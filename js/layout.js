/* =========================================================
   layout.js —— 侧边栏 / 底部导航 / 标题（品牌来自配置或设置）
   ========================================================= */

const NAV = [
  { href: "index.html",   icon: "🏠", label: "总览",   key: "index" },
  { href: "finance.html", icon: "💰", label: "财务账单", key: "finance" },
  { href: "health.html",  icon: "❤️", label: "习惯健康", key: "health" },
  { href: "report.html",  icon: "📈", label: "年度报告", key: "report" },
  { href: "import.html",  icon: "📥", label: "导入规则", key: "import" },
  { href: "settings.html", icon: "⚙️", label: "设置",    key: "settings" },
];

async function renderLayout() {
  const page = document.body.dataset.page || "";
  const brand = await DB.getSetting("brand", null) || APP_CONFIG.brand;

  document.title = brand.name + (page ? " · " + NAV.find(n => n.key === page)?.label : "");

  const navLinks = NAV.map(n => `
    <a href="${n.href}" class="nav-item ${n.key === page ? "active" : ""}">
      <span class="ico">${n.icon}</span><span>${n.label}</span>
    </a>`).join("");
  const bottomLinks = NAV.map(n => `
    <a href="${n.href}" class="${n.key === page ? "active" : ""}">
      <span class="ico">${n.icon}</span><span>${n.label}</span>
    </a>`).join("");

  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand">
        <div class="brand-mark">${esc(brand.logo || "B")}</div>
        <div class="brand-text">
          <strong>${esc(brand.name)}</strong>
          <span>${esc(brand.sub || "")}</span>
        </div>
      </div>
      <nav class="nav">${navLinks}</nav>
      <div class="sidebar-foot">
        <button class="theme-toggle" onclick="toggleTheme()">
          <span id="themeIcon">🌙</span> <span id="themeText">深色</span>
        </button>
        <button class="theme-toggle" id="installBtn" style="display:none;margin-top:8px">
          📲 安装到桌面
        </button>
        <div class="hint">数据只存在你的浏览器本地<br>可在「设置」里导出备份</div>
      </div>`;
  }

  const mobileTop = document.getElementById("mobileTop");
  if (mobileTop) {
    mobileTop.innerHTML = `
      <div class="brand-mark">${esc(brand.logo || "B")}</div>
      <div class="brand-text"><strong>${esc(brand.name)}</strong></div>
      <div class="spacer"></div>
      <button class="theme-toggle" onclick="toggleTheme()">
        <span id="themeIconM">🌙</span>
      </button>`;
  }

  const bottomNav = document.getElementById("bottomNav");
  if (bottomNav) bottomNav.innerHTML = bottomLinks;

  // PWA 安装提示
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById("installBtn");
    if (btn) btn.style.display = "";
  });
  document.addEventListener("click", async (e) => {
    if (e.target.closest("#installBtn") && deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    }
  });

  syncThemeBtn();
  const iconM = document.getElementById("themeIconM");
  if (iconM) {
    const dark = document.documentElement.dataset.theme === "dark";
    iconM.textContent = dark ? "🌙" : "☀️";
  }
}

// PWA：注册 Service Worker（离线缓存）
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(e => {
      console.warn("Service Worker 注册失败（不影响使用）:", e);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => renderLayout().catch(console.error));
