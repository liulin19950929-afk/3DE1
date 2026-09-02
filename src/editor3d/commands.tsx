import type { Feature } from "../cad/types";
import { uid } from "../cad/types";
import { use3D } from "./store3d";

export type FieldType = "num" | "bool" | "select" | "text" | "sketch" | "body" | "sketches" | "bodies";

/** 阵列方向：六个轴向 */
export const AXES = [
  { id: "x", label: "+X" },
  { id: "-x", label: "−X" },
  { id: "y", label: "+Y" },
  { id: "-y", label: "−Y" },
  { id: "z", label: "+Z" },
  { id: "-z", label: "−Z" },
];

export function axisDelta(axis: string, spacing: number): [number, number, number] {
  const s = spacing || 0;
  switch (axis) {
    case "-x":
      return [-s, 0, 0];
    case "y":
      return [0, s, 0];
    case "-y":
      return [0, -s, 0];
    case "z":
      return [0, 0, s];
    case "-z":
      return [0, 0, -s];
    default:
      return [s, 0, 0];
  }
}

const modeName = (m: string) =>
  ({ move: "移动/旋转", mirror: "镜像", linear: "线性阵列", circular: "圆形阵列", scale: "缩放体" })[m] || m;

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  def: any;
  step?: number;
  options?: { id: string; label: string }[];
  hint?: string;
  when?: (p: Record<string, any>) => boolean;
}

export interface CommandDef {
  id: string;
  title: string;
  icon: string;
  group: "modeling" | "surface" | "edit" | "more";
  hint: string;
  fields: Field[];
  needs?: string;
  pro?: boolean;
  apply: (p: Record<string, any>) => Feature | Feature[] | null;
}

const opField: Field = {
  key: "op",
  label: "布尔",
  type: "select",
  def: "new",
  options: [
    { id: "new", label: "新建体" },
    { id: "add", label: "求和" },
    { id: "cut", label: "求差" },
    { id: "intersect", label: "求交" },
  ],
};

/** 视口中选中的截面：整张草图或若干条曲线 */
export function selectedProfile(): { sketchId: string; curveIds: string[]; label: string } {
  const s = use3D.getState();
  const skId = s.sel.sketches[0];
  if (skId) {
    const rec = s.build.sketches.find((x) => x.sketch.id === skId);
    const total = rec?.sketch.entities.length ?? 0;
    const ids = s.sel.curves.filter((c) => rec?.sketch.entities.some((e) => e.id === c));
    const whole = ids.length === 0 || ids.length === total;
    return {
      sketchId: skId,
      curveIds: whole ? [] : ids,
      label: whole ? `${rec?.sketch.name ?? "草图"} · 整张草图` : `${rec?.sketch.name ?? "草图"} · ${ids.length} 条曲线`,
    };
  }
  const list = s.build.sketches;
  const id = list.length ? list[list.length - 1].sketch.id : "";
  return { sketchId: id, curveIds: [], label: id ? "最近的草图（未在视口中选择）" : "未选择截面" };
}

const lastSketch = () => selectedProfile().sketchId;

