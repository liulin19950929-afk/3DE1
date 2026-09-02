import * as THREE from "three";
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import type { Feature, Sketch, Vec2, Vec3, PlaneRef, BodyMeta } from "./types";
import { extractLoops, offsetPolygon, polyArea, pointInPoly, tessellate } from "./sketch";

export interface Body {
  id: string;
  geometry: THREE.BufferGeometry;
  meta: BodyMeta;
}

export interface BuildResult {
  bodies: Body[];
  sketches: { sketch: Sketch; featureId: string; consumed: boolean }[];
  datums: PlaneRef[];
  errors: { featureId: string; message: string }[];
}

const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];
evaluator.useGroups = false;

function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.clearGroups();
  return geo;
}

export function csg(a: THREE.BufferGeometry, b: THREE.BufferGeometry, op: "union" | "subtract" | "intersect"): THREE.BufferGeometry {
  try {
    const ba = new Brush(prep(a));
    ba.updateMatrixWorld();
    const bb = new Brush(prep(b));
    bb.updateMatrixWorld();
    const code = op === "union" ? ADDITION : op === "subtract" ? SUBTRACTION : INTERSECTION;
    const res = evaluator.evaluate(ba, bb, code);
    const geo = res.geometry.clone();
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  } catch (e) {
    console.warn("CSG failed, fallback merge", e);
    return op === "subtract" ? a : mergeGeometries([a, b]);
  }
}

export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position.array as ArrayLike<number>;
    let n = g.attributes.normal?.array as ArrayLike<number> | undefined;
    if (!n) {
      g.computeVertexNormals();
      n = g.attributes.normal.array as ArrayLike<number>;
    }
    for (let i = 0; i < p.length; i++) {
      pos[o + i] = p[i];
      nor[o + i] = n[i];
    }
    o += p.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return geo;
}

/* ------------------------------------------------------------------ */
/* 平面矩阵                                                             */
/* ------------------------------------------------------------------ */
export function planeMatrix(pl: PlaneRef): THREE.Matrix4 {
  const x = new THREE.Vector3(...pl.xdir).normalize();
  const y = new THREE.Vector3(...pl.ydir).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(new THREE.Vector3(...pl.origin));
  return m;
}

/* ------------------------------------------------------------------ */
/* 草图 → 轮廓                                                          */
/* ------------------------------------------------------------------ */
export function shapesFromSketch(sk: Sketch, thin = 0, onlyIds?: string[]): THREE.Shape[] {
  const ents = onlyIds && onlyIds.length ? sk.entities.filter((e) => onlyIds.includes(e.id)) : sk.entities;
  const loops = extractLoops(ents).filter((l) => l.closed && l.pts.length > 2);
  if (!loops.length) return [];
  const shapes: THREE.Shape[] = [];
  const outers: { pts: Vec2[]; shape: THREE.Shape }[] = [];
  for (const l of loops) {
    const isHole = outers.some((o) => pointInPoly(l.pts[0], o.pts));
    if (thin !== 0) {
      // 薄壁：单侧偏置形成环形截面
      const inner = offsetPolygon(l.pts, -Math.abs(thin) * (polyArea(l.pts) > 0 ? 1 : -1));
      const s = new THREE.Shape(l.pts.map((p) => new THREE.Vector2(p.x, p.y)));
      const h = new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, p.y)));
      s.holes.push(h);
      shapes.push(s);
      outers.push({ pts: l.pts, shape: s });
      continue;
    }
    if (isHole) {
      const host = outers.find((o) => pointInPoly(l.pts[0], o.pts));
      host?.shape.holes.push(new THREE.Path(l.pts.map((p) => new THREE.Vector2(p.x, p.y))));
    } else {
      const s = new THREE.Shape(l.pts.map((p) => new THREE.Vector2(p.x, p.y)));
      shapes.push(s);
      outers.push({ pts: l.pts, shape: s });
    }
  }
  return shapes;
}

/* ------------------------------------------------------------------ */
/* 特征几何                                                             */
/* ------------------------------------------------------------------ */
function applyDraft(geo: THREE.BufferGeometry, z0: number, z1: number, angle: number) {
  if (!angle) return;
  const k = Math.tan((angle * Math.PI) / 180);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // 计算截面中心
  let cx = 0,
    cy = 0,
    n = 0;
  for (let i = 0; i < pos.count; i++) {
    cx += pos.getX(i);
    cy += pos.getY(i);
    n++;
  }
  cx /= n || 1;
  cy /= n || 1;
  const h = z1 - z0 || 1;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = (z - z0) / h;
    const dx = pos.getX(i) - cx,
      dy = pos.getY(i) - cy;
    const r = Math.hypot(dx, dy) || 1;
    const grow = k * (z - z0);
    pos.setXY(i, pos.getX(i) + (dx / r) * grow * (t > 0 ? 1 : 1), pos.getY(i) + (dy / r) * grow);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

export function extrudeGeometry(
  sk: Sketch,
  start: number,
  end: number,
  draft: number,
  thin: number,
  surface: boolean,
  symmetric: boolean,
  curveSegments = 48,
  curveIds?: string[],
): THREE.BufferGeometry | null {
  const shapes = shapesFromSketch(sk, thin, curveIds);
  if (!shapes.length) return null;
  let s = start,
    e = end;
  if (symmetric) {
    const d = Math.abs(end - start);
    s = -d / 2;
    e = d / 2;
  }
  const depth = e - s;
  if (Math.abs(depth) < 1e-6) return null;
  let geo: THREE.BufferGeometry;
  if (surface) {
    // 片体：只生成侧面
    geo = buildSideWalls(shapes, s, e, curveSegments);
  } else {
    geo = new THREE.ExtrudeGeometry(shapes, { depth: Math.abs(depth), bevelEnabled: false, steps: 1, curveSegments });
    if (depth < 0) geo.translate(0, 0, depth);
    geo.translate(0, 0, s);
    if (depth < 0) geo.translate(0, 0, -s + s);
  }
  if (!surface) geo.translate(0, 0, 0);
  applyDraft(geo, Math.min(s, e), Math.max(s, e), draft);
  geo.applyMatrix4(planeMatrix(sk.plane));
  geo.computeVertexNormals();
  return geo;
}

function buildSideWalls(shapes: THREE.Shape[], z0: number, z1: number, seg: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sh of shapes) {
    const rings = [sh.getPoints(seg), ...sh.holes.map((h) => h.getPoints(seg))];
    for (const ring of rings) {
      const pos: number[] = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i],
          b = ring[i + 1];
        pos.push(a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1);
        pos.push(a.x, a.y, z0, b.x, b.y, z1, a.x, a.y, z1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      parts.push(g);
    }
  }
  return parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
}

