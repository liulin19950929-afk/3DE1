import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { jsPDF } from "jspdf";
import { use3D } from "../editor3d/store3d";
import { useApp, download, fmt } from "../store";
import { Row, Num, Toggle, Seg, Section, Tool, Badge } from "../components/ui";
import { SHEET_SIZES, uid, type Sheet, type DrawView, type DrawDim, type Vec2, type D2Entity } from "../cad/types";
import { getEdges } from "../editor3d/Viewport";
import { getPool } from "../workers/pool";
import { writeDXF } from "../io/dxf";

interface Seg2 {
  a: Vec2;
  b: Vec2;
  hidden: boolean;
}
interface Circle2 {
  c: Vec2;
  r: number;
}
interface Projection {
  segs: Seg2[];
  circles: Circle2[];
  box: { min: Vec2; max: Vec2 };
  ms: number;
  threads: number;
}

const DIRS: Record<string, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [0.7, -0.8, 0.6],
};

function basisFor(dir: THREE.Vector3) {
  const z = dir.clone().normalize();
  const up = Math.abs(z.z) > 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return { x, y, z };
}

/** 投影一个视图（多线程隐藏线消除） */
async function projectView(
  bodies: { id: string; geometry: THREE.BufferGeometry }[],
  dirArr: [number, number, number],
  rot: { x: number; y: number; z: number },
  hidden: boolean,
  threads: number,
): Promise<Projection> {
  const t0 = performance.now();
  const rotM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((rot.x * Math.PI) / 180, (rot.y * Math.PI) / 180, (rot.z * Math.PI) / 180));
  const dir = new THREE.Vector3(...dirArr).applyMatrix4(rotM).normalize();
  const { x: bx, y: by } = basisFor(dir);
  const segs3: number[] = [];
  const groups: { pts: THREE.Vector3[][] }[] = [];
  for (const b of bodies) {
    const edges = getEdges(b.geometry);
    for (const eg of edges) {
      const list: THREE.Vector3[][] = [];
      for (const s of eg.segments) {
        segs3.push(s[0].x, s[0].y, s[0].z, s[1].x, s[1].y, s[1].z);
        list.push([s[0], s[1]]);
      }
      groups.push({ pts: list });
    }
  }
  const segCount = segs3.length / 6;
  let flags: Uint8Array | null = null;
  const samples = 7;
  const pool = getPool(threads);
  if (hidden && segCount > 0 && bodies.length) {
    // 合并所有体的三角形
    const posArrays: Float32Array[] = [];
    for (const b of bodies) {
      const g = b.geometry.index ? b.geometry.toNonIndexed() : b.geometry;
      posArrays.push(new Float32Array(g.attributes.position.array as ArrayLike<number>));
    }
    const total = posArrays.reduce((a, p) => a + p.length, 0);
    const pos = new Float32Array(total);
    let o = 0;
    for (const p of posArrays) {
      pos.set(p, o);
      o += p.length;
    }
    const idx = new Uint32Array(pos.length / 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    const segsF = new Float32Array(segs3);
    const chunks = await pool.parallel(segCount, (start, end) => ({
      op: "hlr",
      pos,
      idx,
      segs: segsF,
      dir: [-dir.x, -dir.y, -dir.z],
      start,
      end,
      samples,
    }));
    flags = new Uint8Array(segCount * samples);
    let off = 0;
    for (const c of chunks) {
      flags.set(c as Uint8Array, off);
      off += (c as Uint8Array).length;
    }
  }

  const to2 = (v: THREE.Vector3): Vec2 => ({ x: v.dot(bx), y: v.dot(by) });
  const segs: Seg2[] = [];
  const circles: Circle2[] = [];
  let si = 0;
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  for (const grp of groups) {
    const pts2: Vec2[] = [];
    for (const s of grp.pts) {
      const a = to2(s[0]),
        b = to2(s[1]);
      let hiddenCount = 0;
      if (flags) for (let k = 0; k < samples; k++) hiddenCount += flags[si * samples + k];
      const isHidden = hiddenCount > samples / 2;
      if (!isHidden || hidden) segs.push({ a, b, hidden: isHidden });
      for (const p of [a, b]) {
        pts2.push(p);
        minx = Math.min(minx, p.x);
        miny = Math.min(miny, p.y);
        maxx = Math.max(maxx, p.x);
        maxy = Math.max(maxy, p.y);
      }
      si++;
    }
    // 圆识别（用于中心标记与直径标注）
    if (pts2.length >= 12) {
      const c = pts2.reduce((a, p) => ({ x: a.x + p.x / pts2.length, y: a.y + p.y / pts2.length }), { x: 0, y: 0 });
      const rs = pts2.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
      const r = rs.reduce((a, b) => a + b, 0) / rs.length;
      if (r > 0.4 && rs.every((v) => Math.abs(v - r) < r * 0.06)) circles.push({ c, r });
    }
  }
  return {
    segs,
    circles,
    box: { min: { x: minx, y: miny }, max: { x: maxx, y: maxy } },
    ms: performance.now() - t0,
    threads: pool.size,
  };
}

