import { useState } from "react";
import { useApp, DEFAULT_COLORS, DEFAULT_COLORS_LIGHT, download, useColors, usePreviewColors } from "../store";
import { LANGS } from "../i18n";
import { Row, Num, Toggle, Seg, Section, Color, Badge } from "../components/ui";
import { Icon } from "../components/icons";
import { cpuThreads, gpuInfo } from "../workers/pool";
import { benchmark } from "../editor3d/analysis";

const SHORTCUTS: [string, string][] = [
  ["Ctrl + Z / Ctrl + Shift + Z", "撤销 / 重做"],
  ["Ctrl + S", "保存工程"],
  ["Esc", "取消当前命令 / 清空选择"],
  ["F", "全图显示"],
  ["1 / 2 / 3 / 0", "主视 / 俯视 / 侧视 / 轴测"],
  ["E", "拉伸"],
  ["L / C / R（草图内）", "直线 / 圆 / 矩形"],
  ["Delete", "删除选中"],
  ["左键拖动", "旋转视角"],
  ["右键拖动", "平移"],
  ["滚轮", "以指针为锚缩放"],
  ["Shift + 左键", "加选 / 减选"],
];

/** 19 项视口配色的中文名称 */
const COLOR_LABELS: Record<string, string> = {
  bgTop: "背景 · 上",
  bgBottom: "背景 · 下",
  body: "实体默认色",
  edge: "边线",
  selected: "选中高亮",
  preselect: "预选高亮",
  sketch: "草图曲线",
  sketchConstruction: "构造几何",
  dim: "尺寸标注",
  grid: "网格 · 次线",
  gridMajor: "网格 · 主线",
  datumXY: "基准面 XY",
  datumXZ: "基准面 XZ",
  datumYZ: "基准面 YZ",
  axisX: "坐标轴 X",
  axisY: "坐标轴 Y",
  axisZ: "坐标轴 Z",
  sectionLine: "剖切截面线",
  ground: "地面",
  highlightFace: "面高亮",
};

const COLOR_GROUPS: { title: string; keys: string[] }[] = [
  { title: "背景与地面", keys: ["bgTop", "bgBottom", "ground"] },
  { title: "模型", keys: ["body", "edge", "highlightFace"] },
  { title: "选择", keys: ["selected", "preselect"] },
  { title: "草图与标注", keys: ["sketch", "sketchConstruction", "dim"] },
  { title: "网格与基准面", keys: ["grid", "gridMajor", "datumXY", "datumXZ", "datumYZ"] },
  { title: "坐标轴与剖切", keys: ["axisX", "axisY", "axisZ", "sectionLine"] },
];

/** 由弦高公差推算圆周分段数（与内核镶嵌一致） */
const segmentsOf = (tol: number) => Math.max(8, Math.min(256, Math.round(Math.PI / Math.acos(Math.max(-1, 1 - tol / 10)))));

function DatumSwatch({ kind }: { kind: "dashed" | "grid" | "filled" }) {
  const c = "var(--accent)";
  return (
    <svg viewBox="0 0 60 40" width="100%" height="42">
      {kind === "filled" && <rect x="6" y="6" width="48" height="28" fill={c} opacity="0.22" stroke={c} strokeWidth="1" />}
      {kind === "grid" && (
        <>
          <rect x="6" y="6" width="48" height="28" fill={c} opacity="0.07" stroke={c} strokeWidth="1" />
          {[1, 2, 3, 4, 5].map((i) => (
            <line key={"v" + i} x1={6 + i * 8} y1="6" x2={6 + i * 8} y2="34" stroke={c} strokeWidth="0.6" opacity="0.45" />
          ))}
          {[1, 2, 3].map((i) => (
            <line key={"h" + i} x1="6" y1={6 + i * 7} x2="54" y2={6 + i * 7} stroke={c} strokeWidth="0.6" opacity="0.45" />
          ))}
        </>
      )}
      {kind === "dashed" && <rect x="6" y="6" width="48" height="28" fill="none" stroke={c} strokeWidth="1.2" strokeDasharray="4 3" />}
    </svg>
  );
}

