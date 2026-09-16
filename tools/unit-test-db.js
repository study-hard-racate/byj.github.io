// =========================================================
// 单元测试：数据层 db.js
// 覆盖：导入去重与「新增条数」计数 / 自动分类与手动锁定 / 健康覆盖写
//       月度统计（transfer 不计入）/ JSON 备份导出导入往返
// Node 没有 IndexedDB，这里注入一个最小内存实现（只实现 db.js 真正用到的 API）。
// =========================================================
const fs = require("fs");
const path = require("path");
const BASE = path.join(__dirname, "..");

/* ---------------- 最小假 IndexedDB ---------------- */
function makeFakeIndexedDB() {
  const state = { version: 0, stores: new Map() };

  const constraint = (name) => {
    const e = new Error("ConstraintError: 唯一索引冲突 " + name);
    e.name = "ConstraintError";
    return e;
  };
  const newReq = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });

  function checkUnique(d, rec, selfKey) {
    for (const ix of d.indexes) {
      if (!ix.unique) continue;
      const v = rec[ix.keyPath];
      if (v === undefined || v === null) continue;
      for (const [k, other] of d.rows) {
        if (k !== selfKey && other[ix.keyPath] === v) throw constraint(ix.name);
      }
    }
  }
  function keyFor(d, rec) {
    let k = d.keyPath ? rec[d.keyPath] : undefined;
    if ((k === undefined || k === null) && d.autoIncrement) {
      k = ++d.autoId;
      rec[d.keyPath] = k;
    }
    return k;
  }

  function dbObject() {
    return {
      objectStoreNames: { contains: (n) => state.stores.has(n) },
      createObjectStore(name, opts) {
        const d = {
          name, keyPath: (opts && opts.keyPath) || null,
          autoIncrement: !!(opts && opts.autoIncrement),
          indexes: [], rows: new Map(), autoId: 0,
        };
        state.stores.set(name, d);
        return {
          createIndex: (iname, keyPath, iopts) =>
            d.indexes.push({ name: iname, keyPath, unique: !!(iopts && iopts.unique) }),
        };
      },
      transaction(storeName) {
        const d = state.stores.get(storeName);
        if (!d) throw new Error("NoSuchStore: " + storeName);

        const jobs = [];
        const q = (job) => { const req = newReq(); jobs.push({ req, job }); return req; };

        const handle = {
          add: (o) => q(() => {
            const r = structuredClone(o);
            const k = keyFor(d, r);
            if (d.keyPath && k !== undefined && d.rows.has(k)) throw constraint(d.keyPath);
            checkUnique(d, r, k);
            d.rows.set(k, r);
            return k;
          }),
          put: (o) => q(() => {
            const r = structuredClone(o);
            const k = keyFor(d, r);
            checkUnique(d, r, k);
            d.rows.set(k, r);
            return k;
          }),
          delete: (id) => q(() => { d.rows.delete(id); return undefined; }),
          clear: () => q(() => { d.rows.clear(); return undefined; }),
          count: () => q(() => d.rows.size),
          getAll: () => q(() => [...d.rows.values()].map(v => structuredClone(v))),
        };

        // db.js 会直接给这个对象的 oncomplete/onerror/onabort 赋值，
        // 所以必须返回同一个对象（不能包一层），否则事务永远不会 complete。
        const txn = {
          objectStore: () => handle,
          oncomplete: null, onerror: null, onabort: null,
        };

        queueMicrotask(() => {
          for (const { req, job } of jobs) {
            try {
              req.result = job();
              if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
            } catch (e) {
              req.error = e;
              if (typeof req.onerror === "function") req.onerror({ target: req });
              if (typeof txn.onabort === "function") txn.onabort();
              else if (typeof txn.onerror === "function") txn.onerror();
              return;
            }
          }
          if (typeof txn.oncomplete === "function") txn.oncomplete();
        });
        return txn;
      },
    };
  }

  return {
    open(name, version) {
      const req = {
        result: null, error: null,
        onsuccess: null, onerror: null, onupgradeneeded: null,
      };
      queueMicrotask(() => {
        const needUpgrade = (version || 1) > state.version;
        state.version = Math.max(state.version, version || 1);
        const db = dbObject();
        req.result = db;
        if (needUpgrade && typeof req.onupgradeneeded === "function") {
          req.onupgradeneeded({ target: { result: db } });
        }
        if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

globalThis.indexedDB = makeFakeIndexedDB();

/* ---------------- 加载 db.js（连同它依赖的全局函数） ---------------- */
function loadMerged(files, exports) {
  const src = files.map(f => fs.readFileSync(path.join(BASE, f), "utf8")).join("\n");
  return new Function(src + "; return {" + exports + "};")();
}
const { DB, dayKey } = loadMerged(["js/parsers.js", "js/categories.js", "js/db.js"], "DB, dayKey");

/* ---------------- 断言 ---------------- */
const results = [];
const ok = (name, cond, detail) => {
  results.push({ name, pass: !!cond });
  console.log((cond ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
};

const rec = (i, over) => Object.assign({
  occurred_at: new Date(2026, 7, (i % 28) + 1, 12, 0, 0),
  amount: 10 + i,
  direction: "expense",
  source: "支付宝",
  counterparty: "瑞幸咖啡",
  description: "拿铁 " + i,
  method: "余额",
  status: "交易成功",
  suggested_category: "",
  fingerprint: "fp" + i,
}, over || {});

(async () => {
  /* 1. 首次导入 */
  const first = await DB.importRecords([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => rec(i)));
  ok("首次导入 10 条", first.added === 10 && first.dup === 0, JSON.stringify(first));

  /* 2. 全部重复：新增 0、跳过 10 */
  const again = await DB.importRecords([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => rec(i)));
  ok("重复导入不计新增", again.added === 0 && again.dup === 10, JSON.stringify(again));

  /* 3. 回归：库里已有 10 条时再导入「5 旧 + 5 新」——新增必须只报 5
        （旧实现里 bulkAdd 返回 store 总条数，这里会错报成 15） */
  const mixed = await DB.importRecords([5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(i => rec(i)));
  ok("混合导入：新增数=5 而不是库总条数 15", mixed.added === 5 && mixed.dup === 5, JSON.stringify(mixed));

  /* 4. store 实际条数 */
  const all = await DB.getAll("transactions");
  ok("去重后共 15 条", all.length === 15, "len=" + all.length);

  /* 5. getAll 把日期归一成 Date */
  ok("getAll 日期为 Date 实例", all.every(t => t.occurred_at instanceof Date));

  /* 6. 导入时自动分类 */
  const fp10 = all.find(t => t.fingerprint === "fp10");
  ok("导入自动分类 瑞幸咖啡→餐饮·咖啡", fp10 && fp10.category === "餐饮·咖啡", fp10 && fp10.category);

  /* 7. 手动记账：显式分类 → 锁定 */
  await DB.addManual({
    occurred_at: new Date(2026, 7, 16, 9, 0), amount: 50, direction: "expense",
    source: "手动", counterparty: "瑞幸咖啡", description: "手改过", category: "自定义分类A",
  });
  const manual = (await DB.listTransactions()).find(t => t.description === "手改过");
  ok("手动指定分类后 category_locked=true", manual && manual.category_locked === true,
    manual && "cat=" + manual.category + " locked=" + manual.category_locked);

  /* 8. 手动记账：留空分类 → 自动判断且不锁定 */
  await DB.addManual({
    occurred_at: new Date(2026, 7, 15, 9, 0), amount: 30, direction: "expense",
    source: "手动", counterparty: "滴滴出行", description: "打车",
  });
  const auto = (await DB.listTransactions()).find(t => t.counterparty === "滴滴出行");
  ok("手动留空分类自动判断 滴滴出行→交通·打车",
    auto && auto.category === "交通·打车" && auto.category_locked === false,
    auto && auto.category + "/locked=" + auto.category_locked);

  /* 9. 重跑分类不动被锁定的记录 */
  const changed = await DB.reclassifyAll();
  const manualAfter = (await DB.listTransactions()).find(t => t.description === "手改过");
  ok("reclassifyAll 不覆盖手动锁定", manualAfter.category === "自定义分类A",
    "changed=" + changed + " cat=" + manualAfter.category);

  /* 10. transfer 不计入月度收支统计 */
  await DB.addManual({
    occurred_at: new Date(2026, 7, 17, 9, 0), amount: 999, direction: "transfer",
    source: "手动", counterparty: "零钱", description: "零钱充值",
  });
  const sum = await DB.summaryForMonth("2026-08");
  // 10..19 → 145；20..24 → 110；手动 50 + 30 → 合计 335；transfer 999 不计入
  ok("月度统计排除 transfer", sum.expense === 335 && sum.expense_count === 17,
    "expense=" + sum.expense + " count=" + sum.expense_count);

  /* 11. 健康：同一天重复打卡是覆盖写，不产生第二条 */
  const day = new Date(2026, 7, 5);
  await DB.upsertHealth({ day, sleep_hours: 6, mood: 3, weight: 68 });
  await DB.upsertHealth({ day, sleep_hours: 8, mood: 5, weight: 67.5 });
  const hrecs = await DB.getAll("health_records");
  const hit = hrecs.filter(r => dayKey(r.day) === "2026-08-05");
  ok("健康同日覆盖写", hrecs.length === 1 && hit.length === 1 &&
    hit[0].sleep_hours === 8 && hit[0].mood === 5 && hit[0].weight === 67.5,
    "total=" + hrecs.length + " sleep=" + (hit[0] && hit[0].sleep_hours));

  /* 12. 备份导出 → 导入往返 */
  await DB.setSetting("brand", { name: "测试品牌", sub: "t", logo: "T" });
  const dump = await DB.exportAll();
  const txnBefore = dump.transactions.length, healthBefore = dump.health_records.length;
  await DB.importAll(JSON.parse(JSON.stringify(dump)));
  const afterTx = await DB.getAll("transactions");
  const afterH = await DB.getAll("health_records");
  ok("备份往返条数一致", afterTx.length === txnBefore && afterH.length === healthBefore,
    `tx ${afterTx.length}/${txnBefore} health ${afterH.length}/${healthBefore}`);
  ok("备份往返后日期仍是 Date（可参与运算）",
    afterTx.every(t => t.occurred_at instanceof Date && !isNaN(t.occurred_at)) &&
    afterH.every(r => r.day instanceof Date && !isNaN(r.day)));
  ok("备份往返保留设置", (await DB.getSetting("brand", null)).name === "测试品牌");

  /* 13. 根因回归：bulkAdd 返回本次条数，而不是 store 总条数 */
  const n = await DB.bulkAdd("transactions", [
    rec(90, { fingerprint: "fp90" }), rec(91, { fingerprint: "fp91" }),
  ]);
  ok("bulkAdd 返回本次提交条数（非库总条数）", n === 2, "returned=" + n);
  ok("bulkAdd 之后库内确实 +2", (await DB.getAll("transactions")).length === txnBefore + 2,
    "len=" + (await DB.getAll("transactions")).length);

  const failed = results.filter(r => !r.pass).length;
  console.log("\n" + (failed ? failed + " FAILED" : "ALL PASS") + " (" + results.length + ")");
  process.exit(failed ? 1 : 0);
})();