const defaultTitle = () => ({
  单位: "毫米 mm",
  设计: "Digit3D",
  日期: new Date().toISOString().slice(0, 10),
  图号: "D3D-0001",
  材料: "钢 Steel",
  名称: "零件图",
  版本: "A",
});

function newSheet(size: keyof typeof SHEET_SIZES = "A3"): Sheet {
  const [w, h] = SHEET_SIZES[size];
  return {
    id: uid("sheet"),
    name: "图纸1",
    size,
    w,
    h,
    landscape: true,
    scale: 1,
    angle: "first",
    views: [],
    dims: [],
    title: defaultTitle(),
  };
}

export default function Drawing() {
  const st = use3D();
  const app = useApp();
  const cv = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [sheets, setSheets] = useState<Sheet[]>(st.drawing?.sheets?.length ? st.drawing.sheets : [newSheet()]);
  const [active, setActive] = useState(0);
  const [projections, setProjections] = useState<Record<string, Projection>>({});
  const [tool, setTool] = useState("select");
  const [selView, setSelView] = useState<string | null>(null);
  const [pick, setPick] = useState<Vec2[]>([]);
  const [view, setView] = useState({ ox: 40, oy: 40, scale: 1.6 });
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [hlrMs, setHlrMs] = useState(0);

  const sheet = sheets[active];
  const sw = sheet.landscape ? sheet.w : sheet.h;
  const sh = sheet.landscape ? sheet.h : sheet.w;

  const update = (patch: Partial<Sheet>) => setSheets(sheets.map((s, i) => (i === active ? { ...s, ...patch } : s)));

  const addView = async (type: string) => {
    if (!st.build.bodies.length) return app.notify("先在 3D 建模中创建或导入模型", "warn");
    setBusy(true);
    const v: DrawView = {
      id: uid("v"),
      label: { front: "主视图", top: "俯视图", left: "左视图", right: "右视图", back: "后视图", bottom: "仰视图", iso: "轴测图" }[type] || "视图",
      type: type as DrawView["type"],
      x: 60 + sheet.views.length * 70,
      y: 60 + (sheet.views.length % 2) * 70,
      scale: sheet.scale,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      hidden: true,
      tangent: false,
      centerlines: true,
    };
    const proj = await projectView(st.build.bodies, DIRS[type] || DIRS.front, { x: 0, y: 0, z: 0 }, v.hidden, app.settings.threads);
    setProjections((p) => ({ ...p, [v.id]: proj }));
    setHlrMs(proj.ms);
    update({ views: [...sheet.views, v] });
    setBusy(false);
    app.notify(`${v.label} 已添加 · HLR ${proj.threads} 线程 / ${fmt(proj.ms, 0)} ms`, "ok");
  };

  const addSection = async () => {
    const parent = sheet.views.find((v) => v.id === selView) || sheet.views[0];
    if (!parent) return app.notify("先添加一张视图", "warn");
    setBusy(true);
    const v: DrawView = {
      ...parent,
      id: uid("v"),
      label: `剖视 A-A`,
      type: "section",
      parentId: parent.id,
      sectionAxis: "h",
      sectionPos: 0,
      sectionFlip: false,
      x: parent.x + 90,
      y: parent.y,
    };
    const proj = await projectView(st.build.bodies, DIRS[parent.type] || DIRS.front, { x: 0, y: 0, z: 0 }, false, app.settings.threads);
    setProjections((p) => ({ ...p, [v.id]: proj }));
    update({ views: [...sheet.views, v] });
    setBusy(false);
  };

  const addDetail = () => {
    const parent = sheet.views.find((v) => v.id === selView) || sheet.views[0];
    if (!parent) return app.notify("先添加一张视图", "warn");
    const v: DrawView = {
      ...parent,
      id: uid("v"),
      label: "局部放大 I (2:1)",
      type: "detail",
      parentId: parent.id,
      detailR: 12,
      detailCx: 0,
      detailCy: 0,
      scale: parent.scale * 2,
      x: parent.x,
      y: parent.y + 80,
    };
    setProjections((p) => ({ ...p, [v.id]: p[parent.id] }));
    update({ views: [...sheet.views, v] });
  };

  const refreshAll = async () => {
    setBusy(true);
    const next: Record<string, Projection> = {};
    for (const v of sheet.views) {
      next[v.id] = await projectView(
        st.build.bodies,
        DIRS[v.type === "section" || v.type === "detail" ? (sheet.views.find((p) => p.id === v.parentId)?.type ?? "front") : v.type] || DIRS.front,
        { x: v.rotX, y: v.rotY, z: v.rotZ },
        v.hidden,
        app.settings.threads,
      );
    }
    setProjections(next);
    setBusy(false);
    app.notify("所有视图已按当前模型更新", "ok");
  };

  /* ---------------- 绘制 ---------------- */
  const worldToScreen = (p: Vec2) => ({ x: view.ox + p.x * view.scale, y: view.oy + (sh - p.y) * view.scale });
  const screenToWorld = (x: number, y: number): Vec2 => ({ x: (x - view.ox) / view.scale, y: sh - (y - view.oy) / view.scale });

  useEffect(() => {
    const c = cv.current,
      w = wrap.current;
    if (!c || !w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = w.clientWidth,
      ch = w.clientHeight;
    if (c.width !== cw * dpr) {
      c.width = cw * dpr;
      c.height = ch * dpr;
      c.style.width = cw + "px";
      c.style.height = ch + "px";
    }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = app.settings.theme === "dark";
    g.fillStyle = dark ? "#0b0f14" : "#e8edf2";
    g.fillRect(0, 0, cw, ch);

    // 图纸
    const o = worldToScreen({ x: 0, y: 0 });
    const pw = sw * view.scale,
      ph = sh * view.scale;
    g.fillStyle = dark ? "#131c26" : "#ffffff";
    g.fillRect(o.x, o.y - ph, pw, ph);
    g.strokeStyle = dark ? "#3a516b" : "#333";
    g.lineWidth = 1.4;
    g.strokeRect(o.x, o.y - ph, pw, ph);
    // 装订边 + 图框
    const m = 10 * view.scale,
      bind = 20 * view.scale;
    g.lineWidth = 2;
    g.strokeRect(o.x + bind, o.y - ph + m, pw - bind - m, ph - 2 * m);

    const ink = dark ? "#dbe6f2" : "#111";
    // 视图
    for (const v of sheet.views) {
      const proj = projections[v.id];
      const base = worldToScreen({ x: v.x, y: v.y });
      const s = view.scale * v.scale;
      g.save();
      g.beginPath();
      if (v.type === "detail" && v.detailR) {
        g.arc(base.x, base.y, v.detailR * s, 0, Math.PI * 2);
        g.clip();
      }
      if (proj) {
        for (const seg of proj.segs) {
          if (v.type === "section" && v.sectionAxis) {
            const cut = v.sectionAxis === "h" ? (seg.a.y + seg.b.y) / 2 : (seg.a.x + seg.b.x) / 2;
            const keep = v.sectionFlip ? cut <= (v.sectionPos || 0) : cut >= (v.sectionPos || 0);
            if (!keep) continue;
          }
          if (seg.hidden && !v.hidden) continue;
          g.strokeStyle = seg.hidden ? (dark ? "#5b7288" : "#9aa7b4") : ink;
          g.lineWidth = seg.hidden ? 0.7 : 1.3;
          g.setLineDash(seg.hidden ? [4, 3] : []);
          g.beginPath();
          g.moveTo(base.x + seg.a.x * s, base.y - seg.a.y * s);
          g.lineTo(base.x + seg.b.x * s, base.y - seg.b.y * s);
          g.stroke();
        }
        g.setLineDash([]);
        if (v.centerlines) {
          g.strokeStyle = "#f472b6";
          g.lineWidth = 0.7;
          for (const c2 of proj.circles) {
            g.setLineDash([6, 2, 2, 2]);
            g.beginPath();
            g.moveTo(base.x + (c2.c.x - c2.r * 1.25) * s, base.y - c2.c.y * s);
            g.lineTo(base.x + (c2.c.x + c2.r * 1.25) * s, base.y - c2.c.y * s);
            g.moveTo(base.x + c2.c.x * s, base.y - (c2.c.y - c2.r * 1.25) * s);
            g.lineTo(base.x + c2.c.x * s, base.y - (c2.c.y + c2.r * 1.25) * s);
            g.stroke();
            g.setLineDash([]);
          }
        }
        // 剖面线
        if (v.type === "section") {
          g.strokeStyle = "#38bdf8";
          g.lineWidth = 0.5;
          g.globalAlpha = 0.5;
          const bb = proj.box;
          for (let k = -200; k < 200; k += 4) {
            g.beginPath();
            g.moveTo(base.x + (bb.min.x + k) * s, base.y - bb.min.y * s);
            g.lineTo(base.x + (bb.min.x + k + (bb.max.y - bb.min.y)) * s, base.y - bb.max.y * s);
            g.stroke();
          }
          g.globalAlpha = 1;
        }
      }
      g.restore();
      // 视图框与标签
      g.strokeStyle = selView === v.id ? "#38bdf8" : "transparent";
      g.setLineDash([3, 3]);
      if (proj) {
        const bb = proj.box;
        g.strokeRect(base.x + bb.min.x * s - 4, base.y - bb.max.y * s - 4, (bb.max.x - bb.min.x) * s + 8, (bb.max.y - bb.min.y) * s + 8);
      }
      g.setLineDash([]);
      g.fillStyle = ink;
      g.font = `${Math.max(9, 3.5 * view.scale)}px sans-serif`;
      g.fillText(`${v.label}  ${v.scale === 1 ? "" : v.scale + ":1"}`, base.x - 10, base.y + 26);
    }

    // 标注
    for (const d of sheet.dims) {
      const v = sheet.views.find((x) => x.id === d.viewId);
      if (!v) continue;
      const base = worldToScreen({ x: v.x, y: v.y });
      const s = view.scale * v.scale;
      const P = (p: Vec2) => ({ x: base.x + p.x * s, y: base.y - p.y * s });
      const a = P(d.p1),
        b = P(d.p2),
        pos = P(d.pos);
      g.strokeStyle = "#f472b6";
      g.fillStyle = "#f472b6";
      g.lineWidth = 0.9;
      g.beginPath();
      if (d.type === "note") {
        g.font = `${Math.max(9, 3.5 * view.scale)}px sans-serif`;
        g.fillText(d.text || "", pos.x, pos.y);
      } else if (d.type === "leader") {
        g.moveTo(a.x, a.y);
        g.lineTo(pos.x, pos.y);
        g.stroke();
        g.font = `${Math.max(9, 3.5 * view.scale)}px sans-serif`;
        g.fillText(d.text || "", pos.x + 4, pos.y - 3);
      } else if (d.type === "centermark") {
        g.moveTo(a.x - 6, a.y);
        g.lineTo(a.x + 6, a.y);
        g.moveTo(a.x, a.y - 6);
        g.lineTo(a.x, a.y + 6);
        g.stroke();
      } else if (d.type === "diameter" || d.type === "radius") {
        g.moveTo(a.x, a.y);
        g.lineTo(pos.x, pos.y);
        g.stroke();
        g.font = `${Math.max(9, 3.2 * view.scale)}px sans-serif`;
        g.fillText(`${d.type === "diameter" ? "Ø" : "R"}${fmt(d.value * (1 / v.scale))}${tolText(d)}`, pos.x + 3, pos.y - 3);
      } else {
        const off = { x: pos.x - (a.x + b.x) / 2, y: pos.y - (a.y + b.y) / 2 };
        g.moveTo(a.x, a.y);
        g.lineTo(a.x + off.x, a.y + off.y);
        g.moveTo(b.x, b.y);
        g.lineTo(b.x + off.x, b.y + off.y);
        g.moveTo(a.x + off.x, a.y + off.y);
        g.lineTo(b.x + off.x, b.y + off.y);
        g.stroke();
        g.font = `${Math.max(9, 3.2 * view.scale)}px sans-serif`;
        const val = d.type === "angular" ? `${fmt(d.value)}°` : fmt(d.value / v.scale);
        g.fillText(val + tolText(d), pos.x + 3, pos.y - 4);
      }
    }

    // 标题栏
    const tbw = 160 * view.scale,
      tbh = 40 * view.scale;
    const tx = o.x + pw - m - tbw,
      ty = o.y - m - tbh;
    g.strokeStyle = ink;
    g.lineWidth = 1.2;
    g.strokeRect(tx, ty, tbw, tbh);
    g.font = `${Math.max(8, 2.8 * view.scale)}px sans-serif`;
    g.fillStyle = ink;
    const keys = Object.keys(sheet.title);
    keys.forEach((k, i) => {
      const col = i % 2,
        row = Math.floor(i / 2);
      g.fillText(`${k}: ${sheet.title[k]}`, tx + 5 + col * (tbw / 2), ty + 12 + row * (tbh / 4.2));
    });
    g.fillText(`比例 ${sheet.scale}:1 · ${sheet.angle === "first" ? "第一角" : "第三角"} · ${sheet.size}`, tx + 5, ty + tbh - 4);
  }, [sheets, active, projections, view, selView, app.settings.theme, sheet, sw, sh]);

  /* ---------------- 交互 ---------------- */
  const onDown = (ev: React.PointerEvent) => {
    const r = (ev.target as HTMLElement).getBoundingClientRect();
    const p = screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
    if (ev.button === 2) return;
    // 命中视图
    let hitView: DrawView | null = null;
    for (const v of sheet.views) {
      const proj = projections[v.id];
      if (!proj) continue;
      const dx = p.x - v.x,
        dy = p.y - v.y;
      const bb = proj.box;
      if (dx > bb.min.x * v.scale - 5 && dx < bb.max.x * v.scale + 5 && dy > bb.min.y * v.scale - 5 && dy < bb.max.y * v.scale + 5) hitView = v;
    }
    if (tool === "select") {
      if (hitView) {
        setSelView(hitView.id);
        setDrag({ id: hitView.id, dx: p.x - hitView.x, dy: p.y - hitView.y });
      } else setSelView(null);
      return;
    }
    if (!hitView) return;
    const local = { x: (p.x - hitView.x) / hitView.scale, y: (p.y - hitView.y) / hitView.scale };
    const proj = projections[hitView.id];
    const snap = nearestPoint(proj, local);
    const circ = nearestCircle(proj, local);

    if (tool === "auto") {
      if (circ && Math.hypot(circ.c.x - local.x, circ.c.y - local.y) < circ.r * 1.3) {
        addDim(hitView, { type: "diameter", p1: circ.c, p2: { x: circ.c.x + circ.r, y: circ.c.y }, pos: { x: circ.c.x + circ.r * 2, y: circ.c.y + circ.r * 2 }, value: circ.r * 2 * hitView.scale });
        return;
      }
      const seg = nearestSeg(proj, local);
      if (seg) addDim(hitView, { type: "linear", p1: seg.a, p2: seg.b, pos: { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 + 12 }, value: Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) * hitView.scale });
      return;
    }
    if (tool === "diameter" || tool === "radius") {
      if (circ) addDim(hitView, { type: tool as any, p1: circ.c, p2: { x: circ.c.x + circ.r, y: circ.c.y }, pos: { x: circ.c.x + circ.r * 2, y: circ.c.y + circ.r * 2 }, value: (tool === "diameter" ? circ.r * 2 : circ.r) * hitView.scale });
      return;
    }
    if (tool === "centermark") {
      if (circ) addDim(hitView, { type: "centermark", p1: circ.c, p2: circ.c, pos: circ.c, value: 0 });
      return;
    }
    if (tool === "note") {
      const t = window.prompt("注释文字", "技术要求：未注公差按 GB/T 1804-m");
      if (t) addDim(hitView, { type: "note", p1: local, p2: local, pos: local, value: 0, text: t });
      return;
    }
    if (tool === "leader") {
      if (!pick.length) {
        setPick([snap || local]);
        return;
      }
      const t = window.prompt("引线文字", "倒角 C1");
      addDim(hitView, { type: "leader", p1: pick[0], p2: local, pos: local, value: 0, text: t || "" });
      setPick([]);
      return;
    }
    // 长度 / 对齐 / 角度：两点
    const pt = snap || local;
    if (!pick.length) {
      setPick([pt]);
      return;
    }
    const a = pick[0];
    const value = tool === "angular" ? angleBetween(a, pt) : Math.hypot(pt.x - a.x, pt.y - a.y) * hitView.scale;
    addDim(hitView, { type: tool as any, p1: a, p2: pt, pos: { x: (a.x + pt.x) / 2, y: (a.y + pt.y) / 2 + 14 }, value });
    setPick([]);
  };

  const addDim = (v: DrawView, d: Omit<DrawDim, "id" | "viewId">) => {
    update({ dims: [...sheet.dims, { ...d, id: uid("d"), viewId: v.id } as DrawDim] });
  };

  const onMove = (ev: React.PointerEvent) => {
    if (ev.buttons === 2 || ev.buttons === 4) {
      setView((v) => ({ ...v, ox: v.ox + ev.movementX, oy: v.oy + ev.movementY }));
      return;
    }
    if (drag && ev.buttons === 1) {
      const r = (ev.target as HTMLElement).getBoundingClientRect();
      const p = screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
      update({ views: sheet.views.map((v) => (v.id === drag.id ? { ...v, x: p.x - drag.dx, y: p.y - drag.dy } : v)) });
    }
  };

  /* ---------------- 导出 ---------------- */
  const toEntities = (s: Sheet): D2Entity[] => {
    const out: D2Entity[] = [];
    const W = s.landscape ? s.w : s.h,
      H = s.landscape ? s.h : s.w;
    out.push({ id: uid("e"), kind: "polyline", layer: "FRAME", pts: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], closed: true });
    out.push({ id: uid("e"), kind: "polyline", layer: "FRAME", pts: [{ x: 20, y: 10 }, { x: W - 10, y: 10 }, { x: W - 10, y: H - 10 }, { x: 20, y: H - 10 }], closed: true });
    for (const v of s.views) {
      const proj = projections[v.id];
      if (!proj) continue;
      for (const seg of proj.segs) {
        if (seg.hidden && !v.hidden) continue;
        out.push({
          id: uid("e"),
          kind: "line",
          layer: seg.hidden ? "HIDDEN" : "VISIBLE",
          a: { x: v.x + seg.a.x * v.scale, y: v.y + seg.a.y * v.scale },
          b: { x: v.x + seg.b.x * v.scale, y: v.y + seg.b.y * v.scale },
        });
      }
      out.push({ id: uid("e"), kind: "text", layer: "TEXT", c: { x: v.x - 10, y: v.y - 26 }, text: v.label, height: 3.5 });
    }
    for (const d of s.dims) {
      const v = s.views.find((x) => x.id === d.viewId);
      if (!v) continue;
      const P = (p: Vec2) => ({ x: v.x + p.x * v.scale, y: v.y + p.y * v.scale });
      out.push({
        id: uid("e"),
        kind: "dim",
        layer: "DIM",
        a: P(d.p1),
        b: P(d.p2),
        pos: P(d.pos),
        value: d.value,
        text: (d.type === "diameter" ? "Ø" : d.type === "radius" ? "R" : "") + fmt(d.value) + tolText(d),
        height: 3.5,
      });
    }
    let i = 0;
    for (const [k, val] of Object.entries(s.title)) {
      out.push({ id: uid("e"), kind: "text", layer: "TITLE", c: { x: W - 150 + (i % 2) * 75, y: 40 - Math.floor(i / 2) * 8 }, text: `${k}: ${val}`, height: 3 });
      i++;
    }
    return out;
  };

  const exportDXF = () => {
    if (!app.pro) return app.notify("图纸导出属于 Pro 功能", "warn");
    const ents = toEntities(sheet);
    download(
      `${st.name}-${sheet.name}.dxf`,
      writeDXF(ents, [
        { name: "VISIBLE", color: "#ffffff", visible: true, locked: false },
        { name: "HIDDEN", color: "#808080", visible: true, locked: false },
        { name: "DIM", color: "#ff00ff", visible: true, locked: false },
        { name: "TEXT", color: "#ffff00", visible: true, locked: false },
        { name: "FRAME", color: "#00ffff", visible: true, locked: false },
        { name: "TITLE", color: "#00ff00", visible: true, locked: false },
      ]),
      "application/dxf",
    );
  };

  const exportPDF = () => {
    if (!app.pro) return app.notify("图纸导出属于 Pro 功能", "warn");
    let pdf: jsPDF | null = null;
    sheets.forEach((s, i) => {
      const W = s.landscape ? s.w : s.h,
        H = s.landscape ? s.h : s.w;
      if (!pdf) pdf = new jsPDF({ orientation: W > H ? "landscape" : "portrait", unit: "mm", format: [W, H] });
      else pdf.addPage([W, H], W > H ? "landscape" : "portrait");
      const doc = pdf as jsPDF;
      doc.setDrawColor(0);
      doc.setLineWidth(0.5);
      doc.rect(20, 10, W - 30, H - 20);
      for (const v of s.views) {
        const proj = projections[v.id];
        if (!proj) continue;
        for (const seg of proj.segs) {
          if (seg.hidden && !v.hidden) continue;
          doc.setLineWidth(seg.hidden ? 0.15 : 0.35);
          doc.setLineDashPattern(seg.hidden ? [1, 0.8] : [], 0);
          doc.line(v.x + seg.a.x * v.scale, H - (v.y + seg.a.y * v.scale), v.x + seg.b.x * v.scale, H - (v.y + seg.b.y * v.scale));
        }
        doc.setLineDashPattern([], 0);
        doc.setFontSize(9);
        doc.text(v.label, v.x - 10, H - (v.y - 26));
      }
      doc.setFontSize(8);
      let k = 0;
      for (const [key, val] of Object.entries(s.title)) {
        doc.text(`${key}: ${val}`, W - 150 + (k % 2) * 75, H - (40 - Math.floor(k / 2) * 8));
        k++;
      }
      doc.setFontSize(7);
      doc.text(`Sheet ${i + 1}/${sheets.length} · ${s.size} · ${s.scale}:1`, 25, H - 14);
    });
    const blob = (pdf as unknown as jsPDF).output("arraybuffer");
    download(`${st.name}-drawings.pdf`, blob, "application/pdf");
  };

  useEffect(() => {
    st.set("drawing", { sheets, active });
  }, [sheets, active]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center gap-2 px-2 py-1 border-b hairline flex-wrap" style={{ background: "var(--panel)" }}>
        <span className="text-[12px] font-semibold">工程制图 <Badge tone="beta">Beta</Badge></span>
        {sheets.map((s, i) => (
          <button key={s.id} className={"chip " + (i === active ? "on" : "")} onClick={() => setActive(i)}>
            {s.name}
          </button>
        ))}
        <button className="btn sm" onClick={() => { setSheets([...sheets, { ...newSheet(sheet.size as any), name: `图纸${sheets.length + 1}` }]); setActive(sheets.length); }}>+ 图纸</button>
        <div className="flex-1" />
        <button className="btn sm" disabled={busy} onClick={refreshAll}>{busy ? "计算中…" : "🔄 更新视图"}</button>
        <button className="btn sm" onClick={exportDXF}>导出 DXF (Pro)</button>
        <button className="btn sm primary" onClick={exportPDF}>导出多页 PDF (Pro)</button>
        <button className="btn sm" onClick={() => app.setPage("model")}>返回 3D</button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-[62px] shrink-0 border-r hairline overflow-auto" style={{ background: "var(--panel)" }}>
          {([
            ["select", "选择", "select"],
            ["auto", "自动尺寸", "auto"],
            ["linear", "长度", "dimLinear"],
            ["aligned", "对齐", "dimAligned"],
            ["diameter", "直径", "dimDiameter"],
            ["radius", "半径", "dimRadius"],
            ["angular", "角度", "dimAngular"],
            ["centermark", "中心标记", "centermark"],
            ["note", "注释", "note"],
            ["leader", "引线", "leader"],
          ] as [string, string, string][]).map(([id, label, icon]) => (
            <Tool key={id} icon={icon} label={label} on={tool === id} onClick={() => { setTool(id); setPick([]); }} />
          ))}
        </div>

        <div ref={wrap} className="flex-1 relative min-w-0" onContextMenu={(e) => e.preventDefault()}>
          <canvas
            ref={cv}
            className="absolute inset-0"
            style={{ cursor: tool === "select" ? "default" : "crosshair" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => setDrag(null)}
            onWheel={(e) => setView((v) => ({ ...v, scale: Math.max(0.3, Math.min(8, v.scale * (e.deltaY < 0 ? 1.1 : 0.9))) }))}
          />
          <div className="absolute left-2 bottom-2 text-[11px] mono muted">
            {sheet.size} {sheet.landscape ? "横放" : "竖放"} · {sw}×{sh} mm · 视图 {sheet.views.length} · 标注 {sheet.dims.length}
            {hlrMs > 0 && ` · HLR ${fmt(hlrMs, 0)} ms / ${app.settings.threads} 线程`}
          </div>
        </div>

        <div className="w-[280px] shrink-0 border-l hairline overflow-auto" style={{ background: "var(--panel)" }}>
          <Section title="图纸与幅面">
            <Row label="幅面">
              <select className="inp" value={sheet.size} onChange={(e) => { const k = e.target.value as keyof typeof SHEET_SIZES; update({ size: k, w: SHEET_SIZES[k][0], h: SHEET_SIZES[k][1] }); }}>
                {Object.keys(SHEET_SIZES).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </Row>
            <Row label="方向"><Seg value={sheet.landscape ? "l" : "p"} options={[{ id: "l", label: "横放" }, { id: "p", label: "竖放" }]} onChange={(v) => update({ landscape: v === "l" })} /></Row>
            <Row label="投影角"><Seg value={sheet.angle} options={[{ id: "first", label: "第一角" }, { id: "third", label: "第三角" }]} onChange={(v) => update({ angle: v as any })} /></Row>
            <Row label="比例"><Num value={sheet.scale} step={0.25} onChange={(v) => update({ scale: v })} /></Row>
            <Row label="名称"><input className="inp" value={sheet.name} onChange={(e) => update({ name: e.target.value })} /></Row>
          </Section>

          <Section title="添加视图">
            <div className="grid grid-cols-3 gap-1">
              {["front", "top", "left", "right", "back", "bottom", "iso"].map((t) => (
                <button key={t} className="btn sm" disabled={busy} onClick={() => addView(t)}>
                  {{ front: "主视", top: "俯视", left: "左视", right: "右视", back: "后视", bottom: "仰视", iso: "轴测" }[t]}
                </button>
              ))}
              <button className="btn sm" onClick={addSection}>剖视</button>
              <button className="btn sm" onClick={addDetail}>局部放大</button>
            </div>
          </Section>

          {selView && (() => {
            const v = sheet.views.find((x) => x.id === selView)!;
            const upd = (patch: Partial<DrawView>) => update({ views: sheet.views.map((x) => (x.id === v.id ? { ...x, ...patch } : x)) });
            return (
              <Section title={`视图设置 · ${v.label}`}>
                <Row label="标签"><input className="inp" value={v.label} onChange={(e) => upd({ label: e.target.value })} /></Row>
                <Row label="比例"><Num value={v.scale} step={0.25} onChange={(s) => upd({ scale: s })} /></Row>
                <Row label="隐藏线"><Toggle on={v.hidden} onChange={(b) => upd({ hidden: b })} /></Row>
                <Row label="相切边"><Toggle on={v.tangent} onChange={(b) => upd({ tangent: b })} /></Row>
                <Row label="中心线"><Toggle on={v.centerlines} onChange={(b) => upd({ centerlines: b })} /></Row>
                <Row label="任意角度 X"><Num value={v.rotX} onChange={(n) => upd({ rotX: n })} /></Row>
                <Row label="任意角度 Y"><Num value={v.rotY} onChange={(n) => upd({ rotY: n })} /></Row>
                {v.type === "section" && (
                  <>
                    <Row label="剖切方向"><Seg value={v.sectionAxis || "h"} options={[{ id: "h", label: "横切" }, { id: "v", label: "竖切" }]} onChange={(s) => upd({ sectionAxis: s as any })} /></Row>
                    <Row label="剖切位置"><Num value={v.sectionPos || 0} onChange={(n) => upd({ sectionPos: n })} /></Row>
                    <Row label="看的方向"><Toggle on={!!v.sectionFlip} onChange={(b) => upd({ sectionFlip: b })} /></Row>
                  </>
                )}
                {v.type === "detail" && <Row label="放大范围 R"><Num value={v.detailR || 10} onChange={(n) => upd({ detailR: n })} /></Row>}
                <div className="flex gap-1 mt-1">
                  <button className="btn sm" onClick={async () => {
                    setBusy(true);
                    const proj = await projectView(st.build.bodies, DIRS[v.type] || DIRS.front, { x: v.rotX, y: v.rotY, z: v.rotZ }, v.hidden, app.settings.threads);
                    setProjections((p) => ({ ...p, [v.id]: proj }));
                    setBusy(false);
                  }}>重新投影</button>
                  <button className="btn sm" onClick={() => { update({ views: sheet.views.filter((x) => x.id !== v.id), dims: sheet.dims.filter((d) => d.viewId !== v.id) }); setSelView(null); }}>删除视图</button>
                </div>
              </Section>
            );
          })()}

          <Section title="公差与标注样式">
            <div className="text-[11px] muted mb-1">选中最后一个标注可设置公差</div>
            {sheet.dims.length > 0 && (() => {
              const d = sheet.dims[sheet.dims.length - 1];
              const upd = (patch: Partial<DrawDim>) => update({ dims: sheet.dims.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) });
              return (
                <>
                  <Row label="公差方式">
                    <Seg value={d.tolMode || "none"} options={[{ id: "none", label: "无" }, { id: "sym", label: "对称" }, { id: "limits", label: "上下偏差" }, { id: "fit", label: "配合代号" }]} onChange={(v) => upd({ tolMode: v as any })} />
                  </Row>
                  {d.tolMode === "sym" && <Row label="±"><Num value={d.tolUp || 0.1} step={0.01} onChange={(v) => upd({ tolUp: v })} /></Row>}
                  {d.tolMode === "limits" && (
                    <>
                      <Row label="上偏差"><Num value={d.tolUp || 0.1} step={0.01} onChange={(v) => upd({ tolUp: v })} /></Row>
                      <Row label="下偏差"><Num value={d.tolDn || -0.1} step={0.01} onChange={(v) => upd({ tolDn: v })} /></Row>
                    </>
                  )}
                  {d.tolMode === "fit" && <Row label="配合"><input className="inp" value={d.fit || "H7"} onChange={(e) => upd({ fit: e.target.value })} /></Row>}
                  <button className="btn sm mt-1" onClick={() => update({ dims: sheet.dims.filter((x) => x.id !== d.id) })}>删除该标注</button>
                </>
              );
            })()}
          </Section>

          <Section title="标题栏" defaultOpen={false}>
            {Object.entries(sheet.title).map(([k, v]) => (
              <Row key={k} label={k}>
                <input className="inp" value={v} onChange={(e) => update({ title: { ...sheet.title, [k]: e.target.value } })} />
              </Row>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function tolText(d: DrawDim): string {
  if (d.tolMode === "sym") return ` ±${d.tolUp ?? 0.1}`;
  if (d.tolMode === "limits") return ` +${d.tolUp ?? 0.1}/${d.tolDn ?? -0.1}`;
  if (d.tolMode === "fit") return ` ${d.fit || "H7"}`;
  return "";
}

function nearestPoint(proj: Projection | undefined, p: Vec2): Vec2 | null {
  if (!proj) return null;
  let best: Vec2 | null = null,
    bd = 6;
  for (const s of proj.segs) {
    for (const q of [s.a, s.b]) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  }
  return best;
}

function nearestSeg(proj: Projection | undefined, p: Vec2): Seg2 | null {
  if (!proj) return null;
  let best: Seg2 | null = null,
    bd = 8;
  for (const s of proj.segs) {
    const dx = s.b.x - s.a.x,
      dy = s.b.y - s.a.y;
    const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(p.x - (s.a.x + dx * t), p.y - (s.a.y + dy * t));
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function nearestCircle(proj: Projection | undefined, p: Vec2): Circle2 | null {
  if (!proj) return null;
  let best: Circle2 | null = null,
    bd = Infinity;
  for (const c of proj.circles) {
    const d = Math.abs(Math.hypot(p.x - c.c.x, p.y - c.c.y) - c.r);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return bd < 8 ? best : null;
}

function angleBetween(a: Vec2, b: Vec2): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}
