import { useEffect, useRef } from "react";
import * as THREE from "three";
import { use3D } from "./store3d";
import { useApp, useColors, usePreviewColors, type ViewportColors, type PreviewColors } from "../store";
import { computeEdges, computeFaces, planeMatrix, sketchLines, connectedCurves, type FaceInfo, type EdgeGroup, type SketchLine } from "../cad/kernel";
import { snapPoints, tessellate, dist as d2 } from "../cad/sketch";
import { sketchClick, hitEntity, pendingPoints, pendingTool, resetPending } from "./sketchTools";
import type { Vec2 } from "../cad/types";

const faceCache = new WeakMap<THREE.BufferGeometry, FaceInfo[]>();
const edgeCache = new WeakMap<THREE.BufferGeometry, EdgeGroup[]>();

export function getFaces(g: THREE.BufferGeometry): FaceInfo[] {
  let f = faceCache.get(g);
  if (!f) {
    f = computeFaces(g);
    faceCache.set(g, f);
  }
  return f;
}
export function getEdges(g: THREE.BufferGeometry): EdgeGroup[] {
  let e = edgeCache.get(g);
  if (!e) {
    e = computeEdges(g);
    edgeCache.set(g, e);
  }
  return e;
}

export interface Stats {
  fps: number;
  tris: number;
  calls: number;
  bodies: number;
}

export interface PreviewPayload {
  solids: { geo: THREE.BufferGeometry; mode: "add" | "cut" | "new" }[];
  ghosts: THREE.BufferGeometry[];
  sources: THREE.BufferGeometry[];
  arrows: { from: THREE.Vector3; to: THREE.Vector3; label: string; color?: string }[];
  showArrows: boolean;
  pc: PreviewColors;
}

