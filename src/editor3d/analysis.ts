import * as THREE from "three";
import { getPool } from "../workers/pool";
import type { Body } from "../cad/kernel";

function triData(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = new Float32Array(g.attributes.position.array as ArrayLike<number>);
  const count = pos.length / 9;
  const idx = new Uint32Array(count * 3);
  for (let i = 0; i < count * 3; i++) idx[i] = i;
  return { pos, idx, count };
}

export interface AnalysisRun {
  perBody: Record<string, Float32Array>;
  min: number;
  max: number;
  ms: number;
  threads: number;
}

/** 壁厚分析（射线法，多线程） */
export async function runThickness(
  bodies: Body[],
  precision: 1 | 2 | 3,
  threads: number,
  onProgress?: (p: number) => void,
): Promise<AnalysisRun> {
  const pool = getPool(threads);
  const t0 = performance.now();
  const perBody: Record<string, Float32Array> = {};
  let min = Infinity,
    max = -Infinity;
  for (const b of bodies) {
    const { pos, idx, count } = triData(b.geometry);
    const chunks = await pool.parallel(
      count,
      (start, end) => ({ op: "thickness", pos, idx, start, end, rays: precision }),
      onProgress,
    );
    const out = new Float32Array(count);
    let o = 0;
    for (const c of chunks) {
      out.set(c as Float32Array, o);
      o += (c as Float32Array).length;
    }
    for (const v of out) {
      if (v > 0) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    perBody[b.id] = out;
  }
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = 1;
  return { perBody, min, max, ms: performance.now() - t0, threads: pool.size };
}

/** 拔模分析（四色带，多线程） */
export async function runDraft(bodies: Body[], dir: [number, number, number], threads: number): Promise<AnalysisRun> {
  const pool = getPool(threads);
  const t0 = performance.now();
  const perBody: Record<string, Float32Array> = {};
  let min = Infinity,
    max = -Infinity;
  const n = new THREE.Vector3(...dir).normalize();
  for (const b of bodies) {
    const { pos, idx, count } = triData(b.geometry);
    const chunks = await pool.parallel(count, (start, end) => ({ op: "draft", pos, idx, start, end, dir: [n.x, n.y, n.z] }));
    const out = new Float32Array(count);
    let o = 0;
    for (const c of chunks) {
      out.set(c as Float32Array, o);
      o += (c as Float32Array).length;
    }
    for (const v of out) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    perBody[b.id] = out;
  }
  return { perBody, min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 1, ms: performance.now() - t0, threads: pool.size };
}

export interface MassProps {
  volume: number;
  area: number;
  bbox: [number, number, number];
  centroid: [number, number, number];
  boundingVolume: number;
  ms: number;
  threads: number;
}

/** 体测量：体积 / 面积 / 外形尺寸 / 质心（多线程） */
export async function runMass(geo: THREE.BufferGeometry, threads: number): Promise<MassProps> {
  const pool = getPool(threads);
  const t0 = performance.now();
  const { pos, idx, count } = triData(geo);
  const chunks = await pool.parallel(count, (start, end) => ({ op: "mass", pos, idx, start, end }));
  let vol = 0,
    area = 0,
    cx = 0,
    cy = 0,
    cz = 0;
  for (const c of chunks as { vol: number; area: number; cx: number; cy: number; cz: number }[]) {
    vol += c.vol;
    area += c.area;
    cx += c.cx;
    cy += c.cy;
    cz += c.cz;
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  return {
    volume: Math.abs(vol),
    area,
    bbox: [size.x, size.y, size.z],
    centroid: [cx / (vol || 1), cy / (vol || 1), cz / (vol || 1)],
    boundingVolume: size.x * size.y * size.z,
    ms: performance.now() - t0,
    threads: pool.size,
  };
}

/** 线程基准测试 */
export async function benchmark(threads: number): Promise<{ single: number; multi: number; threads: number }> {
  const pool = getPool(threads);
  const t1 = performance.now();
  await pool.run(0, { op: "bench", n: 8e6 });
  const single = performance.now() - t1;
  const t2 = performance.now();
  await Promise.all(Array.from({ length: pool.size }, (_, i) => pool.run(i, { op: "bench", n: 8e6 })));
  const multi = performance.now() - t2;
  return { single, multi, threads: pool.size };
}

/** 局部半径（自由曲面可读） */
export function localRadius(geo: THREE.BufferGeometry, point: THREE.Vector3): number {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array as ArrayLike<number>;
  const nor = g.attributes.normal?.array as ArrayLike<number> | undefined;
  if (!nor) return Infinity;
  let best = Infinity,
    bi = -1;
  for (let i = 0; i < pos.length; i += 3) {
    const d = (pos[i] - point.x) ** 2 + (pos[i + 1] - point.y) ** 2 + (pos[i + 2] - point.z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  if (bi < 0) return Infinity;
  const p0 = new THREE.Vector3(pos[bi], pos[bi + 1], pos[bi + 2]);
  const n0 = new THREE.Vector3(nor[bi], nor[bi + 1], nor[bi + 2]);
  // 用邻近点的法线变化估算曲率
  let maxAng = 0,
    maxDist = 1;
  for (let i = 0; i < pos.length; i += 3) {
    const p = new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]);
    const dd = p.distanceTo(p0);
    if (dd < 1e-6 || dd > 6) continue;
    const n = new THREE.Vector3(nor[i], nor[i + 1], nor[i + 2]);
    const ang = n0.angleTo(n);
    if (ang > maxAng) {
      maxAng = ang;
      maxDist = dd;
    }
  }
  return maxAng < 1e-4 ? Infinity : maxDist / maxAng;
}
