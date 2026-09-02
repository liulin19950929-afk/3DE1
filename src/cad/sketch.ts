import type { Sketch, SketchEntity, Vec2, Vec3, PlaneRef, SketchDim, SketchConstraint } from "./types";
import { uid } from "./types";

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

/* ---------------- 曲线离散 ---------------- */
export function tessellate(e: SketchEntity, seg = 64): Vec2[] {
  switch (e.kind) {
    case "line":
      return [e.a!, e.b!];
    case "circle": {
      const out: Vec2[] = [];
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI * 2;
        out.push({ x: e.c!.x + Math.cos(t) * e.r!, y: e.c!.y + Math.sin(t) * e.r! });
      }
      return out;
    }
    case "arc": {
      const out: Vec2[] = [];
      let a0 = e.a0!,
        a1 = e.a1!;
      while (a1 < a0) a1 += Math.PI * 2;
      const n = Math.max(6, Math.ceil((seg * (a1 - a0)) / (Math.PI * 2)));
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n;
        out.push({ x: e.c!.x + Math.cos(t) * e.r!, y: e.c!.y + Math.sin(t) * e.r! });
      }
      return out;
    }
    case "ellipse": {
      const out: Vec2[] = [];
      const rot = e.rot || 0;
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI * 2;
        const x = Math.cos(t) * e.rx!,
          y = Math.sin(t) * e.ry!;
        out.push({ x: e.c!.x + x * Math.cos(rot) - y * Math.sin(rot), y: e.c!.y + x * Math.sin(rot) + y * Math.cos(rot) });
      }
      return out;
    }
    case "polygon": {
      const out: Vec2[] = [];
      const n = e.n || 6;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2 + (e.rot || 0);
        out.push({ x: e.c!.x + Math.cos(t) * e.r!, y: e.c!.y + Math.sin(t) * e.r! });
      }
      return out;
    }
    case "spline": {
      const p = e.pts || [];
      if (p.length < 3) return p.slice();
      const out: Vec2[] = [];
      const pts = e.closed ? [...p, p[0]] : p;
      const N = pts.length;
      const get = (i: number) => pts[Math.max(0, Math.min(N - 1, i))];
      for (let i = 0; i < N - 1; i++) {
        const p0 = get(i - 1),
          p1 = get(i),
          p2 = get(i + 1),
          p3 = get(i + 2);
        for (let s = 0; s < 12; s++) {
          const t = s / 12,
            t2 = t * t,
            t3 = t2 * t;
          out.push({
            x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
          });
        }
      }
      out.push(pts[N - 1]);
      return out;
    }
    case "point":
      return [e.c!];
    default:
      return [];
  }
}

export function isClosedEntity(e: SketchEntity) {
  return e.kind === "circle" || e.kind === "ellipse" || e.kind === "polygon" || (e.kind === "spline" && !!e.closed);
}

/* ---------------- 特征点（捕捉） ---------------- */
export interface SnapPoint {
  p: Vec2;
  type: "endpoint" | "midpoint" | "center" | "quadrant" | "intersection" | "oncurve" | "grid" | "origin";
  entId?: string;
}

export function snapPoints(sk: Sketch, opts: Record<string, boolean>): SnapPoint[] {
  const out: SnapPoint[] = [{ p: { x: 0, y: 0 }, type: "origin" }];
  for (const e of sk.entities) {
    if (e.kind === "line") {
      if (opts.endpoint) out.push({ p: e.a!, type: "endpoint", entId: e.id }, { p: e.b!, type: "endpoint", entId: e.id });
      if (opts.midpoint) out.push({ p: mul(add(e.a!, e.b!), 0.5), type: "midpoint", entId: e.id });
    } else if (e.kind === "circle" || e.kind === "arc" || e.kind === "polygon" || e.kind === "ellipse") {
      if (opts.center) out.push({ p: e.c!, type: "center", entId: e.id });
      if (opts.quadrant && e.r) {
        for (let i = 0; i < 4; i++)
          out.push({ p: { x: e.c!.x + Math.cos((i * Math.PI) / 2) * e.r, y: e.c!.y + Math.sin((i * Math.PI) / 2) * e.r }, type: "quadrant", entId: e.id });
      }
      if (e.kind === "arc" && opts.endpoint) {
        out.push({ p: { x: e.c!.x + Math.cos(e.a0!) * e.r!, y: e.c!.y + Math.sin(e.a0!) * e.r! }, type: "endpoint", entId: e.id });
        out.push({ p: { x: e.c!.x + Math.cos(e.a1!) * e.r!, y: e.c!.y + Math.sin(e.a1!) * e.r! }, type: "endpoint", entId: e.id });
      }
    } else if (e.kind === "spline") {
      if (opts.endpoint) for (const p of e.pts || []) out.push({ p, type: "endpoint", entId: e.id });
    }
  }
  if (opts.intersection) {
    const lines = sk.entities.filter((e) => e.kind === "line");
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const p = segIntersect(lines[i].a!, lines[i].b!, lines[j].a!, lines[j].b!);
        if (p) out.push({ p, type: "intersection" });
      }
  }
  return out;
}