class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  root = new THREE.Group();
  helpers = new THREE.Group();
  overlay = new THREE.Group();
  sketchGroup = new THREE.Group();
  previewGroup = new THREE.Group();
  cubeScene = new THREE.Scene();
  cubeCam: THREE.OrthographicCamera;
  cube: THREE.Mesh;
  hemi: THREE.HemisphereLight;
  clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  raycaster = new THREE.Raycaster();
  meshes = new Map<string, THREE.Mesh>();
  edgeLines = new Map<string, THREE.LineSegments>();
  labelHost: HTMLDivElement;
  stats: Stats = { fps: 0, tris: 0, calls: 0, bodies: 0 };
  onStats?: (s: Stats) => void;
  previewLabels: { text: string; pos: THREE.Vector3; color?: string }[] = [];
  baseLabels: { id: string; text: string; pos: THREE.Vector3; cls?: string; color?: string }[] = [];
  labels: { id: string; el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
  rubberLine: THREE.Line | null = null;
  private frames = 0;
  private lastT = performance.now();
  private raf = 0;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(public container: HTMLDivElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;";

    this.labelHost = document.createElement("div");
    this.labelHost.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    container.appendChild(this.labelHost);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(120, -160, 110);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.15);
    this.scene.add(this.hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.55);
    dir.position.set(180, -220, 300);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -300;
    dir.shadow.camera.right = 300;
    dir.shadow.camera.top = 300;
    dir.shadow.camera.bottom = -300;
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xbfd9ff, 0.5);
    fill.position.set(-200, 160, 120);
    this.scene.add(fill);
    this.scene.add(this.root, this.helpers, this.overlay, this.sketchGroup, this.previewGroup);

    this.cubeCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 100);
    this.cubeCam.position.set(0, 0, 5);
    this.cubeCam.up.set(0, 0, 1);
    const mats = ["右 R", "左 L", "后 B", "前 F", "上 T", "下 D"].map((t) => new THREE.MeshBasicMaterial({ map: makeLabelTexture(t) }));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), mats);
    this.cubeScene.add(new THREE.AmbientLight(0xffffff, 1), this.cube);

    this.animate();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelHost.remove();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setAA(samples: number) {
    this.renderer.setPixelRatio(samples === 0 ? 1 : Math.min(this.dpr * (samples >= 8 ? 1.5 : 1), 3));
  }

  setTheme(theme: "dark" | "light") {
    this.hemi.color.set(0xffffff);
    this.hemi.groundColor.set(theme === "light" ? 0xdfe7ef : 0x223344);
    this.hemi.intensity = theme === "light" ? 1.35 : 1.15;
    for (const m of ["右 R", "左 L", "后 B", "前 F", "上 T", "下 D"].entries()) {
      const mat = (this.cube.material as THREE.MeshBasicMaterial[])[m[0]];
      mat.map?.dispose();
      mat.map = makeLabelTexture(m[1], theme);
      mat.needsUpdate = true;
    }
  }

  /* -------------------- 场景同步 -------------------- */
  syncBodies(opts: {
    bodies: { id: string; geometry: THREE.BufferGeometry; color: string; visible: boolean; opacity: number; isSheet?: boolean }[];
    display: string;
    colors: ViewportColors;
    analysis: { mode: string; perBody: Record<string, Float32Array>; min: number; max: number };
    section: { on: boolean; axis: "x" | "y" | "z"; pos: number; flip: boolean };
    showSolid: boolean;
    showSheet: boolean;
    flatShading: boolean;
    theme: "dark" | "light";
  }) {
    const keep = new Set(opts.bodies.map((b) => b.id));
    for (const [id, m] of this.meshes) {
      if (!keep.has(id)) {
        this.root.remove(m);
        this.meshes.delete(id);
        const l = this.edgeLines.get(id);
        if (l) {
          this.root.remove(l);
          this.edgeLines.delete(id);
        }
      }
    }
    const n = new THREE.Vector3(opts.section.axis === "x" ? 1 : 0, opts.section.axis === "y" ? 1 : 0, opts.section.axis === "z" ? 1 : 0);
    if (opts.section.flip) n.negate();
    this.clipPlane.set(n, opts.section.flip ? opts.section.pos : -opts.section.pos);
    const clip = opts.section.on ? [this.clipPlane] : [];

    for (const b of opts.bodies) {
      let mesh = this.meshes.get(b.id);
      if (!mesh || mesh.geometry !== b.geometry) {
        if (mesh) this.root.remove(mesh);
        mesh = new THREE.Mesh(b.geometry, new THREE.MeshStandardMaterial());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.bodyId = b.id;
        this.meshes.set(b.id, mesh);
        this.root.add(mesh);
        const eg = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry, 24), new THREE.LineBasicMaterial({ color: 0x223344 }));
        eg.userData.bodyId = b.id;
        const old = this.edgeLines.get(b.id);
        if (old) this.root.remove(old);
        this.edgeLines.set(b.id, eg);
        this.root.add(eg);
      }
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const analysisOn = opts.analysis.mode !== "none" && opts.analysis.perBody[b.id];
      if (analysisOn) applyAnalysisColors(b.geometry, opts.analysis.perBody[b.id], opts.analysis.mode, opts.analysis.min, opts.analysis.max);
      else if (b.geometry.getAttribute("color")) b.geometry.deleteAttribute("color");
      mat.vertexColors = !!analysisOn;
      mat.color.set(analysisOn ? "#ffffff" : b.color);
      mat.metalness = 0.15;
      mat.roughness = opts.theme === "light" ? 0.62 : 0.55;
      mat.side = b.isSheet ? THREE.DoubleSide : THREE.FrontSide;
      mat.clippingPlanes = clip;
      mat.clipShadows = true;
      mat.transparent = b.opacity < 1 || opts.display === "xray";
      mat.opacity = opts.display === "xray" ? Math.min(b.opacity, 0.35) : b.opacity;
      mat.depthWrite = !(opts.display === "xray");
      mat.wireframe = opts.display === "wire";
      mat.flatShading = opts.flatShading;
      if (opts.display === "hidden") {
        mat.color.set(opts.theme === "light" ? "#ffffff" : "#0e151d");
        mat.metalness = 0;
        mat.roughness = 1;
      }
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 1;
      mat.needsUpdate = true;
      const vis = b.visible && (b.isSheet ? opts.showSheet : opts.showSolid);
      mesh.visible = vis && opts.display !== "wire";
      const lines = this.edgeLines.get(b.id)!;
      const lm = lines.material as THREE.LineBasicMaterial;
      lm.color.set(opts.display === "hidden" || opts.display === "wire" ? (opts.theme === "light" ? "#222c38" : "#8ba0b6") : opts.colors.edge);
      lm.clippingPlanes = clip;
      lines.visible = vis && (opts.display === "shadedEdge" || opts.display === "wire" || opts.display === "hidden" || opts.display === "xray");
    }
    this.stats.bodies = opts.bodies.length;
  }

  syncHelpers(opts: {
    grid: boolean;
    axes: boolean;
    datums: boolean;
    planes: { origin: [number, number, number]; xdir: [number, number, number]; ydir: [number, number, number]; name: string }[];
    colors: ViewportColors;
    size: number;
    datumStyle: "dashed" | "grid" | "filled";
    datumOpacity: number;
  }) {
    this.helpers.clear();
    const s = Math.max(60, opts.size);
    if (opts.grid) {
      const grid = new THREE.GridHelper(s * 4, 40, new THREE.Color(opts.colors.gridMajor), new THREE.Color(opts.colors.grid));
      grid.rotateX(Math.PI / 2);
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.55;
      this.helpers.add(grid);
    }
    if (opts.axes) {
      const mk = (a: THREE.Vector3, c: string) => {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), a.clone().multiplyScalar(s * 1.5)]);
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: c }));
      };
      this.helpers.add(mk(new THREE.Vector3(1, 0, 0), opts.colors.axisX), mk(new THREE.Vector3(0, 1, 0), opts.colors.axisY), mk(new THREE.Vector3(0, 0, 1), opts.colors.axisZ));
    }
    if (opts.datums) {
      const style = opts.datumStyle;
      const alpha = opts.datumOpacity;
      opts.planes.forEach((p, i) => {
        const size = s * 1.2;
        const geo = new THREE.PlaneGeometry(size, size);
        const col = [opts.colors.datumXY, opts.colors.datumXZ, opts.colors.datumYZ][i % 3];
        const M = planeMatrix(p as any);
        const mat = new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: style === "filled" ? alpha * 2.2 : style === "grid" ? alpha * 0.85 : 0.012,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const m = new THREE.Mesh(geo, mat);
        m.applyMatrix4(M);
        m.userData.datum = i;
        m.userData.plane = p;
        this.helpers.add(m);

        if (style === "dashed") {
          const h = size / 2;
          const pts = [
            new THREE.Vector3(-h, -h, 0),
            new THREE.Vector3(h, -h, 0),
            new THREE.Vector3(h, h, 0),
            new THREE.Vector3(-h, h, 0),
            new THREE.Vector3(-h, -h, 0),
          ];
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineDashedMaterial({ color: col, dashSize: size * 0.028, gapSize: size * 0.022, transparent: true, opacity: 0.85 }),
          );
          line.computeLineDistances();
          line.applyMatrix4(M);
          this.helpers.add(line);
        } else if (style === "grid") {
          const div = 8;
          const pts: THREE.Vector3[] = [];
          const h = size / 2;
          for (let k = 0; k <= div; k++) {
            const t = -h + (size * k) / div;
            pts.push(new THREE.Vector3(t, -h, 0), new THREE.Vector3(t, h, 0), new THREE.Vector3(-h, t, 0), new THREE.Vector3(h, t, 0));
          }
          const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.3 }));
          grid.applyMatrix4(M);
          this.helpers.add(grid);
          const border = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.75 }));
          border.applyMatrix4(M);
          this.helpers.add(border);
        } else {
          const border = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
          border.applyMatrix4(M);
          this.helpers.add(border);
        }
      });
    }
  }

  syncSketches(list: SketchLine[], color: string, cColor: string, through: boolean, selected: string[] = [], selColor = "#38bdf8") {
    this.sketchGroup.clear();
    for (const l of list) {
      if (!l.pts.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(l.pts, 3));
      const isSel = selected.includes(l.entId);
      const m = new THREE.LineBasicMaterial({
        color: isSel ? selColor : l.construction ? cColor : color,
        transparent: true,
        opacity: l.construction ? 0.7 : 1,
        depthTest: !through,
      });
      const line = new THREE.LineSegments(g, m);
      line.userData = { sketchId: l.sketchId, entId: l.entId };
      line.renderOrder = isSel ? 3 : 1;
      this.sketchGroup.add(line);
    }
  }

  setOverlay(objs: THREE.Object3D[]) {
    this.overlay.clear();
    objs.forEach((o) => this.overlay.add(o));
  }

  /* -------------------- 命令实时预览 -------------------- */
  setPreview(pv: PreviewPayload | null) {
    this.previewGroup.clear();
    this.previewLabels = [];
    if (!pv) return;
    const pc = pv.pc;

    // 源对象：描边 + 外发光（不实心填充，保留原色可辨）
    for (const g of pv.sources) {
      const edges = new THREE.EdgesGeometry(g, 24);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: pc.source, transparent: true, opacity: 1, depthTest: false }));
      line.renderOrder = 9;
      this.previewGroup.add(line);
      const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute);
      const c = box.getCenter(new THREE.Vector3());
      for (let k = 1; k <= pc.sourceGlow; k++) {
        const glow = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: pc.source, transparent: true, opacity: 0.26 / k, depthTest: false, blending: THREE.AdditiveBlending }),
        );
        const f = 1 + k * 0.005;
        glow.scale.setScalar(f);
        glow.position.copy(c).multiplyScalar(1 - f);
        glow.renderOrder = 8;
        this.previewGroup.add(glow);
      }
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: pc.source, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 4;
      this.previewGroup.add(m);
    }

    // 拉伸 / 旋转等：半透明实体预览（确认后才变成不透明真实颜色）
    for (const s of pv.solids) {
      const col = s.mode === "cut" ? pc.cut : pc.add;
      const op = s.mode === "cut" ? pc.cutOpacity : pc.addOpacity;
      const mesh = new THREE.Mesh(
        s.geo,
        new THREE.MeshStandardMaterial({
          color: col,
          transparent: true,
          opacity: op,
          depthWrite: false,
          roughness: 0.45,
          metalness: 0.05,
          side: THREE.DoubleSide,
          emissive: new THREE.Color(col).multiplyScalar(0.16),
        }),
      );
      mesh.renderOrder = 3;
      this.previewGroup.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(s.geo, 22), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: Math.min(1, op + 0.4) }));
      edges.renderOrder = 5;
      this.previewGroup.add(edges);
    }

    // 阵列 / 镜像副本：仅线框，禁止实心填充（避免三角面片竖条纹锯齿）
    for (const g of pv.ghosts) {
      const w = new THREE.LineSegments(
        new THREE.EdgesGeometry(g, 22),
        new THREE.LineBasicMaterial({ color: pc.ghost, transparent: true, opacity: 0.95, linewidth: pc.ghostWidth }),
      );
      w.renderOrder = 5;
      this.previewGroup.add(w);
    }

    if (pv.showArrows) {
      const scale = this.camera.position.distanceTo(this.target);
      for (const a of pv.arrows) {
        const dir = new THREE.Vector3().subVectors(a.to, a.from);
        const len = dir.length();
        const col = new THREE.Color(a.color || pc.arrow);
        if (len > 1e-4) {
          const head = Math.min(len * 0.32, scale * 0.035);
          const arrow = new THREE.ArrowHelper(dir.clone().normalize(), a.from, len, col.getHex(), head, head * 0.55);
          (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
          (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
          arrow.renderOrder = 10;
          this.previewGroup.add(arrow);
        }
        this.previewLabels.push({ text: a.label, pos: a.to.clone(), color: a.color || pc.arrow });
      }
    }
  }

  setRubber(pts: THREE.Vector3[]) {
    if (pts.length < 2) {
      if (this.rubberLine) {
        this.scene.remove(this.rubberLine);
        this.rubberLine.geometry.dispose();
        this.rubberLine = null;
      }
      return;
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    if (!this.rubberLine) {
      this.rubberLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x22d3ee, dashSize: 2.5, gapSize: 1.5, depthTest: false }));
      this.scene.add(this.rubberLine);
    } else {
      this.rubberLine.geometry.dispose();
      this.rubberLine.geometry = g;
    }
    this.rubberLine.computeLineDistances();
  }

  /* -------------------- 相机 -------------------- */
  fit(box?: THREE.Box3) {
    const b = box || new THREE.Box3().setFromObject(this.root);
    if (b.isEmpty()) {
      this.target.set(0, 0, 0);
      this.camera.position.set(120, -160, 110);
      return;
    }
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3()).length() || 100;
    const dirv = this.camera.position.clone().sub(this.target).normalize();
    this.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dirv, size * 1.35);
    this.camera.lookAt(c);
  }

  setView(name: string) {
    const b = new THREE.Box3().setFromObject(this.root);
    const c = b.isEmpty() ? new THREE.Vector3() : b.getCenter(new THREE.Vector3());
    const dist = b.isEmpty() ? 300 : b.getSize(new THREE.Vector3()).length() * 1.4;
    const dirs: Record<string, [number, number, number]> = {
      front: [0, -1, 0],
      back: [0, 1, 0],
      left: [-1, 0, 0],
      right: [1, 0, 0],
      top: [0, 0, 1],
      bottom: [0, 0, -1],
      iso: [0.7, -0.8, 0.6],
    };
    const d = dirs[name] || dirs.iso;
    this.target.copy(c);
    this.camera.position.set(c.x + d[0] * dist, c.y + d[1] * dist, c.z + d[2] * dist);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(c);
  }

  alignToPlane(pl: { origin: number[]; xdir: number[]; ydir: number[] }, keepDistance = true) {
    const x = new THREE.Vector3(pl.xdir[0], pl.xdir[1], pl.xdir[2]).normalize();
    const y = new THREE.Vector3(pl.ydir[0], pl.ydir[1], pl.ydir[2]).normalize();
    const n = new THREE.Vector3().crossVectors(x, y).normalize();
    const o = new THREE.Vector3(pl.origin[0], pl.origin[1], pl.origin[2]);
    const box = new THREE.Box3().setFromObject(this.root);
    const size = box.isEmpty() ? 160 : box.getSize(new THREE.Vector3()).length() * 1.25;
    const dist = keepDistance ? Math.max(60, Math.min(this.camera.position.distanceTo(this.target), size * 2)) : size;
    const side = n.dot(this.camera.position.clone().sub(o)) >= 0 ? 1 : -1;
    this.target.copy(o);
    this.camera.position.copy(o).addScaledVector(n, dist * side);
    this.camera.up.copy(y);
    this.camera.lookAt(o);
  }

  saveCamera() {
    return { p: this.camera.position.clone(), t: this.target.clone(), u: this.camera.up.clone() };
  }
  restoreCamera(s: { p: THREE.Vector3; t: THREE.Vector3; u: THREE.Vector3 }) {
    this.camera.position.copy(s.p);
    this.target.copy(s.t);
    this.camera.up.copy(s.u);
    this.camera.lookAt(this.target);
  }

  orbit(dx: number, dy: number) {
    const off = this.camera.position.clone().sub(this.target);
    const r = off.length();
    let theta = Math.atan2(off.y, off.x);
    let phi = Math.acos(Math.max(-1, Math.min(1, off.z / r)));
    theta -= dx * 0.008;
    phi = Math.max(0.02, Math.min(Math.PI - 0.02, phi + dy * 0.008));
    off.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    this.camera.position.copy(this.target).add(off);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
  }

  pan(dx: number, dy: number) {
    const off = this.camera.position.clone().sub(this.target);
    const dist = off.length();
    const factor = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist) / this.container.clientHeight;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const move = right.multiplyScalar(-dx * factor).add(up.multiplyScalar(dy * factor));
    this.camera.position.add(move);
    this.target.add(move);
  }

  zoom(delta: number, nx: number, ny: number) {
    const dir = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const dist = this.camera.position.distanceTo(this.target);
    const step = dist * delta * 0.0015;
    this.camera.position.addScaledVector(dir, step);
    if (this.camera.position.distanceTo(this.target) < 0.5) this.camera.position.addScaledVector(dir, -step);
  }

  /* -------------------- 拾取 -------------------- */
  ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.container.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick(e: { clientX: number; clientY: number }, filters: { body: boolean; face: boolean; edge: boolean }) {
    const p = this.ndc(e);
    this.raycaster.setFromCamera(p, this.camera);
    this.raycaster.params.Line = { threshold: this.camera.position.distanceTo(this.target) * 0.006 };
    const meshList = [...this.meshes.values()].filter((m) => m.visible);
    const hits = this.raycaster.intersectObjects(meshList, false);
    if (!hits.length) return null;
    const h = hits[0];
    const bodyId = (h.object as THREE.Mesh).userData.bodyId as string;
    const geom = (h.object as THREE.Mesh).geometry as THREE.BufferGeometry;
    let faceId = -1;
    if (filters.face || filters.edge) {
      const faces = getFaces(geom);
      const tri = h.faceIndex ?? -1;
      faceId = faces.findIndex((f) => f.tris.includes(tri));
    }
    let edgeId = -1;
    if (filters.edge) {
      const edges = getEdges(geom);
      let best = Infinity;
      edges.forEach((eg, i) => {
        for (const s of eg.segments) {
          const cp = new THREE.Vector3();
          new THREE.Line3(s[0], s[1]).closestPointToPoint(h.point, true, cp);
          const d = cp.distanceTo(h.point);
          if (d < best) {
            best = d;
            edgeId = i;
          }
        }
      });
      if (best > this.camera.position.distanceTo(this.target) * 0.012) edgeId = -1;
    }
    return { bodyId, faceId, edgeId, point: h.point, normal: h.face?.normal ?? new THREE.Vector3(0, 0, 1), distance: h.distance };
  }

  pickPlane(e: { clientX: number; clientY: number }, plane: THREE.Plane): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p);
  }

  pickDatum(e: { clientX: number; clientY: number }) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(this.helpers.children.filter((c) => (c as any).userData?.plane), false);
    return hits.length ? (hits[0].object.userData.plane as any) : null;
  }

  pickSketchCurve(e: { clientX: number; clientY: number }): { sketchId: string; entId: string } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    this.raycaster.params.Line = { threshold: this.camera.position.distanceTo(this.target) * 0.008 };
    const hits = this.raycaster.intersectObjects(this.sketchGroup.children, false);
    if (!hits.length) return null;
    const u = hits[0].object.userData as { sketchId: string; entId: string };
    return u?.entId ? u : null;
  }

  pickCube(e: { clientX: number; clientY: number }): string | null {
    const r = this.container.getBoundingClientRect();
    const size = 96;
    const x = e.clientX - r.left - (r.width - size - 12);
    const y = e.clientY - r.top - 12;
    if (x < 0 || y < 0 || x > size || y > size) return null;
    const nx = (x / size) * 2 - 1;
    const ny = -((y / size) * 2 - 1);
    const rc = new THREE.Raycaster();
    this.cube.quaternion.copy(this.camera.quaternion).invert();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.cubeCam);
    const hit = rc.intersectObject(this.cube, false)[0];
    if (!hit) return "none";
    const idx = Math.floor((hit.faceIndex ?? 0) / 2);
    return ["right", "left", "back", "front", "top", "bottom"][idx] || "iso";
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  /* -------------------- 标签 -------------------- */
  setLabels(items: { id: string; text: string; pos: THREE.Vector3; cls?: string; color?: string }[]) {
    this.labelHost.innerHTML = "";
    this.labels = items.map((i) => {
      const el = document.createElement("div");
      el.textContent = i.text;
      el.style.cssText =
        "position:absolute;transform:translate(-50%,-50%);padding:2px 7px;border-radius:6px;font-size:11px;white-space:nowrap;background:var(--panel);border:1px solid var(--line);color:var(--text);font-variant-numeric:tabular-nums;";
      if (i.cls === "dim") el.style.borderColor = "#f472b6";
      if (i.cls === "measure") el.style.borderColor = "#38bdf8";
      if (i.cls === "preview") {
        el.style.borderColor = i.color || "#22d3ee";
        el.style.color = i.color || "#22d3ee";
        el.style.fontWeight = "600";
      }
      this.labelHost.appendChild(el);
      return { id: i.id, el, pos: i.pos.clone() };
    });
  }

  refreshLabels() {
    this.setLabels([...this.baseLabels, ...this.previewLabels.map((l, i) => ({ id: "pv" + i, text: l.text, pos: l.pos, cls: "preview", color: l.color }))]);
  }

  private updateLabels() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    for (const l of this.labels) {
      const v = l.pos.clone().project(this.camera);
      l.el.style.left = ((v.x + 1) / 2) * w + "px";
      l.el.style.top = ((-v.y + 1) / 2) * h + "px";
      l.el.style.display = v.z > 1 ? "none" : "block";
    }
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.renderer.domElement.width !== Math.floor(w * this.renderer.getPixelRatio())) this.resize();
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const size = 96;
    this.renderer.clearDepth();
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(w - size - 12, h - size - 12, size, size);
    this.renderer.setViewport(w - size - 12, h - size - 12, size, size);
    this.cube.quaternion.copy(this.camera.quaternion).invert();
    this.renderer.render(this.cubeScene, this.cubeCam);
    this.renderer.setScissorTest(false);
    this.updateLabels();
    this.frames++;
    const now = performance.now();
    if (now - this.lastT > 500) {
      this.stats.fps = Math.round((this.frames * 1000) / (now - this.lastT));
      this.stats.tris = this.renderer.info.render.triangles;
      this.stats.calls = this.renderer.info.render.calls;
      this.frames = 0;
      this.lastT = now;
      this.onStats?.({ ...this.stats });
    }
  };
}

