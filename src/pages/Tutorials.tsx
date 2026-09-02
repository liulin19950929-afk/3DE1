import { useState } from "react";
import { useApp } from "../store";
import { use3D, sampleBracket } from "../editor3d/store3d";
import { Badge } from "../components/ui";

interface Step {
  t: string;
  d: string;
  done: string;
  note: string;
}
interface Tut {
  id: string;
  name: string;
  steps: number;
  minutes: number;
  desc: string;
  tags: string;
  list: Step[];
  practice?: "3d" | "2d";
}

const TUTORIALS: Tut[] = [
  {
    id: "beginner",
    name: "入门教程",
    steps: 5,
    minutes: 8,
    desc: "了解工作区、导航和第一个项目的完整流程。",
    tags: "界面 · 鼠标操作 · 第一个项目",
    list: [
      { t: "认识首页与导航", d: "首页会显示最近文件和示例。顶部导航用于切换首页、3D 建模、2D 制图、工程制图、教程与设置；要新建或导入，请点首页的「新建 / 导入」。", done: "你能找到首页、教程、设置和新建控件。", note: "导航栏会显示在各主页面中。" },
      { t: "打开内置 3D 示例", d: "在首页找到支座示例并点击。程序会在本地生成示例，然后在 3D 编辑器中打开。", done: "3D 视口中显示了支座。", note: "即使示例卡片被移除，也可以用下方的练习按钮重新创建。" },
      { t: "认识 3D 工作区", d: "中央是视口，左侧命令轨提供建模工具，右侧功能轨提供查看工具，建模树列出草图、实体和特征。", done: "你能找到视口、命令轨、建模树和视图控件。", note: "在视口或建模树中点击实体即可选择；点击空白处取消选择。" },
      { t: "使用鼠标浏览", d: "左键拖动旋转，右键拖动平移，滚轮以指针为锚缩放。如果模型离开屏幕，按 F 或点「全图」。", done: "你可以流畅地旋转、平移、缩放和全图显示模型。", note: "双击右上角视图魔方可回到全图。" },
      { t: "体验 2D 并创建第一个项目", d: "打开一个 2D 示例，使用「全图」显示整张图纸，再点击图元进行选择。随后返回首页，点击「新建」，选择空白 2D 图纸或 3D 模型。", done: "你能全图显示并选择 2D 图纸，也能找到两种新建项目选项。", note: "图纸和标注请选择 2D；草图和实体特征请选择 3D。" },
    ],
    practice: "3d",
  },
  {
    id: "2d",
    name: "2D 制图",
    steps: 6,
    minutes: 15,
    desc: "绘制一块精确的 100 × 50 mm 双孔底板。",
    tags: "绘制 · 修改 · 标注 · 导出",
    list: [
      { t: "新建空白图纸", d: "点击首页「新建 / 导入」，选择「2D 图纸」，系统会立即新建有效的空白 DXF。本教程使用毫米。", done: "空白 2D 画布已经打开，可以开始绘制。", note: "2D 编辑会自动保存，没有单独的保存按钮。" },
      { t: "绘制 100 × 50 mm 矩形", d: "开启「对象捕捉」，选择「矩形」，先大致点出两个对角点，再用在线尺寸输入精确值。", done: "画布中出现一个闭合的 100 × 50 mm 底板轮廓。", note: "对象捕捉能让角点以及后续圆心准确落在几何位置上。" },
      { t: "添加并复制 Ø17 mm 孔", d: "选择「圆」，放到底板中心线上，半径输入 8.5 mm。选中圆后用「复制」在对称位置放置副本。", done: "底板轮廓内有两个 Ø17 mm 圆。", note: "如果多个捕捉点距离很近，请先放大再捕捉圆心。" },
      { t: "选择并修改图元", d: "点击边或圆将其选中，然后使用「移动」修正位置。需要多选时先切到「框选」模式再拖出选择框；改错了用「撤销」。", done: "两个孔已对齐，且底板轮廓仍保持闭合。", note: "准确选择可避免移动孔时连同底板轮廓一起移动。" },
      { t: "添加标注", d: "添加水平和垂直标注，标出 100 mm 长度和 50 mm 宽度，再为其中一个孔添加直径标注。", done: "图纸清楚显示 100 mm、50 mm 和 Ø17 mm 标注。", note: "标注用于说明几何尺寸，不能替代绘制时输入的精确数值。" },
      { t: "自动保存并导出", d: "编辑会自动保存。在 2D 编辑器顶栏可导出 PNG 图片或用于 CAD 交换的 DXF。", done: "项目出现在最近文件中，导出记录里能看到 PNG 或 DXF。", note: "真实 2D 导入支持 ASCII DXF；二进制 DXF 与真实 DWG 需先转换。" },
    ],
    practice: "2d",
  },
  {
    id: "3d",
    name: "3D 建模",
    steps: 6,
    minutes: 20,
    desc: "创建一个带凸台和通孔的支座。",
    tags: "草图 · 拉伸 · 旋转体 · 布尔",
    list: [
      { t: "在 XY 平面新建模型", d: "点击首页「新建 / 导入」→「3D 模型」，然后点左侧「草图」并选择 XY 平面。", done: "草图模式已在 XY 平面中打开。", note: "请有意识地选择基准平面，它会决定模型方向和后续草图的参考。" },
      { t: "绘制 60 × 40 mm 底板草图", d: "用矩形工具绘制闭合矩形，选中边后用「尺寸」约束为 60 mm × 40 mm，围绕原点放置，确认闭合后点「✓ 完成」。", done: "建模树中列出了一个闭合的 60 × 40 mm 矩形草图。", note: "拉伸需要闭合轮廓；离开草图前请修复所有可见间隙。" },
      { t: "将底板拉伸 8 mm", d: "点「拉伸」，选择刚才的草图，把终点设为 8 mm，确认特征。", done: "建模树中出现一个厚 8 mm 的实体底板。", note: "确认后旋转视图，检查创建的是实体，而不是开放片体。" },
      { t: "旋转出 Ø20 mm 凸台", d: "在 XZ 平面新建草图，贴着旋转轴绘制 10 × 24 mm 半截面，结束草图后点「旋转体」，360° 生成凸台。", done: "一个 Ø20 mm 圆柱凸台与底板相交。", note: "半截面必须闭合并接触预定旋转轴，但不能穿过旋转轴。" },
      { t: "合并实体并切出通孔", d: "用「布尔 · 并集」合并凸台与底板。在凸台端面绘制 Ø8 mm 圆，再用拉伸「求差」贯穿零件。", done: "支座成为一个实体，并有清晰的 Ø8 mm 通孔。", note: "凸台必须与底板重叠才能执行并集，切除拉伸也必须完全贯穿目标。" },
      { t: "保存 MCAD 并导出 STL", d: "把可编辑项目保存为 .mcad；需要打印时再导出 STL。离开前检查导出记录。", done: "可编辑的 .mcad 项目和导出的 .stl 文件都已生成。", note: "STL 和 STEP 导出都不包含参数化历史，两者都需要 Pro。" },
    ],
    practice: "3d",
  },
  {
    id: "ops",
    name: "3D 操作详解",
    steps: 10,
    minutes: 15,
    desc: "认全 3D 编辑器里的每个按钮：过滤器、显示、草图工具和鼠标操作。",
    tags: "界面 · 过滤器 · 显示 · 草图 · 手势",
    list: [
      { t: "认识 3D 界面", d: "顶栏：显示过滤、选择过滤、撤销、导出。左命令轨：建模命令，从上到下大致按建模顺序。右功能轨：查看工具，这一列不改模型。视口：模型本身。底部提示：当前命令要你做的下一件事。", done: "你能说出屏幕上五块区域各管什么。", note: "窗口变窄时，顶栏会自动折行。" },
      { t: "转动、缩放和选中", d: "左键拖动绕模型转动；右键拖动平移；滚轮以指针为锚缩放；单击选中；点空白取消；双击视图魔方回到全图。", done: "你能把模型转到任意角度，再一步拉回满屏。", note: "中键拖动同样可以旋转。" },
      { t: "用显示过滤器隐藏整类对象", d: "顶栏第一组开关有四项：实体、片体、草图（显示 → 透视 → 隐藏 三档循环）、基准面。图标变淡就是已经隐藏。", done: "关掉草图之后，视口里只剩实体。", note: "点任意开关，底部会提示当前显示状态。" },
      { t: "用选择过滤器锁定能选中什么", d: "选择过滤器有体、面、边、草图四项，可以同时开几个，也可以全关。", done: "关掉「体」之后，点模型再也选不中整个实体。", note: "命令会自己换过滤器，退出命令后恢复。" },
      { t: "换一种画法看模型", d: "右侧功能轨点「显示」，五种模式：着色、着色+边线、线框、隐藏线、X-Ray；旁边可以调抗锯齿、阴影与三角化精度。", done: "你能在着色和线框之间来回切换。", note: "想看清内部结构就用 X-Ray，比反复剖切快。" },
      { t: "右边一列是查看工具", d: "建模树、体、剖切、显示、测量、拔模、壁厚、渲染、导出、性能。这一列不改模型，只换你看模型的方式。", done: "你能打开建模树，找到刚做的那一步。", note: "建模树可以退回到中间某一步，插入新命令后再回到末尾。" },
      { t: "左边一列是建模命令", d: "草图、基准面、拉伸、旋转体、同步、变换、扫掠、曲线组、填充、布尔、圆角、抽壳、拔模、更多。", done: "你能说出每个命令做出来的是什么。", note: "命令都是先选东西再设参数，底部会一直提示当前该选什么。" },
      { t: "进草图，画轮廓", d: "点「草图」，选一个基准面或模型上的平面：左侧换成绘制工具，底部换成草图开关；画完点「✓ 完成」退出。", done: "你画出一条闭合轮廓，退出草图后它出现在建模树里。", note: "拉伸需要闭合轮廓，退出前先确认没有缺口。" },
      { t: "草图底栏的开关", d: "构造线、多边形边数、倒圆角半径、十种约束、尺寸、收笔、完成、取消。捕捉六档在设置里开关。", done: "你能选中两条线后一键加上平行或垂直约束。", note: "捕捉默认开着，端点、中点和圆心会自动吸住。" },
      { t: "选中之后能做什么", d: "在「体」面板里可以改色、调透明度、隐藏、单独显示；右上角的视图魔方随时把视角摆正；按 F 全图。", done: "你能把一个实体改色，再单独显示它。", note: "删除在建模树或「更多 → 删除体」里。" },
    ],
    practice: "3d",
  },
  {
    id: "files",
    name: "文件与项目",
    steps: 6,
    minutes: 10,
    desc: "导入、整理、保存、导出和分享 CAD 文件。",
    tags: "导入 · 格式 · 存储 · 分享",
    list: [
      { t: "打开「新建或导入」", d: "点击首页的「＋ 新建 / 导入」。面板中可创建空白 2D 图纸、空白 3D 模型或从设备导入文件。", done: "面板已打开，三种入口都清晰可见。", note: "从教程打开此面板后关闭，仍会返回当前教程步骤。" },
      { t: "了解哪些格式可编辑", d: "真实 2D 导入请使用 ASCII DXF。MCAD 会保留可编辑的 3D 项目数据；STL / OBJ / 3MF 以网格打开，可转成实体。", done: "你能选择可编辑的项目格式，避开只读或不支持的格式。", note: "请先把不支持的 2D 文件转换为 ASCII DXF 再导入。" },
      { t: "从文件选择器导入", d: "选择「从设备导入」，浏览并点击支持的文件。等待解析完成后再进行编辑或切换视图。", done: "导入的文件已打开，并添加到最近文件中。", note: "云盘文件请先下载到本地，再由程序打开。" },
      { t: "查找并筛选项目", d: "在首页使用搜索匹配项目名称，用 2D / 3D 筛选缩小列表范围。", done: "列表中只显示符合搜索条件和所选类型的项目。", note: "搜索会匹配显示的文件名，并可与类型筛选组合使用。" },
      { t: "按项目类型正确保存", d: "2D 修改会自动保存；需要交换文件时导出 DXF。可编辑的 3D 工作请保存为 .mcad。", done: "2D 项目已自动保存，或可编辑的 3D 项目已保存为 MCAD。", note: "STEP 和 STL 都是不含参数化历史的导出格式，不能替代 MCAD 项目。" },
      { t: "查找导出文件并分享", d: "打开「设置 → 导出历史」，确认格式与大小，点击「再次下载」即可重新取回文件。", done: "你能找到导出的文件并再次下载分享。", note: "STL 与 STEP 导出都需要 Pro；两者都不包含参数化历史。" },
    ],
  },
];