export function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a),
    s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/* ---------------- 约束/尺寸求解器（自研迭代式） ---------------- */
type PtRef = { e: SketchEntity; k: "a" | "b" | "c" | number };

function getPt(r: PtRef): Vec2 {
  if (typeof r.k === "number") return r.e.pts![r.k];
  return (r.e as any)[r.k] as Vec2;
}
function setPt(r: PtRef, p: Vec2) {
  if (typeof r.k === "number") r.e.pts![r.k] = p;
  else (r.e as any)[r.k] = p;
}

export function entPts(e: SketchEntity): PtRef[] {
  if (e.kind === "line") return [{ e, k: "a" }, { e, k: "b" }];
  if (e.kind === "spline") return (e.pts || []).map((_, i) => ({ e, k: i }) as PtRef);
  return [{ e, k: "c" }];
}

/** 迭代松弛法求解草图约束与尺寸，最后重算关联副本 */
export function solveSketch(sk: Sketch, iterations = 120) {
  const byId = new Map(sk.entities.map((e) => [e.id, e]));
  for (let it = 0; it < iterations; it++) {
    for (const c of sk.constraints) applyConstraint(c, byId);
    for (const d of sk.dims) applyDim(d, byId);
  }
  regenerateCopies(sk);
}

/** 关联复制重算：副本由源驱动，源改了副本不会走样 */
export function regenerateCopies(sk: Sketch) {
  const byId = new Map(sk.entities.map((e) => [e.id, e]));
  for (const e of sk.entities) {
    if (!e.src || !e.xf) continue;
    const src = byId.get(e.src);
    if (!src) continue;
    let out: SketchEntity;
    if (e.xf.t === "mirror") out = mirrorEntity(src, e.xf.a, e.xf.b);
    else if (e.xf.t === "move") out = translateEntity(src, e.xf.dx, e.xf.dy);
    else out = rotateEntity(src, e.xf.c, e.xf.ang);
    // 保留副本自身的 id / src / xf，几何完全由源驱动
    Object.assign(e, out, { id: e.id, src: e.src, xf: e.xf, construction: src.construction });
  }
}

