import type { D2Entity, Layer, Vec2 } from "../cad/types";
import { uid } from "../cad/types";

/* ================= DXF 读取器（纯 TS，无 GPL 代码，仅 ASCII） ================= */
interface Pair {
  code: number;
  value: string;
}

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) continue;
    out.push({ code, value: lines[i + 1] ?? "" });
  }
  return out;
}

interface RawEnt {
  type: string;
  v: Record<number, string[]>;
}

function groupEntities(pairs: Pair[], from: string, to: string): { ents: RawEnt[]; blocks: Record<string, RawEnt[]>; layers: Layer[] } {
  const ents: RawEnt[] = [];
  const blocks: Record<string, RawEnt[]> = {};
  const layers: Layer[] = [];
  let i = 0;
  let inSection = "";
  let cur: RawEnt | null = null;
  let curBlock: string | null = null;
  const pushCur = () => {
    if (!cur) return;
    if (curBlock) (blocks[curBlock] ||= []).push(cur);
    else if (inSection === "ENTITIES") ents.push(cur);
    cur = null;
  };
  for (; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    if (code === 0) {
      pushCur();
      if (value === "SECTION") {
        inSection = pairs[i + 1]?.value ?? "";
        continue;
      }
      if (value === "ENDSEC") {
        inSection = "";
        continue;
      }
      if (value === "BLOCK") {
        // 找 name
        let name = "";
        for (let j = i + 1; j < pairs.length && pairs[j].code !== 0; j++) if (pairs[j].code === 2) name = pairs[j].value;
        curBlock = name;
        blocks[name] = [];
        continue;
      }
      if (value === "ENDBLK") {
        curBlock = null;
        continue;
      }
      if (value === "LAYER" && inSection === "TABLES") {
        let name = "0",
          color = "#dbe6f2",
          visible = true;
        for (let j = i + 1; j < pairs.length && pairs[j].code !== 0; j++) {
          if (pairs[j].code === 2) name = pairs[j].value;
          if (pairs[j].code === 62) {
            const c = parseInt(pairs[j].value, 10);
            visible = c >= 0;
            color = aciColor(Math.abs(c));
          }
        }
        if (name && !layers.find((l) => l.name === name)) layers.push({ name, color, visible, locked: false });
        continue;
      }
      cur = { type: value, v: {} };
      continue;
    }
    if (cur) (cur.v[code] ||= []).push(value);
  }
  pushCur();
  void from;
  void to;
  return { ents, blocks, layers };
}

const ACI = [
  "#ffffff", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffffff",
  "#808080", "#c0c0c0",
];
function aciColor(i: number): string {
  return ACI[i % ACI.length] || "#dbe6f2";
}

const num = (e: RawEnt, code: number, idx = 0, def = 0) => {
  const a = e.v[code];
  if (!a || a[idx] === undefined) return def;
  const n = parseFloat(a[idx]);
  return isNaN(n) ? def : n;
};
const str = (e: RawEnt, code: number, def = "") => e.v[code]?.[0] ?? def;

