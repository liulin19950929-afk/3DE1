import { getPool } from "../workers/pool";
import type { MeshData } from "./mesh";

/**
 * 大型 STEP 并行导入
 * ------------------------------------------------------------------
 * 1) 分块并行扫描实体行（正则在 Worker 里跑，主线程不卡）
 * 2) 主线程按拓扑装配面环（轻量指针操作）
 * 3) 面环三角化再次分发到所有线程并行完成
 */
export interface StepProgress {
  stage: "scan" | "topology" | "tessellate" | "done";
  value: number;
  detail?: string;
}

export async function parseSTEPParallel(
  text: string,
  threads: number,
  onProgress?: (p: StepProgress) => void,
): Promise<{ meshes: MeshData[]; ms: number; threads: number; faces: number; entities: number }> {
  const t0 = performance.now();
  const pool = getPool(threads);
  const dataStart = text.indexOf("DATA;");
  const body = dataStart >= 0 ? text.slice(dataStart + 5) : text;

  /* ---------- 1) 并行扫描 ---------- */
  onProgress?.({ stage: "scan", value: 0, detail: "分块扫描实体表…" });
  const n = Math.max(1, Math.min(pool.size, Math.ceil(body.length / 400_000)));
  const chunks: string[] = [];
  if (n === 1) chunks.push(body);
  else {
    let pos = 0;
    const approx = Math.ceil(body.length / n);
    for (let i = 0; i < n; i++) {
      let end = i === n - 1 ? body.length : body.indexOf(";", pos + approx);
      if (end < 0) end = body.length;
      else end += 1;
      chunks.push(body.slice(pos, end));
      pos = end;
      if (pos >= body.length) break;
    }
  }
  const scans = await Promise.all(chunks.map((c, i) => pool.run(i, { op: "stepScan", text: c })));
  const entities = new Map<number, { type: string; args: string }>();
  for (const s of scans as { ids: number[]; types: string[]; args: string[] }[]) {
    for (let i = 0; i < s.ids.length; i++) entities.set(s.ids[i], { type: s.types[i], args: s.args[i] });
  }
  onProgress?.({ stage: "scan", value: 1, detail: `${entities.size} 个实体` });

  /* ---------- 2) 拓扑装配（主线程，纯指针） ---------- */
  onProgress?.({ stage: "topology", value: 0, detail: "装配面环…" });
  const refCache = new Map<string, number[]>();
  const refs = (s: string): number[] => {
    let r = refCache.get(s);
    if (!r) {
      r = [];
      const re = /#(\d+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) r.push(+m[1]);
      refCache.set(s, r);
    }
    return r;
  };
  const numsOf = (s: string): number[] => {
    const out: number[] = [];
    const re = /(-?\d+\.\d*(?:[eE][-+]?\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.push(parseFloat(m[1]));
    return out;
  };
  const ptCache = new Map<number, [number, number, number] | null>();
  const pointOf = (id: number, depth = 0): [number, number, number] | null => {
    if (ptCache.has(id)) return ptCache.get(id)!;
    const e = entities.get(id);
    let res: [number, number, number] | null = null;
    if (e && depth < 4) {
      if (e.type === "CARTESIAN_POINT") {
        const v = numsOf(e.args);
        res = [v[0] || 0, v[1] || 0, v[2] || 0];
      } else if (e.type === "VERTEX_POINT") res = pointOf(refs(e.args)[0], depth + 1);
    }
    ptCache.set(id, res);
    return res;
  };

  const polyFlat: number[] = [];
  const counts: number[] = [];
  const pushLoop = (pts: [number, number, number][]) => {
    if (pts.length < 3) return;
    counts.push(pts.length);
    for (const p of pts) polyFlat.push(p[0], p[1], p[2]);
  };

  const loopPoints = (id: number, depth = 0): [number, number, number][] => {
    const e = entities.get(id);
    if (!e || depth > 6) return [];
    if (e.type === "POLY_LOOP") return refs(e.args).map((r) => pointOf(r)).filter(Boolean) as [number, number, number][];
    if (e.type === "EDGE_LOOP") {
      const pts: [number, number, number][] = [];
      for (const oe of refs(e.args)) {
        const o = entities.get(oe);
        if (!o) continue;
        const reversed = /\.F\.\s*$/.test(o.args.trim());
        const ec = entities.get(refs(o.args)[0]);
        if (!ec) continue;
        const [v1, v2] = refs(ec.args);
        const p1 = pointOf(v1),
          p2 = pointOf(v2);
        const pair = reversed ? [p2, p1] : [p1, p2];
        for (const p of pair) {
          if (!p) continue;
          const last = pts[pts.length - 1];
          if (!last || Math.abs(last[0] - p[0]) > 1e-7 || Math.abs(last[1] - p[1]) > 1e-7 || Math.abs(last[2] - p[2]) > 1e-7) pts.push(p);
        }
      }
      return pts;
    }
    if (e.type === "FACE_OUTER_BOUND" || e.type === "FACE_BOUND") return loopPoints(refs(e.args)[0], depth + 1);
    return [];
  };

  let done = 0;
  const total = entities.size || 1;
  for (const [, e] of entities) {
    if (++done % 20000 === 0) onProgress?.({ stage: "topology", value: done / total });
    if (e.type !== "ADVANCED_FACE" && e.type !== "FACE_SURFACE") continue;
    for (const b of refs(e.args)) {
      const bb = entities.get(b);
      if (bb && (bb.type === "FACE_OUTER_BOUND" || bb.type === "FACE_BOUND")) pushLoop(loopPoints(b));
    }
  }
  if (!counts.length) throw new Error("未找到可解析的面（该 STEP 可能只含 NURBS 曲面）");

  /* ---------- 3) 并行三角化 ---------- */
  onProgress?.({ stage: "tessellate", value: 0, detail: `${counts.length} 个面环` });
  const polys = new Float32Array(polyFlat);
  const countsArr = new Uint32Array(counts);
  const results = await pool.parallel(
    counts.length,
    (start, end) => ({ op: "stepFaces", polys, counts: countsArr, start, end }),
    (v) => onProgress?.({ stage: "tessellate", value: v }),
  );
  let len = 0;
  for (const r of results) len += (r as Float32Array).length;
  const pos = new Float32Array(len);
  let o = 0;
  for (const r of results) {
    pos.set(r as Float32Array, o);
    o += (r as Float32Array).length;
  }
  onProgress?.({ stage: "done", value: 1 });
  return {
    meshes: [{ positions: pos, name: "STEP 导入体" }],
    ms: performance.now() - t0,
    threads: pool.size,
    faces: counts.length,
    entities: entities.size,
  };
}
