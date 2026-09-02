import { useState, useRef } from "react";
import { useApp } from "../store";
import { use3D, sampleBracket } from "../editor3d/store3d";
import { Modal, Badge } from "../components/ui";
import { cpuThreads, gpuInfo } from "../workers/pool";
import { uid, type Project2D } from "../cad/types";
import { parseSTL, parseOBJ, parse3MF } from "../io/mesh";
import { parseSTEPParallel } from "../io/stepParallel";
import { parseDXF } from "../io/dxf";

export default function Home() {
  const app = useApp();
  const st = use3D();
  const [filter, setFilter] = useState<"all" | "3d" | "2d">("all");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gpu = gpuInfo();

  const list = app.projects
    .filter((p) => (filter === "all" ? true : p.kind === filter))
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  const openProject = (id: string) => {
    const p = app.projects.find((x) => x.id === id);
    if (!p) return;
    if (p.kind === "3d") {
      st.loadProject(p);
      app.setPage("model");
    } else {
      app.openProject(id);
      app.setPage("draft2d");
    }
  };

  const newSample3D = () => {
    st.reset("支座示例");
    st.set("features", sampleBracket());
    st.rebuild();
    app.setPage("model");
  };

  const newSample2D = () => {
    const p: Project2D = {
      id: uid("prj"),
      name: "底板示例 100×50",
      kind: "2d",
      layers: [{ name: "0", color: "#dbe6f2", visible: true, locked: false }],
      entities: [
        { id: uid("e"), kind: "polyline", layer: "0", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], closed: true },
        { id: uid("e"), kind: "circle", layer: "0", c: { x: 25, y: 25 }, r: 8.5 },
        { id: uid("e"), kind: "circle", layer: "0", c: { x: 75, y: 25 }, r: 8.5 },
        { id: uid("e"), kind: "dim", layer: "0", dimType: "linear", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, pos: { x: 50, y: -14 }, c: { x: 50, y: -14 }, value: 100 },
        { id: uid("e"), kind: "dim", layer: "0", dimType: "linear", a: { x: 100, y: 0 }, b: { x: 100, y: 50 }, pos: { x: 118, y: 25 }, c: { x: 118, y: 25 }, value: 50 },
      ],
      updated: Date.now(),
    };
    app.upsertProject(p);
    app.openProject(p.id);
    app.setPage("draft2d");
  };

  const onImport = async (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    try {
      if (ext === "dxf") {
        const { entities, layers } = parseDXF(await f.text());
        const p: Project2D = { id: uid("prj"), name: f.name.replace(/\.[^.]+$/, ""), kind: "2d", entities, layers, updated: Date.now() };
        app.upsertProject(p);
        app.openProject(p.id);
        app.setPage("draft2d");
        return;
      }
      if (ext === "mcad") {
        st.loadProject(JSON.parse(await f.text()));
        app.setPage("model");
        return;
      }
      const buf = await f.arrayBuffer();
      let meshes: { positions: Float32Array; name: string }[] = [];
      if (ext === "stl") meshes = parseSTL(buf, f.name);
      else if (ext === "obj") meshes = parseOBJ(new TextDecoder().decode(buf), f.name);
      else if (ext === "3mf") meshes = parse3MF(buf);
      else if (ext === "step" || ext === "stp") {
        app.notify(`正在用 ${app.settings.threads} 线程并行解析 STEP…`, "info");
        const r = await parseSTEPParallel(new TextDecoder().decode(buf), app.settings.threads);
        meshes = r.meshes;
        app.notify(`${r.entities} 实体 / ${r.faces} 面 · ${r.threads} 线程 ${(r.ms / 1000).toFixed(1)} s`, "ok");
      }
      if (!meshes.length) throw new Error(`不支持的格式 .${ext}`);
      st.reset(f.name.replace(/\.[^.]+$/, ""));
      meshes.forEach((m) =>
        st.addFeature({ id: uid("f"), type: "import", name: m.name, source: f.name, positions: Array.from(m.positions), indices: [] } as any),
      );
      app.setPage("model");
      app.notify(`${f.name} 已导入`, "ok");
    } catch (e) {
      app.notify(String((e as Error).message), "err");
    }
  };

  return (
    <div className="w-full h-full overflow-auto">
      {/* Hero */}
      <div className="px-8 pt-8 pb-6 border-b hairline" style={{ background: "linear-gradient(160deg,#101922,#0b0f14 60%)" }}>
        <div className="max-w-[1100px] mx-auto">
          <div className="flex items-center gap-2 mb-2">
            <Badge tone="ok">v1.3.1 桌面版</Badge>
            <Badge tone="beta">工程制图 Beta</Badge>
            <Badge>离线本机运行</Badge>
          </div>
          <h1 className="text-[30px] font-bold leading-tight">把一套 CAD 内核放进电脑</h1>
          <p className="muted mt-2 max-w-[720px] text-[13.5px]">
            草图约束、参数化特征历史、布尔运算、同步建模、曲面、工程制图、2D 制图、测量与分析——
            全部在本机运行：几何运算走 <b className="accent">多线程 CPU</b>（{cpuThreads()} 逻辑核），显示与拾取走 <b className="accent">GPU</b>（{gpu.webgl2 ? "WebGL2" : "WebGL"}）。
          </p>
          <div className="flex gap-2 mt-4 flex-wrap">
            <button className="btn primary" onClick={() => setShowNew(true)}>＋ 新建 / 导入</button>
            <button className="btn" onClick={newSample3D}>打开 3D 支座示例</button>
            <button className="btn" onClick={newSample2D}>打开 2D 底板示例</button>
            <button className="btn" onClick={() => app.setPage("tutorials")}>看教程（5 篇 · 68 分钟）</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[
              ["100%", "离线本机运行"],
              ["B-Rep", "参数化特征内核"],
              [`${cpuThreads()} 线程`, "并行几何运算"],
              [gpu.webgl2 ? "WebGL2" : "WebGL", gpu.renderer.slice(0, 28) || "GPU 渲染"],
            ].map(([a, b]) => (
              <div key={b} className="card p-3">
                <div className="text-[20px] font-bold accent">{a}</div>
                <div className="muted text-[11.5px]">{b}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 最近文件 */}
      <div className="max-w-[1100px] mx-auto px-8 py-6">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[16px] font-semibold">最近文件</h2>
          <div className="flex gap-1">
            {(["all", "3d", "2d"] as const).map((f) => (
              <button key={f} className={"chip " + (filter === f ? "on" : "")} onClick={() => setFilter(f)}>
                {f === "all" ? "全部" : f.toUpperCase()}
              </button>
            ))}
          </div>
          <input className="inp" style={{ width: 200 }} placeholder="搜索项目名称…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex-1" />
          <button className="btn sm" onClick={() => fileRef.current?.click()}>从设备导入</button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".dxf,.mcad,.stl,.obj,.3mf,.step,.stp,.iges,.igs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {list.map((p) => (
            <div
              key={p.id}
              className="card p-3 cursor-pointer hover:border-sky-500 relative"
              onClick={() => openProject(p.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(p.id);
              }}
            >
              <div className="text-[26px] mb-1">{p.kind === "3d" ? "🧊" : "📐"}</div>
              <div className="text-[13px] font-medium truncate">{p.name}</div>
              <div className="muted text-[11px]">
                {p.kind.toUpperCase()} · {new Date(p.updated).toLocaleString()}
              </div>
              {menu === p.id && (
                <div className="absolute right-2 top-2 panel rounded p-1 z-10 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn sm"
                    onClick={() => {
                      const n = window.prompt("重命名", p.name);
                      if (n) app.renameProject(p.id, n);
                      setMenu(null);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => {
                      app.deleteProject(p.id);
                      setMenu(null);
                    }}
                  >
                    删除
                  </button>
                  <button className="btn sm" onClick={() => setMenu(null)}>取消</button>
                </div>
              )}
            </div>
          ))}
          {!list.length && <div className="muted col-span-4 p-6 text-center card">还没有项目。点「新建 / 导入」开始，或打开内置示例。</div>}
        </div>

        <h2 className="text-[16px] font-semibold mt-8">内置示例</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <div className="card p-3 cursor-pointer" onClick={newSample3D}>
            <div className="text-[26px]">🧊</div>
            <div className="text-[13px]">支座（底板 + Ø20 凸台 + Ø8 通孔）</div>
            <div className="muted text-[11px]">3D · 参数化特征历史</div>
          </div>
          <div className="card p-3 cursor-pointer" onClick={newSample2D}>
            <div className="text-[26px]">📐</div>
            <div className="text-[13px]">底板 100 × 50，2×Ø17</div>
            <div className="muted text-[11px]">2D · 含标注</div>
          </div>
          <div className="card p-3 cursor-pointer" onClick={() => app.setPage("formats")}>
            <div className="text-[26px]">🗂</div>
            <div className="text-[13px]">格式速查表</div>
            <div className="muted text-[11px]">能打开什么、能编辑什么、能导出什么</div>
          </div>
          <div className="card p-3 cursor-pointer" onClick={() => app.setPage("pro")}>
            <div className="text-[26px]">🔓</div>
            <div className="text-[13px]">解锁 Pro / 7 天试用</div>
            <div className="muted text-[11px]">导出 · 剖切 · 分析</div>
          </div>
        </div>
      </div>

      {showNew && (
        <Modal title="新建或导入" onClose={() => setShowNew(false)} width={480}>
          <div className="grid grid-cols-1 gap-2">
            <button
              className="btn"
              onClick={() => {
                st.reset("未命名模型");
                app.setPage("model");
                setShowNew(false);
              }}
            >
              🧊 空白 3D 模型（草图 · 实体特征）
            </button>
            <button
              className="btn"
              onClick={() => {
                const p: Project2D = { id: uid("prj"), name: "未命名图纸", kind: "2d", entities: [], layers: [{ name: "0", color: "#dbe6f2", visible: true, locked: false }], updated: Date.now() };
                app.upsertProject(p);
                app.openProject(p.id);
                app.setPage("draft2d");
                setShowNew(false);
              }}
            >
              📐 空白 2D 图纸（立即生成有效空白 DXF）
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              📥 从设备导入（DXF / MCAD / STEP / STL / OBJ / 3MF）
            </button>
          </div>
          <div className="muted text-[11.5px] mt-3">
            真实 2D 导入请使用 ASCII DXF；二进制 DXF 与真实 DWG 需先转换。MCAD 保留可编辑的 3D 工程数据。
          </div>
        </Modal>
      )}
    </div>
  );
}
