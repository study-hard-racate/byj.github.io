/* =========================================================
   app.js —— 通用交互：主题 / 提示 / 弹窗 / 工具函数
   ========================================================= */

/* ---------- 主题 ---------- */
function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  localStorage.setItem("pd-theme", next);
  syncThemeBtn();
  window.dispatchEvent(new CustomEvent("themechange"));
}
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === "dark";
  const icon = document.getElementById("themeIcon");
  const text = document.getElementById("themeText");
  if (icon) icon.textContent = dark ? "🌙" : "☀️";
  if (text) text.textContent = dark ? "深色" : "浅色";
}
(function initTheme() {
  const saved = localStorage.getItem("pd-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  document.addEventListener("DOMContentLoaded", syncThemeBtn);
  syncThemeBtn();
})();

/* ---------- 轻提示 ---------- */
let toastTimer = null;
function toast(msg, type) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.borderColor = type === "error" ? "var(--red)"
    : type === "ok" ? "var(--green)" : "var(--border)";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ---------- 弹窗 ---------- */
function openModal(html, onMount) {
  closeModal();
  const mask = document.createElement("div");
  mask.className = "modal-mask show";
  mask.id = "pd-modal";
  mask.innerHTML = `<div class="modal">${html}</div>`;
  mask.addEventListener("click", e => { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
  if (onMount) onMount(mask);
  return mask;
}
function closeModal() {
  const m = document.getElementById("pd-modal");
  if (m) m.remove();
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

/* ---------- 分类颜色 ---------- */
function catColor(name) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 58%)`;
}
function chipHtml(cat) {
  return `<span class="chip"><span class="dot" style="background:${catColor(cat)}"></span>${esc(cat)}</span>`;
}

/* ---------- 工具 ---------- */
const money = n => "¥" + Number(n || 0).toLocaleString("zh-CN",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = n => "¥" + Math.round(Number(n || 0)).toLocaleString("zh-CN");

// 修复原版 XSS 隐患：单引号、反引号也转义
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/`/g, "&#96;");
}

function emptyState(icon, text, btnHtml) {
  return `<div class="empty"><div class="big">${icon}</div><p>${esc(text)}</p>${btnHtml || ""}</div>`;
}

/* ---------- 文件下载 ---------- */
function download(filename, text, mime = "text/plain") {
  const blob = new Blob(["\uFEFF" + text], { type: mime }); // 带 BOM，Excel 打开中文不乱码
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* ---------- 数字/日期 ---------- */
const pad2 = n => String(n).padStart(2, "0");
function nowMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function monthLabel(m) { return m ? m.slice(0, 4) + " 年 " + Number(m.slice(5)) + " 月" : ""; }