export function revolveGeometry(sk: Sketch, axis: "x" | "y", angle: number, seg = 64, curveIds?: string[]): THREE.BufferGeometry | null {
  const ents = curveIds && curveIds.length ? sk.entities.filter((e) => curveIds.includes(e.id)) : sk.entities;
  const loops = extractLoops(ents).filter((l) => l.pts.length > 2);
  if (!loops.length) return null;
  const loop = loops[0];
  // 转成 (radius, height)
  const pts = loop.pts.map((p) => (axis === "y" ? new THREE.Vector2(Math.abs(p.x), p.y) : new THREE.Vector2(Math.abs(p.y), p.x)));
  if (loop.closed) pts.push(pts[0].clone());
  const phi = (Math.min(360, Math.max(1, angle)) * Math.PI) / 180;
  const geo = new THREE.LatheGeometry(pts, Math.max(8, Math.round((seg * phi) / (Math.PI * 2))), 0, phi);
  // Lathe 绕 Y 轴：把结果映射回草图平面坐标
  if (axis === "y") {
    // radius→x, height→y：绕草图 Y 轴
    geo.rotateX(0);
  } else {
    geo.rotateZ(Math.PI / 2);
  }
  geo.applyMatrix4(planeMatrix(sk.plane));
  geo.computeVertexNormals();
  return geo;
}

