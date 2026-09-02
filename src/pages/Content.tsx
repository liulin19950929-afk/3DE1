import { useState } from "react";
import { useApp } from "../store";
import { Badge } from "../components/ui";

const Wrap = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <div className="w-full h-full overflow-auto">
    <div className="max-w-[1000px] mx-auto p-7">
      <h1 className="text-[24px] font-bold">{title}</h1>
      {sub && <p className="muted text-[13px] mt-1 mb-5">{sub}</p>}
      {children}
    </div>
  </div>
);

const Card = ({ title, items, tag }: { title: string; items: string[]; tag?: string }) => (
  <div className="card p-3">
    <div className="text-[13.5px] font-semibold mb-1">
      {title} {tag && <Badge tone="pro">{tag}</Badge>}
    </div>
    <ul className="muted text-[12px] leading-6">
      {items.map((i) => (
        <li key={i}>· {i}</li>
      ))}
    </ul>
  </div>
);

export function Features() {
  return (
    <Wrap title="功能" sub="本页列的是 v1.3.1 里真正做出来的东西，不是计划。还在图纸上的都放在路线图里。">
      <h2 className="text-[16px] font-semibold mt-2 mb-2">参数化草图 · 约束记住你的设计意图</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <Card title="绘制" items={["直线 · 折线 · 矩形", "圆 · 圆弧 · 椭圆", "样条曲线 · 多边形", "构造几何", "对象捕捉（六档可调）", "连续绘制模式"]} />
        <Card title="曲线编辑" items={["修剪 · 延伸", "倒圆角 · 倒角", "把边投影到草图平面", "橡皮擦（划过即擦）", "破坏性编辑单步撤销（40 步）", "选择引导提示"]} />
        <Card title="关联复制" items={["沿直线镜像", "线性阵列", "圆形阵列", "副本由源驱动", "已存草图穿透显示开关", "点/框选中草图点"]} />
      </div>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">实体建模 · 带真实特征历史的 B-Rep 实体</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <Card title="拉伸" items={["起止距离（可互相穿越）", "拔模角", "薄壁（2D 偏置环形截面）", "生成片体", "区域选择", "半透明实时预览"]} />
        <Card title="旋转体" items={["任意轴、任意角度", "新建体 · 求和 · 求差", "按单曲线或整张草图选截面"]} />
        <Card title="布尔" items={["并集 · 差集 · 交集", "对脏输入用模糊容差", "自动同域愈合", "逐面重网格兜底", "目标体/工具体两个框"]} />
        <Card title="细节特征" items={["边圆角（含 G2 曲率连续）", "倒角", "抽壳（先偏置再挖空）", "拔模"]} />
        <Card title="实体变换" items={["移动 · 复制", "镜像", "线性阵列", "圆形阵列", "缩放体"]} />
        <Card title="基准平面" items={["主平面 XY / XZ / YZ", "从面或平面偏置", "两平面二等分", "成角度", "视口点选即可在其上开草图"]} />
        <Card title="多实体" items={["一个工程内多个实体", "实体树 · 每体独立颜色", "隐藏 · 单独显示 · 全部显示", "透明度滑条", "点击处弹出快捷条"]} />
        <Card title="历史与撤销" items={["完整撤销 / 重做", "打开工程时按特征重放", "任意特征可删可改可抑制", "建模树回退条，中间插入命令"]} />
        <Card title="更多命令" items={["拆分体 · 修剪体 · 加厚", "缩放体 · 包容体 · 管", "螺纹（真实牙型）· 刻字", "删除体 · 优化体"]} />
      </div>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">同步建模 · 直接改几何，不必回溯历史</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <Card title="推拉" items={["拉出面 · 压入面 · 偏置区域", "手柄锚在面质心", "带符号距离，可跨零反向", "预览时选中面/边保持高亮"]} />
        <Card title="曲面" items={["沿引导线扫掠", "通过曲线组（放样对齐三档）", "网格曲面（主曲线 × 交叉曲线）", "边界填充", "加厚成实体"]} />
        <Card title="截面选择" items={["整张草图或单条曲线", "跨曲线多选", "曲线规则：单条/相连/相切/区域边界", "选择过滤：只拾取草图与面"]} />
      </div>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">测量与分析 · 全部在本机多线程运行</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <Card title="拔模分析" tag="Pro" items={["按与脱模方向夹角分四色带", "倒扣一眼就能看出来", "方向可在视口里换", "多线程并行计算"]} />
        <Card title="壁厚分析" tag="Pro" items={["射线法求壁厚", "映射成彩虹色阶", "三档精度：标准 / 精细 / 超精", "大模型带进度条", "分析网格与显示网格分离"]} />
        <Card title="测量" items={["距离 · 角度 · 局部半径（免费）", "体积 · 包容体积 · 外形尺寸 · 面积（Pro）", "20 种材料算重量与成本", "读数直接画在实体上"]} />
      </div>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">视口与显示</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <Card title="剖切" tag="Pro" items={["实时剖切平面（GPU 裁剪）", "切口处绘制截面线", "线宽 0.25 dp 起可调"]} />
        <Card title="配色" items={["19 项可配色，落盘保存", "拾色器", "8 色实体调色板", "背景与边线独立配色"]} />
        <Card title="导航与画质" items={["左键旋转 · 右键平移 · 滚轮缩放", "全图显示与标准视图方向", "XY / XZ / YZ 基准面显示", "抗锯齿采样数可配", "五种显示模式 + 视图魔方"]} />
      </div>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">工程制图 <Badge tone="beta">Beta</Badge></h2>
      <div className="grid md:grid-cols-3 gap-3">
        <Card title="图纸与幅面" items={["A0 到 A4，也可以自定义", "横放竖放，带装订边", "第一角或第三角投影", "比例自己填", "标题栏字段可改", "一个工程多张图纸"]} />
        <Card title="视图" items={["主视 / 俯视 / 侧视 / 后视 / 仰视 / 轴测", "任意角度：转到位再摆正", "隐藏线（多线程 HLR）、相切边开关", "视图可拖着挪"]} />
        <Card title="剖视与局部放大" items={["横切或竖切", "切口自动填剖面线", "看的方向可以反过来", "局部放大：圈出一块单独画一张"]} />
        <Card title="标注" items={["长度 · 对齐 · 直径 · 半径 · 角度", "自动尺寸：点线段/点圆", "读数按图纸比例换算", "字高与箭头样式可设"]} />
        <Card title="公差与注释" items={["对称公差 / 上下偏差", "配合代号", "图纸上任意位置写文字", "带箭头的引线", "中心线与中心标记"]} />
        <Card title="导出" tag="Pro" items={["导出 DXF", "所有图纸导成一份多页 PDF", "制图本身免费，只有导出需要 Pro"]} />
      </div>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">技术架构</h2>
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="桌面全栈" items={["UI：React + TypeScript", "几何核心：TypeScript 内核 + CSG 布尔（BVH 加速）", "耗时任务在 Web Worker 后台运行，支持进度与取消"]} />
        <Card title="多线程 CPU" items={["线程数默认 = 逻辑核心数，可手动调整", "壁厚 / 拔模 / 质量特性 / 隐藏线消除全部并行", "均匀网格加速的射线求交", "内置线程基准测试"]} />
        <Card title="GPU 渲染" items={["WebGL2 渲染模型、线框与选择高亮", "剖切走 GPU 裁剪平面", "PCF 柔和阴影与物理材质", "精确几何与显示网格分离，只在几何变化时上传 GPU"]} />
        <Card title="参数化约束引擎" items={["自研草图几何与尺寸约束求解器（迭代松弛）", "改一个尺寸，下游全部重建", "自由度提示"]} />
      </div>
    </Wrap>
  );
}

