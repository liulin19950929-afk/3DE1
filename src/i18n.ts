// 11 种界面语言 —— 与 App 保持一致（缺失键回退到英文，再回退到中文）
export type Lang =
  | "zh-CN"
  | "en"
  | "ja"
  | "ko"
  | "de"
  | "fr"
  | "es"
  | "pt"
  | "ru"
  | "it"
  | "ar";

export const LANGS: { id: Lang; label: string; flag: string }[] = [
  { id: "zh-CN", label: "简体中文", flag: "🇨🇳" },
  { id: "en", label: "English", flag: "🇬🇧" },
  { id: "ja", label: "日本語", flag: "🇯🇵" },
  { id: "ko", label: "한국어", flag: "🇰🇷" },
  { id: "de", label: "Deutsch", flag: "🇩🇪" },
  { id: "fr", label: "Français", flag: "🇫🇷" },
  { id: "es", label: "Español", flag: "🇪🇸" },
  { id: "pt", label: "Português", flag: "🇵🇹" },
  { id: "ru", label: "Русский", flag: "🇷🇺" },
  { id: "it", label: "Italiano", flag: "🇮🇹" },
  { id: "ar", label: "العربية", flag: "🇸🇦" },
];

type Dict = Record<string, string>;

const zh: Dict = {
  "app.name": "指尖3D 电脑版",
  "nav.home": "首页",
  "nav.model": "3D 建模",
  "nav.draft": "2D 制图",
  "nav.drawing": "工程制图",
  "nav.tutorials": "教程",
  "nav.features": "功能",
  "nav.formats": "格式",
  "nav.changelog": "更新日志",
  "nav.roadmap": "路线图",
  "nav.settings": "设置",
  "nav.pro": "解锁 Pro",
  "nav.faq": "常见问题",
  "common.new": "新建",
  "common.open": "打开",
  "common.import": "导入",
  "common.export": "导出",
  "common.save": "保存",
  "common.cancel": "取消",
  "common.ok": "确定",
  "common.delete": "删除",
  "common.rename": "重命名",
  "common.close": "关闭",
  "common.apply": "应用",
  "common.undo": "撤销",
  "common.redo": "重做",
  "common.search": "搜索",
  "common.all": "全部",
  "common.free": "免费",
  "common.pro": "Pro",
  "home.recent": "最近文件",
  "home.samples": "内置示例",
  "home.empty": "还没有项目。点右下角「+」新建，或从设备导入。",
  "tool.sketch": "草图",
  "tool.datum": "基准面",
  "tool.extrude": "拉伸",
  "tool.revolve": "旋转体",
  "tool.sync": "同步",
  "tool.transform": "变换",
  "tool.surface": "曲面",
  "tool.boolean": "布尔",
  "tool.fillet": "圆角",
  "tool.shell": "抽壳",
  "tool.draft": "拔模",
  "tool.more": "更多",
  "view.tree": "建模树",
  "view.bodies": "体",
  "view.section": "剖切",
  "view.display": "显示",
  "view.measure": "测量",
  "view.draftA": "拔模",
  "view.thick": "壁厚",
  "view.render": "渲染",
};

const en: Dict = {
  "app.name": "Digit3D Desktop",
  "nav.home": "Home",
  "nav.model": "3D Modeling",
  "nav.draft": "2D Drafting",
  "nav.drawing": "Drawings",
  "nav.tutorials": "Tutorials",
  "nav.features": "Features",
  "nav.formats": "Formats",
  "nav.changelog": "Changelog",
  "nav.roadmap": "Roadmap",
  "nav.settings": "Settings",
  "nav.pro": "Unlock Pro",
  "nav.faq": "FAQ",
  "common.new": "New",
  "common.open": "Open",
  "common.import": "Import",
  "common.export": "Export",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.ok": "OK",
  "common.delete": "Delete",
  "common.rename": "Rename",
  "common.close": "Close",
  "common.apply": "Apply",
  "common.undo": "Undo",
  "common.redo": "Redo",
  "common.search": "Search",
  "common.all": "All",
  "common.free": "Free",
  "common.pro": "Pro",
  "home.recent": "Recent files",
  "home.samples": "Built-in samples",
  "home.empty": "No projects yet. Use the + button to create one, or import from disk.",
  "tool.sketch": "Sketch",
  "tool.datum": "Datum",
  "tool.extrude": "Extrude",
  "tool.revolve": "Revolve",
  "tool.sync": "Sync",
  "tool.transform": "Transform",
  "tool.surface": "Surface",
  "tool.boolean": "Boolean",
  "tool.fillet": "Fillet",
  "tool.shell": "Shell",
  "tool.draft": "Draft",
  "tool.more": "More",
  "view.tree": "Tree",
  "view.bodies": "Bodies",
  "view.section": "Section",
  "view.display": "Display",
  "view.measure": "Measure",
  "view.draftA": "Draft",
  "view.thick": "Thickness",
  "view.render": "Render",
};

