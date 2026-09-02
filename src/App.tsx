import { useEffect } from "react";
import { useApp, type Page } from "./store";
import { Icon } from "./components/icons";
import { MoreMenu, MenuItem, MenuGroup } from "./components/ui";
import { LANGS } from "./i18n";
import Home from "./pages/Home";
import Editor3D from "./editor3d/Editor3D";
import Editor2D from "./editor2d/Editor2D";
import Drawing from "./drawing/Drawing";
import Tutorials from "./pages/Tutorials";
import Changelog from "./pages/Changelog";
import Settings from "./pages/Settings";
import { Features, Formats, Roadmap, Faq, Pro } from "./pages/Content";
import { use3D } from "./editor3d/store3d";

/** 主工作区：常驻导航 */
const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "首页", icon: "home" },
  { id: "model", label: "3D 建模", icon: "cube" },
  { id: "draft2d", label: "2D 制图", icon: "dimLinear" },
  { id: "drawing", label: "工程制图", icon: "drawingSheet" },
  { id: "tutorials", label: "教程", icon: "book" },
];

/** 资料与设置：收进右上角 ⋮ 更多菜单 */
const MORE_NAV: { id: Page; label: string; icon: string; hint: string }[] = [
  { id: "features", label: "功能", icon: "auto", hint: "v1.3.1 里真正做出来的东西" },
  { id: "formats", label: "格式支持", icon: "folder", hint: "能打开 / 能编辑 / 能导出什么" },
  { id: "changelog", label: "更新日志", icon: "clock", hint: "每个版本改了什么" },
  { id: "roadmap", label: "路线图", icon: "compass", hint: "接下来做什么、已知短板" },
  { id: "faq", label: "常见问题", icon: "help", hint: "联网、设备、文件存哪" },
  { id: "settings", label: "设置", icon: "settings", hint: "语言 · 性能 · 着色 · 配色 · 快捷键" },
];

export default function App() {
  const app = useApp();
  const st = use3D();

  useEffect(() => {
    document.documentElement.classList.toggle("light", app.settings.theme === "light");
    document.documentElement.lang = app.settings.lang;
    document.documentElement.dir = app.settings.lang === "ar" ? "rtl" : "ltr";
  }, [app.settings.theme, app.settings.lang]);

  useEffect(() => {
    if (!st.build.bodies.length && st.features.length) st.rebuild();
  }, []);

  const page = app.page;

  return (
    <div className="w-full h-full flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* 顶部导航 */}
      <div className="flex items-center gap-1 px-3 h-[42px] border-b hairline shrink-0" style={{ background: "var(--panel)" }}>
        <div className="flex items-center gap-2 mr-3 cursor-pointer" onClick={() => app.setPage("home")}>
          <svg width="22" height="22" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#0b0f14" />
            <path d="M16 4 27 10.2v11.6L16 28 5 21.8V10.2z" fill="none" stroke="#38bdf8" strokeWidth="2" />
            <path d="M16 16 27 10.2M16 16 5 10.2M16 16v12" stroke="#38bdf8" strokeWidth="1.4" opacity=".7" />
          </svg>
          <span className="font-bold text-[14px]">
            指尖3D <span className="muted font-normal text-[11px]">电脑版 · Digit3D Desktop</span>
          </span>
        </div>
        <div className="flex items-center gap-1 overflow-auto">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={"chip " + (page === n.id ? "on" : "")}
              onClick={() => app.setPage(n.id)}
              style={{ padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <Icon name={n.icon} size={14} />
              {n.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button className={"btn sm " + (app.pro ? "active" : "primary")} onClick={() => app.setPage("pro")}>
          {app.pro ? "★ Pro 已解锁" : "解锁 Pro"}
        </button>
        <MoreMenu width={290} title="更多：功能 · 格式 · 更新日志 · 路线图 · 设置">
          <MenuGroup title="资料与帮助">
            {MORE_NAV.slice(0, 5).map((n) => (
              <MenuItem key={n.id} icon={n.icon} label={n.label} hint={n.hint} onClick={() => app.setPage(n.id)} right={page === n.id ? <span className="accent text-[11px]">当前</span> : undefined} />
            ))}
          </MenuGroup>
          <MenuGroup title="设置">
            <MenuItem icon="settings" label="打开设置" hint="语言 · 性能 · 着色 · 镶嵌 · 基准面 · 配色" onClick={() => app.setPage("settings")} />
            <div className="px-2 py-1">
              <div className="flex items-center justify-between py-[3px]">
                <span className="text-[11.5px] muted">主题</span>
                <div className="flex gap-1">
                  <button className={"chip " + (app.settings.theme === "dark" ? "on" : "")} onClick={() => app.set("theme", "dark")}>深色</button>
                  <button className={"chip " + (app.settings.theme === "light" ? "on" : "")} onClick={() => app.set("theme", "light")}>浅色</button>
                </div>
              </div>
              <div className="flex items-center justify-between py-[3px]">
                <span className="text-[11.5px] muted">界面语言</span>
                <select className="inp" style={{ width: 130 }} value={app.settings.lang} onChange={(e) => app.set("lang", e.target.value as any)}>
                  {LANGS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.flag} {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </MenuGroup>
          <MenuGroup title="Pro">
            <MenuItem icon="star" label={app.pro ? "Pro 已解锁" : "解锁 Pro / 7 天试用"} onClick={() => app.setPage("pro")} />
          </MenuGroup>
        </MoreMenu>
      </div>

      {/* 页面 */}
      <div className="flex-1 min-h-0 relative">
        {page === "home" && <Home />}
        {page === "model" && <Editor3D />}
        {page === "draft2d" && <Editor2D />}
        {page === "drawing" && <Drawing />}
        {page === "tutorials" && <Tutorials />}
        {page === "features" && <Features />}
        {page === "formats" && <Formats />}
        {page === "changelog" && <Changelog />}
        {page === "roadmap" && <Roadmap />}
        {page === "faq" && <Faq />}
        {page === "pro" && <Pro />}
        {page === "settings" && <Settings />}
      </div>

      {/* Toast */}
      {app.toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-6 px-4 py-2 rounded-lg text-[12.5px] fade z-[100]"
          style={{
            background: "var(--panel)",
            border: `1px solid ${app.toast.kind === "err" ? "var(--danger)" : app.toast.kind === "warn" ? "var(--warn)" : app.toast.kind === "ok" ? "var(--ok)" : "var(--line)"}`,
            boxShadow: "0 8px 30px rgba(0,0,0,.45)",
          }}
        >
          {app.toast.text}
        </div>
      )}
    </div>
  );
}
