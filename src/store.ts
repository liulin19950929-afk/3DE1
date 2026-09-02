import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Lang } from "./i18n";
import { translate } from "./i18n";
import type { AnyProject } from "./cad/types";
import { cpuThreads } from "./workers/pool";

export type Page =
  | "home"
  | "model"
  | "draft2d"
  | "drawing"
  | "tutorials"
  | "features"
  | "formats"
  | "changelog"
  | "roadmap"
  | "faq"
  | "pro"
  | "settings";

export interface ExportRecord {
  id: string;
  name: string;
  format: string;
  size: number;
  time: number;
  url?: string;
}

export interface ViewportColors {
  bgTop: string;
  bgBottom: string;
  body: string;
  edge: string;
  selected: string;
  preselect: string;
  sketch: string;
  sketchConstruction: string;
  dim: string;
  grid: string;
  gridMajor: string;
  datumXY: string;
  datumXZ: string;
  datumYZ: string;
  axisX: string;
  axisY: string;
  axisZ: string;
  sectionLine: string;
  ground: string;
  highlightFace: string;
}

export const DEFAULT_COLORS: ViewportColors = {
  bgTop: "#16202b",
  bgBottom: "#0a0f14",
  body: "#b8c4d0",
  edge: "#243444",
  selected: "#38bdf8",
  preselect: "#fbbf24",
  sketch: "#67e8f9",
  sketchConstruction: "#a78bfa",
  dim: "#f472b6",
  grid: "#1b2836",
  gridMajor: "#2a3d51",
  datumXY: "#38bdf8",
  datumXZ: "#34d399",
  datumYZ: "#f472b6",
  axisX: "#ef4444",
  axisY: "#22c55e",
  axisZ: "#3b82f6",
  sectionLine: "#fbbf24",
  ground: "#0d141b",
  highlightFace: "#22d3ee",
};

/** 浅色主题的视口配色 */
export const DEFAULT_COLORS_LIGHT: ViewportColors = {
  bgTop: "#f4f7fa",
  bgBottom: "#dde5ee",
  body: "#9fb0c2",
  edge: "#5b6b7c",
  selected: "#0284c7",
  preselect: "#d97706",
  sketch: "#0891b2",
  sketchConstruction: "#7c3aed",
  dim: "#db2777",
  grid: "#dbe3ec",
  gridMajor: "#bccbd9",
  datumXY: "#0284c7",
  datumXZ: "#059669",
  datumYZ: "#db2777",
  axisX: "#dc2626",
  axisY: "#16a34a",
  axisZ: "#2563eb",
  sectionLine: "#d97706",
  ground: "#e6ecf3",
  highlightFace: "#0891b2",
};

/** 实时预览配色语义（按主题切换） */
export interface PreviewColors {
  add: string;
  addOpacity: number;
  cut: string;
  cutOpacity: number;
  ghost: string;
  ghostWidth: number;
  source: string;
  sourceGlow: number;
  arrow: string;
}

export const PREVIEW_DARK: PreviewColors = {
  add: "#60A5FA",
  addOpacity: 0.4,
  cut: "#F87171",
  cutOpacity: 0.45,
  ghost: "#93C5FD",
  ghostWidth: 1.5,
  source: "#38BDF8",
  sourceGlow: 4,
  arrow: "#22D3EE",
};

export const PREVIEW_LIGHT: PreviewColors = {
  add: "#3B82F6",
  addOpacity: 0.35,
  cut: "#EF4444",
  cutOpacity: 0.4,
  ghost: "#60A5FA",
  ghostWidth: 1.5,
  source: "#2563EB",
  sourceGlow: 4,
  arrow: "#0284C7",
};

export const previewColors = (theme: "dark" | "light"): PreviewColors => (theme === "light" ? PREVIEW_LIGHT : PREVIEW_DARK);

export interface Settings {
  lang: Lang;
  theme: "dark" | "light";
  units: "mm" | "cm" | "m" | "in";
  precision: number;
  aa: 0 | 2 | 4 | 8;
  threads: number;
  gridSnap: boolean;
  gridStep: number;
  objectSnap: boolean;
  snapEndpoint: boolean;
  snapMidpoint: boolean;
  snapCenter: boolean;
  snapIntersection: boolean;
  snapQuadrant: boolean;
  snapOnCurve: boolean;
  hideSketchAfterFeature: boolean;
  showDatums: boolean;
  showAxes: boolean;
  shadows: boolean;
  toolbarScale: number;
  panelOpacity: number;
  /** 深色主题视口配色 */
  colors: ViewportColors;
  /** 浅色主题视口配色 */
  colorsLight: ViewportColors;
  stylus: boolean;
  autoSave: boolean;
  tessellation: number;
  /* 图标与线条 */
  iconStroke: number;
  iconSize: number;
  showIconLabel: boolean;
  /* 草图交互 */
  snapRange: number;
  continuousDraw: boolean;
  autoAlignSketch: boolean;
  /* 着色与镶嵌 */
  shading: "flat" | "smooth";
  chordTol: number;
  /* 基准面样式 */
  datumStyle: "dashed" | "grid" | "filled";
  datumOpacity: number;
  /* 预览 */
  livePreview: boolean;
  previewArrows: boolean;
}

