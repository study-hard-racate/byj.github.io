// 单测：纯 JS inflate / 多 sheet xlsx / .xls 识别 / 日期归一化（备份恢复修复）
const fs = require("fs");
const path = require("path");
const BASE = "D:/DeepSeek/deepseek harnes/byj.github.io";
const TD = path.join(BASE, "tools/testdata");

function load(rel, exports) {
  const src = fs.readFileSync(path.join(BASE, rel), "utf8");
  return new Function(src + "; return {" + exports + "};")();
}
function loadMerged(files, exports) {
  const src = files.map(f => fs.readFileSync(path.join(BASE, f), "utf8")).join("\n");
  return new Function(src + "; return {" + exports + "};")();
}
const read = p => new Uint8Array(fs.readFileSync(path.join(TD, p)));

(async () => {
  const xlsx = load("js/xlsx.js", "inflateRaw, xlsxToGrid");
  const parsers = loadMerged(["js/xlsx.js", "js/parsers.js"], "parseBillFile");
  const dbutil = loadMerged(["js/parsers.js", "js/db.js"], "normalizeDate");
  const results = [];
  const ok = (name, cond, detail) => {
    results.push({ name, pass: !!cond });
    console.log((cond ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
  };
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  // 1. inflateRaw：stored / fixed / dynamic / small
  for (const name of ["stored_random", "fixed_repeat", "dynamic_text", "small"]) {
    const deflated = read(`deflate_${name}.bin`);
    const orig = read(`deflate_${name}.orig`);
    let out = null, err = null;
    try { out = xlsx.inflateRaw(deflated); } catch (e) { err = e.message; }
    ok(`inflate ${name}`, out && eq(out, orig), err ? "err:" + err : `ok ${orig.length}B`);
  }

  // 2. 多 sheet：数据在第 2 张表
  const ms = await parsers.parseBillFile(read("multisheet.xlsx"), "multisheet.xlsx");
  ok("多 sheet 解析出记录", ms.records.length === 2, "records=" + ms.records.length);
  ok("多 sheet 字段正确", ms.records.length === 2 &&
     ms.records[0].counterparty === "测试多表商户" && ms.records[0].amount === 66.6,
    JSON.stringify(ms.records[0] && { c: ms.records[0].counterparty, a: ms.records[0].amount }));
  ok("多 sheet 方向", ms.records.length === 2 && ms.records[1].direction === "income",
    ms.records.map(r => r.direction).join(","));

  // 3. .xls 识别
  const xl = await parsers.parseBillFile(read("fake_old.xls"), "fake_old.xls");
  ok(".xls 提示转换", xl.records.length === 0 && xl.meta.warnings[0].includes("另存为"),
    xl.meta.warnings[0].slice(0, 40));

  // 3.5 ArrayBuffer 输入（真实 file.arrayBuffer() 路径）也能解析
  const ab = read("multisheet.xlsx").buffer;
  const viaAb = await parsers.parseBillFile(ab, "multisheet.xlsx");
  ok("ArrayBuffer 输入可解析", viaAb.records.length === 2, "records=" + viaAb.records.length);

  // 4. 日期归一化（备份恢复修复的核心）
  const d1 = dbutil.normalizeDate("2026-09-01 19:48:00");
  ok("本地字符串→Date", d1 instanceof Date && d1.getHours() === 19, String(d1));
  const d2 = dbutil.normalizeDate("2026-09-01T11:12:26.000Z");
  ok("ISO(旧备份)→Date", d2 instanceof Date && d2.getUTCHours() === 11, String(d2));
  const d3 = dbutil.normalizeDate("2026-09-01");
  ok("纯日期→本地零点", d3 instanceof Date && d3.getHours() === 0 && d3.getDate() === 1, String(d3));
  const d4 = dbutil.normalizeDate(1780000000000);
  ok("时间戳→Date", d4 instanceof Date, String(d4));
  ok("非法值→null", dbutil.normalizeDate("garbage") === null && dbutil.normalizeDate(null) === null);

  // 5. 模拟完整 JSON 备份往返（导出→导入路径）
  const original = [
    { id: 1, occurred_at: new Date(2026, 8, 1, 19, 48), amount: 20, category: "餐饮" },
    { id: 2, occurred_at: new Date(2026, 8, 2, 8, 5), amount: 5, category: "交通" },
  ];
  const healthOrig = [{ id: 1, day: new Date(2026, 8, 1) }];
  // 模拟 JSON.stringify 后（日期 → ISO 字符串），再用修复后的逻辑恢复
  const restored = JSON.parse(JSON.stringify(original)).map(t => {
    t.occurred_at = dbutil.normalizeDate(t.occurred_at) || new Date(0);
    return t;
  });
  const hRestored = JSON.parse(JSON.stringify(healthOrig)).map(r => {
    r.day = dbutil.normalizeDate(r.day) || new Date(0);
    return r;
  });
  ok("备份往返后日期可运算", restored.every(t => t.occurred_at instanceof Date) &&
     restored[0].occurred_at.getHours() === 19 &&
     hRestored[0].day instanceof Date && hRestored[0].day.getDate() === 1,
    restored.map(t => String(t.occurred_at)).join(" / "));

  // 6. 旧版(ISO)备份兼容：hour 保持（本地时区 +8 下 19:48 本地 → ISO 11:48Z → 恢复后应还原为 19:48 本地）
  ok("时区往返一致", restored[0].occurred_at.getHours() === 19,
    "getHours=" + restored[0].occurred_at.getHours());

  const failed = results.filter(r => !r.pass).length;
  console.log("\n" + (failed ? failed + " FAILED" : "ALL PASS") + " (" + results.length + ")");
  process.exit(failed ? 1 : 0);
})();