export function sweepGeometry(profile: Sketch, path: Sketch, seg = 48): THREE.BufferGeometry | null {
  const shapes = shapesFromSketch(profile);
  if (!shapes.length) return null;
  const loops = extractLoops(path.entities);
  if (!loops.length) return null;
  const pm = planeMatrix(path.plane);
  const pts3 = loops[0].pts.map((p) => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(pm));
  if (pts3.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(pts3, loops[0].closed);
  const geo = new THREE.ExtrudeGeometry(shapes, { extrudePath: curve, steps: Math.max(24, seg), bevelEnabled: false, curveSegments: 24 });
  geo.computeVertexNormals();
  return geo;
}

export function loftGeometry(sketches: Sketch[], samples = 96): THREE.BufferGeometry | null {
  if (sketches.length < 2) return null;
  const rings: THREE.Vector3[][] = [];
  for (const sk of sketches) {
    const loops = extractLoops(sk.entities).filter((l) => l.closed);
    if (!loops.length) return null;
    const m = planeMatrix(sk.plane);
    rings.push(resampleClosed(loops[0].pts, samples).map((p) => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(m)));
  }
  const pos: number[] = [];
  for (let s = 0; s < rings.length - 1; s++) {
    const A = rings[s],
      B = rings[s + 1];
    for (let i = 0; i < samples; i++) {
      const j = (i + 1) % samples;
      pos.push(A[i].x, A[i].y, A[i].z, B[i].x, B[i].y, B[i].z, B[j].x, B[j].y, B[j].z);
      pos.push(A[i].x, A[i].y, A[i].z, B[j].x, B[j].y, B[j].z, A[j].x, A[j].y, A[j].z);
    }
  }
  // 端盖
  for (const [ring, flip] of [
    [rings[0], true],
    [rings[rings.length - 1], false],
  ] as [THREE.Vector3[], boolean][]) {
    const c = ring.reduce((a, p) => a.add(p.clone()), new THREE.Vector3()).multiplyScalar(1 / ring.length);
    for (let i = 0; i < samples; i++) {
      const j = (i + 1) % samples;
      if (flip) pos.push(c.x, c.y, c.z, ring[j].x, ring[j].y, ring[j].z, ring[i].x, ring[i].y, ring[i].z);
      else pos.push(c.x, c.y, c.z, ring[i].x, ring[i].y, ring[i].z, ring[j].x, ring[j].y, ring[j].z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function resampleClosed(pts: Vec2[], n: number): Vec2[] {
  const per: number[] = [0];
  for (let i = 1; i <= pts.length; i++) per.push(per[i - 1] + Math.hypot(pts[i % pts.length].x - pts[i - 1].x, pts[i % pts.length].y - pts[i - 1].y));
  const total = per[per.length - 1] || 1;
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const d = (k / n) * total;
    let i = 1;
    while (i < per.length && per[i] < d) i++;
    const t = (d - per[i - 1]) / (per[i] - per[i - 1] || 1);
    const a = pts[(i - 1) % pts.length],
      b = pts[i % pts.length];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

export function fillGeometry(sk: Sketch): THREE.BufferGeometry | null {
  const shapes = shapesFromSketch(sk);
  if (!shapes.length) return null;
  const geo = new THREE.ShapeGeometry(shapes, 48);
  geo.applyMatrix4(planeMatrix(sk.plane));
  geo.computeVertexNormals();
  return geo;
}

export function primitiveGeometry(shape: string, p: Record<string, number | string>): THREE.BufferGeometry {
  const n = (k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
  let g: THREE.BufferGeometry;
  switch (shape) {
    case "cylinder":
      g = new THREE.CylinderGeometry(n("r", 15), n("r", 15), n("h", 30), 64);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, n("h", 30) / 2);
      break;
    case "sphere":
      g = new THREE.SphereGeometry(n("r", 20), 48, 32);
      break;
    case "cone":
      g = new THREE.ConeGeometry(n("r", 15), n("h", 30), 48);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, n("h", 30) / 2);
      break;
    case "torus":
      g = new THREE.TorusGeometry(n("r", 20), n("t", 5), 24, 64);
      break;
    case "tube":
      g = new THREE.TorusKnotGeometry(n("r", 16), n("t", 4), 96, 16);
      break;
    case "thread": {
      // 圆柱面上车出真实螺旋牙型
      const R = n("r", 10),
        H = n("h", 24),
        pitch = n("pitch", 1.5),
        depth = n("depth", 0.9);
      const turns = H / pitch;
      const pts: THREE.Vector3[] = [];
      const stepsN = Math.max(48, Math.round(turns * 48));
      for (let i = 0; i <= stepsN; i++) {
        const t = i / stepsN;
        const a = t * turns * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, t * H));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      g = new THREE.TubeGeometry(curve, stepsN, depth, 4, false);
      break;
    }
    default:
      g = new THREE.BoxGeometry(n("x", 40), n("y", 30), n("z", 20));
      g.translate(0, 0, n("z", 20) / 2);
  }
  g.translate(n("px", 0), n("py", 0), n("pz", 0));
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* 拓扑：面与边                                                          */
/* ------------------------------------------------------------------ */
export interface FaceInfo {
  id: number;
  tris: number[];
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
  area: number;
  planar: boolean;
}

/**
 * 面识别：按相邻三角面的二面角做区域生长。
 * angleTol = 1 - cos(θ)；默认 θ≈30°，足以把细分很密的圆柱侧面并成一张面，
 * 又不会跨过真正的棱边（90° 拐角）。
 */
export function computeFaces(geo: THREE.BufferGeometry, angleTol = 1 - Math.cos((32 * Math.PI) / 180)): FaceInfo[] {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array as ArrayLike<number>;
  const triCount = pos.length / 9;
  const normals: THREE.Vector3[] = [];
  const centroids: THREE.Vector3[] = [];
  const areas: number[] = [];
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const edgeMap = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const a = new THREE.Vector3(pos[o], pos[o + 1], pos[o + 2]);
    const b = new THREE.Vector3(pos[o + 3], pos[o + 4], pos[o + 5]);
    const c = new THREE.Vector3(pos[o + 6], pos[o + 7], pos[o + 8]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    areas.push(n.length() / 2);
    normals.push(n.normalize());
    centroids.push(new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3));
    const ks = [key(a.x, a.y, a.z), key(b.x, b.y, b.z), key(c.x, c.y, c.z)];
    for (let i = 0; i < 3; i++) {
      const e = [ks[i], ks[(i + 1) % 3]].sort().join("|");
      const arr = edgeMap.get(e);
      if (arr) arr.push(t);
      else edgeMap.set(e, [t]);
    }
  }
  const faceOf = new Int32Array(triCount).fill(-1);
  const faces: FaceInfo[] = [];
  const adj: number[][] = Array.from({ length: triCount }, () => []);
  for (const [, tris] of edgeMap) {
    if (tris.length === 2) {
      adj[tris[0]].push(tris[1]);
      adj[tris[1]].push(tris[0]);
    }
  }
  for (let t = 0; t < triCount; t++) {
    if (faceOf[t] >= 0) continue;
    const id = faces.length;
    const stack = [t];
    const tris: number[] = [];
    faceOf[t] = id;
    while (stack.length) {
      const cur = stack.pop()!;
      tris.push(cur);
      for (const nb of adj[cur]) {
        if (faceOf[nb] >= 0) continue;
        // 与「相邻三角面」比较二面角，而不是与种子面比较：
        // 这样圆柱侧面绕一圈也能合成一张面，而不会被切成很多竖条。
        if (normals[nb].dot(normals[cur]) > 1 - angleTol) {
          faceOf[nb] = id;
          stack.push(nb);
        }
      }
    }
    let area = 0;
    const cen = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (const tri of tris) {
      area += areas[tri];
      cen.addScaledVector(centroids[tri], areas[tri]);
      nrm.addScaledVector(normals[tri], areas[tri]);
    }
    cen.multiplyScalar(1 / (area || 1));
    nrm.normalize();
    let planar = true;
    for (const tri of tris) if (normals[tri].dot(nrm) < 0.999) planar = false;
    faces.push({ id, tris, normal: nrm, centroid: cen, area, planar });
  }
  return faces;
}

export interface EdgeGroup {
  id: number;
  segments: [THREE.Vector3, THREE.Vector3][];
  n1: THREE.Vector3;
  n2: THREE.Vector3;
  convex: boolean;
  length: number;
  mid: THREE.Vector3;
}

export function computeEdges(geo: THREE.BufferGeometry, angleDeg = 25): EdgeGroup[] {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array as ArrayLike<number>;
  const triCount = pos.length / 9;
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const map = new Map<string, { tris: number[]; p: [THREE.Vector3, THREE.Vector3] }>();
  const normals: THREE.Vector3[] = [];
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const a = new THREE.Vector3(pos[o], pos[o + 1], pos[o + 2]);
    const b = new THREE.Vector3(pos[o + 3], pos[o + 4], pos[o + 5]);
    const c = new THREE.Vector3(pos[o + 6], pos[o + 7], pos[o + 8]);
    normals.push(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize());
    const verts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const p1 = verts[i],
        p2 = verts[(i + 1) % 3];
      const k = [key(p1.x, p1.y, p1.z), key(p2.x, p2.y, p2.z)].sort().join("|");
      const rec = map.get(k);
      if (rec) rec.tris.push(t);
      else map.set(k, { tris: [t], p: [p1.clone(), p2.clone()] });
    }
  }
  const cosTol = Math.cos((angleDeg * Math.PI) / 180);
  const feats: { seg: [THREE.Vector3, THREE.Vector3]; n1: THREE.Vector3; n2: THREE.Vector3; convex: boolean }[] = [];
  for (const [, rec] of map) {
    if (rec.tris.length === 1) {
      feats.push({ seg: rec.p, n1: normals[rec.tris[0]], n2: normals[rec.tris[0]], convex: true });
    } else if (rec.tris.length === 2) {
      const n1 = normals[rec.tris[0]],
        n2 = normals[rec.tris[1]];
      if (n1.dot(n2) < cosTol) {
        const dir = new THREE.Vector3().subVectors(rec.p[1], rec.p[0]).normalize();
        const cross = new THREE.Vector3().crossVectors(n1, n2);
        feats.push({ seg: rec.p, n1, n2, convex: cross.dot(dir) < 0 });
      }
    }
  }
  // 按共享端点 + 法线对分组
  const groups: EdgeGroup[] = [];
  const used = new Array(feats.length).fill(false);
  const pkey = (v: THREE.Vector3) => key(v.x, v.y, v.z);
  const byPoint = new Map<string, number[]>();
  feats.forEach((f, i) => {
    for (const p of f.seg) {
      const k = pkey(p);
      const arr = byPoint.get(k);
      if (arr) arr.push(i);
      else byPoint.set(k, [i]);
    }
  });
  for (let i = 0; i < feats.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const stack = [i];
    const members: number[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const p of feats[cur].seg) {
        for (const nb of byPoint.get(pkey(p)) || []) {
          if (used[nb]) continue;
          const A = feats[cur],
            B = feats[nb];
          const same = (A.n1.dot(B.n1) > 0.98 && A.n2.dot(B.n2) > 0.98) || (A.n1.dot(B.n2) > 0.98 && A.n2.dot(B.n1) > 0.98);
          if (same) {
            used[nb] = true;
            stack.push(nb);
          }
        }
      }
    }
    const segs = members.map((m) => feats[m].seg);
    let length = 0;
    const mid = new THREE.Vector3();
    for (const s of segs) {
      length += s[0].distanceTo(s[1]);
      mid.add(s[0]).add(s[1]);
    }
    mid.multiplyScalar(1 / (segs.length * 2 || 1));
    groups.push({ id: groups.length, segments: segs, n1: feats[i].n1, n2: feats[i].n2, convex: feats[i].convex, length, mid });
  }
  return groups.sort((a, b) => b.length - a.length);
}

/* ------------------------------------------------------------------ */
/* 圆角 / 倒角                                                          */
/* ------------------------------------------------------------------ */
export function filletBody(geo: THREE.BufferGeometry, edgeIdx: number[], radius: number, mode: "fillet" | "chamfer"): THREE.BufferGeometry {
  const edges = computeEdges(geo);
  let result = geo;
  for (const idx of edgeIdx) {
    const eg = edges[idx];
    if (!eg) continue;
    for (const seg of eg.segments) {
      const tool = cornerTool(seg[0], seg[1], eg.n1, eg.n2, radius, mode, eg.convex);
      if (!tool) continue;
      result = eg.convex ? csg(result, tool, "subtract") : csg(result, tool, "union");
    }
  }
  result.computeVertexNormals();
  return result;
}

function cornerTool(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  n1: THREE.Vector3,
  n2: THREE.Vector3,
  r: number,
  mode: "fillet" | "chamfer",
  convex: boolean,
): THREE.BufferGeometry | null {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const L = dir.length();
  if (L < 1e-6) return null;
  dir.normalize();
  const s = convex ? 1 : -1;
  // 面内方向（垂直于边，指向材料内部）
  const t1 = new THREE.Vector3().crossVectors(n1, dir).normalize();
  if (t1.dot(n2) * s > 0) t1.negate();
  const t2 = new THREE.Vector3().crossVectors(n2, dir).normalize();
  if (t2.dot(n1) * s > 0) t2.negate();
  const cosA = Math.max(-0.999, Math.min(0.999, t1.dot(t2)));
  const ang = Math.acos(cosA);
  if (ang < 0.05 || ang > Math.PI - 0.02) return null;
  const tan = r / Math.tan(ang / 2);
  const bis = new THREE.Vector3().addVectors(t1, t2).normalize();
  const c = bis.clone().multiplyScalar(r / Math.sin(ang / 2));
  const P1 = t1.clone().multiplyScalar(tan);
  const P2 = t2.clone().multiplyScalar(tan);
  // 在 (u,v) 局部坐标里构造截面
  const u = t1.clone();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const to2 = (p: THREE.Vector3) => new THREE.Vector2(p.dot(u), p.dot(v));
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), to2(P1)];
  if (mode === "fillet") {
    const c2 = to2(c),
      a2 = to2(P1),
      b2 = to2(P2);
    let a0 = Math.atan2(a2.y - c2.y, a2.x - c2.x);
    let a1 = Math.atan2(b2.y - c2.y, b2.x - c2.x);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const N = 12;
    for (let i = 1; i <= N; i++) {
      const a = a0 + (da * i) / N;
      pts.push(new THREE.Vector2(c2.x + Math.cos(a) * r, c2.y + Math.sin(a) * r));
    }
  }
  pts.push(to2(P2));
  const shape = new THREE.Shape(pts);
  const ext = L + Math.max(r, 1) * 0.02;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: ext, bevelEnabled: false, steps: 1 });
  // 局部坐标 (u,v,dir) → 世界
  const m = new THREE.Matrix4().makeBasis(u, v, dir);
  m.setPosition(p0.clone().addScaledVector(dir, -ext * 0.005));
  geo.applyMatrix4(m);
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* 抽壳 / 拔模 / 加厚                                                    */
/* ------------------------------------------------------------------ */
export function offsetGeometry(geo: THREE.BufferGeometry, d: number): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).clone();
  g.computeVertexNormals();
  // 使用平滑法线做顶点偏置
  const smooth = smoothNormals(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + smooth[i * 3] * d, pos.getY(i) + smooth[i * 3 + 1] * d, pos.getZ(i) + smooth[i * 3 + 2] * d);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * 着色法线
 * ------------------------------------------------------------------
 * flat   : 每个三角面用自己的面法线 → 能看到分面棱线（平面着色）
 * smooth : 按「折痕角」合并同一位置的法线 → 圆柱/圆角面平滑连续，
 *          真正的棱边（夹角大于折痕角）仍然保持锐利。
 */
