import { useEffect, useRef, useState, useCallback } from "react";
import { useApp, download, fmt } from "../store";
import { Tool, Row, Num, Toggle, Section, Color, Seg, IconBtn, MoreMenu, MenuItem, MenuGroup } from "../components/ui";
import type { D2Entity, Layer, Vec2, Project2D } from "../cad/types";
import { uid } from "../cad/types";
import { parseDXF, writeDXF } from "../io/dxf";

const TOOLS: [string, string, string][] = [
  ["select", "选择", "select"],
  ["box", "框选", "box"],
  ["line", "直线", "line"],
  ["polyline", "折线", "polyline"],
  ["rect", "矩形", "rect"],
  ["circle", "圆", "circle"],
  ["arc", "圆弧", "arc"],
  ["ellipse", "椭圆", "ellipse"],
  ["spline", "样条", "spline"],
  ["polygon", "多边形", "polygon"],
  ["text", "文字", "text"],
  ["point", "点", "point"],
  ["move", "移动", "move"],
  ["copy", "复制", "copy"],
  ["rotate", "旋转", "rotate"],
  ["mirror", "镜像", "mirror"],
  ["offset", "偏置", "offset"],
  ["trim", "修剪", "trim"],
  ["fillet", "倒圆角", "fillet"],
  ["erase", "删除", "eraser"],
  ["dimLinear", "线性标注", "dimLinear"],
  ["dimAligned", "对齐标注", "dimAligned"],
  ["dimRadius", "半径标注", "dimRadius"],
  ["dimDiameter", "直径标注", "dimDiameter"],
  ["dimAngular", "角度标注", "dimAngular"],
  ["measure", "测量", "measure"],
];

interface View {
  ox: number;
  oy: number;
  scale: number;
}

