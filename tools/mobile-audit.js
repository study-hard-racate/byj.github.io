// =========================================================
// mobile-audit.js —— 移动端体验回归审计（tabbit 任务脚本，顶层 await）
// 用法见 tools/TESTING.md；通过标准：
//   0 横向溢出 / 无控制台报错 / 核心触控≥40px / input字号≥16px(≤640) / 最小字号≥11px
// 本地调试：把 BASE 改成 http://127.0.0.1:8765/byj.github.io/
// =========================================================
const BASE = "https://study-hard-racate.github.io/byj.github.io/";
const WIDTHS = [360, 390, 430];

const out = { errors: [], violations: [] };
page.on("pageerror", e => out.errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") out.errors.push("console: " + m.text()); });

const waiters = {
  "index.html": () => { const el = document.getElementById("sExpense"); return el && el.textContent !== "—"; },
  "finance.html": () => document.querySelectorAll("#tbody tr").length > 0,
  "health.html": () => { const el = document.getElementById("sSleep"); return el && el.textContent !== "—"; },
  "report.html": () => { const el = document.getElementById("yExpense"); return el && el.textContent !== "—"; },
  "import.html": () => true,
  "settings.html": () => !!document.getElementById("setName"),
};

async function auditPage(p) {
  await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
  const t0 = Date.now();
  while (!(await page.evaluate(waiters[p])) && Date.now() - t0 < 15000) await page.waitForTimeout(200);
  return page.evaluate(() => {
    const res = { overflow: 0, smallCore: [], minFont: 99, inputFont: null };
    res.overflow = Math.max(0, document.body.scrollWidth - window.innerWidth);
    const coreSel = "button, [data-act], .nav-item, .theme-toggle, .star, .chip.editable, .fab";
    document.querySelectorAll(coreSel).forEach(t => {
      const r = t.getBoundingClientRect();
      const st = getComputedStyle(t);
      if (r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden") {
        if (Math.min(r.width, r.height) < 40 && res.smallCore.length < 4) {
          res.smallCore.push((t.className ? String(t.className).slice(0, 24) : t.tagName) + ":" + Math.round(Math.min(r.width, r.height)) + "px");
        }
      }
    });
    document.querySelectorAll("body *").forEach(el => {
      const st = getComputedStyle(el);
      if (st.display !== "none" && el.children.length === 0 && (el.textContent || "").trim()) {
        const fs = parseFloat(st.fontSize) || 0;
        if (fs > 0 && fs < res.minFont) res.minFont = fs;
      }
    });
    const input = document.querySelector("input, select");
    if (input) res.inputFont = parseFloat(getComputedStyle(input).fontSize) || null;
    return res;
  });
}

for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 800 });
  for (const p of Object.keys(waiters)) {
    const r = await auditPage(p);
    if (r.overflow > 0) out.violations.push(`${w}px ${p}: 横向溢出 ${r.overflow}px`);
    if (w <= 640 && r.inputFont && r.inputFont < 16) out.violations.push(`${w}px ${p}: input 字号 ${r.inputFont}px(<16, iOS会缩放)`);
    if (r.smallCore.length) out.violations.push(`${w}px ${p}: 小触控 ${r.smallCore.join(" / ")}`);
    if (r.minFont < 11) out.violations.push(`${w}px ${p}: 最小字号 ${r.minFont}px`);
  }
}
if (out.errors.length) out.violations.push(`控制台报错 ${out.errors.length} 条: ${out.errors[0]}`);
out.pass = out.violations.length === 0;
console.log(out.pass ? "✅ MOBILE AUDIT PASS" : "❌ MOBILE AUDIT FAIL");
out.violations.forEach(v => console.log("  - " + v));
return out;