export function applyShading(geo: THREE.BufferGeometry, mode: "flat" | "smooth", creaseDeg = 40) {
  const g = geo;
  const pos = g.attributes.position.array as ArrayLike<number>;
  const count = pos.length / 3;
  const nor = new Float32Array(count * 3);

  // 1) 面法线
  const fn = new Float32Array((count / 3) * 3);
  for (let t = 0; t < count / 3; t++) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o],
      uy = pos[o + 4] - pos[o + 1],
      uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o],
      vy = pos[o + 7] - pos[o + 1],
      vz = pos[o + 8] - pos[o + 2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx / l;
    fn[t * 3 + 1] = ny / l;
    fn[t * 3 + 2] = nz / l;
  }

  if (mode === "flat") {
    for (let t = 0; t < count / 3; t++)
      for (let k = 0; k < 3; k++) {
        nor[(t * 3 + k) * 3] = fn[t * 3];
        nor[(t * 3 + k) * 3 + 1] = fn[t * 3 + 1];
        nor[(t * 3 + k) * 3 + 2] = fn[t * 3 + 2];
      }
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    return;
  }

  // 2) 按位置分桶
  const buckets = new Map<string, number[]>();
  const key = (i: number) => `${Math.round(pos[i * 3] * 2e3)},${Math.round(pos[i * 3 + 1] * 2e3)},${Math.round(pos[i * 3 + 2] * 2e3)}`;
  for (let i = 0; i < count; i++) {
    const k = key(i);
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }

  // 3) 折痕角内的面法线求平均
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  for (const [, idxs] of buckets) {
    for (const i of idxs) {
      const t = (i / 3) | 0;
      const nx0 = fn[t * 3],
        ny0 = fn[t * 3 + 1],
        nz0 = fn[t * 3 + 2];
      let ax = 0,
        ay = 0,
        az = 0;
      for (const j of idxs) {
        const tj = (j / 3) | 0;
        const nx = fn[tj * 3],
          ny = fn[tj * 3 + 1],
          nz = fn[tj * 3 + 2];
        if (nx * nx0 + ny * ny0 + nz * nz0 >= cosCrease) {
          ax += nx;
          ay += ny;
          az += nz;
        }
      }
      const l = Math.hypot(ax, ay, az) || 1;
      nor[i * 3] = ax / l;
      nor[i * 3 + 1] = ay / l;
      nor[i * 3 + 2] = az / l;
    }
  }
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
}