const FORMATS: [string, string, string, string, string, string][] = [
  [".mcad", "工程", "支持", "完整", "支持", "本应用自有格式。唯一保留参数化特征历史的格式。"],
  [".step .stp", "3D 精确", "支持", "作为导入体", "Pro", "工业交换标准。导入几何成为可布尔、可倒角、可剖切的实体，但没有上游草图历史。"],
  [".iges .igs", "3D 精确", "支持", "作为导入体", "暂无", "本版本仅支持导入线框/曲线。IGES 导出尚未实现。"],
  [".x_t .x_b", "3D 精确", "需转换", "—", "暂无", "Parasolid 中性格式：请从原软件导出 STEP 后导入。"],
  [".stl", "3D 网格", "支持", "可转成实体", "Pro", "3D 打印格式。打开是网格，可就地转成实体后继续编辑。"],
  [".obj", "3D 网格", "支持", "可转成实体", "免费", "与 STL 一样：先以网格打开，需要时转成实体。"],
  [".3mf", "3D 网格", "支持", "可转成实体", "Pro", "多零件文件保留每个零件的名称与摆位；导出同样留得住。"],
  [".dxf", "2D 图纸", "ASCII", "完整", "免费", "仅支持 ASCII DXF。支持块、标注、嵌套引用、阵列、样条、椭圆、剖面线。"],
  [".dwg", "2D 图纸", "需插件", "完整", "不支持", "DWG 是封闭格式，需要独立的免费转换插件；请先另存为 ASCII DXF。"],
  [".png", "图像", "—", "—", "免费", "把 2D 图纸或视口导出成图片。"],
  [".pdf", "图纸", "—", "—", "Pro", "仅导出：工程图的所有图纸合成一份多页 PDF。"],
  [".prt .sldprt .catpart", "原生格式", "计划中", "—", "—", "私有原生格式在路线图上。目前请先从原软件导出 STEP。"],
];

