/* =========================================================
   page-index.js —— 总览页
   ========================================================= */
const monthSel = document.getElementById("monthSel");
const nowMonth = nowMonthStr();

function currentMonth() {
  return monthSel.value || nowMonth;
}

async function loadMonths() {
  const months = await allMonthKeys();
  if (!months.length) months.push(nowMonth);
  monthSel.innerHTML = months.map(m =>
    `<option value="${m}" ${m === nowMonth ? "selected" : ""}>${m}</option>`
  ).join("");
  return months;
}

/* ---------- 提醒横幅（自包含：重新拉取数据，供 render 和切回页面时调用）---------- */
async function refreshBanners() {
  const box = document.getElementById("banners");
  if (!box) return;
  const html = [];
  const today = new Date();

  // 演示数据提示
  const isDemo = await DB.getSetting("demo", false);
  if (isDemo) {
    html.push(`<div class="banner">
      <div class="banner-body">🧪 当前是<b>演示数据</b>（6 个月账单 + 健康打卡），仅供体验。</div>
      <a class="btn sm" href="settings.html">去清空 / 导入真实数据</a>
    </div>`);
  }

  // 打卡提醒（打开网站时）
  const reminder = await DB.getSetting("reminder", null) || {
    healthHour: APP_CONFIG.reminder.healthHour,
    monthlyDay: APP_CONFIG.reminder.monthlyDay,
  };
  const checkedToday = await DB.getHealthByDay(today);
  if (!checkedToday && today.getHours() >= reminder.healthHour) {
    html.push(`<div class="banner">
      <div class="banner-body">⏰ 已经 ${today.getHours()} 点了，今天还没打卡。</div>
      <a class="btn sm primary" href="health.html">去打卡</a>
    </div>`);
    tryNotify("今天还没打卡，去记录一下吧", "health");
  }

  // 月度导入提醒
  const months = await allMonthKeys();
  if (!months.includes(nowMonth) && today.getDate() >= reminder.monthlyDay) {
    html.push(`<div class="banner">
      <div class="banner-body">📥 ${nowMonth} 还没有任何账单记录，记得导入。</div>
      <a class="btn sm primary" href="import.html">去导入</a>
    </div>`);
    tryNotify(`${nowMonth} 还没有账单记录，记得导入`, "bill");
  }

  // 超支提醒
  const sum = await DB.summaryForMonth(nowMonth);
  if (sum.budget && sum.expense > sum.budget) {
    html.push(`<div class="banner danger">
      <div class="banner-body">⚠️ 本月已<b>超支 ${money0(sum.expense - sum.budget)}</b>（预算 ${money0(sum.budget)}）。</div>
      <a class="btn sm" href="settings.html">调预算</a>
    </div>`);
  }

  box.innerHTML = html.join("");
}

function tryNotify(msg, kind) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    // 每天每种提醒只发一次，避免反复打扰
    const key = "pd-notify-" + kind + "-" + todayStr();
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    new Notification("BYJ 个人看板", { body: msg, icon: "icons/icon-192.png" });
  } catch (e) { /* 忽略 */ }
}

// 从别的 App 切回本站时复查提醒（手机 PWA 场景很常用）
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshBanners().catch(console.error);
});