function makeLabelTexture(text: string, theme: "dark" | "light" = "dark"): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = theme === "light" ? "#ffffff" : "#16202b";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = theme === "light" ? "#0284c7" : "#38bdf8";
  g.lineWidth = 5;
  g.strokeRect(3, 3, 122, 122);
  g.fillStyle = theme === "light" ? "#16202b" : "#dbe6f2";
  g.font = "bold 30px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function applyAnalysisColors(geo: THREE.BufferGeometry, values: Float32Array, mode: string, min: number, max: number) {
  const count = geo.attributes.position.count;
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let t = 0; t < count / 3; t++) {
    const v = values[t] ?? 0;
    if (mode === "draft") {
      if (v < -1) c.set("#ef4444");
      else if (v < 1) c.set("#fbbf24");
      else if (v < 15) c.set("#22c55e");
      else c.set("#38bdf8");
    } else if (mode === "zebra") {
      const s = Math.sin(v * 25);
      c.setRGB(s > 0 ? 0.95 : 0.08, s > 0 ? 0.95 : 0.08, s > 0 ? 0.95 : 0.1);
    } else {
      const t01 = v < 0 ? 1 : Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
      c.setHSL((1 - t01) * 0.72, 0.9, 0.5);
    }
    for (let k = 0; k < 3; k++) {
      col[(t * 3 + k) * 3] = c.r;
      col[(t * 3 + k) * 3 + 1] = c.g;
      col[(t * 3 + k) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/* ==================================================================== */
export let engineRef: Engine | null = null;
export const getEngine = () => engineRef;

export default function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  const eng = useRef<Engine | null>(null);
  const st = use3D();
  const settings = useApp((s) => s.settings);
  const colors = useColors();
  const pc = usePreviewColors();
  const statsRef = useRef<HTMLDivElement>(null);
  const hadBodies = useRef(0);
  const savedCam = useRef<ReturnType<Engine["saveCamera"]> | null>(null);
  const lastSketchId = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const e = new Engine(ref.current);
    eng.current = e;
    engineRef = e;
    e.onStats = (s) => {
      if (statsRef.current) statsRef.current.textContent = `${s.fps} FPS · ${(s.tris / 1000).toFixed(1)}k 三角面 · ${s.calls} draw calls · ${s.bodies} 体`;
    };
    e.resize();
    const ro = new ResizeObserver(() => e.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      e.dispose();
      eng.current = null;
      engineRef = null;
    };
  }, []);

  // 主题
  useEffect(() => {
    eng.current?.setTheme(settings.theme);
  }, [settings.theme]);

  // 几何 + 辅助
  useEffect(() => {
    const e = eng.current;
    if (!e) return;
    e.syncBodies({
      bodies: st.build.bodies.map((b) => ({
        id: b.id,
        geometry: b.geometry,
        color: st.metas[b.id]?.color || b.meta.color,
        visible: st.metas[b.id]?.visible ?? true,
        opacity: st.metas[b.id]?.opacity ?? 1,
        isSheet: b.meta.isSheet,
      })),
      display: st.display,
      colors,
      analysis: st.analysis,
      section: st.section,
      showSolid: st.showSolid,
      showSheet: st.showSheet,
      flatShading: settings.shading === "flat",
      theme: settings.theme,
    });
    const box = new THREE.Box3().setFromObject(e.root);
    const size = box.isEmpty() ? 100 : box.getSize(new THREE.Vector3()).length();
    if (hadBodies.current === 0 && st.build.bodies.length > 0) setTimeout(() => e.fit(), 30);
    hadBodies.current = st.build.bodies.length;
    e.syncHelpers({
      grid: true,
      axes: settings.showAxes,
      datums: st.showDatum,
      planes: st.datumPlanes() as any,
      colors,
      size: size / 3,
      datumStyle: settings.datumStyle,
      datumOpacity: settings.datumOpacity,
    });
  }, [
    st.dirty,
    st.display,
    st.section,
    st.analysis,
    st.showDatum,
    st.showSolid,
    st.showSheet,
    st.metas,
    colors,
    settings.showAxes,
    settings.shading,
    settings.theme,
    settings.datumStyle,
    settings.datumOpacity,
  ]);

  // 草图显示 + 尺寸标签
  useEffect(() => {
    const e = eng.current;
    if (!e) return;
    const lines: SketchLine[] = [];
    if (st.showSketch !== 2) {
      for (const s of st.build.sketches) {
        if (s.consumed && settings.hideSketchAfterFeature && !st.activeSketch) continue;
        lines.push(...sketchLines(s.sketch));
      }
    }
    if (st.activeSketch) lines.push(...sketchLines(st.activeSketch));
    const selCurves = st.activeSketch ? st.sketchSel : st.sel.curves;
    e.syncSketches(lines, colors.sketch, colors.sketchConstruction, st.showSketch === 1, selCurves, colors.selected);

    const sk = st.activeSketch;
    if (sk) {
      const m = planeMatrix(sk.plane);
      const labels = sk.dims.map((d) => {
        const ent = sk.entities.find((x) => x.id === d.refs[0]?.split("#")[0]);
        const poly = ent ? tessellate(ent, 16) : [];
        const anchor = poly.length ? poly[Math.floor(poly.length / 2)] : { x: d.pos.x, y: d.pos.y };
        const p = new THREE.Vector3(anchor.x + (d.pos.x || 0) * 0.15, anchor.y + (d.pos.y || 0) * 0.15 + 4, 0).applyMatrix4(m);
        const pre = d.type === "diameter" ? "Ø" : d.type === "radius" ? "R" : "";
        const suf = d.type === "angle" ? "°" : "";
        return { id: d.id, text: `${pre}${Math.round(d.value * 100) / 100}${suf}`, pos: p, cls: "dim" };
      });
      e.baseLabels = [...labels, ...st.measure.items.map((mm, i) => ({ id: "m" + i, text: mm.text, pos: mm.p, cls: "measure" }))];
      e.refreshLabels();
    }
  }, [st.dirty, st.activeSketch, st.showSketch, st.sketchSel, st.sel.curves, colors, settings.hideSketchAfterFeature, st.build.sketches]);

  // 进出草图自动摆正视角
  useEffect(() => {
    const e = eng.current;
    if (!e) return;
    const id = st.activeSketch?.id ?? null;
    if (id && id !== lastSketchId.current) {
      if (!savedCam.current) savedCam.current = e.saveCamera();
      if (settings.autoAlignSketch) e.alignToPlane(st.activeSketch!.plane as any);
    } else if (!id && lastSketchId.current) {
      if (savedCam.current && settings.autoAlignSketch) e.restoreCamera(savedCam.current);
      savedCam.current = null;
    }
    lastSketchId.current = id;
  }, [st.activeSketch?.id, settings.autoAlignSketch]);

  // 选择高亮 + 剖切线 + 测量标签
  useEffect(() => {
    const e = eng.current;
    if (!e) return;
    const objs: THREE.Object3D[] = [];
    for (const b of st.build.bodies) {
      if (st.sel.bodies.includes(b.id)) {
        objs.push(new THREE.Mesh(b.geometry, new THREE.MeshBasicMaterial({ color: colors.selected, transparent: true, opacity: 0.22 })));
      }
      for (const f of st.sel.faces.filter((x) => x.bodyId === b.id)) {
        const face = getFaces(b.geometry)[f.faceId];
        if (face) objs.push(faceHighlight(b.geometry, face, colors.highlightFace));
      }
      for (const ed of st.sel.edges.filter((x) => x.bodyId === b.id)) {
        const eg = getEdges(b.geometry)[ed.edgeId];
        if (eg) {
          const pts: number[] = [];
          for (const s of eg.segments) pts.push(s[0].x, s[0].y, s[0].z, s[1].x, s[1].y, s[1].z);
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
          objs.push(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colors.selected, depthTest: false })));
        }
      }
    }
    if (st.preselect) {
      const b = st.build.bodies.find((x) => x.id === st.preselect!.bodyId);
      if (b && st.preselect.faceId !== undefined && st.preselect.faceId >= 0) {
        const face = getFaces(b.geometry)[st.preselect.faceId];
        if (face) objs.push(faceHighlight(b.geometry, face, colors.preselect, 0.28));
      }
    }
    if (st.section.on && st.section.showLine) {
      const n = new THREE.Vector3(st.section.axis === "x" ? 1 : 0, st.section.axis === "y" ? 1 : 0, st.section.axis === "z" ? 1 : 0);
      const plane = new THREE.Plane(n, -st.section.pos);
      const pts: number[] = [];
      for (const b of st.build.bodies) sectionSegments(b.geometry, plane, pts);
      if (pts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        objs.push(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colors.sectionLine, depthTest: false })));
      }
    }
    e.setOverlay(objs);
    if (!st.activeSketch) {
      e.baseLabels = st.measure.items.map((m, i) => ({ id: "m" + i, text: m.text, pos: m.p, cls: "measure" }));
      e.refreshLabels();
    }
  }, [st.sel, st.preselect, st.dirty, st.section, st.measure, colors, st.build.bodies]);

  // 命令实时预览
  useEffect(() => {
    const e = eng.current;
    if (!e) return;
    if (!st.preview || !settings.livePreview) {
      e.setPreview(null);
      e.refreshLabels();
      return;
    }
    e.setPreview({ ...(st.preview as any), showArrows: settings.previewArrows, pc });
    e.refreshLabels();
  }, [st.preview, settings.livePreview, settings.previewArrows, pc]);

  useEffect(() => {
    eng.current?.setAA(settings.aa);
  }, [settings.aa]);

  useEffect(() => {
    resetPending();
    eng.current?.setRubber([]);
  }, [st.sketchTool, st.activeSketch?.id]);

  /* -------------------- 交互 -------------------- */
  useEffect(() => {
    const e = eng.current;
    const el = ref.current;
    if (!e || !el) return;
    let mode: "none" | "orbit" | "pan" | "dragEnt" = "none";
    let last = { x: 0, y: 0 };
    let downPos = { x: 0, y: 0 };
    let dragEnt: { id: string; key: string } | null = null;

    const planeOf = () => {
      const sk = use3D.getState().activeSketch;
      if (!sk) return null;
      const m = planeMatrix(sk.plane);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
      const o = new THREE.Vector3(...sk.plane.origin);
      return { plane: new THREE.Plane(n, -n.dot(o)), matrix: m, sk };
    };

    const to2D = (ev: PointerEvent): Vec2 | null => {
      const info = planeOf();
      if (!info) return null;
      const hit = e.pickPlane(ev, info.plane);
      if (!hit) return null;
      const local = hit.clone().applyMatrix4(info.matrix.clone().invert());
      let p: Vec2 = { x: local.x, y: local.y };
      const s = useApp.getState().settings;
      if (s.objectSnap) {
        const sps = snapPoints(info.sk, {
          endpoint: s.snapEndpoint,
          midpoint: s.snapMidpoint,
          center: s.snapCenter,
          intersection: s.snapIntersection,
          quadrant: s.snapQuadrant,
          oncurve: s.snapOnCurve,
        });
        const tol = (e.camera.position.distanceTo(e.target) * s.snapRange) / 1000;
        let best: Vec2 | null = null,
          bd = tol;
        for (const sp of sps) {
          const d = d2(sp.p, p);
          if (d < bd) {
            bd = d;
            best = sp.p;
          }
        }
        if (best) p = { ...best };
        else if (s.gridSnap) p = { x: Math.round(p.x / s.gridStep) * s.gridStep, y: Math.round(p.y / s.gridStep) * s.gridStep };
      } else if (s.gridSnap) {
        p = { x: Math.round(p.x / s.gridStep) * s.gridStep, y: Math.round(p.y / s.gridStep) * s.gridStep };
      }
      return p;
    };

    const onDown = (ev: PointerEvent) => {
      el.setPointerCapture(ev.pointerId);
      last = { x: ev.clientX, y: ev.clientY };
      downPos = { ...last };
      const s = use3D.getState();
      if (ev.button === 1 || (ev.button === 2 && ev.shiftKey)) {
        mode = "orbit";
        return;
      }
      if (ev.button === 2) {
        mode = "pan";
        return;
      }
      if (ev.button === 0) {
        if (s.activeSketch && s.sketchTool === "select") {
          const p = to2D(ev);
          if (p) {
            const hit = hitEntity(s.activeSketch, p, (e.camera.position.distanceTo(e.target) * useApp.getState().settings.snapRange) / 1000);
            if (hit) {
              dragEnt = { id: hit.id, key: nearestHandle(hit, p) };
              mode = "dragEnt";
              return;
            }
          }
        }
        mode = s.activeSketch ? "none" : "orbit";
      }
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      if (mode === "orbit") e.orbit(dx, dy);
      else if (mode === "pan") e.pan(dx, dy);
      else if (mode === "dragEnt" && dragEnt) {
        const s = use3D.getState();
        const p = to2D(ev);
        if (p && s.activeSketch) {
          const sk = JSON.parse(JSON.stringify(s.activeSketch));
          const ent = sk.entities.find((x: any) => x.id === dragEnt!.id);
          if (ent) {
            if (dragEnt.key === "whole") {
              const c = ent.c || ent.a;
              const ddx = p.x - c.x,
                ddy = p.y - c.y;
              for (const k of ["a", "b", "c"]) if (ent[k]) ent[k] = { x: ent[k].x + ddx, y: ent[k].y + ddy };
              if (ent.pts) ent.pts = ent.pts.map((q: Vec2) => ({ x: q.x + ddx, y: q.y + ddy }));
            } else if (dragEnt.key === "r") ent.r = d2(ent.c, p);
            else if (dragEnt.key.startsWith("p")) ent.pts[+dragEnt.key.slice(1)] = p;
            else ent[dragEnt.key] = p;
          }
          s.setSketch(sk);
        }
      } else {
        const s = use3D.getState();
        if (!s.activeSketch) {
          const hit = e.pick(ev, { body: s.filterBody, face: s.filterFace, edge: s.filterEdge });
          s.setPre(hit ? { bodyId: hit.bodyId, faceId: hit.faceId, edgeId: hit.edgeId } : null);
        } else if (s.sketchTool !== "select") {
          const info = planeOf();
          const p = to2D(ev);
          if (info && p) e.setRubber([...pendingPoints(), p].map((q) => new THREE.Vector3(q.x, q.y, 0).applyMatrix4(info.matrix)));
        }
      }
    };

    const onUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
      const s = use3D.getState();
      if (mode === "dragEnt") {
        mode = "none";
        dragEnt = null;
        return;
      }
      mode = "none";
      if (moved > 4 || ev.button !== 0) return;
      const cubeFace = e.pickCube(ev);
      if (cubeFace && cubeFace !== "none") {
        e.setView(cubeFace);
        return;
      }
      if (cubeFace === "none") return;

      if (s.activeSketch) {
        const tolW = (e.camera.position.distanceTo(e.target) * useApp.getState().settings.snapRange) / 1000;
        if (s.sketchTool === "project") {
          const hit = e.pick(ev, { body: false, face: false, edge: true });
          if (hit && hit.edgeId >= 0) {
            const body = s.build.bodies.find((b) => b.id === hit.bodyId);
            if (body) {
              const eg = getEdges(body.geometry)[hit.edgeId];
              const inv = planeMatrix(s.activeSketch.plane).clone().invert();
              const sk = JSON.parse(JSON.stringify(s.activeSketch));
              for (const seg of eg.segments) {
                const a = seg[0].clone().applyMatrix4(inv);
                const b = seg[1].clone().applyMatrix4(inv);
                sk.entities.push({ id: "e_" + Math.random().toString(36).slice(2, 9), kind: "line", a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, projected: true });
              }
              s.pushSketchUndo();
              s.setSketch(sk);
              useApp.getState().notify(`已投影 ${eg.segments.length} 段边到草图平面`, "ok");
            }
          } else useApp.getState().notify("请点选模型上的一条边", "warn");
          return;
        }
        const p = to2D(ev);
        if (!p) return;
        if (s.sketchTool === "select") {
          const hit = hitEntity(s.activeSketch, p, tolW);
          if (hit) s.set("sketchSel", ev.shiftKey ? [...new Set([...s.sketchSel, hit.id])] : [hit.id]);
          else if (!ev.shiftKey) s.set("sketchSel", []);
          return;
        }
        const sk = JSON.parse(JSON.stringify(s.activeSketch));
        const ctxState = (window as any).__sketchCtx || {};
        const before = sk.entities.length;
        const res = sketchClick(
          sk,
          s.sketchTool,
          p,
          {
            polygonSides: ctxState.polygonSides ?? 6,
            filletRadius: ctxState.filletRadius ?? 5,
            chamferDist: ctxState.chamferDist ?? 3,
            patternCount: ctxState.patternCount ?? 4,
            patternDx: ctxState.patternDx ?? 20,
            patternDy: ctxState.patternDy ?? 0,
            construction: ctxState.construction ?? false,
            selection: s.sketchSel,
          },
          tolW,
        );
        if (res.changed && before !== sk.entities.length) s.pushSketchUndo();
        if (res.changed || pendingTool()) s.setSketch(sk);
        if (res.finished && !useApp.getState().settings.continuousDraw) s.set("sketchTool", "select");
        return;
      }

      // 截面拾取：整张草图 / 单条曲线 / 相连 / 相切
      if (s.filterSketch) {
        const sc = e.pickSketchCurve(ev);
        if (sc) {
          const rec = s.build.sketches.find((x) => x.sketch.id === sc.sketchId);
          let ids: string[] = [sc.entId];
          if (rec) {
            if (s.curveRule === "whole") ids = rec.sketch.entities.map((x) => x.id);
            else if (s.curveRule === "connected") ids = connectedCurves(rec.sketch, sc.entId, false);
            else if (s.curveRule === "tangent") ids = connectedCurves(rec.sketch, sc.entId, true);
          }
          s.select({ curves: ids, sketches: [sc.sketchId] }, ev.shiftKey);
          return;
        }
      }

      const hit = e.pick(ev, { body: s.filterBody, face: s.filterFace, edge: s.filterEdge });
      if (!hit) {
        const datum = e.pickDatum(ev);
        if (datum) {
          if (s.command?.type === "pickPlane") {
            s.startSketch(datum);
            s.set("command", null);
          } else s.set("hint", `已高亮基准面 ${datum.name}：点左侧「草图」即可在其上绘制`);
          return;
        }
        if (!ev.shiftKey) s.clearSel();
        return;
      }
      if (s.command?.type === "pickPlane" && s.filterFace && hit.faceId >= 0) {
        const body = s.build.bodies.find((b) => b.id === hit.bodyId);
        if (body) {
          const face = getFaces(body.geometry)[hit.faceId];
          if (face?.planar) {
            const n = face.normal;
            const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
            const x = new THREE.Vector3().crossVectors(up, n).normalize();
            const y = new THREE.Vector3().crossVectors(n, x).normalize();
            s.startSketch({ name: "面草图", origin: [face.centroid.x, face.centroid.y, face.centroid.z], xdir: [x.x, x.y, x.z], ydir: [y.x, y.y, y.z] });
            s.set("command", null);
            return;
          }
        }
      }
      if (s.filterEdge && hit.edgeId >= 0) s.select({ edges: [{ bodyId: hit.bodyId, edgeId: hit.edgeId }] }, ev.shiftKey);
      else if (s.filterFace && hit.faceId >= 0) s.select({ faces: [{ bodyId: hit.bodyId, faceId: hit.faceId }], bodies: s.filterBody ? [hit.bodyId] : [] }, ev.shiftKey);
      else if (s.filterBody) s.select({ bodies: [hit.bodyId] }, ev.shiftKey);
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      e.zoom(-ev.deltaY, ((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    };
    const onDbl = (ev: MouseEvent) => {
      if (eng.current?.pickCube(ev as any)) eng.current?.fit();
    };
    const onCtx = (ev: MouseEvent) => ev.preventDefault();

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDbl);
    el.addEventListener("contextmenu", onCtx);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDbl);
      el.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  return (
    <div className="relative w-full h-full" style={{ background: `linear-gradient(180deg, ${colors.bgTop}, ${colors.bgBottom})` }}>
      <div ref={ref} className="absolute inset-0" />
      <div ref={statsRef} className="absolute left-2 bottom-2 text-[10px] mono muted pointer-events-none" />
      {pendingTool() && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 text-[11px] px-3 py-1 rounded-full panel2">
          {pendingTool()} · 已拾取 {pendingPoints().length} 点
        </div>
      )}
    </div>
  );
}

