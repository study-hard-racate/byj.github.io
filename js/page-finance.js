/* =========================================================
   page-finance.js —— 财务账单页
   ========================================================= */
const els = {
  month: document.getElementById("fMonth"),
  cat: document.getElementById("fCat"),
  src: document.getElementById("fSrc"),
  dir: document.getElementById("fDir"),
  kw: document.getElementById("fKw"),
};
const nowMonth = nowMonthStr();
let ALL_TXN = [];       // 全部交易（内存缓存，数据量个人级没问题）
let CURRENT_ROWS = [];  // 当前筛选结果

function monthRangeOf(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

function filterRows() {
  const cat = els.cat.value, src = els.src.value,
        dir = els.dir.value, kw = els.kw.value.trim().toLowerCase();
  let rows = ALL_TXN;
  if (els.month.value !== "all") {
    const { start, end } = monthRangeOf(els.month.value);
    rows = rows.filter(t => t.occurred_at >= start && t.occurred_at < end);
  }
  if (cat !== "all") rows = rows.filter(t => t.category === cat);
  if (src !== "all") rows = rows.filter(t => t.source === src);
  if (dir !== "all") rows = rows.filter(t => t.direction === dir);
  if (kw) rows = rows.filter(t =>
    (t.counterparty || "").toLowerCase().includes(kw) ||
    (t.description || "").toLowerCase().includes(kw) ||
    (t.category || "").toLowerCase().includes(kw));
  rows = [...rows].sort((a, b) => b.occurred_at - a.occurred_at);
  CURRENT_ROWS = rows;
  return rows;
}

async function loadFilters() {
  const t = await DB.monthlyTrend(120);
  const months = t.months.slice().reverse();
  els.month.innerHTML = `<option value="all">全部</option>` +
    months.map(m => `<option value="${m}" ${m === nowMonth ? "selected" : ""}>${m}</option>`).join("");

  const cats = new Set(ALL_TXN.map(t => t.category).filter(Boolean));
  els.cat.innerHTML = `<option value="all">全部</option>` +
    [...cats].sort().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");

  const srcs = new Set(ALL_TXN.map(t => t.source).filter(Boolean));
  els.src.innerHTML = `<option value="all">全部</option>` +
    [...srcs].sort().map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
}

async function render() {
  const m = els.month.value === "all" ? nowMonth : els.month.value;
  const [sum, trend] = await Promise.all([
    DB.summaryForMonth(m),
    DB.monthlyTrend(12),
  ]);
  const rows = filterRows();

  const hasData = ALL_TXN.length > 0;
  document.getElementById("emptyHint").style.display = hasData ? "none" : "";
  document.getElementById("content").style.display = hasData ? "" : "none";
  if (!hasData) return;

  const filteredExpense = rows.filter(r => r.direction === "expense");
  const filteredIncome = rows.filter(r => r.direction === "income");
  const sumExp = filteredExpense.reduce((a, b) => a + b.amount, 0);
  const sumInc = filteredIncome.reduce((a, b) => a + b.amount, 0);
  const maxRow = filteredExpense.reduce((a, b) => (a && a.amount >= b.amount) ? a : b, null);

  document.getElementById("kExpense").textContent = money0(sumExp);
  document.getElementById("kExpenseFoot").textContent =
    els.month.value === "all" ? "全部区间" : `${m} · 环比 ${sum.mom === null ? "—" : (sum.mom > 0 ? "↑" : "↓") + Math.abs(sum.mom) + "%"}`;
  document.getElementById("kIncome").textContent = money0(sumInc);
  document.getElementById("kIncomeFoot").textContent = `${filteredIncome.length} 笔`;
  document.getElementById("kCount").textContent = rows.length;
  document.getElementById("kCountFoot").textContent = `支出 ${filteredExpense.length} · 收入 ${filteredIncome.length}`;
  document.getElementById("kMax").textContent = maxRow ? money0(maxRow.amount) : "—";
  document.getElementById("kMaxFoot").textContent = maxRow ? esc(maxRow.counterparty || maxRow.description || "").slice(0, 14) : "";

  // 饼图（当前筛选的支出）
  const byCat = {};
  filteredExpense.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + r.amount; });
  const pieData = Object.entries(byCat).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ name: k, value: v, color: catColor(k) }));
  Charts.DonutChart(document.getElementById("pie"), {
    data: pieData, size: 200, thickness: 26,
    centerValue: money0(sumExp), centerLabel: "支出合计"
  });
  const tot = sumExp || 1;
  document.getElementById("legend").innerHTML = pieData.slice(0, 12).map(d => `
    <div class="legend-item">
      <span class="dot" style="background:${d.color}"></span>
      <span class="name">${esc(d.name)}</span>
      <span class="val">${money0(d.value)}</span>
      <span class="pct">${(d.value / tot * 100).toFixed(1)}%</span>
    </div>`).join("") || `<div class="muted">当前筛选下没有支出</div>`;

  Charts.BarChart(document.getElementById("trend"), {
    labels: trend.months.map(x => x.slice(5) + "月"),
    series: [
      { name: "支出", data: trend.expense, color: "#ff6b6b" },
      { name: "结余", data: trend.balance, color: "#5c7cfa", type: "line" },
    ],
    height: 250, tipLabel: (lb, i) => trend.months[i] || lb
  });

  // 表格（事件委托，不用内联 onclick，杜绝注入）
  document.getElementById("tbody").innerHTML = rows.slice(0, 500).map(r => `
    <tr>
      <td class="muted" style="white-space:nowrap">${esc(fmtDateTime(r.occurred_at).slice(5, 16))}</td>
      <td><span class="chip editable" data-act="editCat" data-id="${r.id}">
        <span class="dot" style="background:${catColor(r.category)}"></span>${esc(r.category)}</span></td>
      <td class="ellip">${esc(r.counterparty || "—")}</td>
      <td class="ellip muted">${esc(r.description || "")}</td>
      <td class="muted" style="white-space:nowrap">${esc(r.source)}</td>
      <td class="num ${r.direction === 'income' ? 'amount-in' : (r.direction === 'expense' ? 'amount-out' : 'muted')}">
        ${r.direction === "income" ? "+" : (r.direction === "expense" ? "-" : "")}${money(r.amount)}</td>
      <td><button class="btn sm danger" data-act="delTx" data-id="${r.id}">删</button></td>
    </tr>`).join("") || `<tr><td colspan="7" class="empty">没有符合条件的记录</td></tr>`;

  document.getElementById("moreHint").textContent =
    rows.length > 500 ? `仅显示前 500 条，可用筛选条件缩小范围（共 ${rows.length} 条）` : `共 ${rows.length} 条`;

  // 月度导入提醒
  const b = document.getElementById("banners");
  const hasThisMonth = await DB.getSetting("monthSeen:" + nowMonth, false)
    || sum.expense_count > 0 || sum.income > 0;
  b.innerHTML = (!hasThisMonth && (await DB.getAll("transactions")).length > 0) ? `
    <div class="banner">
      <div class="banner-body">📥 ${nowMonth} 还没有账单记录，记得导入或记一笔。</div>
      <a class="btn sm primary" href="import.html">去导入</a>
    </div>` : "";
}

