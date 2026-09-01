/* =========================================================
   db.js —— 数据层（IndexedDB）
   所有数据只存在浏览器本地（IndexedDB），不联网、不上传。
   包含：增删改查 + 统计聚合（从原 Flask API 移植）。
   ========================================================= */

const DB_NAME = "byj-dashboard";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("transactions")) {
        const s = db.createObjectStore("transactions", { keyPath: "id", autoIncrement: true });
        s.createIndex("occurred_at", "occurred_at");
        s.createIndex("fingerprint", "fingerprint", { unique: true });
        s.createIndex("category", "category");
        s.createIndex("source", "source");
        s.createIndex("direction", "direction");
      }
      if (!db.objectStoreNames.contains("category_rules")) {
        const s = db.createObjectStore("category_rules", { keyPath: "id", autoIncrement: true });
        s.createIndex("keyword", "keyword", { unique: true });
      }
      if (!db.objectStoreNames.contains("health_records")) {
        const s = db.createObjectStore("health_records", { keyPath: "id", autoIncrement: true });
        s.createIndex("day", "day", { unique: true });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = (() => {
  let dbPromise = null;
  const db = () => (dbPromise = dbPromise || openDB());

  function req(r) {
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async function run(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    // ---------- 基础 ----------
    getAll(store) {
      return run(store, "readonly", s => req(s.getAll()));
    },
    add(store, obj) {
      return run(store, "readwrite", s => req(s.add(obj)));
    },
    bulkAdd(store, arr) {
      return run(store, "readwrite", s => {
        arr.forEach(o => s.add(o));
        return req(s.count());
      });
    },
    put(store, obj) {
      return run(store, "readwrite", s => req(s.put(obj)));
    },
    del(store, id) {
      return run(store, "readwrite", s => req(s.delete(id)));
    },
    clear(store) {
      return run(store, "readwrite", s => req(s.clear()));
    },

    // ---------- 设置 ----------
    async getSetting(key, def = null) {
      const all = await this.getAll("settings");
      const hit = all.find(x => x.key === key);
      return hit ? hit.value : def;
    },
    async setSetting(key, value) {
      await this.put("settings", { key, value });
    },

    // ---------- 分类规则（默认 + 用户）----------
    async getRules() {
      const userRules = await this.getAll("category_rules");
      const merged = DEFAULT_RULES.map(r => [...r]);
      // 用户规则优先级 +100，更高
      userRules.forEach(r => merged.push([r.keyword, r.category, r.priority + 100]));
      return buildRuleIndex(merged);
    },

    // ---------- 交易 ----------
    async listTransactions() {
      return await this.getAll("transactions");
    },

    async addTransaction(t) {
      t.created_at = t.created_at || new Date();
      return await this.add("transactions", t);
    },

    /** 导入一批解析后的记录：去重 + 自动分类 */
    async importRecords(records) {
      const all = await this.getAll("transactions");
      const exist = new Set(all.map(t => t.fingerprint));
      const rules = await this.getRules();
      const toAdd = [];
      let dup = 0;
      for (const rec of records) {
        const fp = rec.fingerprint;
        if (exist.has(fp)) { dup++; continue; }
        const cat = rec.suggested_category || classify(rec.counterparty, rec.description, rules);
        toAdd.push({
          occurred_at: rec.occurred_at,
          amount: rec.amount,
          direction: rec.direction,
          source: rec.source,
          counterparty: rec.counterparty,
          description: rec.description,
          method: rec.method || "",
          status: rec.status || "",
          category: cat,
          category_locked: false,
          fingerprint: fp,
          created_at: new Date(),
        });
        exist.add(fp);
      }
      let added = 0;
      if (toAdd.length) added = await this.bulkAdd("transactions", toAdd);
      return { added, dup };
    },

    /** 手动记账 */
    async addManual({ occurred_at, amount, direction, source, counterparty, description, category, method }) {
      const fp = "manual-" + fingerprint(new Date(), amount, counterparty + Math.random(), description + Math.random());
      const rules = await this.getRules();
      const cat = category || classify(counterparty, description, rules);
      return await this.add("transactions", {
        occurred_at, amount, direction,
        source: source || "手动",
        counterparty: counterparty || "",
        description: description || "",
        method: method || "",
        category: cat,
        category_locked: !!category,
        fingerprint: fp,
        created_at: new Date(),
      });
    },

    /** 重跑分类（不覆盖手动锁定/改过的） */
    async reclassifyAll() {
      const all = await this.getAll("transactions");
      const rules = await this.getRules();
      let changed = 0;
      for (const t of all) {
        if (t.category_locked) continue;
        const nc = classify(t.counterparty, t.description, rules);
        if (nc !== t.category) {
          t.category = nc;
          t.category_locked = false;
          await this.put("transactions", t);
          changed++;
        }
      }
      return changed;
    },

    // ---------- 健康 ----------
    async listHealth(days) {
      const all = await this.getAll("health_records");
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const start = new Date(); start.setDate(start.getDate() - (days - 1)); start.setHours(0, 0, 0, 0);
      return all
        .filter(r => r.day >= start && r.day <= end)
        .sort((a, b) => a.day - b.day);
    },

    async getHealthByDay(day) {
      const all = await this.getAll("health_records");
      const key = dayKey(day);
      return all.find(r => dayKey(r.day) === key) || null;
    },

    async upsertHealth(rec) {
      const all = await this.getAll("health_records");
      const key = dayKey(rec.day);
      const exist = all.find(r => dayKey(r.day) === key);
      const now = new Date();
      if (exist) {
        const merged = Object.assign({}, exist, rec, { updated_at: now });
        await this.put("health_records", merged);
        return merged;
      }
      const obj = Object.assign({}, rec, { updated_at: now });
      const id = await this.add("health_records", obj);
      return Object.assign({}, obj, { id });
    },

    // ---------- 统计 ----------
    /** 月度汇总（对齐原 /api/summary） */
    async summaryForMonth(monthStr) {
      const all = await this.getAll("transactions");
      const [y, m] = monthStr.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const nxt = new Date(y, m, 1);
      const prevStart = new Date(y, m - 2, 1);

      let expense = 0, income = 0, expenseCnt = 0;
      const catMap = new Map(), catCnt = new Map(), merchant = new Map();
      let biggest = null, uncategorized = 0;

      for (const t of all) {
        const d = t.occurred_at;
        if (d < start || d >= nxt) continue;
        if (t.direction === "expense") {
          expense += t.amount; expenseCnt++;
          catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount);
          catCnt.set(t.category, (catCnt.get(t.category) || 0) + 1);
          if (t.counterparty) merchant.set(t.counterparty, (merchant.get(t.counterparty) || 0) + t.amount);
          if (!biggest || t.amount > biggest.amount) biggest = t;
          if (t.category === "未分类" || t.category === "其他") uncategorized++;
        } else if (t.direction === "income") {
          income += t.amount;
        }
      }

      let prevExpense = 0;
      for (const t of all) {
        const d = t.occurred_at;
        if (d >= prevStart && d < start && t.direction === "expense") prevExpense += t.amount;
      }

      const now = new Date();
      const daysInMonth = (nxt - start) / 86400000;
      const passedDays = start <= now
        ? Math.min(Math.floor((now - start) / 86400000) + 1, daysInMonth)
        : daysInMonth;
      const avgDaily = expense / Math.max(passedDays, 1);

      const categories = [...catMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({
          name, value: round2(value), count: catCnt.get(name),
          color: CATEGORY_COLORS[name] || "#adb5bd",
        }));
      const topMerchants = [...merchant.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, value]) => ({ name, value: round2(value) }));

      const budget = await this.getSetting(`budget:${monthStr}`, null);

      return {
        month: monthStr,
        expense: round2(expense), income: round2(income),
        balance: round2(income - expense),
        expense_count: expenseCnt,
        avg_daily: round2(avgDaily),
        prev_expense: round2(prevExpense),
        mom: prevExpense ? round1((expense - prevExpense) / prevExpense * 100) : null,
        passed_days: passedDays,
        days_in_month: daysInMonth,
        uncategorized,
        categories,
        top_merchants: topMerchants,
        biggest: biggest ? txnToDict(biggest) : null,
        budget: budget === null || budget === undefined ? null : Number(budget),
      };
    },

    /** 近 N 个月收支趋势（对齐原 /api/monthly_trend） */
    async monthlyTrend(n = 12) {
      const all = await this.getAll("transactions");
      const data = new Map(); // monthKey -> {expense, income}
      for (const t of all) {
        if (t.direction !== "expense" && t.direction !== "income") continue;
        const k = monthKey(t.occurred_at);
        if (!data.has(k)) data.set(k, { expense: 0, income: 0 });
        data.get(k)[t.direction] = round2((data.get(k)[t.direction] || 0) + t.amount);
      }
      const keys = [...data.keys()].sort().reverse().slice(0, n).reverse();
      return {
        months: keys,
        expense: keys.map(k => data.get(k).expense),
        income: keys.map(k => data.get(k).income),
        balance: keys.map(k => round2(data.get(k).income - data.get(k).expense)),
      };
    },

    /** 某月每日支出（对齐原 /api/daily_trend） */
    async dailyTrend(monthStr) {
      const [y, m] = monthStr.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const nxt = new Date(y, m, 1);
      const all = await this.getAll("transactions");
      const daily = new Map();
      for (const t of all) {
        if (t.direction !== "expense") continue;
        if (t.occurred_at < start || t.occurred_at >= nxt) continue;
        const k = dayKey(t.occurred_at);
        daily.set(k, round2((daily.get(k) || 0) + t.amount));
      }
      const labels = [], values = [];
      for (let d = new Date(start); d < nxt; d.setDate(d.getDate() + 1)) {
        labels.push(String(d.getDate()));
        values.push(daily.get(dayKey(d)) || 0);
      }
      return { labels, values };
    },

    /** 健康统计（对齐原 /api/health） */
    async healthStats(records) {
      const valid = records;
      const avg = (vals) => {
        const f = vals.filter(v => v && v > 0);
        return f.length ? round1(f.reduce((a, b) => a + b, 0) / f.length) : 0;
      };
      const weights = valid.filter(r => r.weight > 0).map(r => r.weight);
      return {
        records: valid.length,
        avg_sleep: avg(valid.map(r => r.sleep_hours)),
        avg_mood: avg(valid.map(r => r.mood)),
        avg_exercise: avg(valid.map(r => r.exercise_minutes)),
        avg_focus: avg(valid.map(r => r.focus_hours)),
        total_steps: valid.reduce((a, r) => a + (r.steps || 0), 0),
        weight_now: weights.length ? weights[weights.length - 1] : 0,
        weight_start: weights.length ? weights[0] : 0,
        weight_delta: weights.length >= 2 ? round1(weights[weights.length - 1] - weights[0]) : 0,
        good_days: valid.filter(r => r.sleep_hours >= 7 || r.exercise_minutes >= 30).length,
        streak: calcStreak(valid),
      };
    },

    // ---------- 备份 / 恢复 ----------
    async exportAll() {
      return {
        app: "byj-dashboard",
        version: 1,
        exportedAt: new Date().toISOString(),
        transactions: await this.getAll("transactions"),
        health_records: await this.getAll("health_records"),
        category_rules: await this.getAll("category_rules"),
        settings: await this.getAll("settings"),
      };
    },
    async importAll(data) {
      if (!data || !Array.isArray(data.transactions)) throw new Error("备份文件格式不对");
      await this.clear("transactions");
      await this.clear("health_records");
      await this.clear("category_rules");
      await this.clear("settings");
      if (data.transactions.length) await this.bulkAdd("transactions", data.transactions);
      if (data.health_records && data.health_records.length) await this.bulkAdd("health_records", data.health_records);
      if (data.category_rules && data.category_rules.length) await this.bulkAdd("category_rules", data.category_rules);
      if (data.settings && data.settings.length) {
        for (const s of data.settings) await this.put("settings", s);
      }
    },
  };
})();

/* ================= 工具 ================= */
function dayKey(d) {
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return String(d).slice(0, 10);
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }
function txnToDict(t) {
  return {
    id: t.id,
    occurred_at: fmtDateTime(t.occurred_at),
    date: dayKey(t.occurred_at),
    amount: round2(t.amount),
    direction: t.direction,
    source: t.source,
    counterparty: t.counterparty,
    description: t.description,
    category: t.category,
    method: t.method,
    status: t.status,
  };
}
function calcStreak(records) {
  if (!records.length) return 0;
  const daySet = new Set(records.map(r => dayKey(r.day)));
  const today = new Date();
  let cursor = new Date(today);
  if (!daySet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  if (!daySet.has(dayKey(cursor))) return 0;
  let streak = 0;
  while (daySet.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 拿到本月（或指定月）所有月份的列表 */
async function allMonthKeys() {
  const all = await DB.getAll("transactions");
  const s = new Set(all.map(t => monthKey(t.occurred_at)));
  return [...s].sort().reverse();
}