function nearestHandle(e: any, p: Vec2): string {
  const cands: [string, Vec2][] = [];
  if (e.a) cands.push(["a", e.a]);
  if (e.b) cands.push(["b", e.b]);
  if (e.c) cands.push(["c", e.c]);
  if (e.pts) e.pts.forEach((q: Vec2, i: number) => cands.push(["p" + i, q]));
  let best = "whole",
    bd = Infinity;
  for (const [k, q] of cands) {
    const d = d2(q, p);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  if (e.r !== undefined && Math.abs(d2(e.c, p) - e.r) < bd) return "r";
  return bd < 6 ? best : "whole";
}

function faceHighlight(geo: THREE.BufferGeometry, face: FaceInfo, color: string, opacity = 0.45): THREE.Mesh {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position.array as ArrayLike<number>;
  const arr: number[] = [];
  for (const t of face.tris) for (let k = 0; k < 9; k++) arr.push(pos[t * 9 + k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
}

export function sectionSegments(geo: THREE.BufferGeometry, plane: THREE.Plane, out: number[]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array as ArrayLike<number>;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 9) {
    a.set(pos[i], pos[i + 1], pos[i + 2]);
    b.set(pos[i + 3], pos[i + 4], pos[i + 5]);
    c.set(pos[i + 6], pos[i + 7], pos[i + 8]);
    const da = plane.distanceToPoint(a),
      db = plane.distanceToPoint(b),
      dc = plane.distanceToPoint(c);
    const pts: THREE.Vector3[] = [];
    const edge = (p1: THREE.Vector3, d1: number, p2: THREE.Vector3, d2v: number) => {
      if ((d1 > 0 && d2v > 0) || (d1 < 0 && d2v < 0)) return;
      const t = d1 / (d1 - d2v);
      if (isFinite(t)) pts.push(new THREE.Vector3().lerpVectors(p1, p2, t));
    };
    edge(a, da, b, db);
    edge(b, db, c, dc);
    edge(c, dc, a, da);
    if (pts.length >= 2) out.push(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z);
  }
}