function applyConstraint(c: SketchConstraint, byId: Map<string, SketchEntity>) {
  const es = c.refs.map((r) => byId.get(r)).filter(Boolean) as SketchEntity[];
  if (!es.length) return;
  const [e1, e2] = es;
  switch (c.type) {
    case "horizontal":
      if (e1?.kind === "line") {
        const m = (e1.a!.y + e1.b!.y) / 2;
        e1.a = { x: e1.a!.x, y: m };
        e1.b = { x: e1.b!.x, y: m };
      }
      break;
    case "vertical":
      if (e1?.kind === "line") {
        const m = (e1.a!.x + e1.b!.x) / 2;
        e1.a = { x: m, y: e1.a!.y };
        e1.b = { x: m, y: e1.b!.y };
      }
      break;
    case "parallel":
    case "perpendicular":
      if (e1?.kind === "line" && e2?.kind === "line") {
        const d1 = norm(sub(e1.b!, e1.a!));
        let target = d1;
        if (c.type === "perpendicular") target = { x: -d1.y, y: d1.x };
        const l2 = dist(e2.a!, e2.b!);
        const mid = mul(add(e2.a!, e2.b!), 0.5);
        const cur = norm(sub(e2.b!, e2.a!));
        const s = cur.x * target.x + cur.y * target.y >= 0 ? 1 : -1;
        e2.a = add(mid, mul(target, (-l2 / 2) * s));
        e2.b = add(mid, mul(target, (l2 / 2) * s));
      }
      break;
    case "equal":
      if (e1 && e2) {
        if (e1.kind === "line" && e2.kind === "line") {
          const L = (dist(e1.a!, e1.b!) + dist(e2.a!, e2.b!)) / 2;
          for (const e of [e1, e2]) {
            const mid = mul(add(e.a!, e.b!), 0.5);
            const d = norm(sub(e.b!, e.a!));
            e.a = add(mid, mul(d, -L / 2));
            e.b = add(mid, mul(d, L / 2));
          }
        } else if (e1.r !== undefined && e2.r !== undefined) {
          const r = (e1.r + e2.r) / 2;
          e1.r = r;
          e2.r = r;
        }
      }
      break;
    case "coincident": {
      // refs: entId:ptKey pairs encoded as "id#k"
      const refs = c.refs.map(decodePt(byId)).filter(Boolean) as PtRef[];
      if (refs.length >= 2) {
        const pts = refs.map(getPt);
        const avg = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
        refs.forEach((r) => setPt(r, { ...avg }));
      }
      break;
    }
    case "concentric":
      if (e1?.c && e2?.c) {
        const avg = mul(add(e1.c, e2.c), 0.5);
        e1.c = { ...avg };
        e2.c = { ...avg };
      }
      break;
    case "midpoint": {
      const refs = c.refs.map(decodePt(byId)).filter(Boolean) as PtRef[];
      if (refs[0] && e2?.kind === "line") setPt(refs[0], mul(add(e2.a!, e2.b!), 0.5));
      break;
    }
    case "pointOnCurve": {
      const refs = c.refs.map(decodePt(byId)).filter(Boolean) as PtRef[];
      if (refs[0] && e2) {
        const p = getPt(refs[0]);
        setPt(refs[0], closestOnEntity(e2, p));
      }
      break;
    }
    case "tangent":
      if (e1?.kind === "line" && e2?.r !== undefined && e2.c) {
        const d = norm(sub(e1.b!, e1.a!));
        const n = { x: -d.y, y: d.x };
        const v = sub(e2.c, e1.a!);
        const signed = v.x * n.x + v.y * n.y;
        const corr = (Math.abs(signed) - e2.r) * Math.sign(signed);
        e2.c = { x: e2.c.x - n.x * corr, y: e2.c.y - n.y * corr };
      }
      break;
    case "symmetric": {
      const refs = c.refs.slice(0, 2).map(decodePt(byId)).filter(Boolean) as PtRef[];
      const axis = byId.get(c.refs[2]);
      if (refs.length === 2 && axis?.kind === "line") {
        const d = norm(sub(axis.b!, axis.a!));
        const n = { x: -d.y, y: d.x };
        const p1 = getPt(refs[0]),
          p2 = getPt(refs[1]);
        const mid = mul(add(p1, p2), 0.5);
        const off = sub(mid, axis.a!);
        const dn = off.x * n.x + off.y * n.y;
        const target = sub(mid, mul(n, dn));
        const half = mul(sub(p1, p2), 0.5);
        const hn = (half.x * n.x + half.y * n.y) * 1;
        setPt(refs[0], add(target, mul(n, hn)));
        setPt(refs[1], add(target, mul(n, -hn)));
      }
      break;
    }
    case "fix":
      break;
  }
}

const decodePt = (byId: Map<string, SketchEntity>) => (ref: string): PtRef | null => {
  const [id, k] = ref.split("#");
  const e = byId.get(id);
  if (!e) return null;
  if (k === undefined) return { e, k: "c" };
  if (k === "a" || k === "b" || k === "c") return { e, k };
  return { e, k: Number(k) };
};

