import type { Sketch, SketchEntity, Vec2 } from "../cad/types";
import { uid } from "../cad/types";
import { rectEntities, filletLines, chamferLines, trimLineAt, mirrorEntity, translateEntity, rotateEntity, dist, closestOnEntity, tessellate, solveSketch } from "../cad/sketch";

export interface ToolCtx {
  polygonSides: number;
  filletRadius: number;
  chamferDist: number;
  patternCount: number;
  patternDx: number;
  patternDy: number;
  construction: boolean;
  selection: string[];
  dimValue?: number;
}

interface Pending {
  tool: string;
  pts: Vec2[];
  ids: string[];
}

let pending: Pending | null = null;

export function resetPending() {
  pending = null;
}
export function pendingPoints(): Vec2[] {
  return pending?.pts || [];
}
export function pendingTool(): string | null {
  return pending?.tool || null;
}

function ent(kind: SketchEntity["kind"], extra: Partial<SketchEntity>, ctx: ToolCtx): SketchEntity {
  return { id: uid("e"), kind, construction: ctx.construction, ...extra } as SketchEntity;
}

export function hitEntity(sk: Sketch, p: Vec2, tol: number): SketchEntity | null {
  let best: SketchEntity | null = null;
  let bd = tol;
  for (const e of sk.entities) {
    const q = closestOnEntity(e, p);
    const d = dist(q, p);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** 处理一次点击；返回是否修改了草图 */
export function sketchClick(sk: Sketch, tool: string, p: Vec2, ctx: ToolCtx, tol: number): { changed: boolean; finished: boolean } {
  const start = (t: string) => {
    if (!pending || pending.tool !== t) pending = { tool: t, pts: [], ids: [] };
  };
  switch (tool) {
    case "line": {
      start("line");
      pending!.pts.push(p);
      if (pending!.pts.length === 2) {
        sk.entities.push(ent("line", { a: pending!.pts[0], b: pending!.pts[1] }, ctx));
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "polyline": {
      start("polyline");
      pending!.pts.push(p);
      if (pending!.pts.length >= 2) {
        const n = pending!.pts.length;
        sk.entities.push(ent("line", { a: pending!.pts[n - 2], b: pending!.pts[n - 1] }, ctx));
        return { changed: true, finished: false };
      }
      return { changed: false, finished: false };
    }
    case "rect": {
      start("rect");
      pending!.pts.push(p);
      if (pending!.pts.length === 2) {
        const es = rectEntities(pending!.pts[0], pending!.pts[1]);
        es.forEach((e) => (e.construction = ctx.construction));
        sk.entities.push(...es);
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "circle": {
      start("circle");
      pending!.pts.push(p);
      if (pending!.pts.length === 2) {
        const r = dist(pending!.pts[0], pending!.pts[1]);
        if (r > 1e-6) sk.entities.push(ent("circle", { c: pending!.pts[0], r }, ctx));
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "arc": {
      start("arc");
      pending!.pts.push(p);
      if (pending!.pts.length === 3) {
        const [A, B, C] = pending!.pts;
        const circ = circleFrom3(A, C, B);
        if (circ) {
          let a0 = Math.atan2(A.y - circ.c.y, A.x - circ.c.x);
          let a1 = Math.atan2(B.y - circ.c.y, B.x - circ.c.x);
          const am = Math.atan2(C.y - circ.c.y, C.x - circ.c.x);
          const inRange = (a: number, s: number, e: number) => {
            let d = ((a - s) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            let t = ((e - s) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            return d <= t;
          };
          if (!inRange(am, a0, a1)) {
            const t = a0;
            a0 = a1;
            a1 = t;
          }
          sk.entities.push(ent("arc", { c: circ.c, r: circ.r, a0, a1 }, ctx));
        }
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "ellipse": {
      start("ellipse");
      pending!.pts.push(p);
      if (pending!.pts.length === 3) {
        const [c, a, b] = pending!.pts;
        const rx = dist(c, a);
        const rot = Math.atan2(a.y - c.y, a.x - c.x);
        const ry = dist(c, b);
        sk.entities.push(ent("ellipse", { c, rx, ry, rot }, ctx));
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "polygon": {
      start("polygon");
      pending!.pts.push(p);
      if (pending!.pts.length === 2) {
        const c = pending!.pts[0];
        const r = dist(c, pending!.pts[1]);
        const rot = Math.atan2(pending!.pts[1].y - c.y, pending!.pts[1].x - c.x);
        sk.entities.push(ent("polygon", { c, r, n: ctx.polygonSides, rot }, ctx));
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "spline": {
      start("spline");
      pending!.pts.push(p);
      return { changed: false, finished: false };
    }
    case "point":
      sk.entities.push(ent("point", { c: p }, ctx));
      return { changed: true, finished: true };
    case "fillet":
    case "chamfer": {
      start(tool);
      const e = hitEntity(sk, p, tol);
      if (!e || e.kind !== "line") return { changed: false, finished: false };
      pending!.ids.push(e.id);
      if (pending!.ids.length === 2) {
        const l1 = sk.entities.find((x) => x.id === pending!.ids[0])!;
        const l2 = sk.entities.find((x) => x.id === pending!.ids[1])!;
        const res = tool === "fillet" ? filletLines(l1, l2, ctx.filletRadius) : chamferLines(l1, l2, ctx.chamferDist);
        if (res) {
          sk.entities = sk.entities.filter((x) => x.id !== l1.id && x.id !== l2.id);
          sk.entities.push(res.l1, res.l2, (res as any).arc || (res as any).seg);
        }
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "trim": {
      const e = hitEntity(sk, p, tol);
      if (!e) return { changed: false, finished: false };
      if (e.kind === "line") {
        const parts = trimLineAt(e, sk.entities, p);
        sk.entities = sk.entities.filter((x) => x.id !== e.id).concat(parts);
      } else {
        sk.entities = sk.entities.filter((x) => x.id !== e.id);
      }
      return { changed: true, finished: true };
    }
    case "extend": {
      const e = hitEntity(sk, p, tol);
      if (!e || e.kind !== "line") return { changed: false, finished: false };
      const dirEnd = dist(e.b!, p) < dist(e.a!, p) ? "b" : "a";
      const other = dirEnd === "b" ? e.a! : e.b!;
      const tip = dirEnd === "b" ? e.b! : e.a!;
      const d = { x: tip.x - other.x, y: tip.y - other.y };
      const L = Math.hypot(d.x, d.y) || 1;
      let bestT = Infinity;
      for (const o of sk.entities) {
        if (o.id === e.id) continue;
        const poly = tessellate(o);
        for (let i = 0; i < poly.length - 1; i++) {
          const ip = segInter(other, { x: other.x + (d.x / L) * 1e5, y: other.y + (d.y / L) * 1e5 }, poly[i], poly[i + 1]);
          if (ip) {
            const t = dist(other, ip);
            if (t > L && t < bestT) bestT = t;
          }
        }
      }
      if (isFinite(bestT)) {
        const np = { x: other.x + (d.x / L) * bestT, y: other.y + (d.y / L) * bestT };
        (e as any)[dirEnd] = np;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "eraser": {
      const e = hitEntity(sk, p, tol);
      if (e) {
        sk.entities = sk.entities.filter((x) => x.id !== e.id);
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "mirror": {
      start("mirror");
      pending!.pts.push(p);
      if (pending!.pts.length === 2) {
        const [a, b] = pending!.pts;
        const sel = sk.entities.filter((e) => ctx.selection.includes(e.id));
        // 关联镜像：副本记录源与变换，源改了副本自动跟随
        for (const e of sel) sk.entities.push({ ...mirrorEntity(e, a, b), src: e.id, xf: { t: "mirror", a, b } });
        pending = null;
        return { changed: true, finished: true };
      }
      return { changed: false, finished: false };
    }
    case "patternLinear": {
      const sel = sk.entities.filter((e) => ctx.selection.includes(e.id));
      if (!sel.length) return { changed: false, finished: false };
      for (let k = 1; k < ctx.patternCount; k++)
        for (const e of sel) {
          const dx = ctx.patternDx * k,
            dy = ctx.patternDy * k;
          sk.entities.push({ ...translateEntity(e, dx, dy), src: e.id, xf: { t: "move", dx, dy } });
        }
      return { changed: true, finished: true };
    }
    case "patternCircular": {
      const sel = sk.entities.filter((e) => ctx.selection.includes(e.id));
      if (!sel.length) return { changed: false, finished: false };
      for (let k = 1; k < ctx.patternCount; k++)
        for (const e of sel) {
          const ang = ((Math.PI * 2) / ctx.patternCount) * k;
          sk.entities.push({ ...rotateEntity(e, p, ang), src: e.id, xf: { t: "rot", c: p, ang } });
        }
      return { changed: true, finished: true };
    }
    default:
      return { changed: false, finished: false };
  }
}

export function finishSpline(sk: Sketch, ctx: ToolCtx, closed = false): boolean {
  if (pending?.tool === "spline" && pending.pts.length >= 2) {
    sk.entities.push(ent("spline", { pts: pending.pts.slice(), closed }, ctx));
    pending = null;
    return true;
  }
  pending = null;
  return false;
}

function segInter(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

function circleFrom3(A: Vec2, B: Vec2, C: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / d;
  const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / d;
  const c = { x: ux, y: uy };
  return { c, r: dist(c, A) };
}

/** 添加尺寸并求解 */
export function addDimension(sk: Sketch, type: string, ids: string[], value: number, pos: Vec2) {
  sk.dims.push({ id: uid("d"), type: type as any, refs: ids, value, pos });
  solveSketch(sk);
}

export function addConstraint(sk: Sketch, type: string, ids: string[]) {
  sk.constraints.push({ id: uid("c"), type: type as any, refs: ids });
  solveSketch(sk);
}

/** 选择引导提示：当前工具在等你点哪个点或哪条线 */
export const TOOL_HINTS: Record<string, string> = {
  select: "点选曲线；Shift 加选；拖动端点/象限点改大小",
  line: "点第一点，再点第二点",
  polyline: "连续点击画折线；Esc 结束",
  rect: "点两个对角点",
  circle: "先点圆心，再定半径",
  arc: "三点定弧：起点 → 终点 → 弧上一点",
  ellipse: "点圆心 → 点长轴端点 → 点短轴端点",
  spline: "依次点过一串点，点「收笔」结束",
  polygon: "点中心，再点一个顶点（边数在下方可调）",
  point: "点击放置一个点",
  trim: "点要剪掉的那一段",
  extend: "点要延伸的那一端",
  fillet: "依次点两条直线（半径在下方可调）",
  chamfer: "依次点两条直线（距离在下方可调）",
  mirror: "先选中要镜像的曲线，再点镜像线的两个端点",
  patternLinear: "先选中曲线，再点视口任意处生成线性阵列",
  patternCircular: "先选中曲线，再点阵列中心",
  eraser: "划过或点击要擦掉的元素",
  project: "点模型上的一条边，把它投影到当前草图平面",
};
