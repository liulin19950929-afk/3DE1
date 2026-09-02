import * as THREE from "three";
import type { Sketch } from "../cad/types";
import { extrudeGeometry, revolveGeometry, sweepGeometry, loftGeometry, fillGeometry, primitiveGeometry, planeMatrix, computeFaces, offsetGeometry, draftBody, pushPullFace, shapesFromSketch } from "../cad/kernel";
import { use3D } from "./store3d";
import { getFaces } from "./Viewport";

export interface PreviewSet {
  /** 半透明实体预览（增料 = 青绿，切除 = 红） */
  solids: { geo: THREE.BufferGeometry; mode: "add" | "cut" | "new" }[];
  /** 线框虚影（阵列 / 镜像 待生成几何） */
  ghosts: THREE.BufferGeometry[];
  /** 高亮发光的源对象 */
  sources: THREE.BufferGeometry[];
  /** 三维箭头 + 悬浮读数 */
  arrows: { from: THREE.Vector3; to: THREE.Vector3; label: string; color?: string }[];
}

const empty = (): PreviewSet => ({ solids: [], ghosts: [], sources: [], arrows: [] });

const opOf = (op: string): "add" | "cut" | "new" => (op === "cut" ? "cut" : op === "add" ? "add" : "new");

/** 根据当前命令与参数生成实时预览 */
export function buildPreview(cmd: string, p: Record<string, any>, tess = 32): PreviewSet {
  const st = use3D.getState();
  const out = empty();
  const sketchOf = (id: string): Sketch | null => st.build.sketches.find((s) => s.sketch.id === id)?.sketch ?? null;
  const bodyOf = (id: string) => st.build.bodies.find((b) => b.id === id);

  try {
    switch (cmd) {
      case "extrude": {
        const sk = sketchOf(p.sketchId);
        if (!sk) break;
        const ids = st.sel.sketches[0] === p.sketchId ? st.sel.curves : [];
        const geo = extrudeGeometry(sk, p.start, p.end, p.draft, p.thin, p.surface, p.symmetric, tess, ids);
        if (geo) out.solids.push({ geo, mode: opOf(p.op) });
        // 三维箭头：沿法线标出起止距离
        const m = planeMatrix(sk.plane);
        const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
        const center = profileCenter(sk, ids, m);
        let s = p.start,
          e = p.end;
        if (p.symmetric) {
          const d = Math.abs(p.end - p.start);
          s = -d / 2;
          e = d / 2;
        }
        const a0 = center.clone().addScaledVector(n, s);
        const a1 = center.clone().addScaledVector(n, e);
        out.arrows.push({ from: center, to: a1, label: `终点 ${fmt(e)} mm` });
        if (Math.abs(s) > 1e-6) out.arrows.push({ from: center, to: a0, label: `起点 ${fmt(s)} mm` });
        if (p.draft) out.arrows.push({ from: a1, to: a1.clone().addScaledVector(n, 0), label: `拔模 ${fmt(p.draft)}°` });
        break;
      }
      case "revolve": {
        const sk = sketchOf(p.sketchId);
        if (!sk) break;
        const ids = st.sel.sketches[0] === p.sketchId ? st.sel.curves : [];
        const geo = revolveGeometry(sk, p.axis, p.angle, tess, ids);
        if (geo) out.solids.push({ geo, mode: opOf(p.op) });
        const m = planeMatrix(sk.plane);
        const center = profileCenter(sk, ids, m);
        const axisDir = new THREE.Vector3(...(p.axis === "y" ? [0, 1, 0] : [1, 0, 0])).transformDirection(m);
        const o = new THREE.Vector3(...sk.plane.origin);
        out.arrows.push({ from: o.clone().addScaledVector(axisDir, -40), to: o.clone().addScaledVector(axisDir, 40), label: `旋转轴 · ${fmt(p.angle)}°` });
        out.arrows.push({ from: o, to: center, label: `半径 ${fmt(center.distanceTo(o))} mm` });
        break;
      }
      case "sweep": {
        const a = sketchOf(p.sketchId),
          b = sketchOf(p.pathId);
        if (a && b) {
          const geo = sweepGeometry(a, b, tess);
          if (geo) out.solids.push({ geo, mode: opOf(p.op) });
        }
        break;
      }
      case "loft": {
        const sks = (p.sketchIds || []).map((id: string) => sketchOf(id)).filter(Boolean) as Sketch[];
        const geo = loftGeometry(sks);
        if (geo) out.solids.push({ geo, mode: opOf(p.op) });
        break;
      }
      case "fill": {
        const sk = sketchOf(p.sketchId);
        const geo = sk && fillGeometry(sk);
        if (geo) out.solids.push({ geo, mode: "new" });
        break;
      }
      case "primitive": {
        const geo = primitiveGeometry(p.shape, p);
        out.solids.push({ geo, mode: opOf(p.op) });
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const c = bb.getCenter(new THREE.Vector3());
        const size = bb.getSize(new THREE.Vector3());
        out.arrows.push({ from: new THREE.Vector3(bb.min.x, c.y, c.z), to: new THREE.Vector3(bb.max.x, c.y, c.z), label: `X ${fmt(size.x)}`, color: "#ef4444" });
        out.arrows.push({ from: new THREE.Vector3(c.x, bb.min.y, c.z), to: new THREE.Vector3(c.x, bb.max.y, c.z), label: `Y ${fmt(size.y)}`, color: "#22c55e" });
        out.arrows.push({ from: new THREE.Vector3(c.x, c.y, bb.min.z), to: new THREE.Vector3(c.x, c.y, bb.max.z), label: `Z ${fmt(size.z)}`, color: "#3b82f6" });
        break;
      }
      case "pushpull": {
        const f = st.sel.faces[0];
        if (!f) break;
        const body = bodyOf(f.bodyId);
        if (!body) break;
        const face = getFaces(body.geometry)[f.faceId];
        if (!face) break;
        out.sources.push(faceGeometry(body.geometry, face.tris));
        const dist = p.mode === "push" ? -Math.abs(p.distance) : p.distance;
        out.solids.push({ geo: pushPullFace(body.geometry, face, dist), mode: dist >= 0 ? "add" : "cut" });
        out.arrows.push({
          from: face.centroid.clone(),
          to: face.centroid.clone().addScaledVector(face.normal, dist),
          label: `${dist >= 0 ? "拉出" : "压入"} ${fmt(Math.abs(dist))} mm`,
          color: dist >= 0 ? "#22d3ee" : "#f87171",
        });
        break;
      }
      case "shell": {
        const b = bodyOf(p.bodyId) || st.build.bodies[0];
        if (!b) break;
        out.sources.push(b.geometry);
        out.ghosts.push(offsetGeometry(b.geometry, -Math.abs(p.thickness)));
        const bb = b.geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(b.geometry.attributes.position as THREE.BufferAttribute);
        const c = bb.getCenter(new THREE.Vector3());
        out.arrows.push({ from: new THREE.Vector3(bb.max.x, c.y, c.z), to: new THREE.Vector3(bb.max.x - p.thickness, c.y, c.z), label: `壁厚 ${fmt(p.thickness)} mm`, color: "#22d3ee" });
        break;
      }
      case "draftFeat": {
        const b = bodyOf(p.bodyId) || st.build.bodies[0];
        if (!b) break;
        out.sources.push(b.geometry);
        const dir: [number, number, number] = p.dir === "x" ? [1, 0, 0] : p.dir === "y" ? [0, 1, 0] : [0, 0, 1];
        out.solids.push({ geo: draftBody(b.geometry, dir, p.angle), mode: "add" });
        const bb = b.geometry.boundingBox!;
        const c = bb.getCenter(new THREE.Vector3());
        const d = new THREE.Vector3(...dir);
        out.arrows.push({ from: c.clone().addScaledVector(d, -bb.getSize(new THREE.Vector3()).length() / 2), to: c.clone().addScaledVector(d, bb.getSize(new THREE.Vector3()).length() / 2), label: `脱模方向 · ${fmt(p.angle)}°`, color: "#a78bfa" });
        break;
      }
      case "fillet": {
        for (const e of st.sel.edges) {
          const b = bodyOf(e.bodyId);
          if (!b) continue;
          out.sources.push(b.geometry);
        }
        break;
      }
      case "boolean": {
        const t = bodyOf(p.target),
          tool = bodyOf(p.tool);
        if (t) out.sources.push(t.geometry);
        if (tool) out.solids.push({ geo: tool.geometry, mode: p.op === "subtract" ? "cut" : "add" });
        break;
      }
      case "transform": {
        // 阵列 / 镜像 / 移动：线框虚影 + 源高亮
        const ids: string[] = st.sel.bodies.length ? st.sel.bodies : p.bodyId ? [p.bodyId] : [];
        const bodies = ids.map(bodyOf).filter(Boolean) as { geometry: THREE.BufferGeometry }[];
        if (!bodies.length) break;
        for (const b of bodies) out.sources.push(b.geometry);
        const mk = (m: THREE.Matrix4, g: THREE.BufferGeometry) => {
          const c = g.clone();
          c.applyMatrix4(m);
          return c;
        };
        if (p.mode === "linear") {
          const n = Math.max(2, p.count | 0);
          const n2 = p.count2 > 1 ? p.count2 | 0 : 1;
          const d1 = axisVec(p.dir1, p.spacing1);
          const d2 = axisVec(p.dir2, p.spacing2);
          for (const b of bodies)
            for (let i = 0; i < n; i++)
              for (let j = 0; j < n2; j++) {
                if (i === 0 && j === 0) continue;
                const m = new THREE.Matrix4().makeTranslation(d1.x * i + d2.x * j, d1.y * i + d2.y * j, d1.z * i + d2.z * j);
                out.ghosts.push(mk(m, b.geometry));
              }
          const base = centerOf(bodies[0].geometry);
          if (n > 1) out.arrows.push({ from: base, to: base.clone().add(d1.clone().multiplyScalar(n - 1)), label: `方向1 ${String(p.dir1 || "x").toUpperCase()} · ${n} 个 · 间距 ${fmt(p.spacing1)}` });
          if (n2 > 1) out.arrows.push({ from: base, to: base.clone().add(d2.clone().multiplyScalar(n2 - 1)), label: `方向2 ${String(p.dir2 || "y").toUpperCase()} · ${n2} 个 · 间距 ${fmt(p.spacing2)}` });
        } else if (p.mode === "circular") {
          const n = Math.max(2, p.count | 0);
          for (const b of bodies)
            for (let k = 1; k < n; k++) {
              const a = ((Math.PI * 2) / n) * k;
              const m = p.axis === "z" ? new THREE.Matrix4().makeRotationZ(a) : p.axis === "y" ? new THREE.Matrix4().makeRotationY(a) : new THREE.Matrix4().makeRotationX(a);
              out.ghosts.push(mk(m, b.geometry));
            }
          out.arrows.push({ from: new THREE.Vector3(), to: centerOf(bodies[0].geometry), label: `圆形阵列 ${n} 个 · 绕 ${String(p.axis || "z").toUpperCase()} 轴`, color: "#22d3ee" });
        } else if (p.mode === "mirror") {
          const m = new THREE.Matrix4().makeScale(p.axis === "x" ? -1 : 1, p.axis === "y" ? -1 : 1, p.axis === "z" ? -1 : 1);
          for (const b of bodies) out.ghosts.push(mk(m, b.geometry));
          const c = centerOf(bodies[0].geometry);
          const mc = c.clone();
          if (p.axis === "x") mc.x *= -1;
          else if (p.axis === "y") mc.y *= -1;
          else mc.z *= -1;
          out.arrows.push({ from: c, to: mc, label: `镜像 · ${String(p.axis).toUpperCase()} 平面`, color: "#a78bfa" });
        } else if (p.mode === "move") {
          const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((p.rx * Math.PI) / 180, (p.ry * Math.PI) / 180, (p.rz * Math.PI) / 180));
          m.setPosition(p.dx, p.dy, p.dz);
          for (const b of bodies) out.ghosts.push(mk(m, b.geometry));
          const c = centerOf(bodies[0].geometry);
          out.arrows.push({ from: c, to: c.clone().add(new THREE.Vector3(p.dx, p.dy, p.dz)), label: `移动 ${fmt(Math.hypot(p.dx, p.dy, p.dz))} mm${p.copy ? " · 保留副本" : ""}`, color: "#22d3ee" });
        } else if (p.mode === "scale") {
          for (const b of bodies) out.ghosts.push(mk(new THREE.Matrix4().makeScale(p.scale, p.scale, p.scale), b.geometry));
        }
        break;
      }
      case "datum": {
        const geo = new THREE.PlaneGeometry(90, 90);
        const off = p.offset || 0;
        if (p.base === "XY") geo.translate(0, 0, off);
        else if (p.base === "XZ") {
          geo.rotateX(Math.PI / 2);
          geo.translate(0, off, 0);
        } else {
          geo.rotateY(Math.PI / 2);
          geo.translate(off, 0, 0);
        }
        if (p.mode === "angle" && p.angle) geo.rotateX((p.angle * Math.PI) / 180);
        out.solids.push({ geo, mode: "new" });
        const n = p.base === "XY" ? new THREE.Vector3(0, 0, 1) : p.base === "XZ" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        out.arrows.push({ from: new THREE.Vector3(), to: n.clone().multiplyScalar(off), label: `偏置 ${fmt(off)} mm`, color: "#22d3ee" });
        break;
      }
      case "thicken": {
        const b = bodyOf(p.bodyId);
        if (b) {
          out.sources.push(b.geometry);
          out.ghosts.push(offsetGeometry(b.geometry, p.thickness));
        }
        break;
      }
      case "deleteBody": {
        const b = bodyOf(p.bodyId);
        if (b) out.sources.push(b.geometry);
        break;
      }
    }
  } catch {
    /* 预览失败不影响命令本身 */
  }
  return out;
}

