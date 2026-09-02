import { create } from "zustand";
import * as THREE from "three";
import type { Feature, BodyMeta, Sketch, PlaneRef, Project3D, DrawingDoc } from "../cad/types";
import { PRINCIPAL_PLANES, uid } from "../cad/types";
import { buildModel, type BuildResult } from "../cad/kernel";
import { newSketch } from "../cad/sketch";
import { useApp } from "../store";

export type DisplayMode = "shaded" | "shadedEdge" | "wire" | "hidden" | "xray";
export type AnalysisMode = "none" | "draft" | "thickness" | "zebra";
export type UIMode = "full" | "view" | "easy";

export interface Selection {
  bodies: string[];
  faces: { bodyId: string; faceId: number }[];
  edges: { bodyId: string; edgeId: number }[];
  sketches: string[];
  curves: string[];
}

export const emptySel = (): Selection => ({ bodies: [], faces: [], edges: [], sketches: [], curves: [] });

export interface SectionState {
  on: boolean;
  axis: "x" | "y" | "z";
  pos: number;
  flip: boolean;
  showLine: boolean;
  lineWidth: number;
}

export interface AnalysisResult {
  mode: AnalysisMode;
  perBody: Record<string, Float32Array>;
  min: number;
  max: number;
  running: boolean;
  progress: number;
  ms: number;
  threads: number;
}

interface State {
  projectId: string;
  name: string;
  features: Feature[];
  metas: Record<string, BodyMeta>;
  build: BuildResult;
  rollback: number;
  undoStack: Feature[][];
  redoStack: Feature[][];
  sel: Selection;
  preselect: { bodyId: string; faceId?: number; edgeId?: number } | null;
  activeSketch: Sketch | null;
  activeSketchFeature: string | null;
  sketchTool: string;
  sketchSel: string[];
  /** 草图破坏性编辑的单步撤销栈 */
  sketchUndo: Sketch[];
  /** 曲线规则：单条 / 相连 / 相切 / 整张草图 */
  curveRule: "single" | "connected" | "tangent" | "whole";
  command: { type: string; params: Record<string, any> } | null;
  /** 建模树双击后要在左侧参数卡里编辑的特征 id */
  editFeatureId: string | null;
  /** 命令实时预览数据（半透明实体 / 线框虚影 / 源高亮 / 三维箭头） */
  preview: {
    solids: { geo: any; mode: "add" | "cut" | "new" }[];
    ghosts: any[];
    sources: any[];
    arrows: { from: any; to: any; label: string; color?: string }[];
  } | null;
  display: DisplayMode;
  uiMode: UIMode;
  showSolid: boolean;
  showSheet: boolean;
  showSketch: 0 | 1 | 2; // 显示 / 透视 / 隐藏
  showDatum: boolean;
  filterBody: boolean;
  filterFace: boolean;
  filterEdge: boolean;
  filterSketch: boolean;
  section: SectionState;
  analysis: AnalysisResult;
  measure: { items: { text: string; p: THREE.Vector3 }[]; mode: string };
  drawing: DrawingDoc | null;
  dirty: number;
  hint: string;

  rebuild: () => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  addFeature: (f: Feature) => void;
  updateFeature: (id: string, patch: Partial<Feature>) => void;
  removeFeature: (id: string) => void;
  moveRollback: (i: number) => void;
  setMeta: (id: string, patch: Partial<BodyMeta>) => void;
  select: (s: Partial<Selection>, add?: boolean) => void;
  clearSel: () => void;
  setPre: (p: State["preselect"]) => void;
  startSketch: (plane: PlaneRef) => void;
  editSketch: (featureId: string) => void;
  pushSketchUndo: () => void;
  undoSketch: () => void;
  commitSketch: () => void;
  cancelSketch: () => void;
  setSketch: (s: Sketch) => void;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
  loadProject: (p: Project3D) => void;
  toProject: () => Project3D;
  reset: (name?: string) => void;
  datumPlanes: () => PlaneRef[];
}

const emptyBuild: BuildResult = { bodies: [], sketches: [], datums: [], errors: [] };