export function closestOnEntity(e: SketchEntity, p: Vec2): Vec2 {
  if (e.kind === "line") {
    const d = sub(e.b!, e.a!);
    const t = Math.max(0, Math.min(1, ((p.x - e.a!.x) * d.x + (p.y - e.a!.y) * d.y) / (d.x * d.x + d.y * d.y || 1)));
    return add(e.a!, mul(d, t));
  }
  if (e.r !== undefined && e.c) {
    const d = norm(sub(p, e.c));
    return add(e.c, mul(d, e.r));
  }
  const poly = tessellate(e);
  let best = poly[0],
    bd = Infinity;
  for (const q of poly) {
    const d = dist(q, p);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

function applyDim(d: SketchDim, byId: Map<string, SketchEntity>) {
  const e1 = byId.get(d.refs[0]?.split("#")[0] || "");
  const e2 = byId.get(d.refs[1]?.split("#")[0] || "");
  if (!e1) return;
  switch (d.type) {
    case "length":
      if (e1.kind === "line") {
        const mid = mul(add(e1.a!, e1.b!), 0.5);
        const dir = norm(sub(e1.b!, e1.a!));
        e1.a = add(mid, mul(dir, -d.value / 2));
        e1.b = add(mid, mul(dir, d.value / 2));
      }
      break;
    case "radius":
      if (e1.r !== undefined) e1.r = d.value;
      break;
    case "diameter":
      if (e1.r !== undefined) e1.r = d.value / 2;
      break;
    case "distX":
    case "distY":
    case "distance": {
      if (e1 && e2 && e1.kind === "line" && e2.kind === "line") {
        // 两条平行线间距
        const n = norm({ x: -(e1.b!.y - e1.a!.y), y: e1.b!.x - e1.a!.x });
        const cur = (e2.a!.x - e1.a!.x) * n.x + (e2.a!.y - e1.a!.y) * n.y;
        const delta = (Math.sign(cur) || 1) * d.value - cur;
        e2.a = add(e2.a!, mul(n, delta));
        e2.b = add(e2.b!, mul(n, delta));
      } else if (e1.kind === "line") {
        const mid = mul(add(e1.a!, e1.b!), 0.5);
        const dir = norm(sub(e1.b!, e1.a!));
        const axis = d.type === "distX" ? { x: 1, y: 0 } : d.type === "distY" ? { x: 0, y: 1 } : dir;
        const cur = Math.abs((e1.b!.x - e1.a!.x) * axis.x + (e1.b!.y - e1.a!.y) * axis.y);
        if (cur > 1e-9) {
          const k = d.value / cur;
          e1.a = add(mid, mul(sub(e1.a!, mid), k));
          e1.b = add(mid, mul(sub(e1.b!, mid), k));
        }
      }
      break;
    }
    case "angle":
      if (e1.kind === "line" && e2?.kind === "line") {
        const d1 = norm(sub(e1.b!, e1.a!));
        const target = (Math.atan2(d1.y, d1.x) * 180) / Math.PI + d.value;
        const rad = (target * Math.PI) / 180;
        const L = dist(e2.a!, e2.b!);
        const mid = mul(add(e2.a!, e2.b!), 0.5);
        e2.a = { x: mid.x - (Math.cos(rad) * L) / 2, y: mid.y - (Math.sin(rad) * L) / 2 };
        e2.b = { x: mid.x + (Math.cos(rad) * L) / 2, y: mid.y + (Math.sin(rad) * L) / 2 };
      }
      break;
  }
}

/** 自由度估算 */
export function degreesOfFreedom(sk: Sketch): number {
  let dof = 0;
  for (const e of sk.entities) {
    if (e.kind === "line") dof += 4;
    else if (e.kind === "circle") dof += 3;
    else if (e.kind === "arc") dof += 5;
    else if (e.kind === "ellipse") dof += 5;
    else if (e.kind === "polygon") dof += 4;
    else if (e.kind === "spline") dof += (e.pts?.length || 0) * 2;
  }
  dof -= sk.constraints.length * 1.5 + sk.dims.length;
  return Math.max(0, Math.round(dof));
}

/* ---------------- 轮廓/环提取 ---------------- */
export interface Loop {
  pts: Vec2[];
  closed: boolean;
  area: number;
}

export function polyArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 把草图曲线链接成环（闭合）与开放链 */
export function extractLoops(entities: SketchEntity[], tol = 0.05): Loop[] {
  const loops: Loop[] = [];
  const chains: Vec2[][] = [];
  for (const e of entities) {
    if (e.construction) continue;
    const pts = tessellate(e);
    if (pts.length < 2) continue;
    if (isClosedEntity(e)) loops.push({ pts: pts.slice(0, -1), closed: true, area: Math.abs(polyArea(pts)) });
    else chains.push(pts);
  }
  // 链接开放链
  const used = new Array(chains.length).fill(false);
  for (let i = 0; i < chains.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let cur = chains[i].slice();
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < chains.length; j++) {
        if (used[j]) continue;
        const c = chains[j];
        const head = cur[0],
          tail = cur[cur.length - 1];
        if (dist(tail, c[0]) < tol) {
          cur = cur.concat(c.slice(1));
          used[j] = true;
          extended = true;
        } else if (dist(tail, c[c.length - 1]) < tol) {
          cur = cur.concat(c.slice().reverse().slice(1));
          used[j] = true;
          extended = true;
        } else if (dist(head, c[c.length - 1]) < tol) {
          cur = c.slice(0, -1).concat(cur);
          used[j] = true;
          extended = true;
        } else if (dist(head, c[0]) < tol) {
          cur = c.slice().reverse().slice(0, -1).concat(cur);
          used[j] = true;
          extended = true;
        }
      }
    }
    const closed = dist(cur[0], cur[cur.length - 1]) < tol && cur.length > 2;
    if (closed) cur = cur.slice(0, -1);
    loops.push({ pts: cur, closed, area: Math.abs(polyArea(cur)) });
  }
  return loops.sort((a, b) => b.area - a.area);
}

