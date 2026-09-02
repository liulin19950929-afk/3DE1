import * as THREE from "three";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

export interface MeshData {
  positions: Float32Array;
  indices?: Uint32Array;
  name: string;
  color?: string;
}

/* ============================ STL ============================ */
export function parseSTL(buf: ArrayBuffer, name = "STL"): MeshData[] {
  const view = new DataView(buf);
  const isAscii = (() => {
    const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 512)));
    return /^\s*solid/.test(head) && !/\0/.test(head);
  })();
  if (isAscii) {
    const text = new TextDecoder().decode(new Uint8Array(buf));
    const pos: number[] = [];
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) pos.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    return [{ positions: new Float32Array(pos), name }];
  }
  const tri = view.getUint32(80, true);
  const pos = new Float32Array(tri * 9);
  let o = 84;
  for (let i = 0; i < tri; i++) {
    o += 12;
    for (let v = 0; v < 3; v++) {
      pos[i * 9 + v * 3] = view.getFloat32(o, true);
      pos[i * 9 + v * 3 + 1] = view.getFloat32(o + 4, true);
      pos[i * 9 + v * 3 + 2] = view.getFloat32(o + 8, true);
      o += 12;
    }
    o += 2;
  }
  return [{ positions: pos, name }];
}

export function exportSTL(geos: THREE.BufferGeometry[], binary = true): ArrayBuffer | string {
  const tris: number[][] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i += 9) {
      tris.push([p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], p[i + 6], p[i + 7], p[i + 8]]);
    }
  }
  if (!binary) {
    let s = "solid digit3d\n";
    for (const t of tris) {
      const n = normalOf(t);
      s += `facet normal ${n[0]} ${n[1]} ${n[2]}\n outer loop\n`;
      for (let v = 0; v < 3; v++) s += `  vertex ${t[v * 3]} ${t[v * 3 + 1]} ${t[v * 3 + 2]}\n`;
      s += " endloop\nendfacet\n";
    }
    return s + "endsolid digit3d\n";
  }
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  new TextEncoder().encodeInto("Digit3D Desktop binary STL", new Uint8Array(buf, 0, 80));
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const n = normalOf(t);
    dv.setFloat32(o, n[0], true);
    dv.setFloat32(o + 4, n[1], true);
    dv.setFloat32(o + 8, n[2], true);
    o += 12;
    for (let v = 0; v < 9; v++) {
      dv.setFloat32(o, t[v], true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

function normalOf(t: number[]): [number, number, number] {
  const ux = t[3] - t[0],
    uy = t[4] - t[1],
    uz = t[5] - t[2];
  const vx = t[6] - t[0],
    vy = t[7] - t[1],
    vz = t[8] - t[2];
  const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/* ============================ OBJ ============================ */
export function parseOBJ(text: string, name = "OBJ"): MeshData[] {
  const verts: number[] = [];
  const out: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith("f ")) {
      const p = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split("/")[0], 10));
      for (let i = 1; i + 1 < p.length; i++) {
        for (const vi of [p[0], p[i], p[i + 1]]) {
          const idx = (vi > 0 ? vi - 1 : verts.length / 3 + vi) * 3;
          out.push(verts[idx], verts[idx + 1], verts[idx + 2]);
        }
      }
    }
  }
  return [{ positions: new Float32Array(out), name }];
}

export function exportOBJ(geos: THREE.BufferGeometry[], names: string[]): string {
  let s = "# Digit3D Desktop OBJ export\n";
  let base = 1;
  geos.forEach((g0, gi) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array as ArrayLike<number>;
    s += `o ${names[gi] || "body" + gi}\n`;
    for (let i = 0; i < p.length; i += 3) s += `v ${p[i]} ${p[i + 1]} ${p[i + 2]}\n`;
    for (let i = 0; i < p.length / 3; i += 3) s += `f ${base + i} ${base + i + 1} ${base + i + 2}\n`;
    base += p.length / 3;
  });
  return s;
}

