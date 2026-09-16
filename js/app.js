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

/* =========================================================
   动效层（app.js —— 移动端"活"起来的那部分）
   两条铁律：
   1) 尊重 prefers-reduced-motion —— 用户关掉动态效果时，一切静默且内容照常可见；
   2) 只动 transform / opacity，走合成器，绝不触发布局（长列表滚动不掉帧）。
   ========================================================= */
const MQ_REDUCE = (typeof window.matchMedia === "function")
  ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
function motionOK() { return !(MQ_REDUCE && MQ_REDUCE.matches); }

/* ---------- 数字滚动（金额统计用；从上次显示的值滚到新值） ---------- */
function countUp(el, to, fmt, ms) {
  if (!el) return;
  const target = Number(to);
  if (!isFinite(target)) return;
  const start = isFinite(el._cv) ? el._cv : 0;
  if (!motionOK() || start === target) {
    if (el._cuRaf) { cancelAnimationFrame(el._cuRaf); el._cuRaf = null; }
    el._cv = target;
    el.textContent = fmt(target);
    return;
  }
  if (el._cuRaf) cancelAnimationFrame(el._cuRaf);
  const dur = ms || 480, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3); // easeOutCubic
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur);
    const v = start + (target - start) * ease(p);
    el._cv = p === 1 ? target : v;
    el.textContent = fmt(el._cv);
    el._cuRaf = p < 1 ? requestAnimationFrame(tick) : null;
  };
  el._cuRaf = requestAnimationFrame(tick);
}

/* ---------- 进场 / 滚动显现 ---------- */
/**
 * 给"当前真正渲染出来"的块（页头、卡片、统计卡、横幅）排错峰序号并挂 .anim，
 * 由 CSS 做一次性进场动画。
 *
 * 两个刻意的设计取舍：
 * 1) 不做"滚动到才显现"。那种做法要常驻 opacity:0 再等 IntersectionObserver 来揭，
 *    观察器一旦没按预期触发，用户看到的就是"内容不见了"——看板不能有这种失败模式。
 * 2) 只给**有盒子的**元素挂动画。display:none 的空态卡片如果也挂上
 *    fill-mode:backwards 的动画，动画永远不会开始，就会一直停在 from 那一帧（opacity:0）；
 *    等用户清空数据、空态终于显示出来时，看到的是一张透明卡片。
 *    所以隐藏中的元素一律不挂：最坏情况只是"没动画"，内容永远看得见。
 */
function staggerScan(scope) {
  if (!motionOK()) return 0;
  const root = scope || document;
  const all = [...root.querySelectorAll(".main .page-head, .main .card, .main .stat, .main .banner")];
  const outer = all.filter(el => !all.some(o => o !== el && el.contains(o)));
  let n = 0;
  for (const el of outer) {
    if (el.dataset.rv) continue;
    if (!el.getClientRects().length) continue; // 隐藏中（display:none 的空态、未展开的面板）→ 不挂动画
    el.dataset.rv = "1";
    el.style.setProperty("--rv", String(Math.min(n, 7)));
    el.classList.add("anim");
    // 兜底：浏览器在后台标签页会冻结动画时钟（document.timeline 不走），
    // 那样 fill-mode:backwards 会一直停在 opacity:0。定时器在后台仍会执行，
    // 到点直接摘掉 .anim，无论动画有没有跑完，内容都保证可见。
    setTimeout(() => { el.classList.remove("anim"); el.style.removeProperty("--rv"); }, 1000);
    n++;
  }
  return n;
}

/* ---------- 顶栏滚动投影（滚动时才浮起来） ---------- */
(function stickyTopShadow() {
  const bar = document.getElementById("mobileTop");
  if (!bar) return;
  let ticking = false;
  const update = () => { ticking = false; bar.classList.toggle("scrolled", window.scrollY > 4); };
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
})();

