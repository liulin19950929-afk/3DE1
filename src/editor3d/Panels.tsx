import { useState } from "react";
import * as THREE from "three";
import { use3D } from "./store3d";
import { useApp, download, fmt, useColors } from "../store";
import { Row, Num, Toggle, Seg, Section, Color, Badge, Progress } from "../components/ui";
import { Icon } from "../components/icons";
import { MATERIALS, type Feature } from "../cad/types";
import { runThickness, runDraft, runMass, localRadius, benchmark } from "./analysis";
import { getFaces, getEdges, getEngine } from "./Viewport";
import { exportSTL, exportSTEP, exportOBJ, export3MF } from "../io/mesh";
import { DEFAULT_COLORS, DEFAULT_COLORS_LIGHT } from "../store";

/** 每个特征可在建模树里直接改的参数（双击进入） */
const FEATURE_PARAMS: Record<string, { key: string; label: string; type: "num" | "bool" | "select"; step?: number; options?: [string, string][] }[]> = {
  extrude: [
    { key: "start", label: "起点", type: "num" },
    { key: "end", label: "终点", type: "num" },
    { key: "symmetric", label: "对称", type: "bool" },
    { key: "draft", label: "拔模角 °", type: "num", step: 0.5 },
    { key: "thin", label: "薄壁厚度", type: "num", step: 0.5 },
    { key: "surface", label: "生成片体", type: "bool" },
    { key: "op", label: "布尔", type: "select", options: [["new", "新建体"], ["add", "求和"], ["cut", "求差"], ["intersect", "求交"]] },
  ],
  revolve: [
    { key: "angle", label: "角度 °", type: "num", step: 5 },
    { key: "axis", label: "旋转轴", type: "select", options: [["x", "草图 X 轴"], ["y", "草图 Y 轴"]] },
    { key: "op", label: "布尔", type: "select", options: [["new", "新建体"], ["add", "求和"], ["cut", "求差"], ["intersect", "求交"]] },
  ],
  fillet: [
    { key: "radius", label: "半径/距离", type: "num", step: 0.5 },
    { key: "mode", label: "类型", type: "select", options: [["fillet", "圆角"], ["chamfer", "倒角"]] },
  ],
  shell: [{ key: "thickness", label: "壁厚", type: "num", step: 0.5 }],
  draftFeat: [{ key: "angle", label: "拔模角 °", type: "num", step: 0.5 }],
  thicken: [{ key: "thickness", label: "厚度", type: "num", step: 0.5 }],
  datum: [
    { key: "offset", label: "偏置距离", type: "num" },
    { key: "angle", label: "角度 °", type: "num" },
    { key: "base", label: "基准", type: "select", options: [["XY", "XY"], ["XZ", "XZ"], ["YZ", "YZ"]] },
  ],
  transform: [
    { key: "count", label: "方向1 数量", type: "num" },
    { key: "dx", label: "方向1 ΔX", type: "num" },
    { key: "dy", label: "方向1 ΔY", type: "num" },
    { key: "dz", label: "方向1 ΔZ", type: "num" },
    { key: "count2", label: "方向2 数量", type: "num" },
    { key: "dx2", label: "方向2 ΔX", type: "num" },
    { key: "dy2", label: "方向2 ΔY", type: "num" },
    { key: "dz2", label: "方向2 ΔZ", type: "num" },
    { key: "rx", label: "绕X °", type: "num" },
    { key: "ry", label: "绕Y °", type: "num" },
    { key: "rz", label: "绕Z °", type: "num" },
    { key: "scale", label: "比例", type: "num", step: 0.1 },
    { key: "copy", label: "保留副本", type: "bool" },
    { key: "axis", label: "轴", type: "select", options: [["x", "X"], ["y", "Y"], ["z", "Z"]] },
  ],
  boolean: [{ key: "op", label: "运算", type: "select", options: [["union", "并集"], ["subtract", "差集"], ["intersect", "交集"]] }],
  pushpull: [{ key: "distance", label: "距离", type: "num", step: 0.5 }],
  primitive: [],
};