/* ============================ 3MF ============================ */
export function parse3MF(buf: ArrayBuffer): MeshData[] {
  const files = unzipSync(new Uint8Array(buf));
  const key = Object.keys(files).find((k) => k.toLowerCase().endsWith("3dmodel.model"));
  if (!key) throw new Error("3MF 缺少 3dmodel.model");
  const xml = strFromU8(files[key]);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out: MeshData[] = [];
  const objects = Array.from(doc.getElementsByTagName("object"));
  for (const obj of objects) {
    const mesh = obj.getElementsByTagName("mesh")[0];
    if (!mesh) continue;
    const vs = Array.from(mesh.getElementsByTagName("vertex"));
    const ts = Array.from(mesh.getElementsByTagName("triangle"));
    const verts = new Float32Array(vs.length * 3);
    vs.forEach((v, i) => {
      verts[i * 3] = parseFloat(v.getAttribute("x") || "0");
      verts[i * 3 + 1] = parseFloat(v.getAttribute("y") || "0");
      verts[i * 3 + 2] = parseFloat(v.getAttribute("z") || "0");
    });
    const pos = new Float32Array(ts.length * 9);
    ts.forEach((t, i) => {
      const ids = [+(t.getAttribute("v1") || 0), +(t.getAttribute("v2") || 0), +(t.getAttribute("v3") || 0)];
      ids.forEach((id, k) => {
        pos[i * 9 + k * 3] = verts[id * 3];
        pos[i * 9 + k * 3 + 1] = verts[id * 3 + 1];
        pos[i * 9 + k * 3 + 2] = verts[id * 3 + 2];
      });
    });
    out.push({ positions: pos, name: obj.getAttribute("name") || "object" + out.length, color: obj.getAttribute("pid") ? undefined : undefined });
  }
  return out;
}

export function export3MF(geos: THREE.BufferGeometry[], names: string[], colors: string[]): Uint8Array {
  let objects = "";
  geos.forEach((g0, gi) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array as ArrayLike<number>;
    let v = "",
      t = "";
    for (let i = 0; i < p.length; i += 3) v += `<vertex x="${p[i]}" y="${p[i + 1]}" z="${p[i + 2]}"/>`;
    for (let i = 0; i < p.length / 3; i += 3) t += `<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`;
    objects += `<object id="${gi + 1}" type="model" name="${escapeXml(names[gi] || "body")}"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
  });
  const items = geos.map((_, i) => `<item objectid="${i + 1}"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Digit3D Desktop</metadata>
<resources>${objects}</resources><build>${items}</build></model>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  void colors;
  return zipSync({
    "[Content_Types].xml": strToU8(ct),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  });
}

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);