function convert(e: RawEnt, tx: (p: Vec2) => Vec2, scale: number, layerDefault = "0"): D2Entity[] {
  const layer = str(e, 8, layerDefault);
  const base: Partial<D2Entity> = { layer };
  switch (e.type) {
    case "LINE":
      return [{ ...base, id: uid("e"), kind: "line", a: tx({ x: num(e, 10), y: num(e, 20) }), b: tx({ x: num(e, 11), y: num(e, 21) }) } as D2Entity];
    case "CIRCLE":
      return [{ ...base, id: uid("e"), kind: "circle", c: tx({ x: num(e, 10), y: num(e, 20) }), r: num(e, 40) * scale } as D2Entity];
    case "ARC":
      return [
        {
          ...base,
          id: uid("e"),
          kind: "arc",
          c: tx({ x: num(e, 10), y: num(e, 20) }),
          r: num(e, 40) * scale,
          a0: (num(e, 50) * Math.PI) / 180,
          a1: (num(e, 51) * Math.PI) / 180,
        } as D2Entity,
      ];
    case "ELLIPSE": {
      const cx = num(e, 10),
        cy = num(e, 20);
      const mx = num(e, 11),
        my = num(e, 21);
      const ratio = num(e, 40, 0, 1);
      const rx = Math.hypot(mx, my);
      return [
        { ...base, id: uid("e"), kind: "ellipse", c: tx({ x: cx, y: cy }), rx: rx * scale, ry: rx * ratio * scale, rot: Math.atan2(my, mx) } as D2Entity,
      ];
    }
    case "LWPOLYLINE": {
      const xs = e.v[10] || [],
        ys = e.v[20] || [];
      const pts: Vec2[] = xs.map((x, i) => tx({ x: parseFloat(x), y: parseFloat(ys[i] ?? "0") }));
      const flag = num(e, 70);
      return [{ ...base, id: uid("e"), kind: "polyline", pts, closed: (flag & 1) === 1 } as D2Entity];
    }
    case "SPLINE": {
      const xs = e.v[10] || [],
        ys = e.v[20] || [];
      const pts: Vec2[] = xs.map((x, i) => tx({ x: parseFloat(x), y: parseFloat(ys[i] ?? "0") }));
      return [{ ...base, id: uid("e"), kind: "spline", pts, closed: (num(e, 70) & 1) === 1 } as D2Entity];
    }
    case "POINT":
      return [{ ...base, id: uid("e"), kind: "point", c: tx({ x: num(e, 10), y: num(e, 20) }) } as D2Entity];
    case "TEXT":
    case "MTEXT":
      return [
        {
          ...base,
          id: uid("e"),
          kind: "text",
          c: tx({ x: num(e, 10), y: num(e, 20) }),
          text: (str(e, 1) || "").replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, ""),
          height: (num(e, 40, 0, 3.5) || 3.5) * scale,
          rot: (num(e, 50) * Math.PI) / 180,
        } as D2Entity,
      ];
    case "DIMENSION": {
      const p1 = tx({ x: num(e, 13), y: num(e, 23) });
      const p2 = tx({ x: num(e, 14), y: num(e, 24) });
      const pos = tx({ x: num(e, 11), y: num(e, 21) });
      return [
        {
          ...base,
          id: uid("e"),
          kind: "dim",
          a: p1,
          b: p2,
          pos,
          dimType: "linear",
          text: str(e, 1),
          value: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        } as D2Entity,
      ];
    }
    case "SOLID":
    case "HATCH": {
      const xs = e.v[10] || [],
        ys = e.v[20] || [];
      const pts: Vec2[] = xs.map((x, i) => tx({ x: parseFloat(x), y: parseFloat(ys[i] ?? "0") }));
      if (pts.length < 2) return [];
      return [{ ...base, id: uid("e"), kind: "hatch", pts, closed: true } as D2Entity];
    }
    default:
      return [];
  }
}

export function parseDXF(text: string): { entities: D2Entity[]; layers: Layer[] } {
  if (/^\s*(AutoCAD Binary DXF)/.test(text.slice(0, 40))) throw new Error("不支持二进制 DXF，请在桌面 CAD 中另存为 ASCII DXF");
  const pairs = tokenize(text);
  const { ents, blocks, layers } = groupEntities(pairs, "ENTITIES", "ENDSEC");
  const out: D2Entity[] = [];
  const idt = (p: Vec2) => p;

  const expand = (list: RawEnt[], tx: (p: Vec2) => Vec2, scale: number, depth: number) => {
    for (const e of list) {
      if (e.type === "INSERT") {
        if (depth > 6) continue;
        const name = str(e, 2);
        const bx = num(e, 10),
          by = num(e, 20);
        const sx = num(e, 41, 0, 1) || 1,
          sy = num(e, 42, 0, 1) || 1;
        const rot = (num(e, 50) * Math.PI) / 180;
        const cols = Math.max(1, num(e, 70, 0, 1)),
          rows = Math.max(1, num(e, 71, 0, 1));
        const cs = num(e, 44),
          rs = num(e, 45);
        const blk = blocks[name];
        if (!blk) continue;
        for (let ci = 0; ci < cols; ci++) {
          for (let ri = 0; ri < rows; ri++) {
            const ox = bx + ci * cs,
              oy = by + ri * rs;
            const t = (p: Vec2): Vec2 => {
              const x = p.x * sx,
                y = p.y * sy;
              return tx({ x: ox + x * Math.cos(rot) - y * Math.sin(rot), y: oy + x * Math.sin(rot) + y * Math.cos(rot) });
            };
            expand(blk, t, scale * Math.abs(sx), depth + 1);
          }
        }
      } else {
        out.push(...convert(e, tx, scale));
      }
    }
  };
  expand(ents, idt, 1, 0);
  const usedLayers = new Set(out.map((e) => e.layer));
  for (const l of usedLayers) if (!layers.find((x) => x.name === l)) layers.push({ name: l, color: "#dbe6f2", visible: true, locked: false });
  if (!layers.length) layers.push({ name: "0", color: "#dbe6f2", visible: true, locked: false });
  return { entities: out, layers };
}