export default function Settings() {
  const app = useApp();
  const s = app.settings;
  const colors = useColors();
  const pv = usePreviewColors();
  const gpu = gpuInfo();
  const [bench, setBench] = useState<{ single: number; multi: number; threads: number } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="w-full h-full overflow-auto">
      <div className="max-w-[900px] mx-auto p-6">
        <h1 className="text-[22px] font-bold mb-1">设置</h1>
        <p className="muted text-[12.5px] mb-4">89 项设置可打包成一个方案文件，能分享也能导入。</p>

        <div className="card">
          <Section title="通用">
            <Row label="界面语言（11 种）">
              <select className="inp" value={s.lang} onChange={(e) => app.set("lang", e.target.value as any)}>
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="主题">
              <Seg value={s.theme} options={[{ id: "dark", label: "深色" }, { id: "light", label: "浅色" }]} onChange={(v) => app.set("theme", v as any)} />
            </Row>
            <Row label="单位">
              <Seg value={s.units} options={[{ id: "mm", label: "mm" }, { id: "cm", label: "cm" }, { id: "m", label: "m" }, { id: "in", label: "in" }]} onChange={(v) => app.set("units", v as any)} />
            </Row>
            <Row label="小数位数"><Num value={s.precision} onChange={(v) => app.set("precision", Math.max(0, Math.min(6, v)))} w={60} /></Row>
            <Row label="自动保存"><Toggle on={s.autoSave} onChange={(v) => app.set("autoSave", v)} /></Row>
            <Row label="手写笔模式"><Toggle on={s.stylus} onChange={(v) => app.set("stylus", v)} /></Row>
          </Section>

          <Section title="性能 · 多线程 CPU 与 GPU">
            <Row label="工作线程数">
              <input type="range" min={1} max={Math.max(4, cpuThreads() * 2)} value={s.threads} onChange={(e) => app.set("threads", +e.target.value)} className="w-40" />
              <span className="mono text-[11.5px]">{s.threads} / {cpuThreads()}</span>
            </Row>
            <Row label="抗锯齿"><Seg value={String(s.aa) as any} options={[{ id: "0", label: "关" }, { id: "2", label: "2x" }, { id: "4", label: "4x" }, { id: "8", label: "8x" }]} onChange={(v) => app.set("aa", Number(v) as any)} /></Row>
            <Row label="三角化精度"><Num value={s.tessellation} onChange={(v) => app.set("tessellation", v)} w={64} /></Row>
            <Row label="地面阴影"><Toggle on={s.shadows} onChange={(v) => app.set("shadows", v)} /></Row>
            <div className="mt-2 text-[11.5px] mono leading-5 muted">
              <div>GPU：{gpu.renderer}</div>
              <div>厂商：{gpu.vendor} · {gpu.webgl2 ? "WebGL 2.0" : "WebGL 1.0"} · 最大纹理 {gpu.maxTex}</div>
              <div>CPU：{cpuThreads()} 逻辑核 · 内存 {(navigator as any).deviceMemory || "?"} GB</div>
            </div>
            <button
              className="btn sm mt-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setBench(await benchmark(s.threads));
                setBusy(false);
              }}
            >
              {busy ? "跑分中…" : "运行多线程基准"}
            </button>
            {bench && (
              <div className="text-[11.5px] mono mt-1">
                单线程 {bench.single.toFixed(0)} ms · {bench.threads} 线程 {bench.multi.toFixed(0)} ms ·{" "}
                <span className="accent">加速比 {(((bench.single * bench.threads) / bench.multi) || 0).toFixed(2)}×</span>
              </div>
            )}
          </Section>

          <Section title="着色与镶嵌精度">
            <Row label="着色模式" hint="平面着色保留分面棱线；平滑着色按平均法线插值">
              <Seg
                value={s.shading}
                options={[{ id: "flat", label: "平面着色 Flat-Shading" }, { id: "smooth", label: "平滑 Gouraud 着色" }]}
                onChange={(v) => app.set("shading", v as any)}
              />
            </Row>
            <Row label="镶嵌精度公差">
              <input type="range" min={0.01} max={0.6} step={0.01} value={s.chordTol} onChange={(e) => app.set("chordTol", +e.target.value)} className="w-40" />
              <span className="mono text-[11.5px]">{s.chordTol.toFixed(2)} mm</span>
            </Row>
            <Row label="曲面分段数（由公差推算）">
              <span className="mono text-[11.5px] accent">{segmentsOf(s.chordTol)} 段 / 圆</span>
            </Row>
            <table className="grid w-full mt-2">
              <thead>
                <tr>
                  <th>公差</th>
                  <th>分段</th>
                  <th>圆柱视觉观感</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ outline: s.chordTol >= 0.25 ? "1px solid var(--accent)" : undefined }}>
                  <td>大（0.25–0.60）</td>
                  <td>少（{segmentsOf(0.4)} 段）</td>
                  <td>明显竖条棱线，刷新最快</td>
                </tr>
                <tr style={{ outline: s.chordTol > 0.08 && s.chordTol < 0.25 ? "1px solid var(--accent)" : undefined }}>
                  <td>中（0.09–0.24）</td>
                  <td>适中（{segmentsOf(0.15)} 段）</td>
                  <td>轻微棱线，日常建模够用</td>
                </tr>
                <tr style={{ outline: s.chordTol <= 0.08 ? "1px solid var(--accent)" : undefined }}>
                  <td>小（0.01–0.08）</td>
                  <td>细密（{segmentsOf(0.04)} 段）</td>
                  <td>光滑圆润，看不到分割线</td>
                </tr>
              </tbody>
            </table>
            <div className="muted text-[11px] mt-1">
              分析网格与显示网格分开三角化，调高精度不会拖慢壁厚/拔模分析；着色模式只影响显示，不改变实际几何。
            </div>
          </Section>

          <Section title="基准面样式">
            <Row label="样式">
              <Seg
                value={s.datumStyle}
                options={[{ id: "dashed", label: "细虚线方框" }, { id: "grid", label: "内部网格" }, { id: "filled", label: "填充平面" }]}
                onChange={(v) => app.set("datumStyle", v as any)}
              />
            </Row>
            <Row label="填充不透明度">
              <input type="range" min={0.02} max={0.35} step={0.01} value={s.datumOpacity} onChange={(e) => app.set("datumOpacity", +e.target.value)} className="w-40" />
              <span className="mono text-[11.5px]">{(s.datumOpacity * 100).toFixed(0)}%</span>
            </Row>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                ["dashed", "细虚线方框轮廓", "无内部网格，最不挡视线"],
                ["grid", "内部网格", "带 8×8 参考格，便于估算"],
                ["filled", "完整填充平面", "整片半透明色块"],
              ].map(([id, t, d]) => (
                <div
                  key={id}
                  className="p-2 rounded cursor-pointer"
                  style={{ border: `1px solid ${s.datumStyle === id ? "var(--accent)" : "var(--line)"}`, background: "var(--panel2)" }}
                  onClick={() => app.set("datumStyle", id as any)}
                >
                  <DatumSwatch kind={id as any} />
                  <div className="text-[11.5px] mt-1">{t}</div>
                  <div className="text-[10.5px] muted">{d}</div>
                </div>
              ))}
            </div>
            <Row label="显示基准面"><Toggle on={s.showDatums} onChange={(v) => app.set("showDatums", v)} /></Row>
          </Section>

          <Section title="命令实时预览">
            <Row label="半透明实体预览" hint="增料显示青绿，切除显示红色">
              <Toggle on={s.livePreview} onChange={(v) => app.set("livePreview", v)} />
            </Row>
            <Row label="三维箭头与悬浮读数" hint="拉伸/旋转标出起止距离，阵列标出方向与间距">
              <Toggle on={s.previewArrows} onChange={(v) => app.set("previewArrows", v)} />
            </Row>
            <div className="mt-2 p-2 rounded" style={{ background: "var(--panel2)" }}>
              <div className="text-[11px] muted mb-1">当前主题（{s.theme === "light" ? "浅色" : "深色"}）的预览配色语义</div>
              {[
                ["增料预览（拉伸/旋转 半透明实体）", pv.add, `${Math.round(pv.addOpacity * 100)}% 透明度`],
                ["切除预览（半透明实体）", pv.cut, `${Math.round(pv.cutOpacity * 100)}% 透明度`],
                ["阵列 / 镜像副本", pv.ghost, `仅线框 ${pv.ghostWidth}px · 无填充`],
                ["源对象高亮", pv.source, `描边 + ${pv.sourceGlow}px 外发光`],
                ["3D 箭头与读数", pv.arrow, "悬浮标签"],
              ].map(([label, col, note]) => (
                <div key={label as string} className="flex items-center gap-2 py-[3px]">
                  <span className="w-5 h-4 rounded-sm inline-block shrink-0" style={{ background: col as string }} />
                  <span className="text-[11.5px] flex-1">{label as string}</span>
                  <span className="text-[10.5px] mono muted">{col as string}</span>
                  <span className="text-[10.5px] muted">{note as string}</span>
                </div>
              ))}
              <div className="text-[10.5px] muted mt-1">
                规则：复制类只画线框，禁止实心填充（避免三角面片竖条纹锯齿）；预览永远带透明度，按下「确定 √」之后才变成不透明的真实模型颜色。
              </div>
            </div>
          </Section>

          <Section title="图标与线条">
            <Row label="图标线宽" hint="纯线性 outline，无填充 / 无渐变 / 无阴影">
              <input type="range" min={1} max={2.5} step={0.1} value={s.iconStroke} onChange={(e) => app.set("iconStroke", +e.target.value)} className="w-40" />
              <span className="mono text-[11.5px]">{s.iconStroke.toFixed(1)} px</span>
            </Row>
            <Row label="图标尺寸">
              <input type="range" min={14} max={26} value={s.iconSize} onChange={(e) => app.set("iconSize", +e.target.value)} className="w-40" />
              <span className="mono text-[11.5px]">{s.iconSize} px</span>
            </Row>
            <Row label="图标下方中文小字"><Toggle on={s.showIconLabel} onChange={(v) => app.set("showIconLabel", v)} /></Row>
            <div className="mt-2 grid grid-cols-6 gap-2 p-2 rounded" style={{ background: "var(--panel2)" }}>
              {[["sketch", "草图"], ["datum", "基准面"], ["extrude", "拉伸"], ["revolve", "旋转体"], ["transform", "变换"], ["surface", "曲面"]].map(([n, l]) => (
                <div key={n} className="flex flex-col items-center gap-1">
                  <Icon name={n} size={s.iconSize + 6} />
                  <span className="text-[10px] muted">{l}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="草图与捕捉">
            <Row label="对象捕捉"><Toggle on={s.objectSnap} onChange={(v) => app.set("objectSnap", v)} /></Row>
            <Row label="捕捉范围（可调）">
              <input type="range" min={4} max={30} value={s.snapRange} onChange={(e) => app.set("snapRange", +e.target.value)} className="w-40" />
              <span className="mono text-[11.5px]">{s.snapRange} px</span>
            </Row>
            <Row label="连续绘制模式" hint="画完一个图元后保持当前工具"><Toggle on={s.continuousDraw} onChange={(v) => app.set("continuousDraw", v)} /></Row>
            <Row label="进入草图自动摆正视角" hint="视角自动旋转到垂直于草图基准面"><Toggle on={s.autoAlignSketch} onChange={(v) => app.set("autoAlignSketch", v)} /></Row>
            <Row label="网格吸附"><Toggle on={s.gridSnap} onChange={(v) => app.set("gridSnap", v)} /></Row>
            <Row label="网格步长"><Num value={s.gridStep} onChange={(v) => app.set("gridStep", v)} w={64} suffix="mm" /></Row>
            <Row label="捕捉点（六档）">
              <div className="flex gap-1 flex-wrap">
                {([["snapEndpoint", "端点"], ["snapMidpoint", "中点"], ["snapIntersection", "交点"], ["snapOnCurve", "曲线上"], ["snapCenter", "圆心"], ["snapQuadrant", "象限点"]] as const).map(([k, l]) => (
                  <button key={k} className={"chip " + ((s as any)[k] ? "on" : "off")} onClick={() => app.set(k as any, !(s as any)[k])}>
                    {l}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="做出特征后隐藏草图"><Toggle on={s.hideSketchAfterFeature} onChange={(v) => app.set("hideSketchAfterFeature", v)} /></Row>
          </Section>

          <Section title="界面布局">
            <Row label="工具栏缩放">
              <input type="range" min={0.8} max={1.6} step={0.05} value={s.toolbarScale} onChange={(e) => app.set("toolbarScale", +e.target.value)} className="w-40" />
            </Row>
            <Row label="面板不透明度">
              <input type="range" min={0.5} max={1} step={0.05} value={s.panelOpacity} onChange={(e) => app.set("panelOpacity", +e.target.value)} className="w-40" />
            </Row>
          </Section>

          <Section title={`视口配色（${Object.keys(colors).length} 项 · 当前为${s.theme === "light" ? "浅色" : "深色"}主题）`} defaultOpen={false}>
            <div className="text-[11px] muted mb-2">深色与浅色各存一套；切换主题时视口配色会自动跟着换。</div>
            {COLOR_GROUPS.map((grp) => (
              <div key={grp.title} className="mb-2">
                <div className="text-[11px] muted mb-1">{grp.title}</div>
                <div className="grid grid-cols-2 gap-x-4">
                  {grp.keys.map((k) => (
                    <Row key={k} label={COLOR_LABELS[k] || k} hint={k}>
                      <span className="text-[10px] muted mono mr-1">{(colors as any)[k]}</span>
                      <Color value={(colors as any)[k]} onChange={(c) => app.setColors({ [k]: c } as any)} />
                    </Row>
                  ))}
                </div>
              </div>
            ))}
            <button className="btn sm mt-1" onClick={() => app.setColors(s.theme === "light" ? DEFAULT_COLORS_LIGHT : DEFAULT_COLORS)}>
              恢复当前主题默认配色
            </button>
          </Section>

          <Section title="键盘快捷键（可查阅）" defaultOpen={false}>
            <table className="grid w-full">
              <tbody>
                {SHORTCUTS.map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono w-[240px]">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="设置方案 / 导出历史" defaultOpen={false}>
            <div className="flex gap-2 flex-wrap">
              <button className="btn sm" onClick={() => download("digit3d-settings.json", JSON.stringify(s, null, 2), "application/json")}>导出设置方案</button>
              <label className="btn sm">
                导入设置方案
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const obj = JSON.parse(await f.text());
                      Object.entries(obj).forEach(([k, v]) => app.set(k as any, v as any));
                      app.notify("设置方案已导入", "ok");
                    } catch {
                      app.notify("方案文件解析失败", "err");
                    }
                  }}
                />
              </label>
              <button className="btn sm" onClick={app.clearExports}>清空导出历史</button>
            </div>
            <div className="mt-2 max-h-[220px] overflow-auto">
              {app.exports.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-[11.5px] py-[3px] border-b hairline">
                  <Badge>{r.format}</Badge>
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="muted">{(r.size / 1024).toFixed(1)} KB</span>
                  <span className="muted">{new Date(r.time).toLocaleTimeString()}</span>
                  {r.url && (
                    <a className="btn sm" href={r.url} download={r.name}>
                      再次下载
                    </a>
                  )}
                </div>
              ))}
              {!app.exports.length && <div className="muted text-[11.5px] p-2">还没有导出记录。</div>}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