export default function Tutorials() {
  const app = useApp();
  const st = use3D();
  const [open, setOpen] = useState<string | null>("beginner");
  const [q, setQ] = useState("");
  const [progress, setProgress] = useState<Record<string, number>>({});

  const filtered = TUTORIALS.map((t) => ({
    ...t,
    list: q ? t.list.filter((s) => (s.t + s.d + s.note).includes(q)) : t.list,
  })).filter((t) => !q || t.list.length);

  const practice = (kind: "3d" | "2d") => {
    if (kind === "3d") {
      st.reset("练习 · 支座");
      st.set("features", sampleBracket());
      st.rebuild();
      app.setPage("model");
    } else app.setPage("draft2d");
  };

  return (
    <div className="w-full h-full overflow-auto">
      <div className="max-w-[1000px] mx-auto p-7">
        <h1 className="text-[24px] font-bold">上手教程</h1>
        <p className="muted text-[13px] mt-1">五个项目，全部走完约 68 分钟。教程全程使用毫米单位。</p>
        <input className="inp mt-3" style={{ maxWidth: 320 }} placeholder="搜索教程内容…" value={q} onChange={(e) => setQ(e.target.value)} />

        <div className="mt-4 flex flex-col gap-3">
          {filtered.map((t) => (
            <div key={t.id} className="card">
              <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setOpen(open === t.id ? null : t.id)}>
                <span className="text-[14px] font-semibold">{t.name}</span>
                <Badge>{t.steps} 步 · {t.minutes} 分钟</Badge>
                <span className="muted text-[12px] flex-1 truncate">{t.desc}</span>
                {progress[t.id] ? <Badge tone="ok">读到第 {progress[t.id] + 1} 步</Badge> : null}
                <span className="muted">{open === t.id ? "−" : "+"}</span>
              </div>
              {open === t.id && (
                <div className="px-3 pb-3 fade">
                  <div className="muted text-[11.5px] mb-2">{t.tags}</div>
                  {t.list.map((s, i) => (
                    <div key={i} className="border-t hairline py-2" onMouseEnter={() => setProgress((p) => ({ ...p, [t.id]: i }))}>
                      <div className="flex gap-2">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px]" style={{ background: "var(--panel2)", border: "1px solid var(--line)" }}>
                          {i + 1}
                        </span>
                        <div className="flex-1">
                          <div className="text-[13px] font-medium">{s.t}</div>
                          <div className="muted text-[12.5px] mt-1 leading-6">{s.d}</div>
                          <div className="text-[11.5px] mt-1" style={{ color: "var(--ok)" }}>完成标志：{s.done}</div>
                          <div className="text-[11.5px]" style={{ color: "var(--warn)" }}>注意事项：{s.note}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {t.practice && (
                    <button className="btn primary mt-2" onClick={() => practice(t.practice!)}>
                      立即练习 →
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