export const COMMANDS: CommandDef[] = [
  {
    id: "extrude",
    title: "拉伸",
    icon: "⬆",
    group: "modeling",
    hint: "选择截面（整张草图或单条曲线），设定起止距离",
    fields: [
      { key: "sketchId", label: "截面草图", type: "sketch", def: "" },
      { key: "start", label: "起点", type: "num", def: 0 },
      { key: "end", label: "终点", type: "num", def: 20 },
      { key: "symmetric", label: "对称", type: "bool", def: false },
      { key: "draft", label: "拔模角 °", type: "num", def: 0, step: 0.5 },
      { key: "thin", label: "薄壁厚度", type: "num", def: 0, step: 0.5, hint: "0 = 实心；>0 生成环形截面" },
      { key: "surface", label: "生成片体", type: "bool", def: false },
      opField,
    ],
    apply: (p) => ({
      id: uid("f"),
      type: "extrude",
      name: `拉伸 ${p.end - p.start}mm`,
      sketchId: p.sketchId || lastSketch(),
      curveIds: p.sketchId && p.sketchId === selectedProfile().sketchId ? selectedProfile().curveIds : [],
      start: p.start,
      end: p.end,
      draft: p.draft,
      thin: p.thin,
      surface: p.surface,
      symmetric: p.symmetric,
      op: p.op,
    }),
  },
  {
    id: "revolve",
    title: "旋转体",
    icon: "🌀",
    group: "modeling",
    hint: "选择截面与旋转轴，输入角度",
    fields: [
      { key: "sketchId", label: "截面草图", type: "sketch", def: "" },
      { key: "axis", label: "旋转轴", type: "select", def: "y", options: [{ id: "x", label: "草图 X 轴" }, { id: "y", label: "草图 Y 轴" }] },
      { key: "angle", label: "角度 °", type: "num", def: 360, step: 5 },
      opField,
    ],
    apply: (p) => ({
      id: uid("f"),
      type: "revolve",
      name: `旋转 ${p.angle}°`,
      sketchId: p.sketchId || lastSketch(),
      curveIds: p.sketchId && p.sketchId === selectedProfile().sketchId ? selectedProfile().curveIds : [],
      axis: p.axis,
      angle: p.angle,
      op: p.op,
    }),
  },
  {
    id: "sweep",
    title: "扫掠",
    icon: "🪃",
    group: "surface",
    hint: "截面沿引导线扫出实体",
    fields: [
      { key: "sketchId", label: "截面", type: "sketch", def: "" },
      { key: "pathId", label: "引导线", type: "sketch", def: "" },
      opField,
    ],
    apply: (p) => ({ id: uid("f"), type: "sweep", name: "扫掠", sketchId: p.sketchId, pathId: p.pathId, op: p.op }),
  },
  {
    id: "loft",
    title: "通过曲线组",
    icon: "🎚",
    group: "surface",
    hint: "按顺序选择两张以上截面草图",
    fields: [{ key: "sketchIds", label: "截面序列", type: "sketches", def: [] }, opField],
    apply: (p) => ({ id: uid("f"), type: "loft", name: "通过曲线组", sketchIds: p.sketchIds, op: p.op }),
  },
  {
    id: "fill",
    title: "填充",
    icon: "🩹",
    group: "surface",
    hint: "填充一圈封闭边界，生成曲面片体",
    fields: [{ key: "sketchId", label: "边界草图", type: "sketch", def: "" }],
    apply: (p) => ({ id: uid("f"), type: "fill", name: "边界填充", sketchId: p.sketchId || lastSketch() }),
  },
  {
    id: "boolean",
    title: "布尔",
    icon: "⊕",
    group: "modeling",
    hint: "先选目标体，再选工具体（Shift 多选）",
    fields: [
      { key: "op", label: "运算", type: "select", def: "union", options: [{ id: "union", label: "并集" }, { id: "subtract", label: "差集" }, { id: "intersect", label: "交集" }] },
      { key: "target", label: "目标体", type: "body", def: "" },
      { key: "tool", label: "工具体", type: "body", def: "" },
    ],
    apply: (p) => ({ id: uid("f"), type: "boolean", name: `布尔 ${p.op}`, op: p.op, targets: [p.target], tools: [p.tool] }),
  },
  {
    id: "fillet",
    title: "圆角/倒角",
    icon: "◜",
    group: "edit",
    hint: "在视口中点选边（选择过滤器打开「边」），可多选",
    fields: [
      { key: "mode", label: "类型", type: "select", def: "fillet", options: [{ id: "fillet", label: "圆角" }, { id: "chamfer", label: "倒角" }] },
      { key: "radius", label: "半径/距离", type: "num", def: 3, step: 0.5 },
    ],
    needs: "edges",
    apply: (p) => {
      const sel = use3D.getState().sel.edges;
      if (!sel.length) return null;
      return {
        id: uid("f"),
        type: "fillet",
        name: `${p.mode === "fillet" ? "圆角" : "倒角"} R${p.radius}`,
        mode: p.mode,
        bodyId: sel[0].bodyId,
        radius: p.radius,
        edges: sel.map((e) => e.edgeId),
      };
    },
  },
  {
    id: "shell",
    title: "抽壳",
    icon: "🥣",
    group: "edit",
    hint: "选中要开口的面（可选），设定壁厚",
    fields: [{ key: "thickness", label: "壁厚", type: "num", def: 2, step: 0.5 }, { key: "bodyId", label: "实体", type: "body", def: "" }],
    apply: (p) => {
      const sel = use3D.getState().sel;
      return {
        id: uid("f"),
        type: "shell",
        name: `抽壳 ${p.thickness}mm`,
        bodyId: p.bodyId || sel.bodies[0] || sel.faces[0]?.bodyId || "",
        thickness: p.thickness,
        openFaces: sel.faces.map((f) => f.faceId),
      };
    },
  },
  {
    id: "draftFeat",
    title: "拔模",
    icon: "📐",
    group: "edit",
    hint: "让侧面带一点斜度，便于脱模",
    fields: [
      { key: "bodyId", label: "实体", type: "body", def: "" },
      { key: "angle", label: "角度 °", type: "num", def: 3, step: 0.5 },
      { key: "dir", label: "脱模方向", type: "select", def: "z", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }, { id: "z", label: "Z" }] },
    ],
    apply: (p) => ({
      id: uid("f"),
      type: "draftFeat",
      name: `拔模 ${p.angle}°`,
      bodyId: p.bodyId || use3D.getState().sel.bodies[0] || "",
      angle: p.angle,
      dir: p.dir === "x" ? [1, 0, 0] : p.dir === "y" ? [0, 1, 0] : [0, 0, 1],
    }),
  },
  {
    id: "pushpull",
    title: "同步 · 推拉面",
    icon: "🫱",
    group: "edit",
    hint: "先在视口中点选一张面，再输入带符号距离（可跨零反向）",
    fields: [
      { key: "distance", label: "距离", type: "num", def: 5, step: 0.5 },
      { key: "mode", label: "方式", type: "select", def: "pull", options: [{ id: "pull", label: "拉出" }, { id: "push", label: "压入" }, { id: "offset", label: "偏置区域" }] },
    ],
    needs: "face",
    apply: (p) => {
      const f = use3D.getState().sel.faces[0];
      if (!f) return null;
      const body = use3D.getState().build.bodies.find((b) => b.id === f.bodyId);
      if (!body) return null;
      return {
        id: uid("f"),
        type: "pushpull",
        name: `${p.mode === "push" ? "压入" : p.mode === "offset" ? "偏置区域" : "拉出"} ${p.distance}mm`,
        bodyId: f.bodyId,
        faceKey: String(f.faceId),
        normal: [0, 0, 1],
        distance: p.mode === "push" ? -Math.abs(p.distance) : p.distance,
        mode: p.mode,
      };
    },
  },
  {
    id: "transform",
    title: "变换",
    icon: "✥",
    group: "edit",
    hint: "移动 · 复制 · 镜像 · 线性/圆形阵列 · 缩放",
    fields: [
      {
        key: "mode",
        label: "方式",
        type: "select",
        def: "move",
        options: [
          { id: "move", label: "移动/旋转" },
          { id: "mirror", label: "镜像" },
          { id: "linear", label: "线性阵列" },
          { id: "circular", label: "圆形阵列" },
          { id: "scale", label: "缩放体" },
        ],
      },
      { key: "bodyId", label: "实体", type: "bodies", def: "", hint: "在视口里点实体或建模树特征即可选中，Shift 多选" },
      { key: "dx", label: "ΔX", type: "num", def: 0, when: (p) => p.mode === "move" },
      { key: "dy", label: "ΔY", type: "num", def: 0, when: (p) => p.mode === "move" },
      { key: "dz", label: "ΔZ", type: "num", def: 0, when: (p) => p.mode === "move" },
      { key: "rx", label: "绕X °", type: "num", def: 0, when: (p) => p.mode === "move" },
      { key: "ry", label: "绕Y °", type: "num", def: 0, when: (p) => p.mode === "move" },
      { key: "rz", label: "绕Z °", type: "num", def: 0, when: (p) => p.mode === "move" },
      /* 线性阵列：两个方向，各自指定轴 / 数量 / 间距 */
      { key: "dir1", label: "方向1 轴", type: "select", def: "x", options: AXES, when: (p) => p.mode === "linear" },
      { key: "count", label: "方向1 数量", type: "num", def: 4, when: (p) => p.mode === "linear" },
      { key: "spacing1", label: "方向1 间距", type: "num", def: 30, when: (p) => p.mode === "linear" },
      { key: "dir2", label: "方向2 轴", type: "select", def: "y", options: AXES, when: (p) => p.mode === "linear" },
      { key: "count2", label: "方向2 数量", type: "num", def: 1, when: (p) => p.mode === "linear", hint: "1 = 只做单方向阵列" },
      { key: "spacing2", label: "方向2 间距", type: "num", def: 30, when: (p) => p.mode === "linear" && p.count2 > 1 },
      { key: "axis", label: "轴", type: "select", def: "z", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }, { id: "z", label: "Z" }], when: (p) => p.mode === "mirror" || p.mode === "circular" },
      { key: "count", label: "数量", type: "num", def: 6, when: (p) => p.mode === "circular" },
      { key: "scale", label: "比例", type: "num", def: 1.5, step: 0.1, when: (p) => p.mode === "scale" },
      { key: "copy", label: "保留副本", type: "bool", def: true, when: (p) => p.mode === "move" || p.mode === "mirror" },
    ],
    apply: (p) => {
      const ids: string[] = use3D.getState().sel.bodies.length ? use3D.getState().sel.bodies : p.bodyId ? [p.bodyId] : [];
      const targets = ids.length ? ids : [use3D.getState().build.bodies[0]?.id].filter(Boolean);
      if (!targets.length) return null;
      const d1 = axisDelta(p.dir1 || "x", p.spacing1 ?? 30);
      const d2 = axisDelta(p.dir2 || "y", p.spacing2 ?? 30);
      const feats: Feature[] = [];
      for (const bodyId of targets) {
        if (p.mode === "linear") {
          feats.push({
            id: uid("f"),
            type: "transform",
            name: `线性阵列 ${p.count}×${p.count2 > 1 ? p.count2 : 1}`,
            mode: "linear",
            bodyId,
            dx: d1[0],
            dy: d1[1],
            dz: d1[2],
            dx2: d2[0],
            dy2: d2[1],
            dz2: d2[2],
            count2: Math.max(1, p.count2 | 0),
            rx: 0,
            ry: 0,
            rz: 0,
            count: Math.max(2, p.count | 0),
            copy: true,
            axis: "z",
            scale: 1,
          } as Feature);
        } else {
          feats.push({
            id: uid("f"),
            type: "transform",
            name: `变换 · ${modeName(p.mode)}`,
            mode: p.mode,
            bodyId,
            dx: p.dx || 0,
            dy: p.dy || 0,
            dz: p.dz || 0,
            rx: p.rx || 0,
            ry: p.ry || 0,
            rz: p.rz || 0,
            count: p.count || 2,
            copy: !!p.copy,
            axis: p.axis || "z",
            scale: p.scale || 1,
          } as Feature);
        }
      }
      return feats;
    },
  },
  {
    id: "primitive",
    title: "基本体",
    icon: "📦",
    group: "more",
    hint: "长方体 · 圆柱 · 球 · 圆锥 · 圆环 · 管 · 螺纹",
    fields: [
      {
        key: "shape",
        label: "形状",
        type: "select",
        def: "box",
        options: [
          { id: "box", label: "长方体" },
          { id: "cylinder", label: "圆柱" },
          { id: "sphere", label: "球" },
          { id: "cone", label: "圆锥" },
          { id: "torus", label: "圆环" },
          { id: "tube", label: "管" },
          { id: "thread", label: "螺纹" },
        ],
      },
      { key: "x", label: "长 X", type: "num", def: 40, when: (p) => p.shape === "box" },
      { key: "y", label: "宽 Y", type: "num", def: 30, when: (p) => p.shape === "box" },
      { key: "z", label: "高 Z", type: "num", def: 20, when: (p) => p.shape === "box" },
      { key: "r", label: "半径", type: "num", def: 15, when: (p) => p.shape !== "box" },
      { key: "h", label: "高度", type: "num", def: 30, when: (p) => p.shape === "cylinder" || p.shape === "cone" || p.shape === "thread" },
      { key: "t", label: "截面半径", type: "num", def: 5, when: (p) => p.shape === "torus" || p.shape === "tube" },
      { key: "pitch", label: "螺距", type: "num", def: 1.5, step: 0.1, when: (p) => p.shape === "thread" },
      { key: "px", label: "位置 X", type: "num", def: 0 },
      { key: "py", label: "位置 Y", type: "num", def: 0 },
      { key: "pz", label: "位置 Z", type: "num", def: 0 },
      opField,
    ],
    apply: (p) => ({
      id: uid("f"),
      type: "primitive",
      name: `基本体 · ${p.shape}`,
      shape: p.shape,
      params: { ...p },
      op: p.op,
    }),
  },
  {
    id: "thicken",
    title: "加厚",
    icon: "🧱",
    group: "more",
    hint: "把片体撑成实体",
    fields: [{ key: "bodyId", label: "片体", type: "body", def: "" }, { key: "thickness", label: "厚度", type: "num", def: 2, step: 0.5 }],
    apply: (p) => ({ id: uid("f"), type: "thicken", name: `加厚 ${p.thickness}mm`, bodyId: p.bodyId || use3D.getState().sel.bodies[0] || "", thickness: p.thickness }),
  },
  {
    id: "deleteBody",
    title: "删除体",
    icon: "🗑",
    group: "more",
    hint: "把整块实体从模型里移除",
    fields: [{ key: "bodyId", label: "实体", type: "body", def: "" }],
    apply: (p) => ({ id: uid("f"), type: "delete", name: "删除体", bodyId: p.bodyId || use3D.getState().sel.bodies[0] || "" }),
  },
  {
    id: "datum",
    title: "基准面",
    icon: "▦",
    group: "modeling",
    hint: "主平面 · 偏置 · 二等分 · 成角度",
    fields: [
      { key: "mode", label: "方式", type: "select", def: "offset", options: [{ id: "principal", label: "主平面" }, { id: "offset", label: "偏置" }, { id: "bisect", label: "二等分" }, { id: "angle", label: "成角度" }] },
      { key: "base", label: "基准", type: "select", def: "XY", options: [{ id: "XY", label: "XY" }, { id: "XZ", label: "XZ" }, { id: "YZ", label: "YZ" }] },
      { key: "offset", label: "偏置距离", type: "num", def: 20 },
      { key: "angle", label: "角度 °", type: "num", def: 30, when: (p) => p.mode === "angle" },
    ],
    apply: (p) => ({ id: uid("f"), type: "datum", name: `基准面 ${p.base}${p.offset ? "+" + p.offset : ""}`, mode: p.mode, base: p.base, offset: p.offset, angle: p.angle || 0 }),
  },
];

export const commandById = (id: string) => COMMANDS.find((c) => c.id === id);
