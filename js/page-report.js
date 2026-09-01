/* =========================================================
   page-report.js —— 年度报告页
   ========================================================= */
const yearSel = document.getElementById("yearSel");

async function loadYears() {
  const all = await DB.getAll("transactions");
  const yrs = new Set(all.map(t => t.occurred_at.getFullYear()));
  (await DB.getAll("health_records")).forEach(r => yrs.add(r.day.getFullYear()));
  const list = [...yrs].sort().reverse();
  if (!list.length) list.push(new Date().getFullYear());
  yearSel.innerHTML = list.map(y =>
    `<option value="${y}" ${y === new Date().getFullYear() ? "selected" : ""}>${y} 年</option>`
  ).join("");
  return list;
}

async function render() {
  const year = Number(yearSel.value);
  const all = await DB.getAll("transactions");
  const health = await DB.getAll("health_records");

  const yStart = new Date(year, 0, 1), yEnd = new Date(year + 1, 0, 1);
  const txns = all.filter(t => t.occurred_at >= yStart && t.occurred_at < yEnd);
  const hRecs = health.filter(r => r.day >= yStart && r.day < yEnd);

  const hasFinance = txns.length > 0;
  const hasHealth = hRecs.length > 0;
  if (!hasFinance && !hasHealth) {
    document.getElementById("emptyAll").style.display = "";
    document.getElementById("content").style.display = "none";
    return;
  }
  document.getElementById("emptyAll").style.display = "none";
  document.getElementById("content").style.display = "";

  /* ---- 财务 ---- */
  let expense = 0, income = 0, expenseCnt = 0;
  const catMap = new Map(), merchant = new Map();
  let biggest = null, coffee = 0, takeout = 0;
  for (const t of txns) {
    if (t.direction === "expense") {
      expense += t.amount; expenseCnt++;
      catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount);
      if (t.counterparty) merchant.set(t.counterparty, (merchant.get(t.counterparty) || 0) + t.amount);
      if (!biggest || t.amount > biggest.amount) biggest = t;
      if ((t.category || "").includes("咖啡")) coffee += t.amount;
      if ((t.category || "").includes("外卖")) takeout++;
    } else if (t.direction === "income") {
      income += t.amount;
    }
  }
  const isCurYear = year === new Date().getFullYear();
  const daysPassed = isCurYear
    ? Math.floor((new Date() - yStart) / 86400000) + 1
    : (yEnd - yStart) / 86400000;

  document.getElementById("yExpense").textContent = money0(expense);
  document.getElementById("yExpenseFoot").textContent = `${expenseCnt} 笔支出`;
  document.getElementById("yIncome").textContent = money0(income);
  document.getElementById("yIncomeFoot").textContent = isCurYear ? "今年进行中" : "全年";
  const yb = document.getElementById("yBalance");
  yb.textContent = money0(income - expense);
  yb.style.color = income - expense >= 0 ? "var(--green)" : "var(--red)";
  document.getElementById("yBalanceFoot").textContent =
    income > 0 ? `储蓄率 ${Math.max(0, (income - expense) / income * 100).toFixed(0)}%` : "暂无收入记录";
  document.getElementById("yAvg").textContent = money0(expense / Math.max(daysPassed, 1));
  document.getElementById("yAvgFoot").textContent = `按 ${daysPassed.toFixed(0)} 天计算`;

  // 环形图
  const cats = [...catMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, color: catColor(name) }));
  const top8 = cats.slice(0, 8);
  const other = cats.slice(8).reduce((a, b) => a + b.value, 0);
  const pieData = [...top8];
  if (other > 0) pieData.push({ name: "其他", value: other, color: "#868e96" });
  Charts.DonutChart(document.getElementById("pieBox"), {
    data: pieData, size: 200, thickness: 26,
    centerValue: money0(expense), centerLabel: "年度支出"
  });
  const tot = expense || 1;
  document.getElementById("pieLegend").innerHTML = pieData.map(d => `
    <div class="legend-item">
      <span class="dot" style="background:${d.color}"></span>
      <span class="name">${esc(d.name)}</span>
      <span class="val">${money0(d.value)}</span>
      <span class="pct">${(d.value / tot * 100).toFixed(1)}%</span>
    </div>`).join("") || `<div class="muted">这一年没有支出记录</div>`;

  // 月度趋势（当年 12 个月）
  const monthly = new Map();
  for (let m = 0; m < 12; m++) monthly.set(m, { expense: 0, income: 0 });
  for (const t of txns) {
    if (t.direction !== "expense" && t.direction !== "income") continue;
    const m = t.occurred_at.getMonth();
    monthly.get(m)[t.direction] += t.amount;
  }
  const labels = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
  Charts.BarChart(document.getElementById("trendBox"), {
    labels,
    series: [
      { name: "支出", data: [...monthly.values()].map(v => round2(v.expense)), color: "#ff6b6b" },
      { name: "收入", data: [...monthly.values()].map(v => round2(v.income)), color: "#51cf66" },
    ],
    height: 250
  });
  const busiest = [...monthly.entries()].sort((a, b) => b[1].expense - a[1].expense)[0];
  document.getElementById("trendTag").textContent = busiest
    ? `花钱最多：${busiest[0] + 1} 月（${money0(busiest[1].expense)}）` : "";

  // 年度之最
  document.getElementById("biggestBox").innerHTML = biggest
    ? `<div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:6px">${money(biggest.amount)}</div>
       ${esc(biggest.counterparty || "—")} · ${esc(biggest.description || "")}<br>
       <span class="muted">${fmtDateTime(biggest.occurred_at)} · ${esc(biggest.category)}</span>`
    : "没有支出记录";
  const topM = [...merchant.entries()].sort((a, b) => b[1] - a[1])[0];
  document.getElementById("topMerchantBox").innerHTML = topM
    ? `<div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:6px">${esc(topM[0])}</div>
       全年在这花了 ${money0(topM[1])}`
    : "没有商户记录";
  const funLines = [];
  if (coffee > 0) funLines.push(`☕ 咖啡一共喝了 <b style="color:var(--text)">${money0(coffee)}</b>`);
  if (takeout > 0) funLines.push(`🍱 点了 <b style="color:var(--text)">${takeout}</b> 次外卖`);
  const txCnt = txns.filter(t => t.direction === "expense").length;
  if (txCnt > 0) funLines.push(`🧾 全年 <b style="color:var(--text)">${txCnt}</b> 笔支出，平均每笔 ${money0(expense / txCnt)}`);
  document.getElementById("funBox").innerHTML = funLines.join("<br>") || "攒一攒数据就有了";

  /* ---- 健康 ---- */
  document.getElementById("healthYearTag").textContent = `${year} 年`;
  const st = await DB.healthStats(hRecs);
  document.getElementById("hDays").innerHTML = st.records + "<small>天</small>";
  document.getElementById("hSleep").innerHTML = st.avg_sleep + "<small>h</small>";
  document.getElementById("hSleepFoot").textContent = st.avg_sleep >= 7 ? "睡眠达标 ✓" : "平均不足 7h";
  const exMin = hRecs.reduce((a, r) => a + (r.exercise_minutes || 0), 0);
  document.getElementById("hExercise").innerHTML = Math.round(exMin / 60) + "<small>h</small>";
  document.getElementById("hExerciseFoot").textContent = `${exMin.toLocaleString()} 分钟`;
  document.getElementById("hWeight").innerHTML = st.weight_now
    ? st.weight_now + "<small>kg</small>" : "—";
  document.getElementById("hWeightFoot").textContent = st.weight_delta
    ? `${st.weight_delta > 0 ? "+" : ""}${st.weight_delta} kg` : "—";

  const extra = [];
  extra.push(`📅 最长连续打卡 <b style="color:var(--accent)">${await longestStreak(hRecs)}</b> 天`);
  extra.push(`🚶 全年步数 <b style="color:var(--text)">${st.total_steps.toLocaleString()}</b> 步`);
  const monthCnt = new Map();
  hRecs.forEach(r => { const k = r.day.getMonth(); monthCnt.set(k, (monthCnt.get(k) || 0) + 1); });
  const bestM = [...monthCnt.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bestM) extra.push(`🗓️ 打卡最勤的是 <b style="color:var(--text)">${bestM[0] + 1} 月</b>（${bestM[1]} 天）`);
  extra.push(`😊 平均心情 <b style="color:var(--text)">${st.avg_mood}</b> / 5`);
  document.getElementById("healthExtra").innerHTML = extra.join("　·　");
}

async function longestStreak(records) {
  if (!records.length) return 0;
  const daySet = new Set(records.map(r => dayKey(r.day)));
  let best = 0, cur = 0;
  // 按日期排序遍历
  const days = [...daySet].sort();
  let prev = null;
  for (const d of days) {
    if (prev && new Date(d) - new Date(prev) === 86400000) cur++;
    else cur = 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

yearSel.addEventListener("change", render);
window.addEventListener("themechange", () => setTimeout(render, 30));

(async function init() {
  try {
    await seedDemoIfFirstRun();
    await loadYears();
    await render();
  } catch (e) {
    console.error(e);
  }
})();