function smoothNormals(g: THREE.BufferGeometry): Float32Array {
  const pos = g.attributes.position.array as ArrayLike<number>;
  const nor = g.attributes.normal.array as ArrayLike<number>;
  const map = new Map<string, [number, number, number, number]>();
  const key = (i: number) => `${Math.round(pos[i * 3] * 1e3)},${Math.round(pos[i * 3 + 1] * 1e3)},${Math.round(pos[i * 3 + 2] * 1e3)}`;
  const count = pos.length / 3;
  for (let i = 0; i < count; i++) {
    const k = key(i);
    const rec = map.get(k) || [0, 0, 0, 0];
    rec[0] += nor[i * 3];
    rec[1] += nor[i * 3 + 1];
    rec[2] += nor[i * 3 + 2];
    rec[3]++;
    map.set(k, rec);
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const rec = map.get(key(i))!;
    const l = Math.hypot(rec[0], rec[1], rec[2]) || 1;
    out[i * 3] = rec[0] / l;
    out[i * 3 + 1] = rec[1] / l;
    out[i * 3 + 2] = rec[2] / l;
  }
  return out;
}

export function shellBody(geo: THREE.BufferGeometry, thickness: number, openFace?: FaceInfo): THREE.BufferGeometry {
  const inner = offsetGeometry(geo, -Math.abs(thickness));
  if (openFace) {
    const n = openFace.normal.clone().multiplyScalar(Math.abs(thickness) * 1.05);
    inner.translate(n.x, n.y, n.z);
  }
  return csg(geo, inner, "subtract");
}