export default function Editor2D() {
  const app = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = app.projects.find((p) => p.id === app.currentId && p.kind === "2d") as Project2D | undefined;
  const [name, setName] = useState(current?.name || "未命名图纸");
  const [projectId] = useState(current?.id || uid("prj"));
  const [ents, setEnts] = useState<D2Entity[]>(current?.entities || []);
  const [layers, setLayers] = useState<Layer[]>(current?.layers || [{ name: "0", color: "#dbe6f2", visible: true, locked: false }]);
  const [curLayer, setCurLayer] = useState("0");
  const [tool, setTool] = useState("line");
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState<View>({ ox: 80, oy: 420, scale: 2.2 });
  const [pending, setPending] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2>({ x: 0, y: 0 });
  const [snapPt, setSnapPt] = useState<Vec2 | null>(null);
  const [undoStack, setUndo] = useState<D2Entity[][]>([]);
  const [redoStack, setRedo] = useState<D2Entity[][]>([]);
  const [inline, setInline] = useState<{ v: number; kind: string } | null>(null);
  const [polySides, setPolySides] = useState(6);
  const [filletR, setFilletR] = useState(5);
  const [offsetD, setOffsetD] = useState(5);
  const [measureTxt, setMeasureTxt] = useState("");
  const [boxSel, setBoxSel] = useState<{ a: Vec2; b: Vec2 } | null>(null);

  const push = useCallback(
    (next: D2Entity[]) => {
      setUndo((u) => [...u, ents].slice(-60));
      setRedo([]);
      setEnts(next);
    },
    [ents],
  );

  /* ---------- 坐标变换 ---------- */
  const toScreen = (p: Vec2) => ({ x: p.x * view.scale + view.ox, y: -p.y * view.scale + view.oy });
  const toWorld = (x: number, y: number): Vec2 => ({ x: (x - view.ox) / view.scale, y: -(y - view.oy) / view.scale });

  /* ---------- 捕捉 ---------- */
  const snapCandidates = (): Vec2[] => {
    const out: Vec2[] = [{ x: 0, y: 0 }];
    const s = app.settings;
    for (const e of ents) {
      if (!layers.find((l) => l.name === e.layer)?.visible) continue;
      if (e.kind === "line") {
        if (s.snapEndpoint) out.push(e.a!, e.b!);
        if (s.snapMidpoint) out.push({ x: (e.a!.x + e.b!.x) / 2, y: (e.a!.y + e.b!.y) / 2 });
      } else if (e.kind === "circle" || e.kind === "arc") {
        if (s.snapCenter) out.push(e.c!);
        if (s.snapQuadrant) for (let i = 0; i < 4; i++) out.push({ x: e.c!.x + Math.cos((i * Math.PI) / 2) * e.r!, y: e.c!.y + Math.sin((i * Math.PI) / 2) * e.r! });
      } else if (e.pts) {
        if (s.snapEndpoint) out.push(...e.pts);
      }
    }
    return out;
  };

  const applySnap = (p: Vec2): Vec2 => {
    const s = app.settings;
    if (s.objectSnap) {
      const tol = 10 / view.scale;
      let best: Vec2 | null = null,
        bd = tol;
      for (const c of snapCandidates()) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) {
        setSnapPt(best);
        return { ...best };
      }
    }
    setSnapPt(null);
    if (s.gridSnap) return { x: Math.round(p.x / s.gridStep) * s.gridStep, y: Math.round(p.y / s.gridStep) * s.gridStep };
    return p;
  };

  /* ---------- 绘制 ---------- */
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth,
      h = wrap.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.width = w + "px";
      cv.style.height = h + "px";
    }
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = app.settings.theme === "dark";
    g.fillStyle = dark ? "#0b0f14" : "#ffffff";
    g.fillRect(0, 0, w, h);

    // 网格
    const step = app.settings.gridStep * view.scale;
    if (step > 5) {
      g.strokeStyle = dark ? "#141d27" : "#eaeff4";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = view.ox % step; x < w; x += step) {
        g.moveTo(x, 0);
        g.lineTo(x, h);
      }
      for (let y = view.oy % step; y < h; y += step) {
        g.moveTo(0, y);
        g.lineTo(w, y);
      }
      g.stroke();
    }
    // 坐标轴
    g.strokeStyle = dark ? "#2a3d51" : "#c9d6e2";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, view.oy);
    g.lineTo(w, view.oy);
    g.moveTo(view.ox, 0);
    g.lineTo(view.ox, h);
    g.stroke();

    const drawEnt = (e: D2Entity, highlight: boolean) => {
      const layer = layers.find((l) => l.name === e.layer);
      if (layer && !layer.visible) return;
      g.strokeStyle = highlight ? "#38bdf8" : e.color || layer?.color || (dark ? "#dbe6f2" : "#16202b");
      g.fillStyle = g.strokeStyle;
      g.lineWidth = highlight ? 2.4 : 1.4;
      g.beginPath();
      switch (e.kind) {
        case "line": {
          const a = toScreen(e.a!),
            b = toScreen(e.b!);
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
          break;
        }
        case "circle": {
          const c = toScreen(e.c!);
          g.arc(c.x, c.y, e.r! * view.scale, 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case "arc": {
          const c = toScreen(e.c!);
          g.arc(c.x, c.y, e.r! * view.scale, -e.a1!, -e.a0!);
          g.stroke();
          break;
        }
        case "ellipse": {
          const c = toScreen(e.c!);
          g.ellipse(c.x, c.y, e.rx! * view.scale, e.ry! * view.scale, -(e.rot || 0), 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case "polyline":
        case "spline":
        case "hatch": {
          const pts = e.pts || [];
          if (!pts.length) break;
          const p0 = toScreen(pts[0]);
          g.moveTo(p0.x, p0.y);
          for (const p of pts.slice(1)) {
            const q = toScreen(p);
            g.lineTo(q.x, q.y);
          }
          if (e.closed) g.closePath();
          if (e.kind === "hatch") {
            g.globalAlpha = 0.25;
            g.fill();
            g.globalAlpha = 1;
          }
          g.stroke();
          break;
        }
        case "point": {
          const c = toScreen(e.c!);
          g.fillRect(c.x - 2, c.y - 2, 4, 4);
          break;
        }
        case "text": {
          const c = toScreen(e.c!);
          g.font = `${Math.max(8, (e.height || 3.5) * view.scale)}px sans-serif`;
          g.fillText(e.text || "", c.x, c.y);
          break;
        }
        case "dim": {
          const a = toScreen(e.a!),
            b = toScreen(e.b!),
            pos = toScreen(e.pos || e.a!);
          g.strokeStyle = highlight ? "#38bdf8" : "#f472b6";
          g.fillStyle = g.strokeStyle;
          g.lineWidth = 1.1;
          if (e.dimType === "radius" || e.dimType === "diameter") {
            g.moveTo(a.x, a.y);
            g.lineTo(pos.x, pos.y);
            g.stroke();
          } else {
            const off = { x: pos.x - (a.x + b.x) / 2, y: pos.y - (a.y + b.y) / 2 };
            g.moveTo(a.x, a.y);
            g.lineTo(a.x + off.x, a.y + off.y);
            g.moveTo(b.x, b.y);
            g.lineTo(b.x + off.x, b.y + off.y);
            g.moveTo(a.x + off.x, a.y + off.y);
            g.lineTo(b.x + off.x, b.y + off.y);
            g.stroke();
            // 箭头
            arrow(g, { x: a.x + off.x, y: a.y + off.y }, { x: b.x + off.x, y: b.y + off.y });
            arrow(g, { x: b.x + off.x, y: b.y + off.y }, { x: a.x + off.x, y: a.y + off.y });
          }
          g.font = "12px sans-serif";
          const label = e.text || `${e.dimType === "diameter" ? "Ø" : e.dimType === "radius" ? "R" : ""}${fmt(e.value || 0)}${e.dimType === "angular" ? "°" : ""}`;
          g.fillText(label + (e.tol ? " " + e.tol : ""), pos.x + 4, pos.y - 4);
          break;
        }
      }
    };

    for (const e of ents) drawEnt(e, sel.includes(e.id));

    // 预览
    if (pending.length) {
      g.strokeStyle = "#22d3ee";
      g.setLineDash([5, 4]);
      g.lineWidth = 1.2;
      g.beginPath();
      const p0 = toScreen(pending[0]);
      const cur = toScreen(cursor);
      if (tool === "circle") {
        g.arc(p0.x, p0.y, Math.hypot(cur.x - p0.x, cur.y - p0.y), 0, Math.PI * 2);
      } else if (tool === "rect") {
        g.rect(p0.x, p0.y, cur.x - p0.x, cur.y - p0.y);
      } else {
        g.moveTo(p0.x, p0.y);
        for (const p of pending.slice(1)) {
          const q = toScreen(p);
          g.lineTo(q.x, q.y);
        }
        g.lineTo(cur.x, cur.y);
      }
      g.stroke();
      g.setLineDash([]);
    }

    if (boxSel) {
      const a = toScreen(boxSel.a),
        b = toScreen(boxSel.b);
      g.strokeStyle = "#38bdf8";
      g.setLineDash([4, 3]);
      g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      g.setLineDash([]);
    }

    if (snapPt) {
      const s = toScreen(snapPt);
      g.strokeStyle = "#fbbf24";
      g.lineWidth = 1.6;
      g.strokeRect(s.x - 5, s.y - 5, 10, 10);
    }
    // 光标十字
    const c = toScreen(cursor);
    g.strokeStyle = "#38bdf855";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(c.x - 14, c.y);
    g.lineTo(c.x + 14, c.y);
    g.moveTo(c.x, c.y - 14);
    g.lineTo(c.x, c.y + 14);
    g.stroke();
  }, [ents, layers, sel, view, pending, cursor, snapPt, tool, boxSel, app.settings]);

  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  /* ---------- 交互 ---------- */
  const hit = (p: Vec2): D2Entity | null => {
    const tol = 8 / view.scale;
    for (const e of [...ents].reverse()) {
      const layer = layers.find((l) => l.name === e.layer);
      if (layer && (!layer.visible || layer.locked)) continue;
      if (e.kind === "line" && distToSeg(p, e.a!, e.b!) < tol) return e;
      if ((e.kind === "circle" || e.kind === "arc") && Math.abs(Math.hypot(p.x - e.c!.x, p.y - e.c!.y) - e.r!) < tol) return e;
      if (e.kind === "ellipse" && Math.abs(Math.hypot(p.x - e.c!.x, p.y - e.c!.y) - (e.rx! + e.ry!) / 2) < tol * 2) return e;
      if ((e.kind === "polyline" || e.kind === "spline" || e.kind === "hatch") && e.pts) {
        for (let i = 0; i < e.pts.length - 1; i++) if (distToSeg(p, e.pts[i], e.pts[i + 1]) < tol) return e;
        if (e.closed && e.pts.length > 2 && distToSeg(p, e.pts[e.pts.length - 1], e.pts[0]) < tol) return e;
      }
      if ((e.kind === "text" || e.kind === "point" || e.kind === "dim") && e.c && Math.hypot(p.x - e.c.x, p.y - e.c.y) < tol * 2) return e;
      if (e.kind === "dim" && e.pos && Math.hypot(p.x - e.pos.x, p.y - e.pos.y) < tol * 2) return e;
    }
    return null;
  };

  const addEnt = (e: Partial<D2Entity>) => {
    push([...ents, { id: uid("e"), layer: curLayer, kind: "line", ...e } as D2Entity]);
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    const rect = (ev.target as HTMLElement).getBoundingClientRect();
    const raw = toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const p = applySnap(raw);
    if (ev.button === 1 || ev.button === 2) return;
    if (tool === "box") {
      setBoxSel({ a: p, b: p });
      return;
    }
    handleClick(p, ev.shiftKey);
  };

  const handleClick = (p: Vec2, shift: boolean) => {
    switch (tool) {
      case "select": {
        const e = hit(p);
        setSel(e ? (shift ? [...sel, e.id] : [e.id]) : []);
        return;
      }
      case "erase": {
        const e = hit(p);
        if (e) push(ents.filter((x) => x.id !== e.id));
        return;
      }
      case "line":
      case "rect":
      case "circle":
      case "measure":
      case "dimLinear":
      case "dimAligned":
      case "move":
      case "copy":
      case "mirror": {
        const pts = [...pending, p];
        if (pts.length < 2) {
          setPending(pts);
          return;
        }
        finishTwoPoint(pts[0], pts[1]);
        setPending([]);
        return;
      }
      case "polyline":
      case "spline": {
        setPending([...pending, p]);
        return;
      }
      case "arc": {
        const pts = [...pending, p];
        if (pts.length < 3) {
          setPending(pts);
          return;
        }
        const c = circle3(pts[0], pts[2], pts[1]);
        if (c) {
          let a0 = Math.atan2(pts[0].y - c.c.y, pts[0].x - c.c.x);
          let a1 = Math.atan2(pts[1].y - c.c.y, pts[1].x - c.c.x);
          if (a1 < a0) a1 += Math.PI * 2;
          addEnt({ kind: "arc", c: c.c, r: c.r, a0, a1 });
        }
        setPending([]);
        return;
      }
      case "ellipse": {
        const pts = [...pending, p];
        if (pts.length < 3) {
          setPending(pts);
          return;
        }
        const c = pts[0];
        addEnt({ kind: "ellipse", c, rx: Math.hypot(pts[1].x - c.x, pts[1].y - c.y), ry: Math.hypot(pts[2].x - c.x, pts[2].y - c.y), rot: Math.atan2(pts[1].y - c.y, pts[1].x - c.x) });
        setPending([]);
        return;
      }
      case "polygon": {
        const pts = [...pending, p];
        if (pts.length < 2) {
          setPending(pts);
          return;
        }
        const c = pts[0];
        const r = Math.hypot(pts[1].x - c.x, pts[1].y - c.y);
        const rot = Math.atan2(pts[1].y - c.y, pts[1].x - c.x);
        const poly: Vec2[] = [];
        for (let i = 0; i < polySides; i++) poly.push({ x: c.x + Math.cos(rot + (i / polySides) * Math.PI * 2) * r, y: c.y + Math.sin(rot + (i / polySides) * Math.PI * 2) * r });
        addEnt({ kind: "polyline", pts: poly, closed: true });
        setPending([]);
        return;
      }
      case "point":
        addEnt({ kind: "point", c: p });
        return;
      case "text": {
        const t = window.prompt("输入文字", "注释");
        if (t) addEnt({ kind: "text", c: p, text: t, height: 3.5 });
        return;
      }
      case "dimRadius":
      case "dimDiameter": {
        const e = hit(p);
        if (e && (e.kind === "circle" || e.kind === "arc")) {
          addEnt({
            kind: "dim",
            dimType: tool === "dimRadius" ? "radius" : "diameter",
            a: e.c!,
            b: { x: e.c!.x + e.r!, y: e.c!.y },
            pos: { x: e.c!.x + e.r! * 1.4, y: e.c!.y + e.r! * 1.4 },
            value: tool === "dimRadius" ? e.r! : e.r! * 2,
            c: e.c,
          });
        } else app.notify("请点选圆或圆弧", "warn");
        return;
      }
      case "dimAngular": {
        const e = hit(p);
        if (e && e.kind === "line") {
          const pts = [...pending, p];
          if (pts.length < 2) {
            setPending(pts);
            return;
          }
          setPending([]);
          addEnt({ kind: "dim", dimType: "angular", a: pts[0], b: pts[1], pos: p, value: 90, c: p });
        }
        return;
      }
      case "trim": {
        const e = hit(p);
        if (e) push(ents.filter((x) => x.id !== e.id));
        return;
      }
      case "offset": {
        const e = hit(p);
        if (e && e.kind === "line") {
          const d = { x: e.b!.x - e.a!.x, y: e.b!.y - e.a!.y };
          const l = Math.hypot(d.x, d.y) || 1;
          const n = { x: -d.y / l, y: d.x / l };
          const side = Math.sign((p.x - e.a!.x) * n.x + (p.y - e.a!.y) * n.y) || 1;
          addEnt({ kind: "line", a: { x: e.a!.x + n.x * offsetD * side, y: e.a!.y + n.y * offsetD * side }, b: { x: e.b!.x + n.x * offsetD * side, y: e.b!.y + n.y * offsetD * side } });
        } else if (e && e.kind === "circle") {
          addEnt({ kind: "circle", c: e.c!, r: e.r! + offsetD });
        }
        return;
      }
      case "fillet": {
        const e = hit(p);
        if (!e) return;
        const pts = [...pending];
        if (!pts.length) {
          setPending([p]);
          setSel([e.id]);
          return;
        }
        const first = hit(pts[0]);
        if (first && first.kind === "line" && e.kind === "line") {
          const res = fillet2(first, e, filletR);
          if (res) push([...ents.filter((x) => x.id !== first.id && x.id !== e.id), ...res]);
        }
        setPending([]);
        setSel([]);
        return;
      }
      case "rotate": {
        const pts = [...pending, p];
        if (pts.length < 2) {
          setPending(pts);
          return;
        }
        const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
        push(ents.map((e) => (sel.includes(e.id) ? rotateEnt(e, pts[0], ang) : e)));
        setPending([]);
        return;
      }
      default:
        return;
    }
  };

  const finishTwoPoint = (a: Vec2, b: Vec2) => {
    switch (tool) {
      case "line":
        addEnt({ kind: "line", a, b });
        setInline({ v: Math.hypot(b.x - a.x, b.y - a.y), kind: "length" });
        break;
      case "rect":
        push([
          ...ents,
          { id: uid("e"), layer: curLayer, kind: "polyline", pts: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], closed: true },
        ]);
        break;
      case "circle":
        addEnt({ kind: "circle", c: a, r: Math.hypot(b.x - a.x, b.y - a.y) });
        break;
      case "measure":
        setMeasureTxt(`距离 ${fmt(Math.hypot(b.x - a.x, b.y - a.y))} mm · ΔX ${fmt(b.x - a.x)} · ΔY ${fmt(b.y - a.y)} · 角度 ${fmt((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI)}°`);
        break;
      case "dimLinear":
      case "dimAligned":
        addEnt({
          kind: "dim",
          dimType: tool === "dimLinear" ? "linear" : "aligned",
          a,
          b,
          pos: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 12 },
          value: tool === "dimLinear" ? Math.abs(b.x - a.x) || Math.abs(b.y - a.y) : Math.hypot(b.x - a.x, b.y - a.y),
          c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 12 },
        });
        break;
      case "move":
      case "copy": {
        const dx = b.x - a.x,
          dy = b.y - a.y;
        if (tool === "move") push(ents.map((e) => (sel.includes(e.id) ? translateEnt(e, dx, dy) : e)));
        else push([...ents, ...ents.filter((e) => sel.includes(e.id)).map((e) => ({ ...translateEnt(e, dx, dy), id: uid("e") }))]);
        break;
      }
      case "mirror": {
        push([...ents, ...ents.filter((e) => sel.includes(e.id)).map((e) => mirrorEnt(e, a, b))]);
        break;
      }
    }
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    const rect = (ev.target as HTMLElement).getBoundingClientRect();
    const raw = toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    if (ev.buttons === 2 || ev.buttons === 4) {
      setView((v) => ({ ...v, ox: v.ox + ev.movementX, oy: v.oy + ev.movementY }));
      return;
    }
    if (boxSel) setBoxSel({ ...boxSel, b: raw });
    setCursor(applySnap(raw));
  };

  const onPointerUp = () => {
    if (boxSel) {
      const x0 = Math.min(boxSel.a.x, boxSel.b.x),
        x1 = Math.max(boxSel.a.x, boxSel.b.x);
      const y0 = Math.min(boxSel.a.y, boxSel.b.y),
        y1 = Math.max(boxSel.a.y, boxSel.b.y);
      const inside = ents.filter((e) => {
        const pts = entPoints(e);
        return pts.length > 0 && pts.every((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
      });
      setSel(inside.map((e) => e.id));
      setBoxSel(null);
    }
  };

  const onWheel = (ev: React.WheelEvent) => {
    const rect = (ev.target as HTMLElement).getBoundingClientRect();
    const mx = ev.clientX - rect.left,
      my = ev.clientY - rect.top;
    const before = toWorld(mx, my);
    const k = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const scale = Math.max(0.05, Math.min(80, view.scale * k));
    const ox = mx - before.x * scale;
    const oy = my + before.y * scale;
    setView({ ox, oy, scale });
  };

  /* ---------- 文件 ---------- */
  const doImport = async (file: File) => {
    const text = await file.text();
    try {
      const { entities, layers: ls } = parseDXF(text);
      setEnts(entities);
      setLayers(ls);
      setCurLayer(ls[0]?.name || "0");
      setName(file.name.replace(/\.[^.]+$/, ""));
      app.notify(`已导入 ${entities.length} 个图元 / ${ls.length} 个图层`, "ok");
      fitAll(entities);
    } catch (e) {
      app.notify(String((e as Error).message), "err");
    }
  };

  const fitAll = (list = ents) => {
    const pts = list.flatMap(entPoints);
    if (!pts.length) return;
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    const w = wrapRef.current?.clientWidth || 800,
      h = wrapRef.current?.clientHeight || 600;
    const bw = Math.max(1, Math.max(...xs) - Math.min(...xs)),
      bh = Math.max(1, Math.max(...ys) - Math.min(...ys));
    const scale = Math.min((w - 80) / bw, (h - 80) / bh);
    setView({ scale, ox: w / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * scale, oy: h / 2 + ((Math.min(...ys) + Math.max(...ys)) / 2) * scale });
  };

  const exportPNG = () => {
    const cv = canvasRef.current!;
    const out = document.createElement("canvas");
    out.width = cv.width;
    out.height = cv.height;
    const g = out.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(cv, 0, 0);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `${name}.png`;
    a.click();
    app.notify("已导出 PNG（白纸）", "ok");
  };

  /* 自动保存 */
  useEffect(() => {
    if (!app.settings.autoSave) return;
    const t = setTimeout(() => {
      const p: Project2D = { id: projectId, name, kind: "2d", entities: ents, layers, updated: Date.now() };
      app.upsertProject(p);
    }, 1500);
    return () => clearTimeout(t);
  }, [ents, layers, name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") {
        setPending([]);
        setSel([]);
      }
      if (e.key === "Delete" && sel.length) push(ents.filter((x) => !sel.includes(x.id)));
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        const u = undoStack[undoStack.length - 1];
        if (u) {
          setRedo((r) => [...r, ents]);
          setEnts(u);
          setUndo((s) => s.slice(0, -1));
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === "y") {
        const r = redoStack[redoStack.length - 1];
        if (r) {
          setUndo((s) => [...s, ents]);
          setEnts(r);
          setRedo((s) => s.slice(0, -1));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ents, sel, undoStack, redoStack]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center gap-2 px-2 py-1 border-b hairline" style={{ background: "var(--panel)" }}>
        <input className="inp" style={{ width: 180 }} value={name} onChange={(e) => setName(e.target.value)} />
        <IconBtn icon="undo" title="撤销" onClick={() => { const u = undoStack[undoStack.length - 1]; if (u) { setRedo((r) => [...r, ents]); setEnts(u); setUndo((s) => s.slice(0, -1)); } }} />
        <IconBtn icon="redo" title="重做" onClick={() => { const r = redoStack[redoStack.length - 1]; if (r) { setUndo((s) => [...s, ents]); setEnts(r); setRedo((s) => s.slice(0, -1)); } }} />
        <IconBtn icon="fit" title="全图" onClick={() => fitAll()} />
        <span className="text-[11px] muted">自动保存 · 图元 {ents.length}</span>
        <div className="flex-1" />
        <MoreMenu width={300}>
          <MenuGroup title="文件">
            <MenuItem icon="importIcon" label="导入 DXF" hint="仅 ASCII DXF；DWG 需转换插件" onClick={() => fileRef.current?.click()} />
            <MenuItem icon="export" label="导出 DXF" onClick={() => download(`${name}.dxf`, writeDXF(ents, layers), "application/dxf")} />
            <MenuItem icon="render" label="导出 PNG" hint="导出仍是白纸" onClick={exportPNG} />
          </MenuGroup>
          <MenuGroup title="捕捉与网格">
            <div className="px-2 py-1">
              <Row label="对象捕捉"><Toggle on={app.settings.objectSnap} onChange={(v) => app.set("objectSnap", v)} /></Row>
              <Row label="捕捉范围"><input type="range" min={4} max={30} value={app.settings.snapRange} onChange={(e) => app.set("snapRange", +e.target.value)} className="w-24" /><span className="text-[10.5px] muted">{app.settings.snapRange}px</span></Row>
              <Row label="网格吸附"><Toggle on={app.settings.gridSnap} onChange={(v) => app.set("gridSnap", v)} /></Row>
              <Row label="网格步长"><Num value={app.settings.gridStep} onChange={(v) => app.set("gridStep", v)} w={56} suffix="mm" /></Row>
              <Row label="连续绘制"><Toggle on={app.settings.continuousDraw} onChange={(v) => app.set("continuousDraw", v)} /></Row>
            </div>
          </MenuGroup>
          <MenuGroup title="图标与线条">
            <div className="px-2 py-1">
              <Row label="线宽"><input type="range" min={1} max={2.5} step={0.1} value={app.settings.iconStroke} onChange={(e) => app.set("iconStroke", +e.target.value)} className="w-24" /><span className="text-[10.5px] muted mono">{app.settings.iconStroke.toFixed(1)}px</span></Row>
              <Row label="图标下方小字"><Toggle on={app.settings.showIconLabel} onChange={(v) => app.set("showIconLabel", v)} /></Row>
            </div>
          </MenuGroup>
          <MenuGroup title="视图">
            <div className="px-2 py-1">
              <Row label="主题"><Seg value={app.settings.theme} options={[{ id: "dark", label: "深色" }, { id: "light", label: "浅色" }]} onChange={(v) => app.set("theme", v as any)} /></Row>
            </div>
          </MenuGroup>
        </MoreMenu>
        <input ref={fileRef} type="file" accept=".dxf,.dwg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (f.name.toLowerCase().endsWith(".dwg")) app.notify("真实 DWG 需要免费的 DWG 转换插件；请先另存为 ASCII DXF", "warn"); else doImport(f); } e.target.value = ""; }} />
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-[62px] shrink-0 border-r hairline overflow-auto" style={{ background: "var(--panel)" }}>
          {TOOLS.map(([id, label, icon]) => (
            <Tool key={id} icon={icon} label={label} on={tool === id} onClick={() => { setTool(id); setPending([]); }} />
          ))}
        </div>

        <div ref={wrapRef} className="flex-1 relative min-w-0" onContextMenu={(e) => e.preventDefault()}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{ cursor: "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          />
          <div className="absolute left-2 bottom-2 text-[11px] mono muted">
            X {fmt(cursor.x)} Y {fmt(cursor.y)} · 缩放 {fmt(view.scale, 2)}× · 图元 {ents.length} · {measureTxt}
          </div>
          {pending.length > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-3 panel rounded px-3 py-1 text-[11px]">
              {tool} · 已拾取 {pending.length} 点 · 继续点击或按 Esc 取消
              {(tool === "polyline" || tool === "spline") && (
                <button
                  className="btn sm ml-2"
                  onClick={() => {
                    if (pending.length >= 2) addEnt({ kind: tool === "spline" ? "spline" : "polyline", pts: pending, closed: false });
                    setPending([]);
                  }}
                >
                  结束
                </button>
              )}
            </div>
          )}
          {inline && (
            <div className="absolute left-1/2 -translate-x-1/2 top-3 panel rounded px-3 py-1 flex items-center gap-2">
              <span className="text-[11px]">在线尺寸</span>
              <Num value={inline.v} onChange={(v) => setInline({ ...inline, v })} />
              <button
                className="btn sm primary"
                onClick={() => {
                  const last = ents[ents.length - 1];
                  if (last?.kind === "line") {
                    const d = { x: last.b!.x - last.a!.x, y: last.b!.y - last.a!.y };
                    const l = Math.hypot(d.x, d.y) || 1;
                    const nb = { x: last.a!.x + (d.x / l) * inline.v, y: last.a!.y + (d.y / l) * inline.v };
                    push(ents.map((e) => (e.id === last.id ? { ...e, b: nb } : e)));
                  }
                  setInline(null);
                }}
              >
                应用
              </button>
              <button className="btn sm" onClick={() => setInline(null)}>×</button>
            </div>
          )}
        </div>

        <div className="w-[250px] shrink-0 border-l hairline overflow-auto" style={{ background: "var(--panel)" }}>
          <Section title="图层">
            {layers.map((l, i) => (
              <div key={l.name} className="flex items-center gap-1 py-[3px]">
                <Color value={l.color} onChange={(c) => setLayers(layers.map((x) => (x.name === l.name ? { ...x, color: c } : x)))} />
                <span className={"flex-1 truncate text-[11.5px] cursor-pointer " + (curLayer === l.name ? "accent" : "")} onClick={() => setCurLayer(l.name)}>
                  {l.name}
                </span>
                <button className="btn sm" onClick={() => setLayers(layers.map((x) => (x.name === l.name ? { ...x, visible: !x.visible } : x)))}>{l.visible ? "👁" : "🚫"}</button>
                <button className="btn sm" onClick={() => setLayers(layers.map((x) => (x.name === l.name ? { ...x, locked: !x.locked } : x)))}>{l.locked ? "🔒" : "🔓"}</button>
                <button className="btn sm" disabled={i === 0} onClick={() => { const n = layers.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; setLayers(n); }}>↑</button>
              </div>
            ))}
            <button
              className="btn sm mt-1"
              onClick={() => {
                const n = `图层${layers.length}`;
                setLayers([...layers, { name: n, color: "#67e8f9", visible: true, locked: false }]);
                setCurLayer(n);
              }}
            >
              + 新建图层
            </button>
          </Section>
          <Section title="工具参数">
            <Row label="多边形边数"><Num value={polySides} onChange={setPolySides} w={60} /></Row>
            <Row label="倒圆角半径"><Num value={filletR} onChange={setFilletR} w={60} /></Row>
            <Row label="偏置距离"><Num value={offsetD} onChange={setOffsetD} w={60} /></Row>
            <Row label="捕捉点">
              <div className="flex flex-wrap gap-1">
                {([["snapEndpoint", "端点"], ["snapMidpoint", "中点"], ["snapCenter", "圆心"], ["snapIntersection", "交点"], ["snapQuadrant", "象限"], ["snapOnCurve", "线上"]] as const).map(([k, l]) => (
                  <button key={k} className={"chip " + ((app.settings as any)[k] ? "on" : "off")} onClick={() => app.set(k as any, !(app.settings as any)[k])}>
                    {l}
                  </button>
                ))}
              </div>
            </Row>
          </Section>
          <Section title="选中对象">
            <div className="text-[11.5px] muted">{sel.length ? `${sel.length} 个图元` : "未选中"}</div>
            {sel.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                <button className="btn sm" onClick={() => push(ents.filter((e) => !sel.includes(e.id)))}>删除</button>
                <button className="btn sm" onClick={() => push(ents.map((e) => (sel.includes(e.id) ? { ...e, layer: curLayer } : e)))}>移到当前图层</button>
              </div>
            )}
          </Section>
          <Section title="图纸">
            <Row label="深色显示"><Seg value={app.settings.theme} options={[{ id: "dark", label: "深色" }, { id: "light", label: "浅色" }]} onChange={(v) => app.set("theme", v as any)} /></Row>
            <div className="text-[11px] muted mt-1">编辑自动保存；导出仍是白纸。</div>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 工具函数 ---------------- */
function arrow(g: CanvasRenderingContext2D, from: Vec2, to: Vec2) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.lineTo(from.x + Math.cos(a - 0.35) * 9, from.y + Math.sin(a - 0.35) * 9);
  g.lineTo(from.x + Math.cos(a + 0.35) * 9, from.y + Math.sin(a + 0.35) * 9);
  g.closePath();
  g.fill();
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function entPoints(e: D2Entity): Vec2[] {
  const out: Vec2[] = [];
  if (e.a) out.push(e.a);
  if (e.b) out.push(e.b);
  if (e.c) out.push(e.c);
  if (e.pts) out.push(...e.pts);
  if (e.r && e.c) out.push({ x: e.c.x - e.r, y: e.c.y - e.r }, { x: e.c.x + e.r, y: e.c.y + e.r });
  return out;
}

function translateEnt(e: D2Entity, dx: number, dy: number): D2Entity {
  const f = (p: Vec2) => ({ x: p.x + dx, y: p.y + dy });
  return { ...e, a: e.a && f(e.a), b: e.b && f(e.b), c: e.c && f(e.c), pos: e.pos && f(e.pos), pts: e.pts?.map(f) };
}

function rotateEnt(e: D2Entity, o: Vec2, ang: number): D2Entity {
  const f = (p: Vec2) => ({
    x: o.x + (p.x - o.x) * Math.cos(ang) - (p.y - o.y) * Math.sin(ang),
    y: o.y + (p.x - o.x) * Math.sin(ang) + (p.y - o.y) * Math.cos(ang),
  });
  return { ...e, a: e.a && f(e.a), b: e.b && f(e.b), c: e.c && f(e.c), pts: e.pts?.map(f), rot: (e.rot || 0) + ang };
}

function mirrorEnt(e: D2Entity, a: Vec2, b: Vec2): D2Entity {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = dx / l,
    ny = dy / l;
  const f = (p: Vec2) => {
    const vx = p.x - a.x,
      vy = p.y - a.y;
    const d = vx * nx + vy * ny;
    return { x: 2 * (a.x + nx * d) - p.x, y: 2 * (a.y + ny * d) - p.y };
  };
  return { ...e, id: uid("e"), a: e.a && f(e.a), b: e.b && f(e.b), c: e.c && f(e.c), pts: e.pts?.map(f) };
}

function circle3(A: Vec2, B: Vec2, C: Vec2) {
  const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / d;
  const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / d;
  return { c: { x: ux, y: uy }, r: Math.hypot(A.x - ux, A.y - uy) };
}

function fillet2(l1: D2Entity, l2: D2Entity, r: number): D2Entity[] | null {
  const ip = lineInter(l1.a!, l1.b!, l2.a!, l2.b!);
  if (!ip) return null;
  const far = (e: D2Entity) => (Math.hypot(e.a!.x - ip.x, e.a!.y - ip.y) > Math.hypot(e.b!.x - ip.x, e.b!.y - ip.y) ? e.a! : e.b!);
  const f1 = far(l1),
    f2 = far(l2);
  const u1 = norm2({ x: f1.x - ip.x, y: f1.y - ip.y }),
    u2 = norm2({ x: f2.x - ip.x, y: f2.y - ip.y });
  const ang = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  if (ang < 0.02 || Math.abs(ang - Math.PI) < 0.02) return null;
  const t = r / Math.tan(ang / 2);
  const p1 = { x: ip.x + u1.x * t, y: ip.y + u1.y * t };
  const p2 = { x: ip.x + u2.x * t, y: ip.y + u2.y * t };
  const bis = norm2({ x: u1.x + u2.x, y: u1.y + u2.y });
  const c = { x: ip.x + bis.x * (r / Math.sin(ang / 2)), y: ip.y + bis.y * (r / Math.sin(ang / 2)) };
  let a0 = Math.atan2(p1.y - c.y, p1.x - c.x),
    a1 = Math.atan2(p2.y - c.y, p2.x - c.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  if (da < 0) [a0, a1] = [a1, a0];
  return [
    { ...l1, id: uid("e"), a: f1, b: p1 },
    { ...l2, id: uid("e"), a: f2, b: p2 },
    { id: uid("e"), layer: l1.layer, kind: "arc", c, r, a0, a1 },
  ];
}

function lineInter(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y },
    s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

const norm2 = (v: Vec2) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
