import { useEffect, useRef, useState } from "react";
import Viewport, { getEngine } from "./Viewport";
import { use3D, sampleBracket } from "./store3d";
import { useApp } from "../store";
import { Tool, Modal, Row, Num, Toggle, Seg, Badge, MoreMenu, MenuItem, MenuGroup, IconBtn, Progress } from "../components/ui";
import { Icon } from "../components/icons";
import { COMMANDS, commandById, selectedProfile } from "./commands";
import { buildPreview } from "./preview";
import { TreePanel, BodiesPanel, SectionPanel, DisplayPanel, MeasurePanel, DraftPanel, ThicknessPanel, RenderPanel, ExportPanel, PerfPanel } from "./Panels";
import { addConstraint, addDimension, finishSpline, resetPending, TOOL_HINTS } from "./sketchTools";
import { degreesOfFreedom, solveSketch } from "../cad/sketch";
import { PRINCIPAL_PLANES, uid, type Feature, type PlaneRef } from "../cad/types";
import { parseSTL, parseOBJ, parse3MF, parseIGES, parseXT } from "../io/mesh";
import { parseSTEPParallel, type StepProgress } from "../io/stepParallel";

/* 草图工具轨：绘制 / 曲线编辑 / 关联复制 */
const SKETCH_GROUPS: { title: string; tools: [string, string][] }[] = [
  { title: "绘制", tools: [["select", "选择"], ["line", "直线"], ["polyline", "折线"], ["rect", "矩形"], ["circle", "圆"], ["arc", "圆弧"], ["ellipse", "椭圆"], ["spline", "样条"], ["polygon", "多边形"], ["point", "点"]] },
  { title: "曲线编辑", tools: [["trim", "修剪"], ["extend", "延伸"], ["fillet", "倒圆角"], ["chamfer", "倒角"], ["project", "投影边"], ["eraser", "橡皮擦"]] },
  { title: "关联复制", tools: [["mirror", "镜像"], ["patternLinear", "线性阵列"], ["patternCircular", "圆形阵列"]] },
];

const MODEL_TOOLS: [string, string, string][] = [
  ["sketchNew", "草图", "sketch"],
  ["datum", "基准面", "datum"],
  ["extrude", "拉伸", "extrude"],
  ["revolve", "旋转体", "revolve"],
  ["pushpull", "同步", "pushpull"],
  ["transform", "变换", "transform"],
  ["sweep", "扫掠", "sweep"],
  ["loft", "曲线组", "loft"],
  ["fill", "填充", "surface"],
  ["boolean", "布尔", "boolean"],
  ["fillet", "圆角", "fillet"],
  ["shell", "抽壳", "shell"],
  ["draftFeat", "拔模", "draft"],
  ["more", "更多", "more"],
];

const VIEW_TOOLS: [string, string, string][] = [
  ["tree", "建模树", "tree"],
  ["bodies", "体", "bodies"],
  ["section", "剖切", "section"],
  ["display", "显示", "display"],
  ["measure", "测量", "measure"],
  ["draftA", "拔模", "draftA"],
  ["thick", "壁厚", "thick"],
  ["render", "渲染", "render"],
  ["export", "导出", "export"],
  ["perf", "性能", "perf"],
];

const CONSTRAINTS: [string, string][] = [
  ["horizontal", "水平"],
  ["vertical", "竖直"],
  ["parallel", "平行"],
  ["perpendicular", "垂直"],
  ["tangent", "相切"],
  ["equal", "相等"],
  ["concentric", "同心"],
  ["midpoint", "中点"],
  ["pointOnCurve", "点在线上"],
  ["symmetric", "对称"],
];