export function Formats() {
  return (
    <Wrap title="格式支持" sub="哪些文件能打开，打开之后能干什么。只读的、不支持的、需要先转换的，都写在这里。">
      <table className="grid w-full">
        <thead>
          <tr>
            <th>格式</th>
            <th>类型</th>
            <th>打开</th>
            <th>编辑</th>
            <th>导出</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {FORMATS.map((r) => (
            <tr key={r[0]}>
              <td className="mono">{r[0]}</td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
              <td>{r[3]}</td>
              <td>{r[4] === "Pro" ? <Badge tone="pro">Pro</Badge> : r[4]}</td>
              <td className="muted">{r[5]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">精确几何 vs 网格</h2>
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="STEP / IGES / Parasolid —— 精确 B-Rep" items={["以真正的实体导入", "可布尔、倒圆角、剖切、测量与分析", "拿不到原始草图与特征历史", "三角化偏差随体量自适应", "源文件会内嵌进 .mcad 工程"]} />
        <Card title="STL / OBJ / 3MF —— 三角网格" items={["先以网格打开：查看、旋转、测量与分析", "需要当实体用时就地转成实体", "转出来的是网格的形状，不是原始参数化工程", "适合 3D 打印与下游网格工具"]} />
      </div>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">要保住可编辑性，就存成 .mcad</h2>
      <table className="grid w-full">
        <thead>
          <tr>
            <th>工程里保存了什么</th>
            <th>.mcad</th>
            <th>.step</th>
            <th>.stl</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["最终几何", "精确", "精确", "三角化"],
            ["特征历史", "保留", "不保留", "不保留"],
            ["草图与约束", "保留", "不保留", "不保留"],
            ["实体命名与颜色", "保留", "不保留", "不保留"],
            ["内嵌的导入源文件", "保留", "不保留", "不保留"],
            ["其他 CAD 能打开", "不能", "通用", "通用"],
          ].map((r) => (
            <tr key={r[0]}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
              <td>{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted text-[12.5px] mt-2">经验法则：<b>.mcad 存给自己，STEP 导给别人，STL 导给机器。</b></p>

      <h2 className="text-[16px] font-semibold mt-6 mb-2">体量与性能</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <Card title="日常零件" items={["单个零件与小型装配秒开", "布尔与倒角走 BVH 加速"]} />
        <Card title="大型总装" items={["83 MB / 137 万实体 / 1174 零件 的 STEP 需要几十秒", "导入在后台线程运行，有进度、可取消", "屏幕外实体不参与绘制"]} />
        <Card title="低内存设备" items={["超大总装仍可能耗尽内存", "目前没有体量闸门", "云盘文件请先下载到本地再打开"]} />
      </div>
    </Wrap>
  );
}

const ROADMAP: [string, string, string, string][] = [
  ["01", "工程制图（技术图）", "从 3D 模型生成标准二维工程图：投影视图、剖视图、尺寸与公差标注、标题栏与明细表，并可导出 DXF/PDF。", "Beta"],
  ["02", "完整装配模块", "多零件装配设计：贴合、对齐、同心等配合约束，装配树、爆炸视图与干涉检查。", "计划中"],
  ["03", "原生格式支持", "直接打开主流工业 CAD 的原生零件与装配文件（.prt、.sldprt/.sldasm 等）。", "计划中"],
  ["04", "曲面能力", "创建、修剪、连接并优化复杂曲面——远超目前的扫掠、通过曲线组与填充。", "部分已发布"],
  ["05", "建模能力加强", "扩展特征、加深直接编辑、丰富约束能力，并持续打磨稳定性。", "持续进行"],
  ["06", "渲染模块", "材质、灯光、环境与高质量输出，用于出效果图。", "已发布"],
  ["07", "CAM 与 G 代码", "按模型生成刀路，并输出数控机床能直接用的 G 代码。", "计划中"],
  ["08", "CAE 能力", "有限元分析：受力、变形与模态。", "计划中"],
];

export function Roadmap() {
  return (
    <Wrap title="未来计划" sub="这是方向，不是带日期的承诺。顺序会根据大家实际的需求调整。">
      <div className="grid md:grid-cols-2 gap-3">
        {ROADMAP.map((r) => (
          <div key={r[0]} className="card p-3">
            <div className="flex items-center gap-2">
              <span className="text-[20px] font-bold muted">{r[0]}</span>
              <span className="text-[14px] font-semibold flex-1">{r[1]}</span>
              <Badge tone={r[3] === "Beta" ? "beta" : r[3] === "已发布" ? "ok" : "muted"}>{r[3]}</Badge>
            </div>
            <p className="muted text-[12px] mt-1">{r[2]}</p>
          </div>
        ))}
      </div>
      <h2 className="text-[16px] font-semibold mt-6 mb-2">已知短板 · v1.3.1 目前还做不到的</h2>
      <div className="grid md:grid-cols-2 gap-3">
        <Card title="工程图还没有明细表" items={["视图、标注、公差、注释、标题栏都有了", "明细表要等装配模块"]} />
        <Card title="没有装配约束" items={["一个工程里可以有多个实体", "零件之间还没有贴合/对齐等配合关系"]} />
        <Card title="读不了真实 DWG" items={["需要商业授权的库", "请转成 ASCII DXF，那条路是完整支持的"]} />
        <Card title="没有 IGES 导出，也没有云同步" items={["IGES 导入可用，导出尚未实现", "云同步是刻意不做的——你画的东西不会离开设备"]} />
      </div>
    </Wrap>
  );
}

const FAQ: [string, string][] = [
  ["需要联网吗？", "不需要。所有几何运算、文件导入与导出都在你的电脑上完成，你画的东西不会被上传。"],
  ["支持哪些设备？", "桌面版：Windows / macOS / Linux 上的现代浏览器（需 WebGL2 与 Web Worker）。推荐 8 GB 以上内存、多核 CPU 与独立显卡。"],
  ["能打开 DWG 文件吗？", "真实 DWG 需要免费的 DWG 转换插件；非常老的 DWG（R12 及更早）请在电脑的 CAD 里另存为 ASCII DXF。"],
  ["我的文件存在哪？", "只在你的电脑本地（浏览器本地存储 + 你导出到磁盘的位置）。没有账号、没有云同步，文件不经过服务器。"],
  ["多线程是怎么用上的？", "壁厚分析、拔模分析、质量特性与工程图的隐藏线消除都会把任务按三角面/线段范围切块，分发给与逻辑核心数相同的 Web Worker 并行计算，设置里可以调线程数并跑分。"],
  ["GPU 用在哪里？", "视口渲染、选择高亮、剖切裁剪、X-Ray 与阴影都走 GPU（WebGL2）。精确几何与显示网格分离，只有几何真正变化时才重新上传 GPU。"],
  ["为什么导出 STEP 没有特征历史？", "STEP 是交换格式，只带几何。要保住参数化可编辑性请存 .mcad。"],
  ["Pro 包含什么？", "STEP / STL / 3MF 导出、图纸导出 DXF 或多页 PDF、剖切、体测量、拔模与壁厚分析。"],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Wrap title="常见问题">
      <div className="card">
        {FAQ.map(([q, a], i) => (
          <div key={q} className="border-b hairline">
            <div className="px-3 py-2 cursor-pointer flex justify-between" onClick={() => setOpen(open === i ? null : i)}>
              <span className="text-[13px] font-medium">{q}</span>
              <span className="muted">{open === i ? "−" : "+"}</span>
            </div>
            {open === i && <div className="px-3 pb-3 muted text-[12.5px] leading-6">{a}</div>}
          </div>
        ))}
      </div>
    </Wrap>
  );
}

export function Pro() {
  const app = useApp();
  const trialDays = app.trialStart ? Math.max(0, 7 - Math.floor((Date.now() - app.trialStart) / 86400000)) : null;
  return (
    <Wrap title="免费使用，Pro 解锁进阶工具" sub="无账号，无追踪。建模、出图、存工程都免费，Pro 解锁导出与分析工具。">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-[15px] font-semibold">免费版</div>
          <div className="text-[28px] font-bold my-1">¥0</div>
          <ul className="muted text-[12.5px] leading-7">
            {["查看 2D 图纸与 3D 模型", "完整 2D 制图与 3D 建模", "导入 STEP / IGES / STL / OBJ / 3MF / DXF", "保存 .mcad 工程，导出 DXF / PNG / OBJ", "测量距离、角度、半径", "出工程图：图纸、视图、标注、公差"].map((x) => (
              <li key={x}>✓ {x}</li>
            ))}
            <li style={{ opacity: 0.45 }}>✕ STEP / STL / 3MF 导出</li>
            <li style={{ opacity: 0.45 }}>✕ 图纸导出 DXF / PDF</li>
            <li style={{ opacity: 0.45 }}>✕ 剖切</li>
            <li style={{ opacity: 0.45 }}>✕ 测量体、拔模与壁厚分析</li>
          </ul>
        </div>
        <div className="card p-4" style={{ borderColor: "var(--accent)" }}>
          <div className="text-[15px] font-semibold">
            Pro <Badge tone="pro">早鸟价</Badge>
          </div>
          <div className="text-[28px] font-bold my-1">
            $9.99 <span className="text-[14px] muted line-through">$29.90</span> <span className="text-[13px] muted">一次性买断</span>
          </div>
          <ul className="text-[12.5px] leading-7">
            {["STEP / STL / 3MF 导出", "图纸导出 DXF 或多页 PDF", "实时剖切", "测量体、拔模与壁厚分析", "7 天免费试用，无需绑卡", "同一账号可在任意设备恢复"].map((x) => (
              <li key={x}>★ {x}</li>
            ))}
          </ul>
          <div className="flex gap-2 mt-3">
            {!app.pro ? (
              <>
                <button className="btn primary" onClick={() => { app.startTrial(); app.notify("7 天试用已开始，Pro 功能全部解锁", "ok"); }}>
                  开始 7 天试用
                </button>
                <button className="btn" onClick={() => { app.unlockPro(true); app.notify("Pro 已解锁", "ok"); }}>
                  我已购买 · 解锁
                </button>
              </>
            ) : (
              <>
                <Badge tone="ok">Pro 已解锁{trialDays !== null ? ` · 试用剩余 ${trialDays} 天` : ""}</Badge>
                <button className="btn" onClick={() => app.unlockPro(false)}>
                  关闭 Pro（用于对比免费版）
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <p className="muted text-[12px] mt-4">这是早期价格，之后可能调整。实际以结算页显示的价格为准。</p>
    </Wrap>
  );
}