/* ================= DXF 写出 ================= */
function g(code: number, v: string | number) {
  return `${code}\n${v}\n`;
}

export function writeDXF(entities: D2Entity[], layers: Layer[]): string {
  let s = "";
  s += g(0, "SECTION") + g(2, "HEADER");
  s += g(9, "$ACADVER") + g(1, "AC1015");
  s += g(9, "$INSUNITS") + g(70, 4);
  s += g(0, "ENDSEC");
  s += g(0, "SECTION") + g(2, "TABLES") + g(0, "TABLE") + g(2, "LAYER") + g(70, layers.length);
  for (const l of layers) {
    s += g(0, "LAYER") + g(2, l.name) + g(70, 0) + g(62, l.visible ? 7 : -7) + g(6, "CONTINUOUS");
  }
  s += g(0, "ENDTAB") + g(0, "ENDSEC");
  s += g(0, "SECTION") + g(2, "ENTITIES");
  for (const e of entities) {
    const L = e.layer || "0";
    switch (e.kind) {
      case "line":
        s += g(0, "LINE") + g(8, L) + g(10, e.a!.x) + g(20, e.a!.y) + g(30, 0) + g(11, e.b!.x) + g(21, e.b!.y) + g(31, 0);
        break;
      case "circle":
        s += g(0, "CIRCLE") + g(8, L) + g(10, e.c!.x) + g(20, e.c!.y) + g(30, 0) + g(40, e.r!);
        break;
      case "arc":
        s +=
          g(0, "ARC") + g(8, L) + g(10, e.c!.x) + g(20, e.c!.y) + g(30, 0) + g(40, e.r!) +
          g(50, ((e.a0 || 0) * 180) / Math.PI) + g(51, ((e.a1 || 0) * 180) / Math.PI);
        break;
      case "ellipse":
        s +=
          g(0, "ELLIPSE") + g(8, L) + g(10, e.c!.x) + g(20, e.c!.y) + g(30, 0) +
          g(11, Math.cos(e.rot || 0) * e.rx!) + g(21, Math.sin(e.rot || 0) * e.rx!) + g(31, 0) +
          g(40, (e.ry || 1) / (e.rx || 1)) + g(41, 0) + g(42, Math.PI * 2);
        break;
      case "polyline":
      case "spline":
      case "hatch": {
        const pts = e.pts || [];
        s += g(0, "LWPOLYLINE") + g(8, L) + g(90, pts.length) + g(70, e.closed ? 1 : 0);
        for (const p of pts) s += g(10, p.x) + g(20, p.y);
        break;
      }
      case "text":
        s += g(0, "TEXT") + g(8, L) + g(10, e.c!.x) + g(20, e.c!.y) + g(30, 0) + g(40, e.height || 3.5) + g(1, e.text || "") + g(50, ((e.rot || 0) * 180) / Math.PI);
        break;
      case "point":
        s += g(0, "POINT") + g(8, L) + g(10, e.c!.x) + g(20, e.c!.y) + g(30, 0);
        break;
      case "dim": {
        // 以基本图元写出（线 + 文本），保证任何 CAD 都能正确显示
        const a = e.a!,
          b = e.b!,
          pos = e.pos || e.c || a;
        const txt = e.text || String(Math.round((e.value || 0) * 100) / 100);
        s += g(0, "LINE") + g(8, L) + g(10, a.x) + g(20, a.y) + g(30, 0) + g(11, pos.x) + g(21, pos.y) + g(31, 0);
        s += g(0, "LINE") + g(8, L) + g(10, b.x) + g(20, b.y) + g(30, 0) + g(11, pos.x) + g(21, pos.y) + g(31, 0);
        s += g(0, "TEXT") + g(8, L) + g(10, pos.x) + g(20, pos.y) + g(30, 0) + g(40, e.height || 3.5) + g(1, txt);
        break;
      }
    }
  }
  s += g(0, "ENDSEC") + g(0, "EOF");
  return s;
}

/** 简易 DWG 检测（真实 DWG 需转换插件） */
export function isDWG(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf.slice(0, 6));
  const sig = String.fromCharCode(...b);
  return /^AC10\d\d/.test(sig);
}
