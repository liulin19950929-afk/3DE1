export type Vec2 = { x: number; y: number };
export type Vec3 = [number, number, number];

export interface PlaneRef {
  name: string;
  origin: Vec3;
  xdir: Vec3;
  ydir: Vec3;
}

export const PRINCIPAL_PLANES: Record<"XY" | "XZ" | "YZ", PlaneRef> = {
  XY: { name: "XY", origin: [0, 0, 0], xdir: [1, 0, 0], ydir: [0, 1, 0] },
  XZ: { name: "XZ", origin: [0, 0, 0], xdir: [1, 0, 0], ydir: [0, 0, 1] },
  YZ: { name: "YZ", origin: [0, 0, 0], xdir: [0, 1, 0], ydir: [0, 0, 1] },
};

export type EntKind = "line" | "circle" | "arc" | "ellipse" | "spline" | "polygon" | "rect" | "point";

/** 关联复制描述：副本由源驱动，源改了副本跟着走 */
export type CopyXform =
  | { t: "mirror"; a: Vec2; b: Vec2 }
  | { t: "move"; dx: number; dy: number }
  | { t: "rot"; c: Vec2; ang: number };

export interface SketchEntity {
  id: string;
  kind: EntKind;
  construction?: boolean;
  /** 关联副本：源曲线 id */
  src?: string;
  /** 关联副本：从源到副本的变换 */
  xf?: CopyXform;
  /** 由模型边投影而来 */
  projected?: boolean;
  /** line: a,b | rect: a,b(对角) | spline: pts | polygon: c + r */
  a?: Vec2;
  b?: Vec2;
  c?: Vec2;
  r?: number;
  rx?: number;
  ry?: number;
  a0?: number;
  a1?: number;
  rot?: number;
  n?: number;
  pts?: Vec2[];
  closed?: boolean;
}

export type ConstraintType =
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "equal"
  | "coincident"
  | "concentric"
  | "midpoint"
  | "pointOnCurve"
  | "symmetric"
  | "fix";

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  refs: string[];
}

export type DimType = "length" | "radius" | "diameter" | "angle" | "distX" | "distY" | "distance";

export interface SketchDim {
  id: string;
  type: DimType;
  refs: string[];
  value: number;
  pos: Vec2;
}

export interface Sketch {
  id: string;
  name: string;
  plane: PlaneRef;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  dims: SketchDim[];
}

export type BoolOp = "new" | "add" | "cut" | "intersect";

export type Feature =
  | { id: string; type: "sketch"; name: string; sketch: Sketch; suppressed?: boolean }
  | {
      id: string;
      type: "datum";
      name: string;
      mode: "principal" | "offset" | "bisect" | "angle";
      base: "XY" | "XZ" | "YZ";
      offset: number;
      angle: number;
      suppressed?: boolean;
    }
  | {
      id: string;
      type: "extrude";
      name: string;
      sketchId: string;
      /** 截面：只用草图中的这些曲线（空 = 整张草图） */
      curveIds?: string[];
      start: number;
      end: number;
      draft: number;
      thin: number;
      surface: boolean;
      symmetric: boolean;
      op: BoolOp;
      suppressed?: boolean;
    }
  | {
      id: string;
      type: "revolve";
      name: string;
      sketchId: string;
      curveIds?: string[];
      axis: "x" | "y";
      angle: number;
      op: BoolOp;
      suppressed?: boolean;
    }
  | {
      id: string;
      type: "sweep";
      name: string;
      sketchId: string;
      pathId: string;
      op: BoolOp;
      suppressed?: boolean;
    }
  | { id: string; type: "loft"; name: string; sketchIds: string[]; op: BoolOp; suppressed?: boolean }
  | { id: string; type: "fill"; name: string; sketchId: string; suppressed?: boolean }
  | {
      id: string;
      type: "boolean";
      name: string;
      op: "union" | "subtract" | "intersect";
      targets: string[];
      tools: string[];
      suppressed?: boolean;
    }
  | {
      id: string;
      type: "fillet";
      name: string;
      mode: "fillet" | "chamfer";
      bodyId: string;
      radius: number;
      edges: number[];
      suppressed?: boolean;
    }
  | { id: string; type: "shell"; name: string; bodyId: string; thickness: number; openFaces: number[]; suppressed?: boolean }
  | { id: string; type: "draftFeat"; name: string; bodyId: string; angle: number; dir: Vec3; suppressed?: boolean }
  | {
      id: string;
      type: "transform";
      name: string;
      mode: "move" | "mirror" | "linear" | "circular" | "scale";
      bodyId: string;
      dx: number;
      dy: number;
      dz: number;
      /** 线性阵列第二方向 */
      dx2?: number;
      dy2?: number;
      dz2?: number;
      count2?: number;
      rx: number;
      ry: number;
      rz: number;
      count: number;
      copy: boolean;
      axis: "x" | "y" | "z";
      scale: number;
      suppressed?: boolean;
    }
  | {
      id: string;
      type: "pushpull";
      name: string;
      bodyId: string;
      faceKey: string;
      normal: Vec3;
      distance: number;
      mode: "pull" | "push" | "offset";
      suppressed?: boolean;
    }
  | {
      id: string;
      type: "primitive";
      name: string;
      shape: "box" | "cylinder" | "sphere" | "cone" | "torus" | "tube" | "thread" | "text";
      params: Record<string, number | string>;
      op: BoolOp;
      suppressed?: boolean;
    }
  | { id: string; type: "delete"; name: string; bodyId: string; suppressed?: boolean }
  | { id: string; type: "thicken"; name: string; bodyId: string; thickness: number; suppressed?: boolean }
  | { id: string; type: "import"; name: string; source: string; positions: number[]; indices: number[]; suppressed?: boolean };