/* ---------- 事件委托 ---------- */
document.getElementById("tbody").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const id = Number(t.dataset.id);
  if (t.dataset.act === "delTx") await delTx(id);
  else if (t.dataset.act === "editCat") await editCat(id);
});

/* ---------- 改分类 ---------- */
async function editCat(id) {
  const t = ALL_TXN.find(x => x.id === id);
  if (!t) return;
  const cats = new Set(ALL_TXN.map(x => x.category).filter(Boolean));
  const uniq = Array.from(new Set([...cats, ...COMMON_CATEGORIES]));
  openModal(`
    <h3>修改分类</h3>
    <label class="field" style="margin-bottom:12px">选一个已有分类
      <select id="catSel">${uniq.map(c =>
        `<option value="${esc(c)}" ${c === t.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    </label>
    <label class="field">或者输入新分类
      <input type="text" id="catNew" placeholder="留空则用上面选的">
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:var(--text)">
      <input type="checkbox" id="catLearn" checked style="width:auto"> 记住这个商户，以后自动归到此类
    </label>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" data-id="${id}" id="saveCatBtn">保存</button>
    </div>`);
  document.getElementById("saveCatBtn").addEventListener("click", () => saveCat(id));
}
async function saveCat(id) {
  const sel = document.getElementById("catSel").value;
  const nw = document.getElementById("catNew").value.trim();
  const learn = document.getElementById("catLearn").checked;
  const t = ALL_TXN.find(x => x.id === id);
  if (!t) return;
  const cat = nw || sel;
  t.category = cat;
  t.category_locked = true;
  await DB.put("transactions", t);
  if (learn && t.counterparty) {
    const rules = await DB.getAll("category_rules");
    if (!rules.find(r => r.keyword === t.counterparty)) {
      await DB.add("category_rules", { keyword: t.counterparty, category: cat, priority: 50 });
    }
  }
  closeModal();
  toast("已更新分类", "ok");
  render();
}
async function delTx(id) {
  if (!confirm("确定删除这条记录？")) return;
  await DB.del("transactions", id);
  ALL_TXN = ALL_TXN.filter(x => x.id !== id);
  toast("已删除", "ok");
  render();
}
async function reclassify() {
  if (!confirm("将按当前规则重新分类所有「未手动改过」的记录，继续？")) return;
  const changed = await DB.reclassifyAll();
  ALL_TXN = await DB.listTransactions();
  toast(`已重新分类 ${changed} 条`, "ok");
  render();
}

/* ---------- 导出 CSV（当前筛选结果，带 BOM） ---------- */
function exportCsv() {
  const esc = s => {
    s = String(s === null || s === undefined ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const dirName = { expense: "支出", income: "收入", transfer: "不计收支" };
  const lines = [["日期", "分类", "收支", "金额", "来源", "交易对方", "商品说明", "支付方式"]];
  CURRENT_ROWS.forEach(t => {
    lines.push([
      fmtDateTime(t.occurred_at), t.category, dirName[t.direction] || t.direction,
      t.amount, t.source, t.counterparty, t.description, t.method,
    ].map(esc).join(","));
  });
  download(`bills_export_${nowMonthStr()}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  toast(`已导出 ${CURRENT_ROWS.length} 条`, "ok");
}

/* ---------- 手动记账 ---------- */
function openAdd() {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  openModal(`
    <h3>记一笔</h3>
    <div class="checkin-grid">
      <label class="field">金额
        <input type="number" id="aAmount" step="0.01" placeholder="0.00" autofocus>
      </label>
      <label class="field">类型
        <select id="aDir">
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
      </label>
      <label class="field">时间
        <input type="datetime-local" id="aTime" value="${nowStr}">
      </label>
      <label class="field">来源
        <select id="aSrc">
          <option value="手动">手动</option><option value="支付宝">支付宝</option>
          <option value="微信">微信</option><option value="银行卡">银行卡</option>
          <option value="现金">现金</option>
        </select>
      </label>
      <label class="field">交易对方
        <input type="text" id="aParty" placeholder="如：楼下面馆">
      </label>
      <label class="field">分类（留空自动判断）
        <input type="text" id="aCat" placeholder="自动">
      </label>
    </div>
    <label class="field" style="margin-top:12px">备注
      <input type="text" id="aDesc" placeholder="选填">
    </label>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" id="saveAddBtn">保存</button>
    </div>`);
  document.getElementById("saveAddBtn").addEventListener("click", saveAdd);
}
async function saveAdd() {
  const amount = parseFloat(document.getElementById("aAmount").value);
  if (!amount || amount <= 0) { toast("请输入金额", "error"); return; }
  const timeVal = document.getElementById("aTime").value; // "2026-09-01T19:48"
  const dt = parseTime(timeVal) || new Date();            // 修复：T 格式正确解析
  await DB.addManual({
    occurred_at: dt,
    amount,
    direction: document.getElementById("aDir").value,
    source: document.getElementById("aSrc").value,
    counterparty: document.getElementById("aParty").value,
    category: document.getElementById("aCat").value,
    description: document.getElementById("aDesc").value,
  });
  closeModal();
  toast("已记录", "ok");
  ALL_TXN = await DB.listTransactions();
  await loadFilters();
  render();
}

function resetFilter() {
  els.month.value = nowMonth;
  els.cat.value = "all"; els.src.value = "all";
  els.dir.value = "expense"; els.kw.value = "";
  render();
}

["month", "cat", "src", "dir"].forEach(k => els[k].addEventListener("change", render));
let kwTimer;
els.kw.addEventListener("input", () => {
  clearTimeout(kwTimer); kwTimer = setTimeout(render, 300);
});
window.addEventListener("themechange", () => setTimeout(render, 30));

(async function init() {
  try {
    await seedDemoIfFirstRun();
    ALL_TXN = await DB.listTransactions();
    await loadFilters();
    await render();
  } catch (e) {
    console.error(e);
  }
})();
