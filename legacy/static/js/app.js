/* 通用交互：主题切换 / 提示 / 请求封装 / 弹窗 */

/* ---------- 主题 ---------- */
function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  localStorage.setItem("pd-theme", next);
  syncThemeBtn();
  // 图表用了主题色，切主题后重绘
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
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- 请求封装 ---------- */
async function api(url, options) {
  const opts = Object.assign({
    headers: { "Content-Type": "application/json" },
  }, options || {});
  if (opts.body && typeof opts.body === "object") {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (data && data.msg) || "请求失败";
    toast(msg, "error");
    throw new Error(msg);
  }
  return data;
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
const CAT_COLORS = window.CAT_COLORS || {};
function catColor(name) {
  if (CAT_COLORS[name]) return CAT_COLORS[name];
  // 未收录的分类：用名字哈希出一个稳定的颜色
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 58%)`;
}
function chipHtml(cat) {
  return `<span class="chip"><span class="dot" style="background:${catColor(cat)}"></span>${cat}</span>`;
}

/* ---------- 工具 ---------- */
const money = n => "¥" + Number(n || 0).toLocaleString("zh-CN",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = n => "¥" + Math.round(Number(n || 0)).toLocaleString("zh-CN");
const esc = s => String(s === null || s === undefined ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function emptyState(icon, text, btnHtml) {
  return `<div class="empty"><div class="big">${icon}</div><p>${text}</p>${btnHtml || ""}</div>`;
}
