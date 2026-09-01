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
  document.getElementById("setHealthHour").value = reminder.healthHour;
  document.getElementById("setMonthlyDay").value = reminder.monthlyDay;
  document.getElementById("notifyHint").textContent =
    "Notification" in window
      ? (Notification.permission === "granted" ? "系统通知已开启 ✓" : "点击开启浏览器通知权限")
      : "当前浏览器不支持通知";

  document.getElementById("ver").textContent = APP_CONFIG.version;

  // iOS 显示 Safari 手动添加指引
  const iosHint = document.getElementById("iosHint");
  if (iosHint && window.isIOSPWA) iosHint.style.display = "";
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
  const healthHour = Math.min(23, Math.max(0, parseInt(document.getElementById("setHealthHour").value, 10) || 20));
  const monthlyDay = Math.min(28, Math.max(1, parseInt(document.getElementById("setMonthlyDay").value, 10) || 2));
  await DB.setSetting("reminder", { healthHour, monthlyDay });
  toast("提醒设置已保存", "ok");
}

async function enableNotify() {
  if (!("Notification" in window)) { toast("当前浏览器不支持通知", "error"); return; }
  const perm = await Notification.requestPermission();
  document.getElementById("notifyHint").textContent =
    perm === "granted" ? "系统通知已开启 ✓" : "未获得通知权限";
  toast(perm === "granted" ? "通知已开启" : "通知未开启", perm === "granted" ? "ok" : "error");
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
