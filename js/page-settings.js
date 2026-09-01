/* =========================================================
   page-settings.js —— 设置页
   ========================================================= */

async function load() {
  const brand = await DB.getSetting("brand", null) || APP_CONFIG.brand;
  document.getElementById("setName").value = brand.name || "";
  document.getElementById("setSub").value = brand.sub || "";
  document.getElementById("setLogo").value = brand.logo || "";

  const budget = await DB.getSetting(`budget:${nowMonthStr()}`, null);
  document.getElementById("setBudget").value = budget === null ? "" : budget;
  document.getElementById("budgetHint").textContent = budget === null ? "本月未设置预算" : `本月预算 ${money0(budget)}`;

  const reminder = await DB.getSetting("reminder", null) || {
    healthHour: APP_CONFIG.reminder.healthHour,
    monthlyDay: APP_CONFIG.reminder.monthlyDay,
  };
  const hour = Math.max(0, Math.min(23, reminder.healthHour));
  document.getElementById("setHealthTime").value = String(hour).padStart(2, "0") + ":00";
  document.getElementById("setMonthlyDay").value = reminder.monthlyDay;
  refreshNotifyUI();
  refreshReminderStatus(reminder);

  document.getElementById("ver").textContent = APP_CONFIG.version;

  // iOS 显示 Safari 手动添加指引
  const iosHint = document.getElementById("iosHint");
  if (iosHint && window.isIOSPWA) iosHint.style.display = "";
}

/* ---------- 通知权限 ---------- */
function refreshNotifyUI() {
  const hint = document.getElementById("notifyHint");
  const btn = document.getElementById("notifyBtn");
  if (!btn || !hint) return;
  if (!("Notification" in window)) {
    hint.textContent = "当前浏览器不支持通知";
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  if (Notification.permission === "granted") {
    hint.textContent = "系统通知已开启 ✓";
    btn.textContent = "已开启";
    btn.disabled = true;
  } else if (Notification.permission === "denied") {
    hint.textContent = "通知被拒绝，请到浏览器设置里允许本站";
    btn.textContent = "重新开启";
    btn.disabled = false;
  } else {
    hint.textContent = "开启后可收到打卡 / 账单提醒";
    btn.textContent = "开启通知";
    btn.disabled = false;
  }
}

async function toggleNotify() {
  if (!("Notification" in window)) return;
  const perm = await Notification.requestPermission();
  refreshNotifyUI();
  toast(perm === "granted" ? "通知已开启" : "未获得通知权限", perm === "granted" ? "ok" : "error");
}

function testNotify() {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    toast("请先开启通知权限", "error");
    return;
  }
  try {
    new Notification("BYJ 个人看板", {
      body: "这是一条测试通知，收到就说明设置成功了 ✓",
      icon: "icons/icon-192.png",
    });
    toast("测试通知已发送", "ok");
  } catch (e) {
    toast("发送失败：" + e.message, "error");
  }
}

/* ---------- 提醒状态预览 ---------- */
async function refreshReminderStatus(reminder) {
  const box = document.getElementById("reminderStatus");
  if (!box) return;
  const lines = [];
  const rec = await DB.getHealthByDay(new Date());
  lines.push(rec
    ? `✅ 今日已打卡（睡眠 ${rec.sleep_hours || 0}h · 运动 ${rec.exercise_minutes || 0}分）`
    : `⏰ 今天还没打卡 · ${String(reminder.healthHour).padStart(2, "0")}:00 后打开本站会提醒`);
  const months = await allMonthKeys();
  const m = nowMonthStr();
  lines.push(months.includes(m)
    ? `✅ ${m} 已有账单记录`
    : `⏰ ${m} 还没有账单 · 每月 ${reminder.monthlyDay} 号后打开本站会提醒`);
  box.innerHTML = lines.join("<br>");
}

async function saveBrand() {
  const name = document.getElementById("setName").value.trim() || "BYJ 的个人看板";
  const sub = document.getElementById("setSub").value.trim();
  const logo = document.getElementById("setLogo").value.trim() || "B";
  await DB.setSetting("brand", { name, sub, logo });
  toast("品牌已保存", "ok");
  await renderLayout();
}

async function saveBudget() {
  const v = parseFloat(document.getElementById("setBudget").value);
  const month = nowMonthStr();
  if (!v || v <= 0) { await DB.setSetting(`budget:${month}`, null); }
  else { await DB.setSetting(`budget:${month}`, v); }
  toast(v > 0 ? `已设置 ${month} 预算 ${money0(v)}` : "已取消预算", "ok");
  load();
}
async function clearBudget() {
  await DB.setSetting(`budget:${nowMonthStr()}`, null);
  toast("已取消本月预算", "ok");
  load();
}

async function saveReminder() {
  const timeVal = document.getElementById("setHealthTime").value || "20:00";
  const healthHour = Math.min(23, Math.max(0, parseInt(timeVal.split(":")[0], 10) || 20));
  const monthlyDay = Math.min(28, Math.max(1, parseInt(document.getElementById("setMonthlyDay").value, 10) || 2));
  await DB.setSetting("reminder", { healthHour, monthlyDay });
  toast("提醒设置已保存", "ok");
  refreshReminderStatus({ healthHour, monthlyDay });
}

/* ---------- 数据管理 ---------- */
async function exportData() {
  const data = await DB.exportAll();
  download(`byj-backup-${todayStr()}.json`, JSON.stringify(data, null, 2), "application/json");
  toast("备份已导出", "ok");
}

document.getElementById("importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const text = (await f.text()).replace(/^\uFEFF/, ""); // 剥掉 BOM
    const data = JSON.parse(text);
    if (!confirm("导入备份会【覆盖】当前所有数据，确定继续？")) { e.target.value = ""; return; }
    await DB.importAll(data);
    toast("备份已恢复", "ok");
    load();
  } catch (err) {
    toast("导入失败：" + err.message, "error");
  }
  e.target.value = "";
});

async function clearData() {
  if (!confirm("确定清空所有数据？此操作不可恢复，建议先导出备份！")) return;
  if (!confirm("再确认一次：真的要清空全部账单和健康数据？")) return;
  await clearAllData();
  toast("已清空所有数据", "ok");
  load();
}

async function reseedDemo() {
  if (!confirm("将填充一份演示数据（会追加，重复指纹自动跳过），继续？")) return;
  const txn = genDemoTransactions(6);
  const batch = txn.map(t => ({
    occurred_at: t.occurred_at, amount: t.amount, direction: t.direction,
    source: Math.random() < 0.55 ? "支付宝" : "微信",
    counterparty: t.counterparty, description: t.description,
    method: "余额", status: "交易成功",
    category: "未分类", category_locked: false,
    fingerprint: fingerprint(t.occurred_at, t.amount, t.counterparty, t.description),
    created_at: new Date(),
  }));
  const rules = await DB.getRules();
  batch.forEach(t => { t.category = classify(t.counterparty, t.description, rules); });
  await DB.bulkAdd("transactions", batch);
  const health = genDemoHealth(90);
  for (const h of health) await DB.upsertHealth(h);
  await DB.setSetting("demo", true);
  toast(`已填充 ${batch.length} 条账单 + ${health.length} 天打卡`, "ok");
}

(async function init() {
  try {
    await seedDemoIfFirstRun();
    await load();
  } catch (e) {
    console.error(e);
  }
})();