/* ---------- 渲染 ---------- */
async function render() {
  const m = currentMonth();
  const [sum, trend, daily, healthRecs] = await Promise.all([
    DB.summaryForMonth(m),
    DB.monthlyTrend(12),
    DB.dailyTrend(m),
    DB.listHealth(30),
  ]);
  const health = await DB.healthStats(healthRecs);

  const hasFinance = sum.expense_count > 0 || sum.income > 0;
  const hasHealth = health.records > 0;
  document.getElementById("emptyAll").style.display = (hasFinance || hasHealth) ? "none" : "";
  document.getElementById("mainContent").style.display = (hasFinance || hasHealth) ? "" : "none";
  if (!hasFinance && !hasHealth) return;

  // 统计卡
  document.getElementById("sExpense").textContent = money0(sum.expense);
  document.getElementById("sExpenseFoot").innerHTML = sum.mom === null
    ? `共 ${sum.expense_count} 笔`
    : `环比 <span class="${sum.mom > 0 ? 'up' : 'down'}">${sum.mom > 0 ? '↑' : '↓'} ${Math.abs(sum.mom)}%</span> · ${sum.expense_count} 笔`;
  document.getElementById("sIncome").textContent = money0(sum.income);
  document.getElementById("sIncomeFoot").textContent = `已过 ${sum.passed_days} / ${sum.days_in_month} 天`;
  const bal = document.getElementById("sBalance");
  bal.textContent = money0(sum.balance);
  bal.style.color = sum.balance >= 0 ? "var(--green)" : "var(--red)";
  document.getElementById("sBalanceFoot").textContent =
    sum.income > 0 ? `支出占收入 ${(sum.expense / sum.income * 100).toFixed(0)}%` : "暂无收入记录";
  document.getElementById("sAvg").textContent = money0(sum.avg_daily);
  document.getElementById("sAvgFoot").textContent =
    sum.avg_daily > 0 ? `按此速度本月约 ${money0(sum.avg_daily * sum.days_in_month)}` : "—";

  // 预算进度
  const budgetCard = document.getElementById("budgetCard");
  if (sum.budget) {
    budgetCard.style.display = "";
    const pct = Math.min(100, sum.expense / sum.budget * 100);
    document.getElementById("budgetFill").style.width = pct.toFixed(1) + "%";
    document.getElementById("budgetFill").style.background =
      pct >= 100 ? "var(--red)" : pct >= 70 ? "var(--orange)" : "var(--green)";
    document.getElementById("budgetSpent").textContent = `已花 ${money0(sum.expense)} / ${money0(sum.budget)}`;
    document.getElementById("budgetLeft").textContent =
      sum.expense > sum.budget ? `超支 ${money0(sum.expense - sum.budget)}`
        : `剩余 ${money0(sum.budget - sum.expense)}（${(100 - pct).toFixed(0)}%）`;
    document.getElementById("budgetTag").textContent = pct >= 100 ? "已超支！" : `${pct.toFixed(0)}% 已使用`;
  } else {
    budgetCard.style.display = "none";
  }

  // 环形图
  const cats = sum.categories.slice(0, 9);
  const other = sum.categories.slice(9).reduce((a, b) => a + b.value, 0);
  const pieData = cats.map(c => ({ name: c.name, value: c.value, color: c.color || catColor(c.name) }));
  if (other > 0) pieData.push({ name: "其他", value: other, color: "#868e96" });
  Charts.DonutChart(document.getElementById("pieBox"), {
    data: pieData, size: 200, thickness: 26,
    centerValue: money0(sum.expense), centerLabel: "本月支出"
  });
  const total = sum.expense || 1;
  document.getElementById("pieLegend").innerHTML = pieData.map(d => `
    <div class="legend-item">
      <span class="dot" style="background:${d.color}"></span>
      <span class="name">${esc(d.name)}</span>
      <span class="val">${money0(d.value)}</span>
      <span class="pct">${(d.value / total * 100).toFixed(1)}%</span>
    </div>`).join("") || `<div class="muted">本月还没有支出记录</div>`;
  document.getElementById("catTag").textContent =
    sum.uncategorized ? `${sum.uncategorized} 笔未分类` : `${pieData.length} 类`;

  // 月度趋势
  Charts.BarChart(document.getElementById("trendBox"), {
    labels: trend.months.map(m => m.slice(5) + "月"),
    series: [
      { name: "支出", data: trend.expense, color: "#ff6b6b" },
      { name: "结余", data: trend.balance, color: "#5c7cfa", type: "line" },
    ],
    height: 250,
    tipLabel: (lb, i) => trend.months[i] || lb
  });

  // 每日走势
  Charts.LineChart(document.getElementById("dailyBox"), {
    labels: daily.labels,
    series: [{ name: "支出", data: daily.values, color: "#ffa94d" }],
    height: 230,
    tipLabel: (lb) => `${m}-${String(lb).padStart(2, "0")}`,
    tipFormat: v => money(v)
  });
  const maxDay = Math.max(...daily.values, 0);
  document.getElementById("dailyTag").textContent = maxDay > 0 ? `单日最高 ${money0(maxDay)}` : "";

  // Top 商户
  const tops = sum.top_merchants.slice(0, 8);
  const maxTop = tops.length ? tops[0].value : 1;
  document.getElementById("topBox").innerHTML = tops.length ? tops.map(t => `
    <div class="bar-row">
      <div class="bar-head">
        <span>${esc(t.name)}</span>
        <b style="color:var(--text-dim);font-weight:600">${money0(t.value)}</b>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(t.value / maxTop * 100).toFixed(1)}%;
             background:linear-gradient(90deg,#ff6b6b,#ffa94d)"></div>
      </div>
    </div>`).join("") : emptyState("🛒", "本月还没有支出记录");

  // 健康速览
  const st = health;
  document.getElementById("healthMini").innerHTML = hasHealth ? `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="stat purple" style="padding:12px 14px">
        <div class="label">平均睡眠</div>
        <div class="value" style="font-size:20px">${st.avg_sleep}<small>h</small></div>
      </div>
      <div class="stat teal" style="padding:12px 14px">
        <div class="label">平均心情</div>
        <div class="value" style="font-size:20px">${st.avg_mood}<small>/5</small></div>
      </div>
    </div>
    <div style="font-size:12.5px;color:var(--text-dim);line-height:2">
      近 30 天打卡 <b style="color:var(--text)">${st.records}</b> 天 ·
      连续 <b style="color:var(--accent)">${st.streak}</b> 天<br>
      平均运动 <b style="color:var(--text)">${st.avg_exercise}</b> 分钟 ·
      达标 <b style="color:var(--green)">${st.good_days}</b> 天<br>
      ${st.weight_now ? `体重 <b style="color:var(--text)">${st.weight_now}</b> kg
        <span style="color:${st.weight_delta <= 0 ? 'var(--green)' : 'var(--red)'}">
          (${st.weight_delta > 0 ? '+' : ''}${st.weight_delta})</span>` : '还没有记录体重'}
    </div>` : emptyState("❤️", "还没有健康打卡记录",
      `<a class="btn primary" href="health.html">去打卡</a>`);

  await refreshBanners();
}

monthSel.addEventListener("change", render);
window.addEventListener("themechange", () => setTimeout(render, 30));

(async function init() {
  try {
    await seedDemoIfFirstRun();
    await loadMonths();
    await render();
  } catch (e) {
    console.error(e);
    document.getElementById("emptyAll").style.display = "none";
    document.getElementById("mainContent").innerHTML =
      `<div class="card"><div class="empty"><div class="big">😵</div><p>初始化出错：${esc(e.message)}</p></div></div>`;
  }
})();
