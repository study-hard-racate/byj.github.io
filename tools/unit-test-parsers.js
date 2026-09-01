// Node 单测：解析器（GBK 解码 / 时间 T 格式 / 方向判定 / 指纹去重）
const fs = require("fs");
const path = require("path");
const BASE = "D:/DeepSeek/deepseek harnes/byj.github.io";

function load(rel, exports) {
  const src = fs.readFileSync(path.join(BASE, rel), "utf8");
  return new Function(src + "; return {" + exports + "};")();
}

(async () => {
  const parsers = load("js/parsers.js", "parseBillText, decodeBytes, parseTime, fingerprint");
  const cats = load("js/categories.js", "buildRuleIndex, classify, DEFAULT_RULES");
  const results = [];
  const ok = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail: detail || "" });
    console.log((cond ? "PASS" : "FAIL") + " | " + name + (detail ? " | " + detail : ""));
  };

  // 1. GBK 解码（支付宝样例文件）
  const gbk = fs.readFileSync(path.join(BASE, "legacy/samples/alipay_sample.csv"));
  const text = parsers.decodeBytes(gbk);
  ok("GBK 解码含支付宝头", text.includes("支付宝交易记录明细查询"), text.slice(0, 30));
  const parsed = parsers.parseBillText(text, "alipay");
  ok("GBK 样例解析出记录", parsed.records.length > 100, "records=" + parsed.records.length + " skipped=" + parsed.meta.skipped);
  ok("支付宝分类映射", parsed.records[0].suggested_category === "购物·日用", "first=" + parsed.records[0].suggested_category);

  // 2. 微信样例（UTF-8-BOM）
  const wx = fs.readFileSync(path.join(BASE, "legacy/samples/wechat_sample.csv"));
  const wxText = parsers.decodeBytes(wx);
  const wxParsed = parsers.parseBillText(wxText, "");
  ok("微信样例解析", wxParsed.records.length > 100, "records=" + wxParsed.records.length + " source=" + wxParsed.meta.source);

  // 3. 时间 T 格式（修复验证）
  const t1 = parsers.parseTime("2026-09-01T19:48");
  ok("T 格式解析时分", t1 && t1.getHours() === 19 && t1.getMinutes() === 48, String(t1));
  const t2 = parsers.parseTime("2026-09-01 19:48:00");
  ok("空格格式解析", t2 && t2.getHours() === 19, String(t2));
  const t3 = parsers.parseTime("2026/9/1 12:00");
  ok("斜杠+非补零", t3 && t3.getMonth() === 8 && t3.getHours() === 12, String(t3));

  // 4. 方向判定（修复验证：无收支列 → expense，命中关键词 → transfer）
  const gen = parsers.parseBillText("时间,商户,金额,备注\n2026-08-01 10:00,某餐厅,35.00,午餐", "generic");
  ok("无收支列默认支出", gen.records.length === 1 && gen.records[0].direction === "expense",
    "dir=" + (gen.records[0] && gen.records[0].direction));
  const gen2 = parsers.parseBillText("时间,商户,金额,备注\n2026-08-01 10:00,零钱,35.00,零钱提现", "generic");
  ok("命中不计收支关键词→transfer", gen2.records.length === 1 && gen2.records[0].direction === "transfer",
    "dir=" + (gen2.records[0] && gen2.records[0].direction));

  // 5. 指纹去重稳定性
  const fp1 = parsers.fingerprint(t1, 20, "测试", "描述");
  const fp2 = parsers.fingerprint(t1, 20, "测试", "描述");
  const fp3 = parsers.fingerprint(t1, 21, "测试", "描述");
  ok("指纹稳定", fp1 === fp2 && fp1 !== fp3, fp1);

  // 6. 分类规则
  const idx = cats.buildRuleIndex(cats.DEFAULT_RULES);
  ok("分类：瑞幸→咖啡", cats.classify("瑞幸咖啡", "", idx) === "餐饮·咖啡", cats.classify("瑞幸咖啡", "", idx));
  ok("分类：滴滴→打车", cats.classify("滴滴出行", "快车", idx) === "交通·打车", cats.classify("滴滴出行", "快车", idx));
  ok("分类：未知→未分类", cats.classify("神秘商户XYZ", "", idx) === "未分类", cats.classify("神秘商户XYZ", "", idx));

  const failed = results.filter(r => !r.pass).length;
  console.log("\n" + (failed ? failed + " FAILED" : "ALL PASS") + " (" + results.length + ")");
  process.exit(failed ? 1 : 0);
})();