export default function Editor3D() {
  const st = use3D();
  const app = useApp();
  const [panel, setPanel] = useState<string | null>("tree");
  const [cmd, setCmd] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, any>>({});
  const [showMore, setShowMore] = useState(false);
  const [planePick, setPlanePick] = useState(false);
  const [dimPrompt, setDimPrompt] = useState<{ type: string; ids: string[] } | null>(null);
  const [dimValue, setDimValue] = useState(10);
  const [sketchCtx, setSketchCtx] = useState({ polygonSides: 6, filletRadius: 5, chamferDist: 3, patternCount: 4, patternDx: 20, patternDy: 0, construction: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ name: string; stage: string; value: number; info: string } | null>(null);
  const activeSketch = st.activeSketch;

  useEffect(() => {
    (window as any).__sketchCtx = sketchCtx;
  }, [sketchCtx]);

  const openCmd = (id: string) => {
    const c = commandById(id);
    if (!c) return;
    const p: Record<string, any> = {};
    for (const f of c.fields) p[f.key] = f.def;
    const prof = selectedProfile();
    if (c.fields.find((f) => f.key === "sketchId")) p.sketchId = prof.sketchId;
    if (c.fields.find((f) => f.key === "pathId")) p.pathId = st.build.sketches[0]?.sketch.id || "";
    if (st.build.bodies.length) {
      if (c.fields.find((f) => f.key === "bodyId")) p.bodyId = st.sel.bodies[0] || st.build.bodies[st.build.bodies.length - 1].id;
      if (c.fields.find((f) => f.key === "target")) p.target = st.sel.bodies[0] || st.build.bodies[0].id;
      if (c.fields.find((f) => f.key === "tool")) p.tool = st.sel.bodies[1] || st.build.bodies[st.build.bodies.length - 1].id;
    }
    setParams(p);
    setCmd(id);
    st.set("hint", c.hint);
  };

  const runCmd = () => {
    const c = cmd ? commandById(cmd) : null;
    if (!c) return;
    const f = c.apply(params);
    if (!f) {
      app.notify("请先按提示选择所需的几何", "warn");
      return;
    }
    (Array.isArray(f) ? f : [f]).forEach((x) => st.addFeature(x as Feature));
    setCmd(null);
    st.set("preview", null);
    app.notify(`${c.title} 完成`, "ok");
  };

  const closeCmd = () => {
    setCmd(null);
    st.set("preview", null);
  };

  /* 实时预览：命令 / 参数 / 选择 变化就重算（节流到下一帧） */
  useEffect(() => {
    if (!cmd || !app.settings.livePreview) {
      st.set("preview", null);
      return;
    }
    const t = setTimeout(() => {
      const pv = buildPreview(cmd, params, Math.max(16, Math.round(24 / Math.max(0.04, app.settings.chordTol))));
      st.set("preview", pv as any);
    }, 40);
    return () => clearTimeout(t);
  }, [cmd, params, st.sel, st.dirty, app.settings.livePreview, app.settings.chordTol]);

  useEffect(() => () => use3D.getState().set("preview", null), []);

  /* 着色模式 / 镶嵌精度变化 → 按新精度重建几何 */
  const firstShade = useRef(true);
  useEffect(() => {
    if (firstShade.current) {
      firstShade.current = false;
      return;
    }
    if (st.features.length) st.rebuild();
  }, [app.settings.chordTol, app.settings.shading]);

  const startSketchOn = (plane: PlaneRef) => {
    st.startSketch(plane);
    setPlanePick(false);
    setTimeout(() => app.settings.autoAlignSketch && getEngine()?.alignToPlane(plane as any), 20);
  };

  /* 快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "z") {
        if (st.activeSketch) st.undoSketch();
        else if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (e.ctrlKey && k === "y") return st.redo();
      if (e.ctrlKey && k === "s") {
        e.preventDefault();
        app.upsertProject(st.toProject());
        app.notify("工程已保存", "ok");
        return;
      }
      if (k === "escape") {
        resetPending();
        if (st.activeSketch) st.set("sketchTool", "select");
        setCmd(null);
        st.clearSel();
      }
      if (k === "f") getEngine()?.fit();
      if (k === "1") getEngine()?.setView("front");
      if (k === "2") getEngine()?.setView("top");
      if (k === "3") getEngine()?.setView("right");
      if (k === "0") getEngine()?.setView("iso");
      if (k === "n" && st.activeSketch) getEngine()?.alignToPlane(st.activeSketch.plane as any);
      if (k === "l" && st.activeSketch) st.set("sketchTool", "line");
      if (k === "c" && st.activeSketch) st.set("sketchTool", "circle");
      if (k === "r" && st.activeSketch) st.set("sketchTool", "rect");
      if (k === "d" && st.activeSketch) openDim();
      if (k === "e" && !st.activeSketch) openCmd("extrude");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [st, app]);

  /* 导入（STEP 走多线程并行管线） */
  const onFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    try {
      const buf = await file.arrayBuffer();
      if (ext === "mcad") {
        st.loadProject(JSON.parse(new TextDecoder().decode(buf)));
        app.notify("工程已打开（含完整特征历史）", "ok");
        return;
      }
      let meshes: { positions: Float32Array; name: string }[] = [];
      if (ext === "step" || ext === "stp") {
        const text = new TextDecoder().decode(buf);
        setImporting({ name: file.name, stage: "扫描实体表", value: 0, info: `${(buf.byteLength / 1048576).toFixed(1)} MB · ${app.settings.threads} 线程` });
        try {
          const r = await parseSTEPParallel(text, app.settings.threads, (p: StepProgress) =>
            setImporting((s) => (s ? { ...s, stage: { scan: "并行扫描实体表", topology: "装配面环拓扑", tessellate: "并行三角化", done: "完成" }[p.stage], value: p.value, info: p.detail || s.info } : s)),
          );
          meshes = r.meshes;
          app.notify(`${file.name}：${r.entities} 实体 / ${r.faces} 面，${r.threads} 线程并行 ${(r.ms / 1000).toFixed(1)} s`, "ok");
        } finally {
          setImporting(null);
        }
      } else if (ext === "stl") meshes = parseSTL(buf, file.name);
      else if (ext === "obj") meshes = parseOBJ(new TextDecoder().decode(buf), file.name);
      else if (ext === "3mf") meshes = parse3MF(buf);
      else if (ext === "iges" || ext === "igs") {
        const r = parseIGES(new TextDecoder().decode(buf));
        app.notify(`IGES 已解析 ${r.lines.length / 6} 条曲线（本版本仅支持线框导入）`, "info");
        return;
      } else if (ext === "x_t" || ext === "x_b") parseXT(buf);
      else throw new Error(`3D 编辑器不支持 .${ext}`);
      for (const m of meshes)
        st.addFeature({ id: uid("f"), type: "import", name: m.name, source: file.name, positions: Array.from(m.positions), indices: [] } as Feature);
      setTimeout(() => getEngine()?.fit(), 60);
      app.notify(`${file.name} 已导入`, "ok");
    } catch (err) {
      app.notify(String((err as Error).message), "err");
    }
  };

  const openDim = () => {
    if (!activeSketch || !st.sketchSel.length) return app.notify("先选择要标注的对象", "warn");
    const ent = activeSketch.entities.find((e) => e.id === st.sketchSel[0]);
    const type = ent?.kind === "circle" || ent?.kind === "arc" ? "diameter" : st.sketchSel.length > 1 ? "angle" : "length";
    setDimPrompt({ type, ids: st.sketchSel.slice(0, 2) });
    setDimValue(type === "diameter" ? Math.round((ent?.r || 5) * 2 * 100) / 100 : type === "angle" ? 90 : 20);
  };

  const prof = selectedProfile();

  return (
    <div className="w-full h-full flex flex-col" style={{ background: "var(--bg)" }}>
      {/* 顶栏：只保留最常用的，其余全部收进右上角 ⋮ */}
      <div className="flex items-center gap-2 px-2 py-1 border-b hairline" style={{ background: "var(--panel)" }}>
        <input className="inp" style={{ width: 180 }} value={st.name} onChange={(e) => st.set("name", e.target.value)} />
        <IconBtn icon="undo" title="撤销 Ctrl+Z" onClick={() => (activeSketch ? st.undoSketch() : st.undo())} />
        <IconBtn icon="redo" title="重做 Ctrl+Shift+Z" onClick={st.redo} />
        <IconBtn icon="fit" title="全图 F" onClick={() => getEngine()?.fit()} />
        <IconBtn icon="save" title="保存 Ctrl+S" onClick={() => { app.upsertProject(st.toProject()); app.notify("工程已保存到最近文件", "ok"); }} />

        {/* 显示过滤器 */}
        <div className="flex items-center gap-1 pl-2 border-l hairline">
          <span className="text-[10px] muted">显示</span>
          <button className={"chip " + (st.showSolid ? "on" : "off")} onClick={() => st.set("showSolid", !st.showSolid)}>实体</button>
          <button className={"chip " + (st.showSheet ? "on" : "off")} onClick={() => st.set("showSheet", !st.showSheet)}>片体</button>
          <button className="chip" onClick={() => st.set("showSketch", ((st.showSketch + 1) % 3) as 0 | 1 | 2)}>
            草图 {["显示", "透视", "隐藏"][st.showSketch]}
          </button>
          <button className={"chip " + (st.showDatum ? "on" : "off")} onClick={() => st.set("showDatum", !st.showDatum)}>基准面</button>
        </div>

        {/* 选择过滤器 */}
        <div className="flex items-center gap-1 pl-2 border-l hairline">
          <span className="text-[10px] muted">选择</span>
          <button className={"chip " + (st.filterBody ? "on" : "off")} onClick={() => st.set("filterBody", !st.filterBody)}>体</button>
          <button className={"chip " + (st.filterFace ? "on" : "off")} onClick={() => st.set("filterFace", !st.filterFace)}>面</button>
          <button className={"chip " + (st.filterEdge ? "on" : "off")} onClick={() => st.set("filterEdge", !st.filterEdge)}>边</button>
          <button className={"chip " + (st.filterSketch ? "on" : "off")} onClick={() => st.set("filterSketch", !st.filterSketch)}>草图</button>
          <button
            className="chip"
            title="只拾取草图与面：选截面时最好用"
            onClick={() => {
              st.set("filterBody", false);
              st.set("filterEdge", false);
              st.set("filterFace", true);
              st.set("filterSketch", true);
              app.notify("已切到「只拾取草图与面」", "ok");
            }}
          >
            只拾取草图与面
          </button>
        </div>

        {/* 曲线规则 */}
        <div className="flex items-center gap-1 pl-2 border-l hairline" title="截面怎么选：在视口里点整张草图或单条曲线，Shift 多选">
          <span className="text-[10px] muted">曲线</span>
          {([["single", "单条"], ["connected", "相连"], ["tangent", "相切"], ["whole", "整张"]] as const).map(([id, l]) => (
            <button key={id} className={"chip " + (st.curveRule === id ? "on" : "")} onClick={() => st.set("curveRule", id)}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <span className="text-[11px] muted truncate max-w-[220px]">
          {activeSketch ? `${activeSketch.name} · ${activeSketch.plane.name} · 自由度 ${degreesOfFreedom(activeSketch)}` : `截面：${prof.label}`}
        </span>
        {st.build.errors.length > 0 && <Badge tone="warn">{st.build.errors.length} 个特征报错</Badge>}
        <button className="btn sm" onClick={() => app.setPage("drawing")}>
          <Icon name="drawingSheet" size={15} /> 出工程图
        </button>

        {/* ⋮ 更多菜单：所有工具与开关都在这里 */}
        <MoreMenu width={330}>
          <MenuGroup title="文件">
            <MenuItem icon="importIcon" label="导入模型" hint="STEP / STL / OBJ / 3MF / IGES / MCAD" onClick={() => fileRef.current?.click()} />
            <MenuItem icon="save" label="保存工程 (.mcad)" hint="保留完整参数化特征历史" onClick={() => { app.upsertProject(st.toProject()); app.notify("工程已保存", "ok"); }} />
            <MenuItem icon="cube" label="载入支座示例" onClick={() => sampleBracketLoad()} />
            <MenuItem icon="export" label="导出面板" onClick={() => setPanel("export")} />
          </MenuGroup>

          <MenuGroup title="实时预览">
            <div className="px-2 py-1">
              <Row label="半透明实时预览"><Toggle on={app.settings.livePreview} onChange={(v) => app.set("livePreview", v)} /></Row>
              <Row label="三维箭头与读数"><Toggle on={app.settings.previewArrows} onChange={(v) => app.set("previewArrows", v)} /></Row>
            </div>
          </MenuGroup>

          <MenuGroup title="着色与镶嵌">
            <div className="px-2 py-1">
              <Row label="着色模式">
                <Seg value={app.settings.shading} options={[{ id: "flat", label: "平面 Flat" }, { id: "smooth", label: "平滑 Gouraud" }]} onChange={(v) => app.set("shading", v as any)} />
              </Row>
              <Row label="镶嵌公差">
                <input type="range" min={0.01} max={0.6} step={0.01} value={app.settings.chordTol} onChange={(e) => app.set("chordTol", +e.target.value)} className="w-24" />
                <span className="text-[10.5px] muted mono">{app.settings.chordTol.toFixed(2)}</span>
              </Row>
            </div>
          </MenuGroup>

          <MenuGroup title="基准面样式">
            <div className="px-2 py-1">
              <Seg
                value={app.settings.datumStyle}
                options={[{ id: "dashed", label: "细虚线框" }, { id: "grid", label: "内部网格" }, { id: "filled", label: "填充平面" }]}
                onChange={(v) => app.set("datumStyle", v as any)}
              />
            </div>
          </MenuGroup>

          <MenuGroup title="界面模式">
            <div className="px-2 py-1">
              <Seg value={st.uiMode} options={[{ id: "full", label: "全能建模" }, { id: "view", label: "看图" }, { id: "easy", label: "简易建模" }]} onChange={(v) => st.set("uiMode", v)} />
            </div>
          </MenuGroup>

          <MenuGroup title="草图与捕捉">
            <div className="px-2 py-1">
              <Row label="对象捕捉"><Toggle on={app.settings.objectSnap} onChange={(v) => app.set("objectSnap", v)} /></Row>
              <Row label="捕捉范围"><input type="range" min={4} max={30} value={app.settings.snapRange} onChange={(e) => app.set("snapRange", +e.target.value)} className="w-24" /><span className="text-[10.5px] muted">{app.settings.snapRange}px</span></Row>
              <Row label="连续绘制"><Toggle on={app.settings.continuousDraw} onChange={(v) => app.set("continuousDraw", v)} /></Row>
              <Row label="进草图自动摆正"><Toggle on={app.settings.autoAlignSketch} onChange={(v) => app.set("autoAlignSketch", v)} /></Row>
              <Row label="网格吸附"><Toggle on={app.settings.gridSnap} onChange={(v) => app.set("gridSnap", v)} /></Row>
              <Row label="网格步长"><Num value={app.settings.gridStep} onChange={(v) => app.set("gridStep", v)} w={56} suffix="mm" /></Row>
            </div>
          </MenuGroup>

          <MenuGroup title="图标与线条">
            <div className="px-2 py-1">
              <Row label="图标线宽">
                <input type="range" min={1} max={2.5} step={0.1} value={app.settings.iconStroke} onChange={(e) => app.set("iconStroke", +e.target.value)} className="w-24" />
                <span className="text-[10.5px] muted mono">{app.settings.iconStroke.toFixed(1)}px</span>
              </Row>
              <Row label="图标大小">
                <input type="range" min={14} max={26} value={app.settings.iconSize} onChange={(e) => app.set("iconSize", +e.target.value)} className="w-24" />
                <span className="text-[10.5px] muted mono">{app.settings.iconSize}</span>
              </Row>
              <Row label="图标下方小字"><Toggle on={app.settings.showIconLabel} onChange={(v) => app.set("showIconLabel", v)} /></Row>
            </div>
          </MenuGroup>

          <MenuGroup title="标准视图">
            <div className="flex gap-1 flex-wrap px-2 py-1">
              {[["front", "主视"], ["back", "后视"], ["top", "俯视"], ["bottom", "仰视"], ["left", "左视"], ["right", "右视"], ["iso", "轴测"]].map(([v, l]) => (
                <button key={v} className="chip" onClick={() => getEngine()?.setView(v)}>{l}</button>
              ))}
              <button className="chip" onClick={() => getEngine()?.fit()}>全图 F</button>
            </div>
          </MenuGroup>

          <MenuGroup title="更多">
            <MenuItem icon="settings" label="打开完整设置" onClick={() => app.setPage("settings")} />
            <MenuItem icon="help" label="操作详解教程" onClick={() => app.setPage("tutorials")} />
          </MenuGroup>
        </MoreMenu>

        <input
          ref={fileRef}
          type="file"
          accept=".stl,.obj,.3mf,.step,.stp,.iges,.igs,.x_t,.x_b,.mcad"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex-1 flex min-h-0">
        {/* 左命令轨 */}
        {st.uiMode !== "view" && (
          <div className="w-[64px] shrink-0 border-r hairline overflow-auto" style={{ background: "var(--panel)" }}>
            {activeSketch
              ? SKETCH_GROUPS.map((g) => (
                  <div key={g.title}>
                    <div className="text-[9.5px] muted text-center py-[3px] border-b hairline">{g.title}</div>
                    {g.tools.map(([id, label]) => (
                      <Tool key={id} icon={id} label={label} on={st.sketchTool === id} onClick={() => st.set("sketchTool", id)} title={TOOL_HINTS[id]} />
                    ))}
                  </div>
                ))
              : MODEL_TOOLS.filter((t) => st.uiMode === "full" || ["sketchNew", "extrude", "pushpull", "shell", "fillet", "boolean"].includes(t[0])).map(([id, label, icon]) => (
                  <Tool
                    key={id}
                    icon={icon}
                    label={label}
                    on={cmd === id}
                    onClick={() => {
                      if (id === "sketchNew") setPlanePick(true);
                      else if (id === "more") setShowMore(true);
                      else openCmd(id);
                    }}
                  />
                ))}
          </div>
        )}

        {/* 视口 */}
        <div className="flex-1 relative min-w-0">
          <Viewport />
          <div className="absolute top-2 left-2 flex gap-1">
            <IconBtn icon="fit" title="全图 F" onClick={() => getEngine()?.fit()} />
            {[["front", "主视"], ["top", "俯视"], ["right", "侧视"], ["iso", "轴测"]].map(([v, l]) => (
              <button key={v} className="btn sm" onClick={() => getEngine()?.setView(v)}>
                {l}
              </button>
            ))}
            {activeSketch && (
              <button className="btn sm active" title="摆正到草图平面 N" onClick={() => getEngine()?.alignToPlane(activeSketch.plane as any)}>
                <Icon name="datum" size={14} /> 正视草图面
              </button>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 px-3 py-1 text-[11px] flex items-center gap-3" style={{ background: "linear-gradient(0deg,rgba(0,0,0,.6),transparent)" }}>
            <span className="accent">{activeSketch ? TOOL_HINTS[st.sketchTool] || "选择草图工具" : st.hint}</span>
            <span className="muted">左键旋转 · 右键平移 · 滚轮缩放 · 双击魔方全图</span>
          </div>

          {/* 草图底部操作条 */}
          {activeSketch && (
            <div className="absolute bottom-7 left-1/2 -translate-x-1/2 panel rounded-lg px-2 py-1 flex items-center gap-1 flex-wrap max-w-[94%]" style={{ opacity: app.settings.panelOpacity }}>
              <button className={"chip " + (sketchCtx.construction ? "on" : "")} onClick={() => setSketchCtx({ ...sketchCtx, construction: !sketchCtx.construction })} title="构造几何：只用来定位，不参与成形">
                <Icon name="construction" size={13} /> 构造线
              </button>
              <Num value={sketchCtx.polygonSides} onChange={(v) => setSketchCtx({ ...sketchCtx, polygonSides: v })} w={44} suffix="边" />
              <Num value={sketchCtx.filletRadius} onChange={(v) => setSketchCtx({ ...sketchCtx, filletRadius: v })} w={44} suffix="R" />
              <Num value={sketchCtx.patternCount} onChange={(v) => setSketchCtx({ ...sketchCtx, patternCount: v })} w={40} suffix="×" />
              <span className="w-px h-4" style={{ background: "var(--line)" }} />
              {CONSTRAINTS.map(([c, l]) => (
                <button
                  key={c}
                  className="chip"
                  disabled={!st.sketchSel.length}
                  onClick={() => {
                    const sk = JSON.parse(JSON.stringify(activeSketch));
                    st.pushSketchUndo();
                    addConstraint(sk, c, st.sketchSel);
                    st.setSketch(sk);
                    app.notify(`已添加约束：${l}`, "ok");
                  }}
                >
                  {l}
                </button>
              ))}
              <span className="w-px h-4" style={{ background: "var(--line)" }} />
              <button className="chip on" onClick={openDim} title="标注尺寸 D：数值驱动几何">
                <Icon name="dimension" size={13} /> 尺寸
              </button>
              <button className="chip" onClick={() => { const sk = JSON.parse(JSON.stringify(activeSketch)); if (finishSpline(sk, { ...sketchCtx, selection: [] } as any)) st.setSketch(sk); }}>收笔</button>
              <IconBtn icon="undo" title="草图单步撤销" onClick={st.undoSketch} />
              <span className="w-px h-4" style={{ background: "var(--line)" }} />
              <button className="btn sm primary" onClick={() => { st.commitSketch(); app.notify("草图已完成", "ok"); }}>
                <Icon name="check" size={14} /> 完成
              </button>
              <button className="btn sm" onClick={st.cancelSketch}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </div>

        {/* 右侧面板 */}
        {(panel || activeSketch) && (
          <div className="w-[300px] shrink-0 border-l hairline overflow-auto" style={{ background: "var(--panel)" }}>
            {activeSketch ? (
              <SketchPanel />
            ) : (
              <>
                <div className="flex items-center justify-between px-2 py-1 border-b hairline">
                  <span className="text-[12px] font-semibold">{VIEW_TOOLS.find((v) => v[0] === panel)?.[1]}</span>
                  <IconBtn icon="close" onClick={() => setPanel(null)} />
                </div>
                {panel === "tree" && <TreePanel />}
                {panel === "bodies" && <BodiesPanel />}
                {panel === "section" && <SectionPanel />}
                {panel === "display" && <DisplayPanel />}
                {panel === "measure" && <MeasurePanel />}
                {panel === "draftA" && <DraftPanel />}
                {panel === "thick" && <ThicknessPanel />}
                {panel === "render" && <RenderPanel />}
                {panel === "export" && <ExportPanel />}
                {panel === "perf" && <PerfPanel />}
              </>
            )}
          </div>
        )}

        {/* 右功能轨 */}
        <div className="w-[64px] shrink-0 border-l hairline overflow-auto" style={{ background: "var(--panel)" }}>
          {VIEW_TOOLS.map(([id, label, icon]) => (
            <Tool key={id} icon={icon} label={label} on={panel === id} onClick={() => setPanel(panel === id ? null : id)} />
          ))}
        </div>
      </div>

      {/* 命令参数卡 */}
      {cmd && (
        <div className="absolute left-[72px] top-[62px] w-[296px] card p-2 z-30 fade" style={{ opacity: app.settings.panelOpacity }}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[12.5px] font-semibold flex items-center gap-1">
              <Icon name={cmd} size={16} /> {commandById(cmd)?.title}
            </div>
            <IconBtn icon="close" onClick={closeCmd} />
          </div>
          <div className="text-[11px] muted mb-1">{commandById(cmd)?.hint}</div>
          {(cmd === "extrude" || cmd === "revolve") && (
            <div className="panel2 rounded px-2 py-1 mb-1 text-[11px] flex items-center justify-between">
              <span>视口选择：{prof.label}</span>
              <button className="chip" onClick={() => st.clearSel()}>清空</button>
            </div>
          )}
          {commandById(cmd)!.fields.filter((f) => !f.when || f.when(params)).map((f) => (
            <Row key={f.key} label={f.label} hint={f.hint}>
              {f.type === "num" && <Num value={params[f.key] ?? f.def} step={f.step} onChange={(v) => setParams({ ...params, [f.key]: v })} />}
              {f.type === "bool" && <Toggle on={!!params[f.key]} onChange={(v) => setParams({ ...params, [f.key]: v })} />}
              {f.type === "select" && (
                <select className="inp" value={params[f.key]} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                  {f.options!.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              )}
              {f.type === "sketch" && (
                <select className="inp" value={params[f.key]} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                  <option value="">— 选择草图 —</option>
                  {st.build.sketches.map((s) => (
                    <option key={s.sketch.id} value={s.sketch.id}>{s.sketch.name}</option>
                  ))}
                </select>
              )}
              {f.type === "sketches" && (
                <select className="inp" multiple size={3} value={params[f.key] || []} onChange={(e) => setParams({ ...params, [f.key]: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                  {st.build.sketches.map((s) => (
                    <option key={s.sketch.id} value={s.sketch.id}>{s.sketch.name}</option>
                  ))}
                </select>
              )}
              {f.type === "body" && (
                <select className="inp" value={params[f.key]} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                  <option value="">— 选择实体 —</option>
                  {st.build.bodies.map((b) => (
                    <option key={b.id} value={b.id}>{st.metas[b.id]?.name || b.meta.name}</option>
                  ))}
                </select>
              )}
              {f.type === "bodies" && (
                <span className="text-[11px]">
                  {st.sel.bodies.length ? (
                    <span className="accent">视口已选 {st.sel.bodies.length} 个</span>
                  ) : (
                    <select className="inp" value={params[f.key]} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                      <option value="">— 视口点选或在此选择 —</option>
                      {st.build.bodies.map((b) => (
                        <option key={b.id} value={b.id}>{st.metas[b.id]?.name || b.meta.name}</option>
                      ))}
                    </select>
                  )}
                </span>
              )}
            </Row>
          ))}
          {cmd === "transform" && (
            <div className="panel2 rounded px-2 py-1 text-[10.5px] muted mt-1">
              在视口里点实体（或在建模树里点特征）即可选中，<b>Shift 多选</b>；选中的会高亮发光，待生成的副本显示为线框虚影。
              {st.sel.bodies.length > 0 && (
                <button className="chip ml-1" onClick={() => st.clearSel()}>清空选择</button>
              )}
            </div>
          )}
          {cmd === "fillet" && <div className="text-[11px] muted">已选边：{st.sel.edges.length} 条</div>}
          {cmd === "pushpull" && <div className="text-[11px] muted">已选面：{st.sel.faces.length} 张</div>}
          <div className="flex gap-1 mt-2">
            <button className="btn sm primary flex-1" onClick={runCmd}>确定</button>
            <button className="btn sm" onClick={closeCmd}>取消</button>
          </div>
        </div>
      )}

      {/* 选择草图基准平面 */}
      {planePick && (
        <Modal title="草图 · 选择基准平面" onClose={() => setPlanePick(false)} width={470}>
          <div className="text-[12px] muted mb-2">选择主平面、已建的基准面，或先在视口点选模型上的一张平面。进入草图后视角会自动摆正到垂直于该平面。</div>
          <div className="grid grid-cols-3 gap-2">
            {(["XY", "XZ", "YZ"] as const).map((p) => (
              <button key={p} className="btn justify-center" onClick={() => startSketchOn(PRINCIPAL_PLANES[p])}>
                <Icon name="datum" size={16} /> {p} 平面
              </button>
            ))}
          </div>
          {st.build.datums.length > 0 && (
            <>
              <div className="text-[11.5px] muted mt-3 mb-1">自建基准面</div>
              <div className="grid grid-cols-3 gap-2">
                {st.build.datums.map((d, i) => (
                  <button key={i} className="btn justify-center" onClick={() => startSketchOn(d)}>
                    <Icon name="datum" size={16} /> {d.name}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              className="btn"
              disabled={!st.sel.faces.length}
              onClick={() => {
                const f = st.sel.faces[0];
                const body = st.build.bodies.find((b) => b.id === f.bodyId);
                if (!body) return;
                import("./Viewport").then(({ getFaces }) => {
                  const face = getFaces(body.geometry)[f.faceId];
                  if (!face) return;
                  const n = face.normal;
                  const up = Math.abs(n.z) > 0.9 ? [1, 0, 0] : [0, 0, 1];
                  const xv = [up[1] * n.z - up[2] * n.y, up[2] * n.x - up[0] * n.z, up[0] * n.y - up[1] * n.x];
                  const xl = Math.hypot(xv[0], xv[1], xv[2]) || 1;
                  const x: [number, number, number] = [xv[0] / xl, xv[1] / xl, xv[2] / xl];
                  const y: [number, number, number] = [n.y * x[2] - n.z * x[1], n.z * x[0] - n.x * x[2], n.x * x[1] - n.y * x[0]];
                  startSketchOn({ name: "面草图", origin: [face.centroid.x, face.centroid.y, face.centroid.z], xdir: x, ydir: y });
                });
              }}
            >
              在选中面上（原点落在面中心）
            </button>
            <button
              className="btn"
              onClick={() => {
                st.set("command", { type: "pickPlane", params: {} });
                st.set("filterFace", true);
                st.set("hint", "在视口中点选一张平面或基准面来创建草图");
                setPlanePick(false);
              }}
            >
              到视口里点选平面
            </button>
          </div>
        </Modal>
      )}

      {/* 更多命令 */}
      {showMore && (
        <Modal title="更多命令" onClose={() => setShowMore(false)} width={580}>
          <div className="grid grid-cols-3 gap-2">
            {COMMANDS.map((c) => (
              <button key={c.id} className="btn justify-start" onClick={() => { setShowMore(false); openCmd(c.id); }}>
                <Icon name={c.id} size={16} /> {c.title}
              </button>
            ))}
          </div>
          <div className="text-[11px] muted mt-3">拆分体 / 修剪体 / 优化体 / 刻字 / 包容体 通过「基本体 + 布尔 + 变换」组合完成，参数卡内已含对应选项。</div>
        </Modal>
      )}

      {/* 建模参数卡：建模树双击特征后在这里编辑 */}
      {st.editFeatureId && !cmd && <FeatureCard id={st.editFeatureId} />}

      {/* 大型 STEP 并行导入进度 */}
      {importing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,.55)" }}>
          <div className="card p-4 fade" style={{ width: 420 }}>
            <div className="text-[13px] font-semibold flex items-center gap-2">
              <Icon name="importIcon" size={16} /> 正在导入 {importing.name}
            </div>
            <div className="text-[11.5px] muted mt-1">
              {importing.stage} · {importing.info}
            </div>
            <div className="mt-2">
              <Progress value={importing.value} />
            </div>
            <div className="text-[11px] muted mt-2">
              大型总装采用并行管线：分块扫描实体表 → 装配面环拓扑 → 多线程三角化，全程后台线程运行，界面不卡。
            </div>
          </div>
        </div>
      )}

      {/* 尺寸输入（参数化驱动） */}
      {dimPrompt && (
        <Modal title="标注尺寸 · 数值驱动几何" onClose={() => setDimPrompt(null)} width={360}>
          <Row label="类型">
            <Seg
              value={dimPrompt.type}
              options={[{ id: "length", label: "长度" }, { id: "distX", label: "水平" }, { id: "distY", label: "竖直" }, { id: "radius", label: "半径" }, { id: "diameter", label: "直径" }, { id: "angle", label: "角度" }]}
              onChange={(v) => setDimPrompt({ ...dimPrompt, type: v })}
            />
          </Row>
          <Row label="数值"><Num value={dimValue} onChange={setDimValue} step={0.5} /></Row>
          <div className="text-[11px] muted mt-1">尺寸会加入草图的约束系统：改数值 → 求解器重算 → 下游特征全部重建。</div>
          <div className="flex gap-1 mt-2">
            <button
              className="btn primary"
              onClick={() => {
                if (!activeSketch) return;
                const sk = JSON.parse(JSON.stringify(activeSketch));
                st.pushSketchUndo();
                addDimension(sk, dimPrompt.type, dimPrompt.ids, dimValue, { x: 8, y: 8 });
                st.setSketch(sk);
                setDimPrompt(null);
                app.notify("尺寸已驱动几何更新", "ok");
              }}
            >
              应用
            </button>
            <button className="btn" onClick={() => setDimPrompt(null)}>取消</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 建模参数卡：建模树双击后在左侧编辑已有特征 ---------------- */
function FeatureCard({ id }: { id: string }) {
  const st = use3D();
  const app = useApp();
  const f = st.features.find((x) => x.id === id) as any;
  if (!f) return null;
  const fields = FEATURE_FIELDS[f.type] || [];
  const set = (k: string, v: any) => st.updateFeature(id, { [k]: v } as Partial<Feature>);
  const close = () => {
    st.set("editFeatureId", null);
    st.set("preview", null);
  };
  return (
    <div className="absolute left-[72px] top-[62px] w-[296px] card p-2 z-30 fade" style={{ opacity: app.settings.panelOpacity }}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[12.5px] font-semibold flex items-center gap-1">
          <Icon name={featureIcon(f.type)} size={16} /> 编辑 · {f.name}
        </div>
        <IconBtn icon="close" onClick={close} />
      </div>
      <div className="text-[11px] muted mb-1">改数值 → 该特征重算 → 下游特征全部重建</div>
      <Row label="名称">
        <input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} />
      </Row>
      {fields.map((fl) => {
        const val = f[fl.key];
        return (
          <Row key={fl.key} label={fl.label}>
            {fl.type === "num" && <Num value={typeof val === "number" ? val : 0} step={fl.step} onChange={(v) => set(fl.key, v)} />}
            {fl.type === "bool" && <Toggle on={!!val} onChange={(v) => set(fl.key, v)} />}
            {fl.type === "select" && (
              <select className="inp" value={val ?? fl.options![0][0]} onChange={(e) => set(fl.key, e.target.value)}>
                {fl.options!.map(([oid, l]) => (
                  <option key={oid} value={oid}>{l}</option>
                ))}
              </select>
            )}
          </Row>
        );
      })}
      {(f.type === "extrude" || f.type === "revolve") && (
        <div className="panel2 rounded px-2 py-1 text-[10.5px] mt-1">
          截面：{f.curveIds?.length ? `${f.curveIds.length} 条曲线` : "整张草图"}
          <button
            className="chip ml-1"
            onClick={() => {
              st.updateFeature(id, { curveIds: st.sel.curves, sketchId: st.sel.sketches[0] || f.sketchId } as Partial<Feature>);
              app.notify("已用当前视口选择替换截面", "ok");
            }}
          >
            用当前选择替换
          </button>
        </div>
      )}
      <div className="flex gap-1 mt-2">
        <button className="btn sm primary flex-1" onClick={close}>完成</button>
        <button className="btn sm" onClick={() => { st.removeFeature(id); close(); }}>删除特征</button>
      </div>
    </div>
  );
}

const FEATURE_FIELDS: Record<string, { key: string; label: string; type: "num" | "bool" | "select"; step?: number; options?: [string, string][] }[]> = {
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
  pushpull: [{ key: "distance", label: "距离", type: "num", step: 0.5 }],
  datum: [
    { key: "offset", label: "偏置距离", type: "num" },
    { key: "angle", label: "角度 °", type: "num" },
    { key: "base", label: "基准", type: "select", options: [["XY", "XY"], ["XZ", "XZ"], ["YZ", "YZ"]] },
  ],
  boolean: [{ key: "op", label: "运算", type: "select", options: [["union", "并集"], ["subtract", "差集"], ["intersect", "交集"]] }],
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
};

const featureIcon = (t: string) =>
  ({ extrude: "extrude", revolve: "revolve", fillet: "fillet", shell: "shell", draftFeat: "draft", transform: "transform", datum: "datum", boolean: "boolean", pushpull: "pushpull", thicken: "thicken" })[t] || "primitive";

/* ---------------- 草图参数面板：几何 / 约束 / 尺寸（可直接改数值） ---------------- */
function SketchPanel() {
  const st = use3D();
  const sk = st.activeSketch!;
  const app = useApp();
  const update = (fn: (s: any) => void) => {
    const copy = JSON.parse(JSON.stringify(sk));
    fn(copy);
    solveSketch(copy);
    st.setSketch(copy);
  };
  return (
    <div className="text-[12px]">
      <div className="flex items-center justify-between px-2 py-1 border-b hairline">
        <span className="text-[12px] font-semibold flex items-center gap-1">
          <Icon name="sketch" size={15} /> {sk.name}
        </span>
        <Badge tone={degreesOfFreedom(sk) === 0 ? "ok" : "muted"}>自由度 {degreesOfFreedom(sk)}</Badge>
      </div>

      <div className="px-2 py-1 border-b hairline">
        <Row label="草图名称">
          <input className="inp" value={sk.name} onChange={(e) => update((s) => (s.name = e.target.value))} />
        </Row>
        <Row label="基准平面">
          <span className="text-[11.5px] mono">{sk.plane.name}</span>
          <button className="chip" onClick={() => getEngine()?.alignToPlane(sk.plane as any)}>摆正视角</button>
        </Row>
      </div>

      <div className="border-b hairline">
        <div className="px-2 py-1 text-[11.5px] font-semibold">尺寸（参数化）· {sk.dims.length}</div>
        <div className="px-2 pb-2">
          {sk.dims.map((d) => (
            <div key={d.id} className="flex items-center gap-1 py-[2px]">
              <Icon name="dimension" size={13} />
              <span className="text-[11px] muted w-[52px]">{dimLabel(d.type)}</span>
              <Num
                value={d.value}
                step={0.5}
                w={70}
                onChange={(v) =>
                  update((s) => {
                    const t = s.dims.find((x: any) => x.id === d.id);
                    if (t) t.value = v;
                  })
                }
              />
              <button className="btn sm" onClick={() => update((s) => (s.dims = s.dims.filter((x: any) => x.id !== d.id)))}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          {!sk.dims.length && <div className="muted text-[11px]">还没有尺寸。选中曲线后点底部「尺寸」（快捷键 D）。</div>}
        </div>
      </div>

      <div className="border-b hairline">
        <div className="px-2 py-1 text-[11.5px] font-semibold">约束 · {sk.constraints.length}</div>
        <div className="px-2 pb-2 flex flex-wrap gap-1">
          {sk.constraints.map((c) => (
            <button
              key={c.id}
              className="chip on"
              title="点击删除该约束"
              onClick={() => update((s) => (s.constraints = s.constraints.filter((x: any) => x.id !== c.id)))}
            >
              {CONSTRAINTS.find((x) => x[0] === c.type)?.[1] || c.type} ✕
            </button>
          ))}
          {!sk.constraints.length && <div className="muted text-[11px]">还没有约束。选中曲线后在底部一键添加。</div>}
        </div>
      </div>

      <div>
        <div className="px-2 py-1 text-[11.5px] font-semibold">几何 · {sk.entities.length}</div>
        <div className="px-2 pb-3 max-h-[240px] overflow-auto">
          {sk.entities.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-1 py-[2px] cursor-pointer rounded px-1"
              style={{ background: st.sketchSel.includes(e.id) ? "color-mix(in srgb,var(--accent) 18%,transparent)" : undefined }}
              onClick={() => st.set("sketchSel", [e.id])}
            >
              <Icon name={e.kind === "line" ? "line" : e.kind} size={13} />
              <span className="flex-1 truncate text-[11px]">
                {kindLabel(e.kind)}
                {e.construction && " · 构造"}
                {e.projected && " · 投影"}
                {e.src && " · 关联副本"}
              </span>
              <button
                className="btn sm"
                onClick={(ev) => {
                  ev.stopPropagation();
                  st.pushSketchUndo();
                  update((s) => (s.entities = s.entities.filter((x: any) => x.id !== e.id && x.src !== e.id)));
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="p-2 flex gap-1">
        <button className="btn sm primary flex-1" onClick={() => { st.commitSketch(); app.notify("草图已完成", "ok"); }}>
          <Icon name="check" size={14} /> 完成草图
        </button>
        <button className="btn sm" onClick={st.cancelSketch}>取消</button>
      </div>
    </div>
  );
}

const dimLabel = (t: string) =>
  ({ length: "长度", radius: "半径", diameter: "直径", angle: "角度", distX: "水平", distY: "竖直", distance: "距离" })[t] || t;

const kindLabel = (k: string) =>
  ({ line: "直线", circle: "圆", arc: "圆弧", ellipse: "椭圆", spline: "样条", polygon: "多边形", rect: "矩形", point: "点" })[k] || k;

export function sampleBracketLoad() {
  const st = use3D.getState();
  st.reset("支座示例");
  st.set("features", sampleBracket());
  st.rebuild();
  setTimeout(() => getEngine()?.fit(), 80);
}