export const use3D = create<State>((set, get) => ({
  projectId: uid("prj"),
  name: "未命名模型",
  features: [],
  metas: {},
  build: emptyBuild,
  rollback: Infinity,
  undoStack: [],
  redoStack: [],
  sel: emptySel(),
  preselect: null,
  activeSketch: null,
  activeSketchFeature: null,
  sketchTool: "select",
  sketchSel: [],
  sketchUndo: [],
  curveRule: "single",
  command: null,
  editFeatureId: null,
  preview: null,
  display: "shadedEdge",
  uiMode: "full",
  showSolid: true,
  showSheet: true,
  showSketch: 0,
  showDatum: true,
  filterBody: true,
  filterFace: true,
  filterEdge: true,
  filterSketch: true,
  section: { on: false, axis: "x", pos: 0, flip: false, showLine: true, lineWidth: 1.5 },
  analysis: { mode: "none", perBody: {}, min: 0, max: 1, running: false, progress: 0, ms: 0, threads: 0 },
  measure: { items: [], mode: "distance" },
  drawing: null,
  dirty: 0,
  hint: "选择一个命令开始建模",

  rebuild: () => {
    const { features, metas, rollback } = get();
    const t0 = performance.now();
    // 镶嵌精度：由弦高公差推算圆周分段数
    const cfg = useApp.getState().settings;
    const tol = cfg.chordTol ?? 0.08;
    const seg = Math.max(8, Math.min(256, Math.round(Math.PI / Math.acos(Math.max(-1, 1 - tol / 10)))));
    const build = buildModel(features, metas, rollback, seg, cfg.shading);
    const newMetas = { ...metas };
    for (const b of build.bodies) newMetas[b.id] = { ...b.meta, ...(metas[b.id] || {}), id: b.id, name: metas[b.id]?.name || b.meta.name };
    set({ build, metas: newMetas, dirty: get().dirty + 1 });
    void t0;
  },

  pushUndo: () => {
    const { features, undoStack } = get();
    set({ undoStack: [...undoStack, JSON.parse(JSON.stringify(features))].slice(-40), redoStack: [] });
  },

  undo: () => {
    const { undoStack, features, redoStack } = get();
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    set({ features: prev, undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, features] });
    get().rebuild();
  },

  redo: () => {
    const { redoStack, features, undoStack } = get();
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    set({ features: next, redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, features] });
    get().rebuild();
  },

  addFeature: (f) => {
    get().pushUndo();
    const { features, rollback } = get();
    const at = rollback === Infinity ? features.length : rollback;
    const list = [...features.slice(0, at), f, ...features.slice(at)];
    set({ features: list, rollback: rollback === Infinity ? Infinity : at + 1, command: null });
    get().rebuild();
  },

  updateFeature: (id, patch) => {
    get().pushUndo();
    set({ features: get().features.map((f) => (f.id === id ? ({ ...f, ...patch } as Feature) : f)) });
    get().rebuild();
  },

  removeFeature: (id) => {
    get().pushUndo();
    set({ features: get().features.filter((f) => f.id !== id) });
    get().rebuild();
  },

  moveRollback: (i) => {
    set({ rollback: i });
    get().rebuild();
  },

  setMeta: (id, patch) => {
    set({ metas: { ...get().metas, [id]: { ...(get().metas[id] as BodyMeta), ...patch } } });
    get().rebuild();
  },

  select: (s, add) => {
    const cur = get().sel;
    if (!add) set({ sel: { ...emptySel(), ...s } });
    else
      set({
        sel: {
          bodies: [...new Set([...cur.bodies, ...(s.bodies || [])])],
          faces: [...cur.faces, ...(s.faces || [])],
          edges: [...cur.edges, ...(s.edges || [])],
          sketches: [...new Set([...cur.sketches, ...(s.sketches || [])])],
          curves: [...new Set([...cur.curves, ...(s.curves || [])])],
        },
      });
  },

  clearSel: () => set({ sel: emptySel() }),
  setPre: (p) => set({ preselect: p }),

  startSketch: (plane) => {
    const n = get().features.filter((f) => f.type === "sketch").length + 1;
    set({ activeSketch: newSketch(plane, `草图${n}`), activeSketchFeature: null, sketchTool: "line", hint: "选择绘制工具，在平面上点击开始绘制" });
  },

  editSketch: (featureId) => {
    const f = get().features.find((x) => x.id === featureId);
    if (f && f.type === "sketch") set({ activeSketch: JSON.parse(JSON.stringify(f.sketch)), activeSketchFeature: featureId, sketchTool: "select" });
  },

  commitSketch: () => {
    const { activeSketch, activeSketchFeature } = get();
    if (!activeSketch) return;
    if (activeSketchFeature) get().updateFeature(activeSketchFeature, { sketch: activeSketch } as Partial<Feature>);
    else get().addFeature({ id: uid("f"), type: "sketch", name: activeSketch.name, sketch: activeSketch });
    set({ activeSketch: null, activeSketchFeature: null, sketchSel: [], hint: "草图已完成" });
  },

  cancelSketch: () => set({ activeSketch: null, activeSketchFeature: null, sketchSel: [], sketchUndo: [] }),
  setSketch: (s) => set({ activeSketch: s }),

  pushSketchUndo: () => {
    const s = get().activeSketch;
    if (!s) return;
    set({ sketchUndo: [...get().sketchUndo, JSON.parse(JSON.stringify(s))].slice(-40) });
  },

  undoSketch: () => {
    const stack = get().sketchUndo;
    if (!stack.length) return;
    set({ activeSketch: stack[stack.length - 1], sketchUndo: stack.slice(0, -1), sketchSel: [] });
  },
  set: (k, v) => set({ [k]: v } as any),

  loadProject: (p) => {
    set({
      projectId: p.id,
      name: p.name,
      features: p.features || [],
      metas: p.bodies || {},
      drawing: p.drawing || null,
      undoStack: [],
      redoStack: [],
      rollback: Infinity,
      sel: emptySel(),
      activeSketch: null,
    });
    get().rebuild();
  },

  toProject: (): Project3D => ({
    id: get().projectId,
    name: get().name,
    kind: "3d",
    features: get().features,
    bodies: get().metas,
    updated: Date.now(),
    drawing: get().drawing || undefined,
  }),

  reset: (name) =>
    set({
      projectId: uid("prj"),
      name: name || "未命名模型",
      features: [],
      metas: {},
      build: emptyBuild,
      undoStack: [],
      redoStack: [],
      sel: emptySel(),
      activeSketch: null,
      drawing: null,
      rollback: Infinity,
    }),

  datumPlanes: () => [PRINCIPAL_PLANES.XY, PRINCIPAL_PLANES.XZ, PRINCIPAL_PLANES.YZ, ...get().build.datums],
}));