const partial: Record<Exclude<Lang, "zh-CN" | "en">, Dict> = {
  ja: {
    "nav.home": "ホーム", "nav.model": "3Dモデリング", "nav.draft": "2D作図", "nav.drawing": "図面",
    "nav.tutorials": "チュートリアル", "nav.features": "機能", "nav.formats": "形式",
    "nav.changelog": "更新履歴", "nav.roadmap": "ロードマップ", "nav.settings": "設定", "nav.pro": "Pro解除",
    "tool.sketch": "スケッチ", "tool.extrude": "押し出し", "tool.revolve": "回転", "tool.boolean": "ブール",
    "tool.fillet": "フィレット", "tool.shell": "シェル", "tool.draft": "抜き勾配", "common.new": "新規",
  },
  ko: {
    "nav.home": "홈", "nav.model": "3D 모델링", "nav.draft": "2D 제도", "nav.drawing": "도면",
    "nav.tutorials": "튜토리얼", "nav.features": "기능", "nav.formats": "형식", "nav.changelog": "변경 내역",
    "nav.roadmap": "로드맵", "nav.settings": "설정", "nav.pro": "Pro 해제", "tool.sketch": "스케치",
    "tool.extrude": "돌출", "tool.revolve": "회전", "tool.boolean": "불리언", "common.new": "새로 만들기",
  },
  de: {
    "nav.home": "Start", "nav.model": "3D-Modellierung", "nav.draft": "2D-Zeichnen", "nav.drawing": "Zeichnungen",
    "nav.tutorials": "Tutorials", "nav.features": "Funktionen", "nav.formats": "Formate",
    "nav.changelog": "Änderungen", "nav.roadmap": "Roadmap", "nav.settings": "Einstellungen",
    "nav.pro": "Pro freischalten", "tool.sketch": "Skizze", "tool.extrude": "Extrudieren",
    "tool.revolve": "Drehen", "tool.boolean": "Boolesch", "common.new": "Neu",
  },
  fr: {
    "nav.home": "Accueil", "nav.model": "Modélisation 3D", "nav.draft": "Dessin 2D", "nav.drawing": "Mises en plan",
    "nav.tutorials": "Tutoriels", "nav.features": "Fonctions", "nav.formats": "Formats",
    "nav.changelog": "Journal", "nav.roadmap": "Feuille de route", "nav.settings": "Réglages",
    "nav.pro": "Débloquer Pro", "tool.sketch": "Esquisse", "tool.extrude": "Extrusion",
    "tool.revolve": "Révolution", "tool.boolean": "Booléen", "common.new": "Nouveau",
  },
  es: {
    "nav.home": "Inicio", "nav.model": "Modelado 3D", "nav.draft": "Dibujo 2D", "nav.drawing": "Planos",
    "nav.tutorials": "Tutoriales", "nav.features": "Funciones", "nav.formats": "Formatos",
    "nav.changelog": "Cambios", "nav.roadmap": "Hoja de ruta", "nav.settings": "Ajustes",
    "nav.pro": "Desbloquear Pro", "tool.sketch": "Croquis", "tool.extrude": "Extrusión",
    "tool.revolve": "Revolución", "tool.boolean": "Booleana", "common.new": "Nuevo",
  },
  pt: {
    "nav.home": "Início", "nav.model": "Modelagem 3D", "nav.draft": "Desenho 2D", "nav.drawing": "Desenhos",
    "nav.tutorials": "Tutoriais", "nav.features": "Recursos", "nav.formats": "Formatos",
    "nav.changelog": "Novidades", "nav.roadmap": "Roteiro", "nav.settings": "Ajustes",
    "nav.pro": "Desbloquear Pro", "tool.sketch": "Esboço", "tool.extrude": "Extrusão",
    "tool.revolve": "Revolução", "tool.boolean": "Booleana", "common.new": "Novo",
  },
  ru: {
    "nav.home": "Главная", "nav.model": "3D-моделирование", "nav.draft": "2D-черчение", "nav.drawing": "Чертежи",
    "nav.tutorials": "Уроки", "nav.features": "Функции", "nav.formats": "Форматы",
    "nav.changelog": "История", "nav.roadmap": "План", "nav.settings": "Настройки",
    "nav.pro": "Открыть Pro", "tool.sketch": "Эскиз", "tool.extrude": "Выдавить",
    "tool.revolve": "Вращение", "tool.boolean": "Булева", "common.new": "Создать",
  },
  it: {
    "nav.home": "Home", "nav.model": "Modellazione 3D", "nav.draft": "Disegno 2D", "nav.drawing": "Tavole",
    "nav.tutorials": "Tutorial", "nav.features": "Funzioni", "nav.formats": "Formati",
    "nav.changelog": "Novità", "nav.roadmap": "Roadmap", "nav.settings": "Impostazioni",
    "nav.pro": "Sblocca Pro", "tool.sketch": "Schizzo", "tool.extrude": "Estrusione",
    "tool.revolve": "Rivoluzione", "tool.boolean": "Booleana", "common.new": "Nuovo",
  },
  ar: {
    "nav.home": "الرئيسية", "nav.model": "نمذجة ثلاثية", "nav.draft": "رسم ثنائي", "nav.drawing": "المخططات",
    "nav.tutorials": "الدروس", "nav.features": "الميزات", "nav.formats": "الصيغ",
    "nav.changelog": "السجل", "nav.roadmap": "خارطة الطريق", "nav.settings": "الإعدادات",
    "nav.pro": "تفعيل Pro", "tool.sketch": "رسم", "tool.extrude": "بثق",
    "tool.revolve": "تدوير", "tool.boolean": "بوليني", "common.new": "جديد",
  },
};

export function translate(lang: Lang, key: string): string {
  if (lang === "zh-CN") return zh[key] ?? en[key] ?? key;
  if (lang === "en") return en[key] ?? zh[key] ?? key;
  const d = partial[lang];
  return d[key] ?? en[key] ?? zh[key] ?? key;
}