export function TreePanel() {
  const st = use3D();
  const app = useApp();
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <div className="text-[12px]">
      <Section title={`建模树 · ${st.features.length} 个特征`}>
        <div className="text-[10.5px] muted mb-1">双击特征 = 在左侧建模参数卡里编辑（草图则进入草图）；单击 = 在视口中高亮</div>
        <div className="flex flex-col gap-[2px]">
          {st.features.map((f, i) => {
            const active = st.rollback === Infinity || i < st.rollback;
            const open = st.editFeatureId === f.id;
            const fields = FEATURE_PARAMS[f.type] || [];
            return (
              <div key={f.id}>
                <div
                  className="flex items-center gap-1 px-1 py-[3px] rounded"
                  style={{
                    background: open || st.sel.sketches.includes((f as any).sketch?.id) ? "color-mix(in srgb,var(--accent) 18%,transparent)" : undefined,
                    opacity: active ? 1 : 0.4,
                  }}
                >
                  <span className="w-4 flex items-center justify-center muted">
                    <Icon name={iconOf(f.type)} size={14} />
                  </span>
                  {renaming === f.id ? (
                    <input
                      className="inp"
                      defaultValue={f.name}
                      autoFocus
                      onBlur={(e) => {
                        st.updateFeature(f.id, { name: e.target.value } as Partial<Feature>);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <span
                      className="flex-1 truncate cursor-pointer select-none"
                      title="双击编辑参数"
                      onClick={() => {
                        if (f.type === "sketch") st.select({ sketches: [(f as any).sketch.id], curves: [] });
                        else if ((f as any).bodyId) st.select({ bodies: [(f as any).bodyId] });
                      }}
                      onDoubleClick={() => {
                        // 双击 = 回到左边的建模参数卡里编辑
                        if (f.type === "sketch") st.editSketch(f.id);
                        else if (fields.length) {
                          st.set("editFeatureId", f.id);
                          st.set("command", null);
                        } else app.notify("该特征没有可编辑参数（可在此重命名或删除）", "info");
                      }}
                    >
                      {f.name}
                      {f.suppressed && <span className="muted"> · 已抑制</span>}
                    </span>
                  )}
                  <button className="btn sm" title="重命名" onClick={() => setRenaming(f.id)}>
                    <Icon name="text" size={12} />
                  </button>
                  <button className="btn sm" title="抑制/启用" onClick={() => st.updateFeature(f.id, { suppressed: !f.suppressed } as Partial<Feature>)}>
                    <Icon name={f.suppressed ? "eyeOff" : "eye"} size={12} />
                  </button>
                  <button className="btn sm" title="回退到此处" onClick={() => st.moveRollback(i)}>
                    <Icon name="undo" size={12} />
                  </button>
                  <button className="btn sm" title="删除" onClick={() => st.removeFeature(f.id)}>
                    <Icon name="close" size={12} />
                  </button>
                </div>

                {open && <div className="ml-5 mr-1 mb-1 text-[10.5px] accent">← 参数已在左侧建模参数卡中打开</div>}
              </div>
            );
          })}
          {!st.features.length && <div className="muted p-2">还没有特征。从左侧命令轨开始：草图 → 拉伸。</div>}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button className="btn sm" onClick={() => st.moveRollback(Infinity)}>回到末尾</button>
          <span className="muted text-[11px]">回退条：{st.rollback === Infinity ? "末尾" : st.rollback}</span>
        </div>
        {st.build.errors.length > 0 && (
          <div className="mt-2 text-[11px]" style={{ color: "var(--danger)" }}>
            {st.build.errors.map((e, i) => (
              <div key={i}>⚠ {e.message}</div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function iconOf(t: string) {
  return (
    {
      sketch: "sketch",
      extrude: "extrude",
      revolve: "revolve",
      boolean: "boolean",
      fillet: "fillet",
      shell: "shell",
      draftFeat: "draft",
      transform: "transform",
      datum: "datum",
      primitive: "primitive",
      sweep: "sweep",
      loft: "loft",
      fill: "surface",
      pushpull: "pushpull",
      import: "importIcon",
      delete: "deleteBody",
      thicken: "thicken",
    } as Record<string, string>
  )[t] || "point";
}

export function BodiesPanel() {
  const st = use3D();
  return (
    <Section title={`实体 · ${st.build.bodies.length}`}>
      {st.build.bodies.map((b) => {
        const m = st.metas[b.id] || b.meta;
        return (
          <div key={b.id} className="flex items-center gap-1 py-[3px]">
            <Color value={m.color} onChange={(c) => st.setMeta(b.id, { color: c })} />
            <span className="flex-1 truncate text-[11.5px] cursor-pointer" onClick={() => st.select({ bodies: [b.id] })}>
              {m.name} {b.meta.isSheet && <Badge>片体</Badge>}
            </span>
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={m.opacity}
              onChange={(e) => st.setMeta(b.id, { opacity: +e.target.value })}
              className="w-14"
              title="透明度"
            />
            <button className="btn sm" onClick={() => st.setMeta(b.id, { visible: !m.visible })}>
              {m.visible ? "👁" : "🚫"}
            </button>
            <button
              className="btn sm"
              title="单独显示"
              onClick={() => st.build.bodies.forEach((x) => st.setMeta(x.id, { visible: x.id === b.id }))}
            >
              ◎
            </button>
          </div>
        );
      })}
      <div className="flex gap-1 mt-1 flex-wrap">
        <button className="btn sm" onClick={() => st.build.bodies.forEach((x) => st.setMeta(x.id, { visible: true }))}>
          全部显示
        </button>
        <button
          className="btn sm"
          title="网格模型就地转成实体：转完能继续布尔、倒角，也能导出 STEP"
          onClick={() => {
            const id = st.sel.bodies[0] || st.build.bodies[0]?.id;
            if (!id) return;
            st.setMeta(id, { fromMesh: false, name: (st.metas[id]?.name || "实体") + " · 已转实体" });
            useApp.getState().notify("网格已转成实体（可继续编辑与导出 STEP）", "ok");
          }}
        >
          网格转实体
        </button>
        <button
          className="btn sm"
          onClick={() => {
            const id = st.sel.bodies[0];
            if (!id) return;
            const n = window.prompt("实体名称", st.metas[id]?.name || "");
            if (n) st.setMeta(id, { name: n });
          }}
        >
          重命名
        </button>
      </div>
    </Section>
  );
}

export function SectionPanel() {
  const st = use3D();
  const pro = useApp((s) => s.pro);
  const box = new THREE.Box3();
  st.build.bodies.forEach((b) => box.expandByObject(new THREE.Mesh(b.geometry)));
  const range = box.isEmpty() ? 100 : Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  return (
    <Section title="剖切 (Pro)">
      {!pro && <div className="text-[11px] mb-1" style={{ color: "var(--warn)" }}>剖切属于 Pro 功能，可在「解锁 Pro」中开启 7 天试用。</div>}
      <Row label="启用">
        <Toggle on={st.section.on} onChange={(v) => st.set("section", { ...st.section, on: v && pro })} />
      </Row>
      <Row label="平面">
        <Seg value={st.section.axis} options={[{ id: "x", label: "YZ" }, { id: "y", label: "XZ" }, { id: "z", label: "XY" }]} onChange={(v) => st.set("section", { ...st.section, axis: v })} />
      </Row>
      <Row label="位置">
        <input type="range" min={-range} max={range} step={range / 200} value={st.section.pos} onChange={(e) => st.set("section", { ...st.section, pos: +e.target.value })} className="w-32" />
        <Num value={st.section.pos} onChange={(v) => st.set("section", { ...st.section, pos: v })} w={60} />
      </Row>
      <Row label="反向">
        <Toggle on={st.section.flip} onChange={(v) => st.set("section", { ...st.section, flip: v })} />
      </Row>
      <Row label="截面线">
        <Toggle on={st.section.showLine} onChange={(v) => st.set("section", { ...st.section, showLine: v })} />
        <Num value={st.section.lineWidth} onChange={(v) => st.set("section", { ...st.section, lineWidth: v })} step={0.25} w={54} suffix="dp" />
      </Row>
    </Section>
  );
}

export function DisplayPanel() {
  const st = use3D();
  const { settings, set, setColors } = useApp();
  const colors = useColors();
  return (
    <>
      <Section title="显示模式">
        <Seg
          value={st.display}
          options={[
            { id: "shaded", label: "着色" },
            { id: "shadedEdge", label: "着色+边线" },
            { id: "wire", label: "线框" },
            { id: "hidden", label: "隐藏线" },
            { id: "xray", label: "X-Ray" },
          ]}
          onChange={(v) => st.set("display", v)}
        />
        <Row label="抗锯齿采样">
          <Seg value={String(settings.aa) as any} options={[{ id: "0", label: "关" }, { id: "2", label: "2x" }, { id: "4", label: "4x" }, { id: "8", label: "8x" }]} onChange={(v) => set("aa", Number(v) as any)} />
        </Row>
        <Row label="地面阴影">
          <Toggle on={settings.shadows} onChange={(v) => set("shadows", v)} />
        </Row>
        <Row label="坐标轴">
          <Toggle on={settings.showAxes} onChange={(v) => set("showAxes", v)} />
        </Row>
        <Row label="着色模式">
          <Seg value={settings.shading} options={[{ id: "flat", label: "平面 Flat" }, { id: "smooth", label: "平滑" }]} onChange={(v) => set("shading", v as any)} />
        </Row>
        <Row label="镶嵌公差">
          <input type="range" min={0.01} max={0.6} step={0.01} value={settings.chordTol} onChange={(e) => set("chordTol", +e.target.value)} className="w-28" />
          <span className="text-[11px] muted mono">{settings.chordTol.toFixed(2)}</span>
        </Row>
        <Row label="基准面样式">
          <Seg value={settings.datumStyle} options={[{ id: "dashed", label: "虚线框" }, { id: "grid", label: "网格" }, { id: "filled", label: "填充" }]} onChange={(v) => set("datumStyle", v as any)} />
        </Row>
        <Row label="实时预览"><Toggle on={settings.livePreview} onChange={(v) => set("livePreview", v)} /></Row>
        <Row label="预览箭头读数"><Toggle on={settings.previewArrows} onChange={(v) => set("previewArrows", v)} /></Row>
      </Section>
      <Section title={`配色 · ${settings.theme === "light" ? "浅色主题" : "深色主题"}`} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-x-2">
          {Object.entries(colors).map(([k, v]) => (
            <Row key={k} label={colorLabel(k)}>
              <Color value={v as string} onChange={(c) => setColors({ [k]: c } as any)} />
            </Row>
          ))}
        </div>
        <button className="btn sm mt-2" onClick={() => setColors(settings.theme === "light" ? DEFAULT_COLORS_LIGHT : DEFAULT_COLORS)}>
          恢复默认配色
        </button>
      </Section>
    </>
  );
}

const COLOR_LABELS: Record<string, string> = {
  bgTop: "背景上",
  bgBottom: "背景下",
  body: "实体",
  edge: "边线",
  selected: "选中",
  preselect: "预选",
  sketch: "草图曲线",
  sketchConstruction: "构造线",
  dim: "尺寸",
  grid: "网格",
  gridMajor: "主网格",
  datumXY: "XY 基准面",
  datumXZ: "XZ 基准面",
  datumYZ: "YZ 基准面",
  axisX: "X 轴",
  axisY: "Y 轴",
  axisZ: "Z 轴",
  sectionLine: "截面线",
  ground: "地面",
  highlightFace: "面高亮",
};
const colorLabel = (k: string) => COLOR_LABELS[k] || k;

export function MeasurePanel() {
  const st = use3D();
  const app = useApp();
  const [mode, setMode] = useState("distance");
  const [mat, setMat] = useState(0);
  const [mass, setMass] = useState<{ volume: number; area: number; bbox: [number, number, number]; boundingVolume: number; ms: number; threads: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const measure = () => {
    const items: { text: string; p: THREE.Vector3 }[] = [];
    const sel = st.sel;
    const pts: THREE.Vector3[] = [];
    for (const f of sel.faces) {
      const b = st.build.bodies.find((x) => x.id === f.bodyId);
      if (b) pts.push(getFaces(b.geometry)[f.faceId]?.centroid.clone() || new THREE.Vector3());
    }
    for (const e of sel.edges) {
      const b = st.build.bodies.find((x) => x.id === e.bodyId);
      if (b) pts.push(getEdges(b.geometry)[e.edgeId]?.mid.clone() || new THREE.Vector3());
    }
    if (mode === "distance" && pts.length >= 2) {
      const d = pts[0].distanceTo(pts[1]);
      items.push({ text: `距离 ${fmt(d)} ${app.settings.units}`, p: pts[0].clone().lerp(pts[1], 0.5) });
    } else if (mode === "angle" && sel.faces.length >= 2) {
      const b1 = st.build.bodies.find((x) => x.id === sel.faces[0].bodyId)!;
      const b2 = st.build.bodies.find((x) => x.id === sel.faces[1].bodyId)!;
      const n1 = getFaces(b1.geometry)[sel.faces[0].faceId].normal;
      const n2 = getFaces(b2.geometry)[sel.faces[1].faceId].normal;
      items.push({ text: `夹角 ${fmt((n1.angleTo(n2) * 180) / Math.PI)}°`, p: pts[0].clone().lerp(pts[1] || pts[0], 0.5) });
    } else if (mode === "radius" && (sel.faces.length || sel.edges.length)) {
      const f = sel.faces[0];
      if (f) {
        const b = st.build.bodies.find((x) => x.id === f.bodyId)!;
        const face = getFaces(b.geometry)[f.faceId];
        const r = face.planar ? Infinity : localRadius(b.geometry, face.centroid);
        items.push({ text: face.planar ? "平面（半径 ∞）" : `局部半径 R${fmt(r)}`, p: face.centroid.clone() });
      } else {
        const e = sel.edges[0];
        const b = st.build.bodies.find((x) => x.id === e.bodyId)!;
        const eg = getEdges(b.geometry)[e.edgeId];
        items.push({ text: `边长 ${fmt(eg.length)}`, p: eg.mid.clone() });
      }
    } else if (mode === "composite") {
      pts.forEach((p, i) => items.push({ text: `点${i + 1} (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`, p }));
    }
    st.set("measure", { items, mode });
    if (!items.length) app.notify("请先选择几何（打开面/边选择过滤器）", "warn");
  };

  const doMass = async () => {
    if (!app.pro) return app.notify("体测量属于 Pro 功能", "warn");
    const b = st.build.bodies.find((x) => x.id === st.sel.bodies[0]) || st.build.bodies[0];
    if (!b) return;
    setBusy(true);
    const r = await runMass(b.geometry, app.settings.threads);
    setMass(r);
    setBusy(false);
    st.set("measure", {
      mode: "body",
      items: [{ text: `体积 ${fmt(r.volume / 1000)} cm³ · 面积 ${fmt(r.area / 100)} cm²`, p: new THREE.Vector3(...r.centroid) }],
    });
  };

  const m = MATERIALS[mat];
  const weight = mass ? (mass.volume / 1000) * m.density * 0.001 : 0; // kg

  return (
    <>
      <Section title="测量">
        <Seg
          value={mode}
          options={[
            { id: "distance", label: "距离" },
            { id: "angle", label: "角度" },
            { id: "radius", label: "半径" },
            { id: "composite", label: "复合" },
          ]}
          onChange={setMode}
        />
        <div className="flex gap-1 mt-2">
          <button className="btn sm" onClick={measure}>
            测量选中
          </button>
          <button className="btn sm" onClick={() => st.set("measure", { items: [], mode })}>
            清除读数
          </button>
        </div>
        {st.measure.items.map((i, k) => (
          <div key={k} className="mt-1 text-[11.5px] mono">
            · {i.text}
          </div>
        ))}
      </Section>
      <Section title="体测量 (Pro)">
        <Row label="材料">
          <select className="inp" value={mat} onChange={(e) => setMat(+e.target.value)}>
            {MATERIALS.map((x, i) => (
              <option key={x.name} value={i}>
                {x.name} · {x.density} g/cm³
              </option>
            ))}
          </select>
        </Row>
        <button className="btn sm mt-1" disabled={busy} onClick={doMass}>
          {busy ? "计算中…" : "测量体（多线程）"}
        </button>
        {mass && (
          <div className="mt-2 text-[11.5px] mono leading-5">
            <div>体积 {fmt(mass.volume / 1000)} cm³</div>
            <div>包容体积 {fmt(mass.boundingVolume / 1000)} cm³</div>
            <div>
              外形尺寸 {fmt(mass.bbox[0])} × {fmt(mass.bbox[1])} × {fmt(mass.bbox[2])} mm
            </div>
            <div>表面积 {fmt(mass.area / 100)} cm²</div>
            <div>重量 {fmt(weight, 3)} kg</div>
            <div>成本 ≈ ¥{fmt(weight * m.price, 2)}</div>
            <div className="muted">{mass.threads} 线程 · {fmt(mass.ms, 0)} ms</div>
          </div>
        )}
      </Section>
    </>
  );
}

export function DraftPanel() {
  const st = use3D();
  const app = useApp();
  const [dir, setDir] = useState<"x" | "y" | "z">("z");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!app.pro) return app.notify("拔模分析属于 Pro 功能", "warn");
    setBusy(true);
    const v: [number, number, number] = dir === "x" ? [1, 0, 0] : dir === "y" ? [0, 1, 0] : [0, 0, 1];
    const r = await runDraft(st.build.bodies, v, app.settings.threads);
    st.set("analysis", { mode: "draft", perBody: r.perBody, min: r.min, max: r.max, running: false, progress: 1, ms: r.ms, threads: r.threads });
    setBusy(false);
  };
  return (
    <Section title="拔模分析 (Pro)">
      <Row label="脱模方向">
        <Seg value={dir} options={[{ id: "x", label: "X" }, { id: "y", label: "Y" }, { id: "z", label: "Z" }]} onChange={(v) => setDir(v as any)} />
      </Row>
      <div className="flex gap-1 mt-1">
        <button className="btn sm" disabled={busy} onClick={run}>
          {busy ? "分析中…" : "运行分析"}
        </button>
        <button className="btn sm" onClick={() => st.set("analysis", { ...st.analysis, mode: "none", perBody: {} })}>
          关闭
        </button>
      </div>
      <div className="mt-2 text-[11px] grid grid-cols-2 gap-1">
        <Band c="#ef4444" t="倒扣 < -1°" />
        <Band c="#fbbf24" t="临界 ±1°" />
        <Band c="#22c55e" t="可脱模 1–15°" />
        <Band c="#38bdf8" t="> 15°" />
      </div>
      {st.analysis.mode === "draft" && (
        <div className="muted text-[11px] mt-1">
          {st.analysis.threads} 线程并行 · {fmt(st.analysis.ms, 0)} ms
        </div>
      )}
    </Section>
  );
}

const Band = ({ c, t }: { c: string; t: string }) => (
  <div className="flex items-center gap-1">
    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} /> {t}
  </div>
);

export function ThicknessPanel() {
  const st = use3D();
  const app = useApp();
  const [prec, setPrec] = useState<1 | 2 | 3>(1);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!app.pro) return app.notify("壁厚分析属于 Pro 功能", "warn");
    setBusy(true);
    setProgress(0);
    const r = await runThickness(st.build.bodies, prec, app.settings.threads, (p) => setProgress(p));
    st.set("analysis", { mode: "thickness", perBody: r.perBody, min: r.min, max: r.max, running: false, progress: 1, ms: r.ms, threads: r.threads });
    setBusy(false);
  };
  return (
    <Section title="壁厚分析 (Pro)">
      <Row label="精度">
        <Seg value={String(prec) as any} options={[{ id: "1", label: "标准" }, { id: "2", label: "精细" }, { id: "3", label: "超精" }]} onChange={(v) => setPrec(Number(v) as any)} />
      </Row>
      <div className="flex gap-1 mt-1">
        <button className="btn sm" disabled={busy} onClick={run}>
          {busy ? "分析中…" : "运行分析（多线程）"}
        </button>
        <button className="btn sm" onClick={() => st.set("analysis", { ...st.analysis, mode: "none", perBody: {} })}>
          关闭
        </button>
      </div>
      {busy && (
        <div className="mt-2">
          <Progress value={progress} />
        </div>
      )}
      {st.analysis.mode === "thickness" && (
        <div className="mt-2 text-[11px]">
          <div className="h-3 rounded" style={{ background: "linear-gradient(90deg,hsl(259,90%,50%),hsl(200,90%,50%),hsl(120,90%,50%),hsl(60,90%,50%),hsl(0,90%,50%))" }} />
          <div className="flex justify-between muted">
            <span>薄 {fmt(st.analysis.min)}</span>
            <span>厚 {fmt(st.analysis.max)} mm</span>
          </div>
          <div className="muted mt-1">
            {st.analysis.threads} 线程并行 · {fmt(st.analysis.ms, 0)} ms
          </div>
        </div>
      )}
    </Section>
  );
}

export function RenderPanel() {
  const st = use3D();
  const app = useApp();
  const [aperture, setAperture] = useState(0.4);
  const [expo, setExpo] = useState(1);
  return (
    <Section title="渲染（材料 · 环境 · 相机）">
      <Row label="曝光">
        <input type="range" min={0.3} max={2} step={0.05} value={expo} onChange={(e) => setExpo(+e.target.value)} className="w-28" />
      </Row>
      <Row label="景深">
        <input type="range" min={0} max={1} step={0.05} value={aperture} onChange={(e) => setAperture(+e.target.value)} className="w-28" />
      </Row>
      <Row label="柔和阴影">
        <Toggle on={app.settings.shadows} onChange={(v) => app.set("shadows", v)} />
      </Row>
      <div className="flex gap-1 mt-1">
        <button
          className="btn sm"
          onClick={() => {
            const eng = getEngine();
            if (!eng) return;
            eng.renderer.toneMappingExposure = expo;
            const url = eng.screenshot();
            const a = document.createElement("a");
            a.href = url;
            a.download = `${st.name}-render.png`;
            a.click();
            app.notify("效果图已输出 PNG", "ok");
          }}
        >
          输出效果图 PNG
        </button>
      </div>
      <div className="muted text-[11px] mt-1">GPU 实时渲染：WebGL2 · PCF 柔和阴影 · 物理材质</div>
    </Section>
  );
}

export function ExportPanel() {
  const st = use3D();
  const app = useApp();
  const [name, setName] = useState(st.name);
  const bodies = st.build.bodies;
  const geos = bodies.map((b) => b.geometry);
  const names = bodies.map((b) => st.metas[b.id]?.name || b.meta.name);
  const gate = (f: () => void) => (app.pro ? f() : app.notify("该导出格式属于 Pro 功能", "warn"));
  return (
    <Section title="导出">
      <Row label="文件名">
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
      </Row>
      <div className="grid grid-cols-2 gap-1 mt-1">
        <button className="btn sm" onClick={() => gate(() => download(`${name}.stl`, exportSTL(geos, true) as ArrayBuffer))}>
          STL (Pro)
        </button>
        <button className="btn sm" onClick={() => gate(() => download(`${name}.step`, exportSTEP(geos, names), "text/plain"))}>
          STEP (Pro)
        </button>
        <button className="btn sm" onClick={() => download(`${name}.obj`, exportOBJ(geos, names), "text/plain")}>
          OBJ
        </button>
        <button className="btn sm" onClick={() => gate(() => download(`${name}.3mf`, export3MF(geos, names, names.map(() => "#b8c4d0")).slice().buffer as ArrayBuffer))}>
          3MF (Pro)
        </button>
        <button
          className="btn sm"
          onClick={() => {
            const eng = getEngine();
            if (!eng) return;
            const url = eng.screenshot();
            const a = document.createElement("a");
            a.href = url;
            a.download = `${name}.png`;
            a.click();
            app.notify("已导出 PNG", "ok");
          }}
        >
          PNG
        </button>
        <button className="btn sm" onClick={() => download(`${name}.mcad`, JSON.stringify(st.toProject(), null, 1), "application/json")}>
          .mcad 工程
        </button>
      </div>
      <div className="muted text-[11px] mt-2">STEP / STL / 3MF 导出不含参数化历史；要保住可编辑性请存 .mcad。</div>
    </Section>
  );
}

export function PerfPanel() {
  const app = useApp();
  const [res, setRes] = useState<{ single: number; multi: number; threads: number } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="性能 · 多线程 CPU / GPU">
      <Row label="工作线程">
        <Num value={app.settings.threads} onChange={(v) => app.set("threads", Math.max(1, Math.min(64, v)))} w={60} />
        <span className="muted text-[11px]">/ {navigator.hardwareConcurrency || "?"} 逻辑核</span>
      </Row>
      <button
        className="btn sm mt-1"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setRes(await benchmark(app.settings.threads));
          setBusy(false);
        }}
      >
        {busy ? "跑分中…" : "运行线程基准"}
      </button>
      {res && (
        <div className="text-[11.5px] mono mt-1 leading-5">
          <div>单线程 {fmt(res.single, 0)} ms</div>
          <div>
            {res.threads} 线程 {fmt(res.multi, 0)} ms
          </div>
          <div className="accent">加速比 ≈ {fmt((res.single * res.threads) / res.multi, 2)}×</div>
        </div>
      )}
    </Section>
  );
}