export interface BodyMeta {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  opacity: number;
  isSheet?: boolean;
  fromMesh?: boolean;
}

export interface Project3D {
  id: string;
  name: string;
  kind: "3d";
  features: Feature[];
  bodies: Record<string, BodyMeta>;
  updated: number;
  drawing?: DrawingDoc;
}

/* ---------------- 2D 制图 ---------------- */
export interface Layer {
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}
export type D2Kind =
  | "line"
  | "polyline"
  | "circle"
  | "arc"
  | "ellipse"
  | "spline"
  | "text"
  | "dim"
  | "hatch"
  | "point";

export interface D2Entity {
  id: string;
  kind: D2Kind;
  layer: string;
  color?: string;
  a?: Vec2;
  b?: Vec2;
  c?: Vec2;
  r?: number;
  rx?: number;
  ry?: number;
  a0?: number;
  a1?: number;
  rot?: number;
  pts?: Vec2[];
  closed?: boolean;
  text?: string;
  height?: number;
  dimType?: "linear" | "aligned" | "radius" | "diameter" | "angular";
  pos?: Vec2;
  value?: number;
  tol?: string;
  leader?: Vec2[];
}

export interface Project2D {
  id: string;
  name: string;
  kind: "2d";
  entities: D2Entity[];
  layers: Layer[];
  updated: number;
}

/* ---------------- 工程制图 ---------------- */
export type SheetSize = "A0" | "A1" | "A2" | "A3" | "A4" | "custom";

export interface DrawView {
  id: string;
  label: string;
  type: "front" | "top" | "left" | "right" | "back" | "bottom" | "iso" | "custom" | "section" | "detail";
  x: number;
  y: number;
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  hidden: boolean;
  tangent: boolean;
  centerlines: boolean;
  parentId?: string;
  sectionAxis?: "h" | "v";
  sectionPos?: number;
  sectionFlip?: boolean;
  detailR?: number;
  detailCx?: number;
  detailCy?: number;
  bodies?: string[];
}

export interface DrawDim {
  id: string;
  type: "linear" | "aligned" | "diameter" | "radius" | "angular" | "note" | "leader" | "centermark";
  viewId: string;
  p1: Vec2;
  p2: Vec2;
  pos: Vec2;
  value: number;
  text?: string;
  tolMode?: "none" | "sym" | "limits" | "fit";
  tolUp?: number;
  tolDn?: number;
  fit?: string;
}

export interface Sheet {
  id: string;
  name: string;
  size: SheetSize;
  w: number;
  h: number;
  landscape: boolean;
  scale: number;
  angle: "first" | "third";
  views: DrawView[];
  dims: DrawDim[];
  title: Record<string, string>;
}

export interface DrawingDoc {
  sheets: Sheet[];
  active: number;
}

export type AnyProject = Project3D | Project2D;

export const MATERIALS: { name: string; density: number; price: number }[] = [
  { name: "钢 Steel", density: 7.85, price: 6 },
  { name: "不锈钢 304", density: 7.93, price: 22 },
  { name: "铸铁 Cast Iron", density: 7.2, price: 5 },
  { name: "铝 6061", density: 2.7, price: 20 },
  { name: "铝 7075", density: 2.81, price: 38 },
  { name: "铜 Copper", density: 8.96, price: 62 },
  { name: "黄铜 Brass", density: 8.5, price: 48 },
  { name: "青铜 Bronze", density: 8.8, price: 55 },
  { name: "钛 Ti-6Al-4V", density: 4.43, price: 320 },
  { name: "镁合金 AZ91", density: 1.81, price: 30 },
  { name: "锌合金 Zamak", density: 6.6, price: 18 },
  { name: "铅 Lead", density: 11.34, price: 16 },
  { name: "ABS", density: 1.04, price: 14 },
  { name: "PLA", density: 1.24, price: 18 },
  { name: "PETG", density: 1.27, price: 22 },
  { name: "尼龙 PA6", density: 1.14, price: 26 },
  { name: "PC 聚碳酸酯", density: 1.2, price: 30 },
  { name: "POM 赛钢", density: 1.41, price: 28 },
  { name: "橡胶 NBR", density: 1.2, price: 15 },
  { name: "玻璃 Glass", density: 2.5, price: 12 },
];

export const SHEET_SIZES: Record<Exclude<SheetSize, "custom">, [number, number]> = {
  A0: [1189, 841],
  A1: [841, 594],
  A2: [594, 420],
  A3: [420, 297],
  A4: [297, 210],
};

export const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 9);
