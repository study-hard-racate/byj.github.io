/* =========================================================
   run-tests.js —— 一键回归：跑全部单元测试并汇总
   用法： node tools/run-tests.js
   ========================================================= */
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const tests = [
  ["unit-test-parsers.js", "解析器（CSV/时间/方向/分类/GBK）"],
  ["unit-test-xlsx.js", "Excel（共享串/日期序列/内联串/回归）"],
  ["unit-test-robust.js", "健壮性（inflate/多sheet/.xls/备份日期）"],
];

let failed = 0;
for (const [file, label] of tests) {
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: root, encoding: "utf8", timeout: 60000,
  });
  const out = (r.stdout || "").trim();
  const last = out.split("\n").filter(Boolean).pop() || "";
  const pass = r.status === 0;
  console.log(`${pass ? "✅" : "❌"} [${label}] ${last}`);
  if (!pass) {
    console.log(out);
    if (r.stderr) console.error(r.stderr);
    failed++;
  }
}
console.log(failed ? `\n❌ ${failed} 组失败` : "\n✅ 全部通过");
process.exit(failed ? 1 : 0);
