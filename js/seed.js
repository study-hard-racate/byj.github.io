/* =========================================================
   seed.js —— 演示数据（首次打开自动填充，可在设置里清空）
   ========================================================= */

const EXPENSE_POOL = [
  ["瑞幸咖啡", "生椰拿铁", "餐饮美食", 15, 32, 6, 14],
  ["蜜雪冰城", "冰鲜柠檬水", "餐饮美食", 6, 12, 3, 8],
  ["肯德基", "香辣鸡腿堡套餐", "餐饮美食", 28, 45, 1, 4],
  ["美团外卖", "午餐订单", "餐饮美食", 18, 42, 5, 12],
  ["学校食堂", "就餐", "餐饮美食", 8, 20, 10, 20],
  ["沙县小吃", "拌面蒸饺", "餐饮美食", 12, 25, 2, 5],
  ["滴滴出行", "快车行程", "交通出行", 12, 48, 2, 7],
  ["深圳地铁", "乘车码", "交通出行", 3, 12, 8, 22],
  ["哈啰单车", "骑行", "交通出行", 1.5, 5, 4, 12],
  ["12306", "高铁票", "交通出行", 80, 550, 0, 2],
  ["京东商城", "数码配件", "日用百货", 25, 320, 1, 4],
  ["拼多多", "日用品", "日用百货", 9, 89, 2, 6],
  ["嘉立创", "PCB打样+元器件", "数码电器", 30, 260, 1, 3],
  ["优衣库", "服饰", "服饰装扮", 79, 399, 0, 2],
  ["沃尔玛", "超市购物", "日用百货", 35, 180, 1, 4],
  ["中国移动", "话费充值", "生活缴费", 30, 100, 1, 1],
  ["国家电网", "电费", "生活缴费", 50, 220, 1, 1],
  ["万达影城", "电影票", "文化休闲", 35, 98, 0, 2],
  ["哔哩哔哩", "大会员", "文化休闲", 15, 25, 0, 1],
  ["Steam", "游戏", "文化休闲", 30, 298, 0, 2],
  ["健身房", "月卡", "运动户外", 99, 299, 0, 1],
  ["当当网", "图书", "学习教育", 30, 150, 0, 2],
  ["大药房", "药品", "医疗健康", 15, 120, 0, 2],
];
const INCOME_POOL = [
  ["公司", "工资代发", "收入", 8000, 8000, 1, 1],
  ["导师", "助研津贴", "收入", 800, 1500, 0, 1],
  ["妈妈", "生活费", "收入", 1500, 2000, 0, 1],
];

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function genDemoTransactions(months = 6) {
  const out = [];
  const now = new Date();
  for (let off = months - 1; off >= 0; off--) {
    const first = new Date(now.getFullYear(), now.getMonth() - off, 1);
    const last = new Date(now.getFullYear(), now.getMonth() - off + 1, 0);
    const isCurrent = off === 0;
    const maxDay = isCurrent ? now.getDate() : last.getDate();

    const pool = EXPENSE_POOL.concat(INCOME_POOL);
    for (const [party, desc, cat, lo, hi, cLo, cHi] of pool) {
      const cnt = randInt(cLo, cHi);
      for (let i = 0; i < cnt; i++) {
        const d = randInt(1, Math.max(maxDay, 1));
        const t = new Date(first.getFullYear(), first.getMonth(), d,
          randInt(7, 23), randInt(0, 59), randInt(0, 59));
        if (t > now) continue;
        out.push({
          occurred_at: t,
          amount: Math.round(rand(lo, hi) * 100) / 100,
          direction: cat === "收入" ? "income" : "expense",
          counterparty: party,
          description: desc,
        });
      }
    }
  }
  out.sort((a, b) => a.occurred_at - b.occurred_at);
  return out;
}

function genDemoHealth(days = 90) {
  const out = [];
  const today = new Date();
  let weight = 68.0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (Math.random() < 0.12) continue; // 偶尔漏打卡
    const sleep = Math.round(rand(5.5, 8.8) * 10) / 10;
    const ex = [0, 0, 15, 25, 30, 45, 60, 90][randInt(0, 7)];
    const mood = Math.max(1, Math.min(5, Math.round(rand(2.6, 4.4))));
    weight = Math.round((weight + rand(-0.35, 0.3)) * 10) / 10;
    const notes = ["", "", "", "跑了 5 公里", "熬夜了", "状态不错", "调了一天 I2C 时序", "焊板子", "", ""];
    out.push({
      day: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      sleep_hours: sleep,
      sleep_score: Math.max(1, Math.min(5, Math.round(sleep / 2))),
      weight: i % 2 === 0 ? weight : 0,
      mood,
      exercise_minutes: ex,
      steps: randInt(2000, 16000),
      focus_hours: Math.round(rand(0.5, 7.5) * 10) / 10,
      note: notes[randInt(0, notes.length - 1)],
    });
  }
  return out;
}

/** 首次运行自动填充演示数据（只执行一次） */
async function seedDemoIfFirstRun() {
  const seeded = await DB.getSetting("seeded", false);
  if (seeded) return { seeded: false };
  const txnCount = (await DB.getAll("transactions")).length;
  if (txnCount > 0) { await DB.setSetting("seeded", true); return { seeded: false }; }

  const txn = genDemoTransactions(6);
  const health = genDemoHealth(90);
  let addedT = 0;
  const batch = txn.map(t => {
    addedT++;
    return {
      occurred_at: t.occurred_at, amount: t.amount, direction: t.direction,
      source: Math.random() < 0.55 ? "支付宝" : "微信",
      counterparty: t.counterparty, description: t.description,
      method: "余额", status: "交易成功",
      category: "未分类", category_locked: false,
      fingerprint: fingerprint(t.occurred_at, t.amount, t.counterparty, t.description),
      created_at: new Date(),
    };
  });
  // 导入时自动分类
  const rules = await DB.getRules();
  batch.forEach(t => { t.category = classify(t.counterparty, t.description, rules); });

  await DB.bulkAdd("transactions", batch);
  for (const h of health) await DB.upsertHealth(h);
  await DB.setSetting("seeded", true);
  await DB.setSetting("demo", true); // 标记为演示数据，总览页显示提示
  return { seeded: true, transactions: addedT, health: health.length };
}

/** 清空全部数据（含设置里的品牌/预算，保留 seeded 标志以便再填充） */
async function clearAllData() {
  await DB.clear("transactions");
  await DB.clear("health_records");
  await DB.clear("category_rules");
  await DB.clear("settings");
  await DB.setSetting("seeded", true); // 避免页面一开又自动塞演示数据
}