export function draftBody(geo: THREE.BufferGeometry, dir: Vec3, angle: number): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const d = new THREE.Vector3(...dir).normalize();
  const base = bb.min.clone().dot(d);
  const k = Math.tan((angle * Math.PI) / 180);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const smooth = smoothNormals(g);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = new THREE.Vector3(smooth[i * 3], smooth[i * 3 + 1], smooth[i * 3 + 2]);
    const vertical = Math.abs(n.dot(d));
    if (vertical > 0.7) continue; // 顶/底面不动
    const h = v.dot(d) - base;
    const lateral = n.clone().addScaledVector(d, -n.dot(d));
    if (lateral.lengthSq() < 1e-9) continue;
    lateral.normalize().multiplyScalar(k * h);
    pos.setXYZ(i, v.x + lateral.x, v.y + lateral.y, v.z + lateral.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export function pushPullFace(geo: THREE.BufferGeometry, face: FaceInfo, distance: number): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).clone();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const moved = new Set<string>();
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  for (const t of face.tris) {
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      moved.add(key(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
  }
  const n = face.normal.clone().multiplyScalar(distance);
  for (let i = 0; i < pos.count; i++) {
    if (moved.has(key(pos.getX(i), pos.getY(i), pos.getZ(i)))) {
      pos.setXYZ(i, pos.getX(i) + n.x, pos.getY(i) + n.y, pos.getZ(i) + n.z);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export function thickenSheet(geo: THREE.BufferGeometry, t: number): THREE.BufferGeometry {
  const a = (geo.index ? geo.toNonIndexed() : geo).clone();
  const b = offsetGeometry(a, t);
  // 简化：并集两层 + 侧壁由 CSG 处理
  return csg(a, b, "union");
}

/* ------------------------------------------------------------------ */
/* 特征重建                                                             */
/* ------------------------------------------------------------------ */
export function buildModel(
  features: Feature[],
  metas: Record<string, BodyMeta>,
  upto = Infinity,
  tessellation = 48,
  shading: "flat" | "smooth" = "smooth",
): BuildResult {
  const bodies: Body[] = [];
  const sketches: BuildResult["sketches"] = [];
  const datums: PlaneRef[] = [];
  const errors: BuildResult["errors"] = [];
  const sketchById = new Map<string, Sketch>();

  const meta = (id: string, name: string, extra?: Partial<BodyMeta>): BodyMeta => ({
    id,
    name,
    color: metas[id]?.color || "#b8c4d0",
    visible: metas[id]?.visible ?? true,
    opacity: metas[id]?.opacity ?? 1,
    ...extra,
  });

  // 体 id 与创建它的特征绑定，重建后保持稳定（颜色 / 显隐 / 选择不丢）
  let curFeatureId = "f";
  let bodySeq = 0;
  const push = (geo: THREE.BufferGeometry | null, name: string, id?: string, extra?: Partial<BodyMeta>) => {
    if (!geo || !geo.attributes.position || geo.attributes.position.count < 3) return null;
    const bid = id || `${curFeatureId}#${bodySeq++}`;
    const b: Body = { id: bid, geometry: geo, meta: meta(bid, name, extra) };
    bodies.push(b);
    return b;
  };

  const applyBool = (geo: THREE.BufferGeometry | null, op: string, name: string) => {
    if (!geo) return;
    if (op === "new" || bodies.length === 0) {
      push(geo, name);
      return;
    }
    const target = bodies[bodies.length - 1];
    if (op === "add") target.geometry = csg(target.geometry, geo, "union");
    else if (op === "cut") target.geometry = csg(target.geometry, geo, "subtract");
    else if (op === "intersect") target.geometry = csg(target.geometry, geo, "intersect");
    else push(geo, name);
  };

  features.forEach((f, i) => {
    if (i >= upto || f.suppressed) return;
    curFeatureId = f.id;
    bodySeq = 0;
    try {
      switch (f.type) {
        case "sketch":
          sketchById.set(f.sketch.id, f.sketch);
          sketches.push({ sketch: f.sketch, featureId: f.id, consumed: false });
          break;
        case "datum": {
          const base = f.base;
          const p: PlaneRef =
            base === "XY"
              ? { name: f.name, origin: [0, 0, f.offset], xdir: [1, 0, 0], ydir: [0, 1, 0] }
              : base === "XZ"
                ? { name: f.name, origin: [0, f.offset, 0], xdir: [1, 0, 0], ydir: [0, 0, 1] }
                : { name: f.name, origin: [f.offset, 0, 0], xdir: [0, 1, 0], ydir: [0, 0, 1] };
          if (f.mode === "angle" && f.angle) {
            const rad = (f.angle * Math.PI) / 180;
            const m = new THREE.Matrix4().makeRotationX(rad);
            const y = new THREE.Vector3(...p.ydir).applyMatrix4(m);
            p.ydir = [y.x, y.y, y.z];
          }
          datums.push(p);
          break;
        }
        case "extrude": {
          const sk = sketchById.get(f.sketchId);
          if (!sk) throw new Error("找不到草图");
          const geo = extrudeGeometry(sk, f.start, f.end, f.draft, f.thin, f.surface, f.symmetric, tessellation, f.curveIds);
          const rec = sketches.find((s) => s.sketch.id === f.sketchId);
          if (rec) rec.consumed = true;
          if (f.surface) push(geo, f.name, undefined, { isSheet: true });
          else applyBool(geo, f.op, f.name);
          break;
        }
        case "revolve": {
          const sk = sketchById.get(f.sketchId);
          if (!sk) throw new Error("找不到草图");
          const geo = revolveGeometry(sk, f.axis, f.angle, tessellation, f.curveIds);
          const rec = sketches.find((s) => s.sketch.id === f.sketchId);
          if (rec) rec.consumed = true;
          applyBool(geo, f.op, f.name);
          break;
        }
        case "sweep": {
          const p = sketchById.get(f.sketchId),
            path = sketchById.get(f.pathId);
          if (!p || !path) throw new Error("需要截面与引导线");
          applyBool(sweepGeometry(p, path, tessellation), f.op, f.name);
          break;
        }
        case "loft": {
          const sks = f.sketchIds.map((id) => sketchById.get(id)).filter(Boolean) as Sketch[];
          applyBool(loftGeometry(sks), f.op, f.name);
          break;
        }
        case "fill": {
          const sk = sketchById.get(f.sketchId);
          if (sk) push(fillGeometry(sk), f.name, undefined, { isSheet: true });
          break;
        }
        case "primitive":
          applyBool(primitiveGeometry(f.shape, f.params), f.op, f.name);
          break;
        case "boolean": {
          const targets = bodies.filter((b) => f.targets.includes(b.id));
          const tools = bodies.filter((b) => f.tools.includes(b.id));
          if (!targets.length || !tools.length) throw new Error("布尔需要目标体与工具体");
          for (const t of targets) for (const to of tools) t.geometry = csg(t.geometry, to.geometry, f.op);
          for (const to of tools) {
            const i2 = bodies.indexOf(to);
            if (i2 >= 0 && !f.targets.includes(to.id)) bodies.splice(i2, 1);
          }
          break;
        }
        case "fillet": {
          const b = bodies.find((x) => x.id === f.bodyId) || bodies[bodies.length - 1];
          if (b) b.geometry = filletBody(b.geometry, f.edges, f.radius, f.mode);
          break;
        }
        case "shell": {
          const b = bodies.find((x) => x.id === f.bodyId) || bodies[bodies.length - 1];
          if (b) {
            const faces = computeFaces(b.geometry);
            const of = f.openFaces.length ? faces[f.openFaces[0]] : undefined;
            b.geometry = shellBody(b.geometry, f.thickness, of);
          }
          break;
        }
        case "draftFeat": {
          const b = bodies.find((x) => x.id === f.bodyId) || bodies[bodies.length - 1];
          if (b) b.geometry = draftBody(b.geometry, f.dir, f.angle);
          break;
        }
        case "thicken": {
          const b = bodies.find((x) => x.id === f.bodyId) || bodies[bodies.length - 1];
          if (b) {
            b.geometry = thickenSheet(b.geometry, f.thickness);
            b.meta.isSheet = false;
          }
          break;
        }
        case "pushpull": {
          const b = bodies.find((x) => x.id === f.bodyId) || bodies[bodies.length - 1];
          if (b) {
            const faces = computeFaces(b.geometry);
            const face =
              faces.find((fa) => faceKey(fa) === f.faceKey) ||
              faces.reduce((best, fa) => (fa.centroid.distanceTo(new THREE.Vector3(...f.normal)) < best.centroid.distanceTo(new THREE.Vector3(...f.normal)) ? fa : best), faces[0]);
            if (face) b.geometry = pushPullFace(b.geometry, face, f.distance);
          }
          break;
        }
        case "transform": {
          const b = bodies.find((x) => x.id === f.bodyId) || bodies[bodies.length - 1];
          if (!b) break;
          const mk = (m: THREE.Matrix4) => {
            const g = b.geometry.clone();
            g.applyMatrix4(m);
            return g;
          };
          if (f.mode === "move") {
            const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((f.rx * Math.PI) / 180, (f.ry * Math.PI) / 180, (f.rz * Math.PI) / 180));
            m.setPosition(f.dx, f.dy, f.dz);
            if (f.copy) push(mk(m), f.name + " 副本");
            else b.geometry = mk(m);
          } else if (f.mode === "mirror") {
            const m = new THREE.Matrix4().makeScale(f.axis === "x" ? -1 : 1, f.axis === "y" ? -1 : 1, f.axis === "z" ? -1 : 1);
            const g = mk(m);
            g.scale(1, 1, 1);
            const flipped = flipWinding(g);
            if (f.copy) push(flipped, f.name + " 镜像");
            else b.geometry = flipped;
          } else if (f.mode === "linear") {
            // 两个方向的线性阵列
            const n1 = Math.max(2, f.count);
            const n2 = Math.max(1, f.count2 ?? 1);
            const parts: THREE.BufferGeometry[] = [];
            for (let i = 0; i < n1; i++)
              for (let j = 0; j < n2; j++) {
                if (i === 0 && j === 0) {
                  parts.push(b.geometry);
                  continue;
                }
                const m = new THREE.Matrix4().makeTranslation(
                  f.dx * i + (f.dx2 ?? 0) * j,
                  f.dy * i + (f.dy2 ?? 0) * j,
                  f.dz * i + (f.dz2 ?? 0) * j,
                );
                parts.push(mk(m));
              }
            b.geometry = mergeGeometries(parts);
          } else if (f.mode === "circular") {
            const parts = [b.geometry];
            for (let k = 1; k < Math.max(2, f.count); k++) {
              const a = ((Math.PI * 2) / Math.max(2, f.count)) * k;
              const m = f.axis === "z" ? new THREE.Matrix4().makeRotationZ(a) : f.axis === "y" ? new THREE.Matrix4().makeRotationY(a) : new THREE.Matrix4().makeRotationX(a);
              parts.push(mk(m));
            }
            b.geometry = mergeGeometries(parts);
          } else if (f.mode === "scale") {
            b.geometry = mk(new THREE.Matrix4().makeScale(f.scale, f.scale, f.scale));
          }
          break;
        }
        case "delete": {
          const i2 = bodies.findIndex((x) => x.id === f.bodyId);
          if (i2 >= 0) bodies.splice(i2, 1);
          break;
        }
        case "import": {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(f.positions, 3));
          if (f.indices.length) geo.setIndex(f.indices);
          geo.computeVertexNormals();
          push(geo, f.name, f.id, { fromMesh: true });
          break;
        }
      }
    } catch (e) {
      errors.push({ featureId: f.id, message: (e as Error).message });
    }
  });

  for (const b of bodies) {
    // 统一为非索引三角面：分析着色、面/边拓扑与导出都基于同一份数据
    if (b.geometry.index) b.geometry = b.geometry.toNonIndexed();
    applyShading(b.geometry, shading);
    b.geometry.computeBoundingBox();
  }
  return { bodies, sketches, datums, errors };
}

function flipWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let t = 0; t < pos.count; t += 3) {
    const x = pos.getX(t + 1),
      y = pos.getY(t + 1),
      z = pos.getZ(t + 1);
    pos.setXYZ(t + 1, pos.getX(t + 2), pos.getY(t + 2), pos.getZ(t + 2));
    pos.setXYZ(t + 2, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function faceKey(f: FaceInfo): string {
  return `${f.normal.x.toFixed(3)},${f.normal.y.toFixed(3)},${f.normal.z.toFixed(3)}@${f.centroid.x.toFixed(2)},${f.centroid.y.toFixed(2)},${f.centroid.z.toFixed(2)}`;
}

/* 草图曲线 → 世界坐标线段（视口显示与拾取） */
export interface SketchLine {
  pts: number[];
  construction: boolean;
  sketchId: string;
  entId: string;
  associative: boolean;
}

export function sketchLines(sk: Sketch): SketchLine[] {
  const m = planeMatrix(sk.plane);
  return sk.entities.map((e) => {
    const poly = tessellate(e, 72);
    const arr: number[] = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const a = new THREE.Vector3(poly[i].x, poly[i].y, 0).applyMatrix4(m);
      const b = new THREE.Vector3(poly[i + 1].x, poly[i + 1].y, 0).applyMatrix4(m);
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    return { pts: arr, construction: !!e.construction, sketchId: sk.id, entId: e.id, associative: !!e.src };
  });
}

/** 相连 / 相切曲线链（曲线规则用） */
export function connectedCurves(sk: Sketch, startId: string, tangentOnly = false): string[] {
  const tol = 0.08;
  const ends = new Map<string, Vec2[]>();
  for (const e of sk.entities) {
    const poly = tessellate(e, 24);
    if (poly.length) ends.set(e.id, [poly[0], poly[poly.length - 1]]);
  }
  const out = new Set<string>([startId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of sk.entities) {
      if (out.has(e.id)) continue;
      const a = ends.get(e.id);
      if (!a) continue;
      for (const id of out) {
        const b = ends.get(id);
        if (!b) continue;
        const touch = a.some((p) => b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < tol));
        if (touch) {
          if (tangentOnly) {
            const ea = sk.entities.find((x) => x.id === e.id)!;
            const eb = sk.entities.find((x) => x.id === id)!;
            if (ea.kind !== eb.kind && ea.kind === "line" && eb.kind === "line") continue;
          }
          out.add(e.id);
          grew = true;
          break;
        }
      }
    }
  }
  return [...out];
}
