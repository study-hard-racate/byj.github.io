/* =========================================================
   page-health.js —— 习惯健康页
   ========================================================= */
let ALL = { series: [], stats: {} };

/* ---------- 星级控件 ---------- */
function bindStars(wrapId, valueEl, cb) {
  const wrap = document.getElementById(wrapId);
  wrap.addEventListener("click", e => {
    const s = e.target.closest(".star");
    if (!s) return;
    const v = parseInt(s.dataset.v, 10);
    setStars(wrapId, v);
    document.getElementById(valueEl).textContent = v + " / 5";
    if (cb) cb(v);
  });
}
function setStars(wrapId, v) {
  document.querySelectorAll(`#${wrapId} .star`).forEach(s => {
    s.classList.toggle("on", parseInt(s.dataset.v, 10) <= v);
  });
}
function getStars(wrapId) {
  let v = 0;
  document.querySelectorAll(`#${wrapId} .star.on`).forEach(s => {
    v = Math.max(v, parseInt(s.dataset.v, 10));
  });
  return v;
}

/* ---------- 打卡表单 ---------- */
async function loadDay(dayStr) {
  const day = new Date(dayStr + "T00:00:00");
  const r = await DB.getHealthByDay(day);
  const v = r || {};
  document.getElementById("cDay").value = dayStr;
  document.getElementById("cSleep").value = v.sleep_hours || 0;
  document.getElementById("vSleep").textContent = (v.sleep_hours || 0) + " h";
  setStars("cSleepScore", v.sleep_score || 0);
  document.getElementById("vSleepScore").textContent = v.sleep_score ? v.sleep_score + " / 5" : "—";
  setStars("cMood", v.mood || 0);
  document.getElementById("vMood").textContent = v.mood ? v.mood + " / 5" : "—";
  document.getElementById("cWeight").value = v.weight || "";
  document.getElementById("cExercise").value = v.exercise_minutes || "";
  document.getElementById("cSteps").value = v.steps || "";
  document.getElementById("cFocus").value = v.focus_hours || "";
  document.getElementById("cNote").value = v.note || "";
  document.getElementById("saveHint").textContent = r ? "这天已有记录，保存将覆盖" : "";
}
function clearForm() {
  ["cWeight", "cExercise", "cSteps", "cFocus", "cNote"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("cSleep").value = 0;
  document.getElementById("vSleep").textContent = "0 h";
  setStars("cSleepScore", 0); setStars("cMood", 0);
  document.getElementById("vSleepScore").textContent = "—";
  document.getElementById("vMood").textContent = "—";
  document.getElementById("saveHint").textContent = "";
}
async function saveCheckin() {
  const dayStr = document.getElementById("cDay").value;
  if (!dayStr) { toast("请选择日期", "error"); return; }
  await DB.upsertHealth({
    day: new Date(dayStr + "T00:00:00"),
    sleep_hours: parseFloat(document.getElementById("cSleep").value) || 0,
    sleep_score: getStars("cSleepScore"),
    mood: getStars("cMood"),
    weight: parseFloat(document.getElementById("cWeight").value) || 0,
    exercise_minutes: parseInt(document.getElementById("cExercise").value) || 0,
    steps: parseInt(document.getElementById("cSteps").value) || 0,
    focus_hours: parseFloat(document.getElementById("cFocus").value) || 0,
    note: document.getElementById("cNote").value,
  });
  toast("打卡成功", "ok");
  await render();
  await loadDay(dayStr);
}
function openCheckin() {
  document.getElementById("cDay").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function delRecord(dayStr) {
  if (!confirm(`删除 ${dayStr} 的记录？`)) return;
  const recs = await DB.getAll("health_records");
  const rec = recs.find(r => dayKey(r.day) === dayStr);
  if (!rec) { toast("没找到记录"); return; }
  await DB.del("health_records", rec.id);
  toast("已删除", "ok");
  render();
}
function exportHealthCsv() {
  const rows = [["日期", "睡眠时长", "睡眠质量", "体重", "心情", "运动分钟", "步数", "专注小时", "备注"]];
  ALL.series.forEach(r => {
    if (!r.id) return;
    rows.push([dayKey(r.day), r.sleep_hours, r.sleep_score, r.weight, r.mood,
      r.exercise_minutes, r.steps, r.focus_hours, r.note]);
  });
  download("health_export.csv", rows.map(r => r.join(",")).join("\n"), "text/csv;charset=utf-8");
}

/* ---------- 渲染 ---------- */
async function render() {
  const days = parseInt(document.getElementById("rangeSel").value, 10);
  const series = await DB.listHealth(days);
  const st = await DB.healthStats(series);
  ALL = { series, stats: st };
  const has = st.records > 0;

  document.getElementById("emptyBanner").style.display = has ? "none" : "";
  document.getElementById("dataSections").style.display = has ? "" : "none";

  document.getElementById("sSleep").innerHTML = st.avg_sleep + "<small>h</small>";
  document.getElementById("sSleepFoot").textContent = st.avg_sleep >= 7 ? "睡眠达标 ✓" : "建议 7-9 小时";
  document.getElementById("sMood").innerHTML = st.avg_mood + "<small>/5</small>";
  // 修复原版 bug：这里应显示「睡眠质量」均分，而不是把睡眠小时当质量
  const scoreVals = series.map(r => r.sleep_score).filter(v => v > 0);
  const avgScore = scoreVals.length ? (scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length).toFixed(1) : "—";
  document.getElementById("sMoodFoot").textContent = `平均质量 ${avgScore} /5`;
  document.getElementById("sStreak").innerHTML = st.streak + "<small>天</small>";
  document.getElementById("sStreakFoot").textContent = `共打卡 ${st.records} 天`;
  document.getElementById("sWeight").innerHTML = st.weight_now
    ? st.weight_now + "<small>kg</small>" : "—";
  const dw = document.getElementById("sWeightFoot");
  if (st.weight_delta) {
    dw.innerHTML = `<span style="color:${st.weight_delta < 0 ? 'var(--green)' : 'var(--red)'}">
      ${st.weight_delta > 0 ? "+" : ""}${st.weight_delta} kg</span> 相比起始`;
  } else { dw.textContent = st.weight_now ? "保持稳定" : "没有体重记录"; }

  const S = series;
  const labels = S.map(x => dayKey(x.day).slice(5));
  const opt = (extra) => Object.assign({
    labels, height: 220, treatZeroAsGap: true, maxXLabels: 10,
    tipLabel: (lb, i) => S[i] ? dayKey(S[i].day) : lb
  }, extra || {});

  Charts.LineChart(document.getElementById("chartSleep"), opt({
    series: [{ name: "睡眠", data: S.map(x => x.sleep_hours), color: "#b197fc" }],
    yMin: 0, yMax: 10, tipFormat: v => v + " 小时"
  }));
  document.getElementById("tSleep").textContent = `平均 ${st.avg_sleep} 小时`;

  Charts.LineChart(document.getElementById("chartMood"), opt({
    series: [
      { name: "心情", data: S.map(x => x.mood), color: "#38d9a9" },
      { name: "睡眠质量", data: S.map(x => x.sleep_score), color: "#4dabf7", dashed: true },
    ], yMin: 0, yMax: 5, ticks: 5, tipFormat: v => v + " 分"
  }));

  // 体重图：yMin "auto" —— 修复原版从 0 起画导致曲线被压扁的 bug
  Charts.LineChart(document.getElementById("chartWeight"), opt({
    series: [{ name: "体重", data: S.map(x => x.weight), color: "#ffa94d" }],
    yMin: "auto", showDots: false, tipFormat: v => v + " kg"
  }));
  document.getElementById("tWeight").textContent = st.weight_now
    ? `${st.weight_now} kg（${st.weight_delta > 0 ? "+" : ""}${st.weight_delta}）` : "";

  Charts.LineChart(document.getElementById("chartEx"), opt({
    series: [
      { name: "运动(分)", data: S.map(x => x.exercise_minutes), color: "#51cf66" },
      { name: "专注(h)", data: S.map(x => x.focus_hours), color: "#ff6b6b", dashed: true },
    ], yMin: 0, tipFormat: v => String(v)
  }));

  // 热力图（随所选时间范围缩放）
  const hm = document.getElementById("heatmap");
  hm.innerHTML = S.slice(-days).map(x => {
    const score = Math.min(1, (x.sleep_hours / 8) * 0.6 + (x.exercise_minutes / 60) * 0.4);
    const has = x.id !== null && x.id !== undefined;
    const bg = !has ? "var(--bg-soft)"
      : `rgba(92,124,250,${0.18 + score * 0.75})`;
    return `<div class="hm-cell" title="${dayKey(x.day)}　睡眠 ${x.sleep_hours}h　运动 ${x.exercise_minutes}分"
      style="background:${bg}"></div>`;
  }).join("");

  // 表格（事件委托）
  const rows = S.filter(x => x.id).slice().reverse().slice(0, 60);
  document.getElementById("hb").innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td style="white-space:nowrap">${dayKey(r.day)}</td>
      <td class="num">${r.sleep_hours || "—"}</td>
      <td class="num">${r.sleep_score || "—"}</td>
      <td class="num">${["", "😞", "😕", "😐", "🙂", "😄"][r.mood] || "—"}</td>
      <td class="num">${r.weight || "—"}</td>
      <td class="num">${r.exercise_minutes || "—"}</td>
      <td class="num">${r.steps ? r.steps.toLocaleString() : "—"}</td>
      <td class="num">${r.focus_hours || "—"}</td>
      <td class="ellip muted">${esc(r.note || "")}</td>
      <td><button class="btn sm danger" data-act="del" data-day="${dayKey(r.day)}">删</button></td>
    </tr>`).join("") : `<tr><td colspan="10" class="empty">还没有记录</td></tr>`;
  document.getElementById("listTag").textContent = `显示最近 ${rows.length} 条`;
}

document.getElementById("hb").addEventListener("click", (e) => {
  const t = e.target.closest("[data-act=del]");
  if (t) delRecord(t.dataset.day);
});

document.getElementById("rangeSel").addEventListener("change", render);
document.getElementById("cDay").addEventListener("change", e => loadDay(e.target.value));
window.addEventListener("themechange", () => setTimeout(render, 30));

bindStars("cSleepScore", "vSleepScore");
bindStars("cMood", "vMood");

(async function init() {
  try {
    await seedDemoIfFirstRun();
    await render();
    await loadDay(todayStr());
  } catch (e) {
    console.error(e);
  }
})();
