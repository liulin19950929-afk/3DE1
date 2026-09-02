import type { ReactNode } from "react";
import { useApp } from "../store";

/**
 * CAD 命令图标集 —— 纯线性 outline / 无填充 / 无渐变 / 无阴影 / 扁平
 * 线宽统一可在「设置 → 图标与线条」中调整（默认 1.5px），颜色继承 currentColor。
 * viewBox 统一 24×24，圆角端点，深色背景适配。
 */
const P: Record<string, ReactNode> = {
  /* ---------- 建模命令 ---------- */
  sketch: (
    <>
      <path d="M3.5 17.5 7.5 6.5h13l-4 11z" />
      <path d="M9.6 14.4 15 9" />
      <circle cx="16.2" cy="8.2" r="1.3" />
    </>
  ),
  datum: (
    <>
      <path d="M2.8 15.2 7.4 9.4h13.8l-4.6 5.8z" />
      <path d="M12 3v18" strokeDasharray="2.6 2.4" />
    </>
  ),
  extrude: (
    <>
      <path d="M4 17.2 12 14l8 3.2-8 3.2z" />
      <path d="M12 11.4V3.4" />
      <path d="M9 6.4 12 3.4l3 3" />
    </>
  ),
  revolve: (
    <>
      <path d="M12 2.6v18.8" strokeDasharray="2.6 2.4" />
      <ellipse cx="12" cy="12" rx="7.4" ry="3.6" />
      <path d="M14.6 8.6h4.2v6.8h-4.2z" />
    </>
  ),
  transform: (
    <>
      <path d="M12 3.2v17.6M3.2 12h17.6" />
      <path d="m9.6 5.6 2.4-2.4 2.4 2.4M9.6 18.4l2.4 2.4 2.4-2.4M5.6 9.6 3.2 12l2.4 2.4M18.4 9.6 20.8 12l-2.4 2.4" />
    </>
  ),
  surface: (
    <>
      <path d="M3 13.4c3-4.4 6 4.4 9 0s6-4.4 9 0" />
      <path d="M3 13.4v4.2c3-4.4 6 4.4 9 0s6-4.4 9 0v-4.2" />
    </>
  ),
  sweep: (
    <>
      <path d="M5.6 19.4c4.4 0 3.4-13.2 14.2-13.2" />
      <ellipse cx="5.6" cy="19.4" rx="2.6" ry="1.6" />
    </>
  ),
  loft: (
    <>
      <ellipse cx="12" cy="18.2" rx="7.2" ry="2.6" />
      <ellipse cx="12" cy="5.8" rx="4.2" ry="1.8" />
      <path d="M4.8 18.2 7.8 5.8M19.2 18.2 16.2 5.8" />
    </>
  ),
  fill: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M7.4 14.6 14.6 7.4M10.4 16.6 16.6 10.4" />
    </>
  ),
  boolean: (
    <>
      <circle cx="9.2" cy="12" r="6.2" />
      <circle cx="14.8" cy="12" r="6.2" />
    </>
  ),
  fillet: (
    <>
      <path d="M4.5 20V4h15.5" strokeDasharray="2.6 2.4" />
      <path d="M4.5 13.2A9.2 9.2 0 0 1 13.7 4" />
    </>
  ),
  chamfer: (
    <>
      <path d="M4.5 20V4h15.5" strokeDasharray="2.6 2.4" />
      <path d="M4.5 13.2 13.7 4" />
    </>
  ),
  shell: (
    <>
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2" />
      <path d="M6.8 8.8h10.4v6.4H6.8z" />
    </>
  ),
  draft: (
    <>
      <path d="M4.4 19.4h15.2" />
      <path d="M4.4 19.4 14.6 4.6" />
      <path d="M9.4 19.4a6.6 6.6 0 0 0 1.9-4.4" />
    </>
  ),
  pushpull: (
    <>
      <path d="M4 8.4 12 4.4l8 4-8 4z" />
      <path d="M12 20.2v-7.6" />
      <path d="m9 17.2 3 3 3-3" />
    </>
  ),
  primitive: (
    <>
      <path d="M12 2.8 20.4 7.6v9.6L12 22l-8.4-4.8V7.6z" />
      <path d="M12 12.4 20.4 7.6M12 12.4 3.6 7.6M12 12.4V22" />
    </>
  ),
  thicken: (
    <>
      <path d="M3.4 9.4 12 5.2l8.6 4.2L12 13.6z" />
      <path d="M3.4 14.6 12 18.8l8.6-4.2" />
    </>
  ),
  deleteBody: (
    <>
      <path d="M4.6 6.8h14.8" />
      <path d="M9.4 6.8V4.4h5.2v2.4" />
      <path d="M6.6 6.8 7.7 20h8.6l1.1-13.2" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="5" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="12" cy="19" r="1.3" />
    </>
  ),

  /* ---------- 右侧查看工具 ---------- */
  tree: (
    <>
      <path d="M5 4.4v14.2a1.4 1.4 0 0 0 1.4 1.4H10" />
      <path d="M5 11.6h5" />
      <rect x="10.4" y="2.4" width="9.2" height="4" rx="1.2" />
      <rect x="10.4" y="9.6" width="9.2" height="4" rx="1.2" />
      <rect x="10.4" y="16.6" width="9.2" height="4" rx="1.2" />
    </>
  ),
  bodies: (
    <>
      <path d="M9.4 3.4 15.6 7v7L9.4 17.6 3.2 14V7z" />
      <path d="M14 8.6 20.8 12v6l-6.2 3.4" />
    </>
  ),
  section: (
    <>
      <path d="M12 2.8 20.4 7.6v9.6L12 22l-8.4-4.8V7.6z" />
      <path d="M2.6 14.6 21.4 8" />
    </>
  ),
  display: (
    <>
      <path d="M2.4 12S6.2 6.2 12 6.2 21.6 12 21.6 12 17.8 17.8 12 17.8 2.4 12 2.4 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  measure: (
    <>
      <path d="M3.2 15.8 15.8 3.2l5 5L8.2 20.8z" />
      <path d="m7.6 8.4 2 2M10.6 5.4l2 2M4.8 11.4l2 2" />
    </>
  ),
  draftA: (
    <>
      <path d="M4 19.6h16L12 4.4z" />
      <path d="M8.6 14.2h6.8" />
    </>
  ),
  thick: (
    <>
      <path d="M3.4 9.4 12 5.2l8.6 4.2L12 13.6z" />
      <path d="M5.6 13.4 12 16.6l6.4-3.2M5.6 17 12 20.2l6.4-3.2" />
    </>
  ),
  render: (
    <>
      <rect x="3" y="4.2" width="18" height="15.6" rx="2" />
      <circle cx="8.8" cy="9.6" r="1.9" />
      <path d="m3.6 17.6 5-4.2 3.8 3 3-2.2 5 5" />
    </>
  ),
  export: (
    <>
      <path d="M12 15V3.2" />
      <path d="m8 7.2 4-4 4 4" />
      <path d="M4.2 14.8v4.2a1.8 1.8 0 0 0 1.8 1.8h12a1.8 1.8 0 0 0 1.8-1.8v-4.2" />
    </>
  ),
  importIcon: (
    <>
      <path d="M12 3.2V15" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4.2 14.8v4.2a1.8 1.8 0 0 0 1.8 1.8h12a1.8 1.8 0 0 0 1.8-1.8v-4.2" />
    </>
  ),
  perf: <path d="M13.2 2.4 4.6 13.8h6.2l-1 7.8 8.6-11.4h-6.2z" />,
  save: (
    <>
      <path d="M4.6 4.6h11.2L19.4 8.2v11.2a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4V6a1.4 1.4 0 0 1 1.4-1.4Z" />
      <path d="M8 4.6v5.2h6.6V4.6M8 20.8v-5.6h8v5.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.8M12 18.6v2.8M21.4 12h-2.8M5.4 12H2.6M18.6 5.4l-2 2M7.4 16.6l-2 2M18.6 18.6l-2-2M7.4 7.4l-2-2" />
    </>
  ),
  undo: (
    <>
      <path d="M4.4 8.6h10.2a5.4 5.4 0 0 1 0 10.8H8.2" />
      <path d="m8 4.6-3.6 4 3.6 4" />
    </>
  ),
  redo: (
    <>
      <path d="M19.6 8.6H9.4a5.4 5.4 0 0 0 0 10.8h6.4" />
      <path d="m16 4.6 3.6 4-3.6 4" />
    </>
  ),
  fit: <path d="M4 9.2V4h5.2M20 9.2V4h-5.2M4 14.8V20h5.2M20 14.8V20h-5.2" />,
  cube: (
    <>
      <path d="M12 2.8 20.4 7.6v9.6L12 22l-8.4-4.8V7.6z" />
      <path d="M12 12.4 20.4 7.6M12 12.4 3.6 7.6M12 12.4V22" />
    </>
  ),
  drawingSheet: (
    <>
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="1.6" />
      <path d="M14.4 19.8v-5.6h6.4" />
      <path d="M6.6 8h6.2M6.6 11.4h4" />
    </>
  ),

  /* ---------- 草图工具 ---------- */
  select: <path d="M6 3.4 18.6 11l-5.4 1.3-1.4 5.4z" />,
  line: (
    <>
      <path d="M5.6 18.4 18.4 5.6" />
      <circle cx="5" cy="19" r="1.5" />
      <circle cx="19" cy="5" r="1.5" />
    </>
  ),
  polyline: (
    <>
      <path d="M3.6 18 8.4 10l4.6 4.4 7-11" />
      <circle cx="3.6" cy="18" r="1.3" />
      <circle cx="13" cy="14.4" r="1.3" />
      <circle cx="20" cy="3.4" r="1.3" />
    </>
  ),
  rect: <rect x="3.8" y="6.2" width="16.4" height="11.6" rx="1.2" />,
  circle: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="1.1" />
    </>
  ),
  arc: (
    <>
      <path d="M3.8 18.2a8.2 8.2 0 0 1 16.4 0" />
      <circle cx="3.8" cy="18.2" r="1.3" />
      <circle cx="20.2" cy="18.2" r="1.3" />
    </>
  ),
  ellipse: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="5.8" />
      <circle cx="12" cy="12" r="1.1" />
    </>
  ),
  spline: (
    <>
      <path d="M3.2 17.4c4.4 0 3.6-10.8 8.8-10.8s4.4 10.8 8.8 10.8" />
      <circle cx="3.2" cy="17.4" r="1.3" />
      <circle cx="12" cy="6.6" r="1.3" />
      <circle cx="20.8" cy="17.4" r="1.3" />
    </>
  ),
  polygon: <path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6z" />,
  point: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3.4v3.2M12 17.4v3.2M3.4 12h3.2M17.4 12h3.2" />
    </>
  ),
  trim: (
    <>
      <path d="M6.4 4.2 17 17.4M17.6 4.2 7 17.4" strokeDasharray="3 2.4" />
      <circle cx="5.6" cy="19.4" r="2" />
      <circle cx="18.4" cy="19.4" r="2" />
    </>
  ),
  extend: (
    <>
      <path d="M3.2 12h10.4" />
      <path d="m10.6 8.4 3.6 3.6-3.6 3.6" />
      <path d="M20.4 4.4v15.2" />
    </>
  ),
  mirror: (
    <>
      <path d="M12 3v18" strokeDasharray="2.6 2.4" />
      <path d="M9.2 7.4 4 12l5.2 4.6z" />
      <path d="M14.8 7.4 20 12l-5.2 4.6z" />
    </>
  ),
  patternLinear: (
    <>
      <rect x="2.4" y="9.4" width="5.4" height="5.4" rx="1" />
      <rect x="9.3" y="9.4" width="5.4" height="5.4" rx="1" />
      <rect x="16.2" y="9.4" width="5.4" height="5.4" rx="1" />
    </>
  ),
  patternCircular: (
    <>
      <circle cx="12" cy="12" r="7.6" strokeDasharray="2.6 2.6" />
      <rect x="10.2" y="1.8" width="3.6" height="3.6" rx="0.8" />
      <rect x="18.6" y="10.2" width="3.6" height="3.6" rx="0.8" />
      <rect x="1.8" y="10.2" width="3.6" height="3.6" rx="0.8" />
      <rect x="10.2" y="18.6" width="3.6" height="3.6" rx="0.8" />
    </>
  ),
  eraser: (
    <>
      <path d="M8.4 20.4H4.2l-1.4-3.6L12.8 6.6l5.6 5.6-7.4 8.2z" />
      <path d="M20.6 20.4h-8" />
    </>
  ),
  dimension: (
    <>
      <path d="M4.2 5.6v12.8M19.8 5.6v12.8" />
      <path d="M4.2 12h15.6" />
      <path d="m7.4 9 -3.2 3 3.2 3M16.6 9l3.2 3-3.2 3" />
    </>
  ),
  constraint: (
    <>
      <path d="M3.4 7.6h17.2M3.4 16.4h17.2" />
      <circle cx="8.4" cy="12" r="2.2" />
      <circle cx="15.6" cy="12" r="2.2" />
    </>
  ),
  project: (
    <>
      <rect x="3.2" y="3.2" width="6.4" height="6.4" rx="1" />
      <rect x="14.4" y="14.4" width="6.4" height="6.4" rx="1" />
      <path d="m9.8 9.8 4.4 4.4" strokeDasharray="2.4 2.2" />
    </>
  ),
  construction: <path d="M3.4 20.6 20.6 3.4" strokeDasharray="3 2.6" />,
  check: <path d="m4.6 12.6 4.8 4.8L19.4 7.4" />,
  close: <path d="M5.6 5.6 18.4 18.4M18.4 5.6 5.6 18.4" />,
  plus: <path d="M12 4.6v14.8M4.6 12h14.8" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m15.8 15.8 4.6 4.6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.4 12S6.2 6.2 12 6.2 21.6 12 21.6 12 17.8 17.8 12 17.8 2.4 12 2.4 12Z" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4.4 20 20.4" />
      <path d="M9.6 6.6A9.4 9.4 0 0 1 12 6.2c5.8 0 9.6 5.8 9.6 5.8a17 17 0 0 1-3.4 3.8M6.2 8.4A17.6 17.6 0 0 0 2.4 12s3.8 5.8 9.6 5.8a9.6 9.6 0 0 0 3-.5" />
    </>
  ),
  isolate: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" strokeDasharray="2 2" />
    </>
  ),

  /* ---------- 2D 与工程图 ---------- */
  text: <path d="M5.2 5.6h13.6M12 5.6v12.8M8.8 18.4h6.4" />,
  move: (
    <>
      <path d="M12 3.2v17.6M3.2 12h17.6" />
      <path d="m9.6 5.6 2.4-2.4 2.4 2.4M9.6 18.4l2.4 2.4 2.4-2.4M5.6 9.6 3.2 12l2.4 2.4M18.4 9.6 20.8 12l-2.4 2.4" />
    </>
  ),
  copy: (
    <>
      <rect x="3.4" y="3.4" width="12" height="12" rx="1.8" />
      <path d="M7.8 20.6h10.8a2 2 0 0 0 2-2V7.8" />
    </>
  ),
  rotate: (
    <>
      <path d="M20.4 12a8.4 8.4 0 1 1-3.2-6.6" />
      <path d="M20.4 3v5.2h-5.2" />
    </>
  ),
  offset: <path d="M5.2 19.6 13.4 4.4M10.6 21 19 5.6" />,
  box: <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="1.2" strokeDasharray="4 3" />,
  dimLinear: (
    <>
      <path d="M4.2 6.4v11.2M19.8 6.4v11.2" />
      <path d="M4.2 12h15.6" />
    </>
  ),
  dimAligned: (
    <>
      <path d="M4.6 4.6 9 9M15 15l4.4 4.4" />
      <path d="M6.8 6.8 17.2 17.2" />
    </>
  ),
  dimRadius: (
    <>
      <circle cx="10.8" cy="13.2" r="7" />
      <path d="m10.8 13.2 7.8-6.4" />
    </>
  ),
  dimDiameter: (
    <>
      <circle cx="12" cy="12" r="7.2" />
      <path d="M6.9 17.1 17.1 6.9" />
    </>
  ),
  dimAngular: (
    <>
      <path d="M4 19.8h16M4 19.8 17.6 5.6" />
      <path d="M12.6 19.8a9.2 9.2 0 0 0-1.3-4.7" />
    </>
  ),
  centermark: (
    <>
      <path d="M12 5.4v13.2M5.4 12h13.2" />
      <circle cx="12" cy="12" r="7" strokeDasharray="2.6 2.6" />
    </>
  ),
  note: <path d="M3.8 4.8h16.4v10.4H9.4l-5.6 4.2z" />,
  leader: (
    <>
      <path d="m4 20 7.4-7.4" />
      <path d="M11.4 12.6H20" />
      <path d="m4 20 1.2-4.2 3 1.2z" />
    </>
  ),
  auto: <path d="M12 3.2 14 9l5.8 2-5.8 2-2 5.8-2-5.8L4.2 11 10 9z" />,
  home: (
    <>
      <path d="M3.6 10.6 12 3.6l8.4 7v9a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M9.6 20.4v-6.6h4.8v6.6" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.4h6a3 3 0 0 1 3 3v12a2.4 2.4 0 0 0-2.4-2.4H4z" />
      <path d="M20 4.4h-6a3 3 0 0 0-3 3v12a2.4 2.4 0 0 1 2.4-2.4H20z" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.2 21 8l-9 4.8L3 8z" />
      <path d="m4.6 12 7.4 4 7.4-4M4.6 16 12 20l7.4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7v5.4l3.4 2" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m15.4 8.6-2 5.4-5.4 2 2-5.4z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.6 9.4a2.6 2.6 0 0 1 5 .9c0 1.8-2.6 2.2-2.6 4" />
      <circle cx="12" cy="17.2" r="0.9" />
    </>
  ),
  star: <path d="m12 3.4 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.8l6-.9z" />,
  folder: <path d="M3.4 6.6a1.6 1.6 0 0 1 1.6-1.6h4.2l2 2.4h7.4a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6z" />,
};

/* 别名：命令 id → 图标 */
const ALIAS: Record<string, string> = {
  draftFeat: "draft",
  sketchNew: "sketch",
  erase: "eraser",
  linear: "dimLinear",
  aligned: "dimAligned",
  diameter: "dimDiameter",
  radius: "dimRadius",
  angular: "dimAngular",
  import: "importIcon",
  rectangle: "rect",
  patternL: "patternLinear",
  patternC: "patternCircular",
};

export type IconName = keyof typeof P | string;

export function Icon({ name, size = 18, stroke, className, style }: { name: IconName; size?: number; stroke?: number; className?: string; style?: React.CSSProperties }) {
  const w = useApp((s) => s.settings.iconStroke);
  const body = P[name] ?? P[ALIAS[name]];
  if (!body) return <span style={{ fontSize: size * 0.8 }}>{name}</span>;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke ?? w ?? 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      shapeRendering="geometricPrecision"
    >
      {body}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(P);