function axisVec(axis: string | undefined, spacing: number): THREE.Vector3 {
  const s = spacing || 0;
  if (axis === "y") return new THREE.Vector3(0, s, 0);
  if (axis === "z") return new THREE.Vector3(0, 0, s);
  if (axis === "-x") return new THREE.Vector3(-s, 0, 0);
  if (axis === "-y") return new THREE.Vector3(0, -s, 0);
  if (axis === "-z") return new THREE.Vector3(0, 0, -s);
  return new THREE.Vector3(s, 0, 0);
}

function centerOf(g: THREE.BufferGeometry): THREE.Vector3 {
  if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox!.getCenter(new THREE.Vector3());
}

function profileCenter(sk: Sketch, ids: string[], m: THREE.Matrix4): THREE.Vector3 {
  const shapes = shapesFromSketch(sk, 0, ids);
  const c = new THREE.Vector2();
  let n = 0;
  for (const s of shapes)
    for (const p of s.getPoints(16)) {
      c.add(p);
      n++;
    }
  if (!n) return new THREE.Vector3(...sk.plane.origin);
  c.multiplyScalar(1 / n);
  return new THREE.Vector3(c.x, c.y, 0).applyMatrix4(m);
}

function faceGeometry(geo: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position.array as ArrayLike<number>;
  const arr: number[] = [];
  for (const t of tris) for (let k = 0; k < 9; k++) arr.push(pos[t * 9 + k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

export function previewFaces(geo: THREE.BufferGeometry) {
  return computeFaces(geo);
}