/** 多边形等距偏置（正数向外） */
export function offsetPolygon(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  const ccw = polyArea(pts) > 0;
  const s = ccw ? 1 : -1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n],
      cur = pts[i],
      next = pts[(i + 1) % n];
    const d1 = norm(sub(cur, prev)),
      d2 = norm(sub(next, cur));
    const n1 = { x: d1.y * s, y: -d1.x * s },
      n2 = { x: d2.y * s, y: -d2.x * s };
    let bis = norm(add(n1, n2));
    const cosHalf = Math.max(0.25, Math.sqrt(Math.max(0.05, (1 + (n1.x * n2.x + n1.y * n2.y)) / 2)));
    if (!isFinite(bis.x)) bis = n1;
    out.push({ x: cur.x + (bis.x * d) / cosHalf, y: cur.y + (bis.y * d) / cosHalf });
  }
  return out;
}

/* ---------------- 平面 <-> 世界 ---------------- */
export function planeToWorld(pl: PlaneRef, p: Vec2): Vec3 {
  return [
    pl.origin[0] + pl.xdir[0] * p.x + pl.ydir[0] * p.y,
    pl.origin[1] + pl.xdir[1] * p.x + pl.ydir[1] * p.y,
    pl.origin[2] + pl.xdir[2] * p.x + pl.ydir[2] * p.y,
  ];
}

export function planeNormal(pl: PlaneRef): Vec3 {
  const [ax, ay, az] = pl.xdir,
    [bx, by, bz] = pl.ydir;
  const n: Vec3 = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export function newSketch(plane: PlaneRef, name: string): Sketch {
  return { id: uid("sk"), name, plane, entities: [], constraints: [], dims: [] };
}

/* ---------------- 曲线编辑：修剪 / 延伸 / 倒圆角 / 倒角 ---------------- */
export function trimLineAt(e: SketchEntity, others: SketchEntity[], p: Vec2): SketchEntity[] {
  if (e.kind !== "line") return [e];
  const cuts: number[] = [0, 1];
  const d = sub(e.b!, e.a!);
  const L2 = d.x * d.x + d.y * d.y || 1;
  for (const o of others) {
    if (o.id === e.id) continue;
    const pts = tessellate(o);
    for (let i = 0; i < pts.length - 1; i++) {
      const ip = segIntersect(e.a!, e.b!, pts[i], pts[i + 1]);
      if (ip) cuts.push(((ip.x - e.a!.x) * d.x + (ip.y - e.a!.y) * d.y) / L2);
    }
  }
  cuts.sort((a, b) => a - b);
  const t = ((p.x - e.a!.x) * d.x + (p.y - e.a!.y) * d.y) / L2;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < cuts.length - 1; i++) if (t >= cuts[i] && t <= cuts[i + 1]) {
    lo = cuts[i];
    hi = cuts[i + 1];
  }
  const res: SketchEntity[] = [];
  if (lo > 0.001) res.push({ ...e, id: uid("e"), a: e.a!, b: add(e.a!, mul(d, lo)) });
  if (hi < 0.999) res.push({ ...e, id: uid("e"), a: add(e.a!, mul(d, hi)), b: e.b! });
  return res;
}

export function filletLines(l1: SketchEntity, l2: SketchEntity, r: number): { l1: SketchEntity; l2: SketchEntity; arc: SketchEntity } | null {
  if (l1.kind !== "line" || l2.kind !== "line") return null;
  const ip = lineLineIntersect(l1.a!, l1.b!, l2.a!, l2.b!);
  if (!ip) return null;
  const far1 = dist(l1.a!, ip) > dist(l1.b!, ip) ? l1.a! : l1.b!;
  const far2 = dist(l2.a!, ip) > dist(l2.b!, ip) ? l2.a! : l2.b!;
  const d1 = norm(sub(far1, ip)),
    d2 = norm(sub(far2, ip));
  const ang = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
  if (ang < 1e-3 || Math.abs(ang - Math.PI) < 1e-3) return null;
  const t = r / Math.tan(ang / 2);
  const p1 = add(ip, mul(d1, t)),
    p2 = add(ip, mul(d2, t));
  const bis = norm(add(d1, d2));
  const center = add(ip, mul(bis, r / Math.sin(ang / 2)));
  let a0 = Math.atan2(p1.y - center.y, p1.x - center.x);
  let a1 = Math.atan2(p2.y - center.y, p2.x - center.x);
  let da = a1 - a0;
  while (da <= -Math.PI) da += Math.PI * 2;
  while (da > Math.PI) da -= Math.PI * 2;
  if (da < 0) {
    const tmp = a0;
    a0 = a1;
    a1 = tmp;
  }
  return {
    l1: { ...l1, a: far1, b: p1 },
    l2: { ...l2, a: far2, b: p2 },
    arc: { id: uid("e"), kind: "arc", c: center, r, a0, a1 },
  };
}

