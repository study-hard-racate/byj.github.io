/* =========================================================
   page-import.js —— 导入与规则页
   ========================================================= */
const dz = document.getElementById("dropZone");
const fi = document.getElementById("fileInput");
const fn = document.getElementById("fileName");
let PARSED = null; // {records, meta, text}

dz.addEventListener("click", () => fi.click());
dz.addEventListener("dragover", e => {
  e.preventDefault();
  dz.style.borderColor = "var(--accent)";
  dz.style.background = "rgba(92,124,250,.06)";
});
dz.addEventListener("dragleave", () => {
  dz.style.borderColor = "var(--border)";
  dz.style.background = "var(--card-2)";
});
dz.addEventListener("drop", e => {
  e.preventDefault();
  dz.style.borderColor = "var(--border)";
  dz.style.background = "var(--card-2)";
  if (e.dataTransfer.files.length) {
    fi.files = e.dataTransfer.files;
    fn.textContent = "已选择：" + e.dataTransfer.files[0].name;
    autoGuessSource(e.dataTransfer.files[0].name);
    handleFile(e.dataTransfer.files[0]);
  }
});
fi.addEventListener("change", () => {
  if (fi.files.length) {
    fn.textContent = "已选择：" + fi.files[0].name;
    autoGuessSource(fi.files[0].name);
    handleFile(fi.files[0]);
  }
});
function autoGuessSource(name) {
  const n = name.toLowerCase();
  const sel = document.getElementById("srcSel");
  if (n.includes("alipay") || n.includes("支付宝")) sel.value = "alipay";
  else if (n.includes("wechat") || n.includes("微信") || n.includes("wx")) sel.value = "wechat";
}

/* ---------- 解析 + 预览 ---------- */
async function handleFile(file) {
  document.getElementById("resultBox").style.display = "none";
  try {
    const buf = await file.arrayBuffer();
    const parsed = await parseBillFile(buf, file.name, document.getElementById("srcSel").value);
    PARSED = Object.assign({}, parsed, { name: file.name });
    showPreview();
  } catch (e) {
    // 兜底：解析器没捕获的异常也要显示出来，方便排查
    PARSED = { records: [], meta: { source: "", total_rows: 0, skipped: 0, warnings: ["读取失败：" + e.message] }, name: file.name };
    document.getElementById("parseBox").style.display = "";
    document.getElementById("parseInfo").innerHTML =
      `<span style="color:var(--red)">⚠ ${esc(e.message)}</span>`;
    document.getElementById("previewBody").innerHTML = "";
    document.getElementById("confirmImport").onclick = null;
  }
}

function showPreview() {
  const { records, meta } = PARSED;
  const box = document.getElementById("parseBox");
  box.style.display = "";
  const srcName = { alipay: "支付宝", wechat: "微信", bank: "银行卡", generic: "通用" }[meta.source] || meta.source;
  const fileType = meta.fileType === "xlsx" ? "Excel" : "CSV";
  const warn = meta.warnings.length
    ? `<br><span style="color:var(--orange)">⚠ ${meta.warnings.map(esc).join("；")}</span>` : "";
  document.getElementById("parseInfo").innerHTML =
    `<b>识别来源：${esc(srcName)}</b>（${fileType}）· 解析出 <b>${records.length}</b> 条有效记录 · 跳过 ${meta.skipped} 条无效${warn}`;

  const body = document.getElementById("previewBody");
  body.innerHTML = records.slice(0, 100).map(r => `
    <tr>
      <td style="white-space:nowrap">${esc(fmtDateTime(r.occurred_at))}</td>
      <td class="ellip">${esc(r.counterparty || "—")}</td>
      <td class="ellip muted">${esc(r.description || "")}</td>
      <td class="num">${money(r.amount)}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">没有有效记录</td></tr>`;

  document.getElementById("confirmImport").onclick = doImport;
}

/* ---------- 确认导入 ---------- */
async function doImport() {
  if (!PARSED || !PARSED.records.length) { toast("没有可导入的记录", "error"); return; }
  const { added, dup } = await DB.importRecords(PARSED.records);
  const box = document.getElementById("resultBox");
  box.style.display = "";
  box.style.borderColor = added ? "var(--green)" : "var(--border)";
  box.style.background = added ? "rgba(81,207,102,.08)" : "var(--card-2)";
  box.innerHTML = `<b>导入完成</b><br>新增 <b>${added}</b> 条 · 跳过重复 <b>${dup}</b> 条<br>
    <span class="muted">文件：${esc(PARSED.name)}</span>`;
  toast(`导入成功：新增 ${added} 条`, "ok");
  document.getElementById("parseBox").style.display = "none";
  PARSED = null;
}

/* ---------- 规则管理 ---------- */
async function loadRules() {
  const rules = await DB.getAll("category_rules");
  rules.sort((a, b) => b.priority - a.priority);
  document.getElementById("ruleBody").innerHTML = rules.length ? rules.map(r => `
    <tr>
      <td><code>${esc(r.keyword)}</code></td>
      <td>${chipHtml(r.category)}</td>
      <td class="num muted">${r.priority}</td>
      <td><button class="btn sm danger" data-act="delRule" data-id="${r.id}">删</button></td>
    </tr>`).join("") : `<tr><td colspan="4" class="empty">还没有自定义规则</td></tr>`;
}
document.getElementById("ruleBody").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act=delRule]");
  if (!t) return;
  await DB.del("category_rules", Number(t.dataset.id));
  toast("已删除", "ok");
  loadRules();
});
async function addRule() {
  const kw = document.getElementById("rKw").value.trim();
  const cat = document.getElementById("rCat").value.trim();
  if (!kw || !cat) { toast("关键词和分类都要填", "error"); return; }
  const rules = await DB.getAll("category_rules");
  const exist = rules.find(r => r.keyword === kw);
  const prio = parseInt(document.getElementById("rPrio").value, 10) || 50;
  if (exist) {
    exist.category = cat;
    exist.priority = prio;
    await DB.put("category_rules", exist);
  } else {
    await DB.add("category_rules", { keyword: kw, category: cat, priority: prio });
  }
  document.getElementById("rKw").value = "";
  document.getElementById("rCat").value = "";
  toast("规则已保存", "ok");
  loadRules();
}
async function reclassify() {
  if (!confirm("将按当前规则重新分类所有「未手动改过」的记录，继续？")) return;
  const changed = await DB.reclassifyAll();
  toast(`已重新分类 ${changed} 条`, "ok");
}

(async function init() {
  try {
    await seedDemoIfFirstRun();
    await loadRules();
  } catch (e) {
    console.error(e);
  }
})();