/* ============================ STEP ============================ */
/** 导出 AP203 faceted B-Rep（几何精确到三角面，不含特征历史） */
export function exportSTEP(geos: THREE.BufferGeometry[], names: string[]): string {
  let id = 1;
  const lines: string[] = [];
  const push = (s: string) => {
    lines.push(`#${id}=${s};`);
    return id++;
  };
  const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('digit3d.step','${new Date().toISOString()}',('Digit3D Desktop'),(''),'Digit3D','Digit3D Desktop','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;`;
  const shells: number[] = [];
  geos.forEach((g0, gi) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array as ArrayLike<number>;
    const faces: number[] = [];
    const ptCache = new Map<string, number>();
    const pt = (x: number, y: number, z: number) => {
      const k = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
      const c = ptCache.get(k);
      if (c) return c;
      const n = push(`CARTESIAN_POINT('',(${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}))`);
      ptCache.set(k, n);
      return n;
    };
    for (let i = 0; i < p.length; i += 9) {
      const a = pt(p[i], p[i + 1], p[i + 2]);
      const b = pt(p[i + 3], p[i + 4], p[i + 5]);
      const c = pt(p[i + 6], p[i + 7], p[i + 8]);
      const loop = push(`POLY_LOOP('',(#${a},#${b},#${c}))`);
      const bound = push(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      // 每个三角面配一张平面（AP203 faceted B-Rep）
      const n = normalOf([p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], p[i + 6], p[i + 7], p[i + 8]]);
      const dirZ = push(`DIRECTION('',(${n[0].toFixed(6)},${n[1].toFixed(6)},${n[2].toFixed(6)}))`);
      const ref: [number, number, number] = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const rx = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
      const rl = Math.hypot(rx[0], rx[1], rx[2]) || 1;
      const dirX = push(`DIRECTION('',(${(rx[0] / rl).toFixed(6)},${(rx[1] / rl).toFixed(6)},${(rx[2] / rl).toFixed(6)}))`);
      const place = push(`AXIS2_PLACEMENT_3D('',#${a},#${dirZ},#${dirX})`);
      const plane = push(`PLANE('',#${place})`);
      faces.push(push(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`));
    }
    const shell = push(`CLOSED_SHELL('${escapeStep(names[gi] || "body")}',(${faces.map((f) => "#" + f).join(",")}))`);
    shells.push(push(`MANIFOLD_SOLID_BREP('${escapeStep(names[gi] || "body")}',#${shell})`));
  });
  const ctx = push("APPLICATION_CONTEXT('automotive design')");
  push(`APPLICATION_PROTOCOL_DEFINITION('','config_control_design',1994,#${ctx})`);
  return `${header}\n${lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

const escapeStep = (s: string) => s.replace(/'/g, "''");

/** STEP 导入：解析实体表，重建平面面 / 多边形面（复杂曲面按边界多边形近似） */
export function parseSTEP(text: string): MeshData[] {
  const dataStart = text.indexOf("DATA;");
  const body = dataStart >= 0 ? text.slice(dataStart + 5) : text;
  const entities = new Map<number, { type: string; args: string }>();
  const re = /#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) entities.set(+m[1], { type: m[2], args: m[3] });

  const refs = (s: string): number[] => Array.from(s.matchAll(/#(\d+)/g)).map((x) => +x[1]);
  const nums = (s: string): number[] => Array.from(s.matchAll(/(-?\d+\.\d*(?:[eE][-+]?\d+)?)/g)).map((x) => parseFloat(x[1]));

  const pointOf = (id: number): [number, number, number] | null => {
    const e = entities.get(id);
    if (!e) return null;
    if (e.type === "CARTESIAN_POINT") {
      const n = nums(e.args);
      return [n[0] || 0, n[1] || 0, n[2] || 0];
    }
    if (e.type === "VERTEX_POINT") return pointOf(refs(e.args)[0]);
    return null;
  };

  const polys: [number, number, number][][] = [];

  const loopPoints = (id: number, depth = 0): [number, number, number][] => {
    const e = entities.get(id);
    if (!e || depth > 8) return [];
    if (e.type === "POLY_LOOP") return refs(e.args).map(pointOf).filter(Boolean) as [number, number, number][];
    if (e.type === "EDGE_LOOP") {
      const pts: [number, number, number][] = [];
      for (const oe of refs(e.args)) {
        const o = entities.get(oe);
        if (!o) continue;
        const orient = /\.F\.\s*$/.test(o.args.trim());
        const ec = entities.get(refs(o.args)[0]);
        if (!ec) continue;
        const [v1, v2] = refs(ec.args);
        const p1 = pointOf(v1),
          p2 = pointOf(v2);
        const pair = orient ? [p2, p1] : [p1, p2];
        for (const p of pair) if (p && (!pts.length || dist3(pts[pts.length - 1], p) > 1e-7)) pts.push(p);
      }
      return pts;
    }
    if (e.type === "FACE_OUTER_BOUND" || e.type === "FACE_BOUND") return loopPoints(refs(e.args)[0], depth + 1);
    return [];
  };

  for (const [, e] of entities) {
    if (e.type === "ADVANCED_FACE" || e.type === "FACE_SURFACE") {
      const r = refs(e.args);
      for (const b of r) {
        const bb = entities.get(b);
        if (bb && (bb.type === "FACE_OUTER_BOUND" || bb.type === "FACE_BOUND")) {
          const pts = loopPoints(b);
          if (pts.length >= 3) polys.push(pts);
        }
      }
    }
  }
  if (!polys.length) throw new Error("未找到可解析的面（该 STEP 可能只含 NURBS 曲面，导入器暂以边界近似）");

  const pos: number[] = [];
  for (const poly of polys) {
    // 平面三角化（扇形 + 平面投影）
    const tri = triangulatePolygon(poly);
    pos.push(...tri);
  }
  return [{ positions: new Float32Array(pos), name: "STEP 导入体" }];
}

function dist3(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function triangulatePolygon(poly: [number, number, number][]): number[] {
  const pts = poly.map((p) => new THREE.Vector3(...p));
  if (pts.length === 3) return pts.flatMap((p) => [p.x, p.y, p.z]);
  // 平面法线
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  if (n.lengthSq() < 1e-12) return [];
  n.normalize();
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.dot(u)) > 0.9) u.set(0, 1, 0);
  const xa = new THREE.Vector3().crossVectors(n, u).normalize();
  const ya = new THREE.Vector3().crossVectors(n, xa).normalize();
  const o = pts[0];
  const flat = pts.map((p) => {
    const d = new THREE.Vector3().subVectors(p, o);
    return new THREE.Vector2(d.dot(xa), d.dot(ya));
  });
  const faces = THREE.ShapeUtils.triangulateShape(flat, []);
  const out: number[] = [];
  for (const f of faces) for (const i of f) out.push(pts[i].x, pts[i].y, pts[i].z);
  return out;
}

/* ============================ IGES（仅导入线框/面） ============================ */
export function parseIGES(text: string): { lines: number[] } {
  const params: Record<number, string> = {};
  const dir: { type: number; pStart: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const sec = line[72];
    if (sec === "D") {
      const type = parseInt(line.slice(0, 8).trim(), 10);
      const pStart = parseInt(line.slice(8, 16).trim(), 10);
      if (!isNaN(type)) dir.push({ type, pStart });
    } else if (sec === "P") {
      const seq = parseInt(line.slice(64, 72).trim(), 10);
      params[seq] = (params[seq] || "") + line.slice(0, 64);
    }
  }
  const segs: number[] = [];
  const all = Object.keys(params)
    .map(Number)
    .sort((a, b) => a - b);
  for (const k of all) {
    const raw = params[k];
    const parts = raw.split(",").map((s) => s.trim());
    const type = parseInt(parts[0], 10);
    const v = parts.slice(1).map((x) => parseFloat(x));
    if (type === 110 && v.length >= 6) {
      segs.push(v[0], v[1], v[2], v[3], v[4], v[5]);
    } else if (type === 100 && v.length >= 7) {
      const [zt, cx, cy, x1, y1, x2, y2] = v;
      const r = Math.hypot(x1 - cx, y1 - cy);
      let a0 = Math.atan2(y1 - cy, x1 - cx),
        a1 = Math.atan2(y2 - cy, x2 - cx);
      if (a1 <= a0) a1 += Math.PI * 2;
      const N = 48;
      for (let i = 0; i < N; i++) {
        const t0 = a0 + ((a1 - a0) * i) / N,
          t1 = a0 + ((a1 - a0) * (i + 1)) / N;
        segs.push(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, zt, cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, zt);
      }
    }
  }
  if (!segs.length) throw new Error("IGES 中未找到可解析的曲线实体（本版本 IGES 仅支持导入线框）");
  return { lines: segs };
}

/* ============================ Parasolid X_T（文本头识别） ============================ */
export function parseXT(buf: ArrayBuffer): never {
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 64)));
  if (!/PS[0-9]|\*\*ABCDEFGHIJKLMNOP/.test(head)) throw new Error("不是有效的 Parasolid 文件");
  throw new Error("Parasolid X_T/X_B 需要内核转换器：请从原软件导出 STEP 后导入");
}

export function meshToGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  if (m.indices) g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}