export function chamferLines(l1: SketchEntity, l2: SketchEntity, d: number): { l1: SketchEntity; l2: SketchEntity; seg: SketchEntity } | null {
  if (l1.kind !== "line" || l2.kind !== "line") return null;
  const ip = lineLineIntersect(l1.a!, l1.b!, l2.a!, l2.b!);
  if (!ip) return null;
  const far1 = dist(l1.a!, ip) > dist(l1.b!, ip) ? l1.a! : l1.b!;
  const far2 = dist(l2.a!, ip) > dist(l2.b!, ip) ? l2.a! : l2.b!;
  const p1 = add(ip, mul(norm(sub(far1, ip)), d));
  const p2 = add(ip, mul(norm(sub(far2, ip)), d));
  return {
    l1: { ...l1, a: far1, b: p1 },
    l2: { ...l2, a: far2, b: p2 },
    seg: { id: uid("e"), kind: "line", a: p1, b: p2 },
  };
}

export function lineLineIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a),
    s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/* ---------------- 阵列 / 镜像 ---------------- */
export function mirrorEntity(e: SketchEntity, a: Vec2, b: Vec2): SketchEntity {
  const d = norm(sub(b, a));
  const f = (p: Vec2): Vec2 => {
    const v = sub(p, a);
    const dp = v.x * d.x + v.y * d.y;
    const proj = add(a, mul(d, dp));
    return { x: 2 * proj.x - p.x, y: 2 * proj.y - p.y };
  };
  const out: SketchEntity = { ...e, id: uid("e") };
  if (e.a) out.a = f(e.a);
  if (e.b) out.b = f(e.b);
  if (e.c) out.c = f(e.c);
  if (e.pts) out.pts = e.pts.map(f);
  if (e.kind === "arc") {
    const a0 = Math.PI - e.a1!,
      a1 = Math.PI - e.a0!;
    out.a0 = a0;
    out.a1 = a1;
  }
  return out;
}

export function translateEntity(e: SketchEntity, dx: number, dy: number): SketchEntity {
  const f = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
  const out: SketchEntity = { ...e, id: uid("e") };
  if (e.a) out.a = f(e.a);
  if (e.b) out.b = f(e.b);
  if (e.c) out.c = f(e.c);
  if (e.pts) out.pts = e.pts.map(f);
  return out;
}

export function rotateEntity(e: SketchEntity, center: Vec2, ang: number): SketchEntity {
  const f = (p: Vec2): Vec2 => {
    const v = sub(p, center);
    return { x: center.x + v.x * Math.cos(ang) - v.y * Math.sin(ang), y: center.y + v.x * Math.sin(ang) + v.y * Math.cos(ang) };
  };
  const out: SketchEntity = { ...e, id: uid("e") };
  if (e.a) out.a = f(e.a);
  if (e.b) out.b = f(e.b);
  if (e.c) out.c = f(e.c);
  if (e.pts) out.pts = e.pts.map(f);
  if (e.kind === "arc") {
    out.a0 = e.a0! + ang;
    out.a1 = e.a1! + ang;
  }
  if (e.kind === "polygon" || e.kind === "ellipse") out.rot = (e.rot || 0) + ang;
  return out;
}

export function rectEntities(a: Vec2, b: Vec2): SketchEntity[] {
  const p1 = a,
    p2 = { x: b.x, y: a.y },
    p3 = b,
    p4 = { x: a.x, y: b.y };
  return [
    { id: uid("e"), kind: "line", a: p1, b: p2 },
    { id: uid("e"), kind: "line", a: p2, b: p3 },
    { id: uid("e"), kind: "line", a: p3, b: p4 },
    { id: uid("e"), kind: "line", a: p4, b: p1 },
  ];
}