interface State {
  page: Page;
  settings: Settings;
  pro: boolean;
  trialStart: number | null;
  projects: AnyProject[];
  currentId: string | null;
  exports: ExportRecord[];
  toast: { id: number; text: string; kind: "info" | "ok" | "warn" | "err" } | null;
  setPage: (p: Page) => void;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  setColors: (c: Partial<ViewportColors>) => void;
  activeColors: () => ViewportColors;
  preview: () => PreviewColors;
  unlockPro: (v: boolean) => void;
  startTrial: () => void;
  upsertProject: (p: AnyProject) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  openProject: (id: string) => void;
  addExport: (r: ExportRecord) => void;
  clearExports: () => void;
  notify: (text: string, kind?: "info" | "ok" | "warn" | "err") => void;
  t: (k: string) => string;
}

export const useApp = create<State>()(
  persist(
    (set, get) => ({
      page: "home",
      settings: {
        lang: "zh-CN",
        theme: "dark",
        units: "mm",
        precision: 2,
        aa: 4,
        threads: cpuThreads(),
        gridSnap: true,
        gridStep: 5,
        objectSnap: true,
        snapEndpoint: true,
        snapMidpoint: true,
        snapCenter: true,
        snapIntersection: true,
        snapQuadrant: true,
        snapOnCurve: true,
        hideSketchAfterFeature: true,
        showDatums: true,
        showAxes: true,
        shadows: true,
        toolbarScale: 1,
        panelOpacity: 1,
        colors: DEFAULT_COLORS,
        colorsLight: DEFAULT_COLORS_LIGHT,
        stylus: false,
        autoSave: true,
        tessellation: 48,
        iconStroke: 1.5,
        iconSize: 19,
        showIconLabel: true,
        snapRange: 12,
        continuousDraw: true,
        autoAlignSketch: true,
        shading: "smooth",
        chordTol: 0.08,
        datumStyle: "dashed",
        datumOpacity: 0.08,
        livePreview: true,
        previewArrows: true,
      },
      pro: false,
      trialStart: null,
      projects: [],
      currentId: null,
      exports: [],
      toast: null,
      setPage: (p) => set({ page: p }),
      set: (k, v) => set({ settings: { ...get().settings, [k]: v } }),
      /** 改的是「当前主题」那套配色 */
  setColors: (c) => {
    const s = get().settings;
    if (s.theme === "light") set({ settings: { ...s, colorsLight: { ...s.colorsLight, ...c } } });
    else set({ settings: { ...s, colors: { ...s.colors, ...c } } });
  },
  activeColors: () => {
    const s = get().settings;
    return s.theme === "light" ? s.colorsLight : s.colors;
  },
  preview: () => previewColors(get().settings.theme),
      unlockPro: (v) => set({ pro: v }),
      startTrial: () => set({ trialStart: Date.now(), pro: true }),
      upsertProject: (p) => {
        const list = get().projects.slice();
        const i = list.findIndex((x) => x.id === p.id);
        p.updated = Date.now();
        if (i >= 0) list[i] = p;
        else list.unshift(p);
        set({ projects: list });
      },
      deleteProject: (id) =>
        set({ projects: get().projects.filter((p) => p.id !== id), currentId: get().currentId === id ? null : get().currentId }),
      renameProject: (id, name) =>
        set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)) }),
      openProject: (id) => set({ currentId: id }),
      addExport: (r) => set({ exports: [r, ...get().exports].slice(0, 60) }),
      clearExports: () => set({ exports: [] }),
      notify: (text, kind = "info") => {
        const id = Date.now() + Math.random();
        set({ toast: { id, text, kind } });
        setTimeout(() => {
          if (get().toast?.id === id) set({ toast: null });
        }, 2600);
      },
      t: (k) => translate(get().settings.lang, k),
    }),
    {
      name: "digit3d-desktop",
      partialize: (s) =>
        ({
          settings: s.settings,
          pro: s.pro,
          trialStart: s.trialStart,
          projects: s.projects,
          exports: s.exports.map((e) => ({ ...e, url: undefined })),
        }) as unknown as State,
    },
  ),
);

/** React hook：当前主题的视口配色 */
export function useColors(): ViewportColors {
  return useApp((s) => (s.settings.theme === "light" ? s.settings.colorsLight : s.settings.colors));
}

/** React hook：当前主题的预览配色语义 */
export function usePreviewColors(): PreviewColors {
  return useApp((s) => previewColors(s.settings.theme));
}

export function fmt(v: number, digits?: number): string {
  const p = digits ?? useApp.getState().settings.precision;
  if (!isFinite(v)) return "—";
  return v.toFixed(p).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m));
}

export const UNIT_FACTOR: Record<Settings["units"], number> = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4 };

export function toUnit(mm: number): number {
  return mm * UNIT_FACTOR[useApp.getState().settings.units];
}
export function unitLabel(): string {
  return useApp.getState().settings.units;
}

export function download(name: string, data: BlobPart, mime = "application/octet-stream") {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  const st = useApp.getState();
  st.addExport({
    id: Math.random().toString(36).slice(2),
    name,
    format: name.split(".").pop()?.toUpperCase() || "BIN",
    size: blob.size,
    time: Date.now(),
    url,
  });
  st.notify(`已导出 ${name}（${(blob.size / 1024).toFixed(1)} KB）`, "ok");
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