/* ---------------- 示例模型 ---------------- */
export function sampleBracket(): Feature[] {
  const sk1 = newSketch(PRINCIPAL_PLANES.XY, "草图1");
  sk1.entities = [
    { id: uid("e"), kind: "line", a: { x: -30, y: -20 }, b: { x: 30, y: -20 } },
    { id: uid("e"), kind: "line", a: { x: 30, y: -20 }, b: { x: 30, y: 20 } },
    { id: uid("e"), kind: "line", a: { x: 30, y: 20 }, b: { x: -30, y: 20 } },
    { id: uid("e"), kind: "line", a: { x: -30, y: 20 }, b: { x: -30, y: -20 } },
  ];
  const sk2 = newSketch({ ...PRINCIPAL_PLANES.XY, origin: [0, 0, 8] }, "草图2");
  sk2.entities = [{ id: uid("e"), kind: "circle", c: { x: 0, y: 0 }, r: 10 }];
  const sk3 = newSketch({ ...PRINCIPAL_PLANES.XY, origin: [0, 0, 0] }, "草图3");
  sk3.entities = [{ id: uid("e"), kind: "circle", c: { x: 0, y: 0 }, r: 4 }];
  return [
    { id: uid("f"), type: "sketch", name: "草图1", sketch: sk1 },
    { id: uid("f"), type: "extrude", name: "拉伸1 · 底板 8mm", sketchId: sk1.id, start: 0, end: 8, draft: 0, thin: 0, surface: false, symmetric: false, op: "new" },
    { id: uid("f"), type: "sketch", name: "草图2", sketch: sk2 },
    { id: uid("f"), type: "extrude", name: "拉伸2 · Ø20 凸台", sketchId: sk2.id, start: 0, end: 24, draft: 0, thin: 0, surface: false, symmetric: false, op: "add" },
    { id: uid("f"), type: "sketch", name: "草图3", sketch: sk3 },
    { id: uid("f"), type: "extrude", name: "切除 · Ø8 通孔", sketchId: sk3.id, start: -2, end: 34, draft: 0, thin: 0, surface: false, symmetric: false, op: "cut" },
  ];
}
