// Node 单测：xlsx 解析 + parseBillFile（含日期序列、共享/内联字符串）
const fs = require("fs");
const path = require("path");
const BASE = "D:/DeepSeek/deepseek harnes/byj.github.io";

function load(rel, exports) {
  const src = fs.readFileSync(path.join(BASE, rel), "utf8");
  return new Function(src + "; return {" + exports + "};")();
}
// parsers.js 依赖 xlsx.js 的全局函数，合并到同一作用域加载（模拟浏览器全局）
function loadParsers() {
  const src = ["js/xlsx.js", "js/parsers.js"]
    .map(f => fs.readFileSync(path.join(BASE, f), "utf8")).join("\n");
  return new Function(src + "; return {xlsxToGrid, parseBillFile, parseBillText, decodeBytes};")();
}

(async () => {
  const xlsx = load("js/xlsx.js", "xlsxToGrid, unzipEntry, excelSerialToStr");
  const parsers = loadParsers();
  const results = [];
  const ok = (name, cond, detail) => {
    results.push({ name, pass: !!cond });
    console.log((cond ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
  };
  const read = p => new Uint8Array(fs.readFileSync(path.join(BASE, p)));

  // 1. 共享字符串 + 文本日期（微信样式）
  const b1 = read("tools/testdata/wechat_shared_text.xlsx");
  const g1 = await xlsx.xlsxToGrid(b1);
  ok("grid 行数", g1.length === 10, "rows=" + g1.length);
  ok("grid 表头定位", g1[5][0] === "交易时间" && g1[5][5] === "金额(元)", JSON.stringify(g1[5]));
  const p1 = await parsers.parseBillFile(b1, "wechat_shared_text.xlsx");
  ok("文本日期用例：解析出 3 条（1 条退款被跳过）", p1.records.length === 3 && p1.meta.skipped === 1,
    "records=" + p1.records.length + " skipped=" + p1.meta.skipped);
  ok("来源识别微信", p1.meta.source === "wechat", p1.meta.source);
  const r0 = p1.records[0];
  ok("金额解析", r0.amount === 22.6 && r0.counterparty === "瑞幸咖啡", r0.amount);
  ok("时间解析", r0.occurred_at.getHours() === 10 && r0.occurred_at.getMinutes() === 23,
    String(r0.occurred_at));
  ok("方向：支出/收入", p1.records[0].direction === "expense" && p1.records[2].direction === "income",
    p1.records.map(r => r.direction).join(","));

  // 2. Excel 原生日期序列
  const b2 = read("tools/testdata/wechat_serial_dates.xlsx");
  const p2 = await parsers.parseBillFile(b2, "wechat_serial_dates.xlsx");
  ok("日期序列用例：解析出 3 条", p2.records.length === 3, "records=" + p2.records.length);
  ok("日期序列转时间正确（12:00）", p2.records[0].occurred_at.getHours() === 12 &&
     p2.records[0].occurred_at.getMonth() === 7 && p2.records[0].occurred_at.getDate() === 1,
    String(p2.records[0].occurred_at));
  ok("日期序列含秒", p2.records[1].occurred_at.getSeconds() === 15, String(p2.records[1].occurred_at));
  ok("序列日期金额正常", p2.records[2].amount === 1200, p2.records[2].amount);

  // 3. 内联字符串
  const b3 = read("tools/testdata/generic_inline.xlsx");
  const p3 = await parsers.parseBillFile(b3, "generic_inline.xlsx", "generic");
  ok("内联字符串用例：解析出 2 条", p3.records.length === 2, "records=" + p3.records.length);
  ok("内联字符串内容", p3.records[0].counterparty === "测试小店" && p3.records[0].amount === 12.8,
    p3.records[0].counterparty + "/" + p3.records[0].amount);

  // 4. 回归：CSV 解析不受重构影响
  const csv = await parsers.parseBillText(parsers.decodeBytes(
    read("legacy/samples/alipay_sample.csv")), "alipay");
  ok("CSV 回归：支付宝样例 559 条", csv.records.length === 559, "records=" + csv.records.length);

  // 5. 无效文件容错
  const bad = await parsers.parseBillFile(new Uint8Array([1, 2, 3]), "bad.xlsx");
  ok("损坏 xlsx 容错", bad.records.length === 0 && bad.meta.warnings.length > 0, bad.meta.warnings[0]);

  const failed = results.filter(r => !r.pass).length;
  console.log("\n" + (failed ? failed + " FAILED" : "ALL PASS") + " (" + results.length + ")");
  process.exit(failed ? 1 : 0);
})();
