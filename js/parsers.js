/* =========================================================
   parsers.js —— 账单解析器（浏览器本地解析，数据不出浏览器）
   支持：支付宝 / 微信 官方导出的 CSV（GBK、UTF-8-BOM 自动识别）
        通用 CSV（自动猜列名）
   注意：官方导出的 zip 是加密的，请先解压成 CSV 再上传。
   ========================================================= */

// ---------- 列名同义词 ----------
const COL_ALIASES = {
  time: ["交易时间", "交易创建时间", "付款时间", "时间", "date", "日期", "交易日期"],
  category: ["交易分类", "交易类型", "类型", "分类"],
  counterparty: ["交易对方", "对方", "商户", "收款方", "付款方"],
  description: ["商品说明", "商品名称", "商品", "说明", "备注", "摘要"],
  direction: ["收/支", "收支", "收支类型", "方向"],
  amount: ["金额", "金额（元）", "金额(元)", "交易金额", "amount"],
  method: ["收/付款方式", "支付方式", "付款方式", "账户"],
  status: ["交易状态", "当前状态", "状态"],
};

// 支付宝自带分类 -> 我们的分类
const ALIPAY_CATEGORY_MAP = {
  "餐饮美食": "餐饮", "交通出行": "交通", "日用百货": "购物·日用",
  "服饰装扮": "购物·服饰", "美容美发": "购物·日用", "文化休闲": "娱乐",
  "运动户外": "娱乐·运动", "住房物业": "居住", "生活缴费": "居住·水电",
  "转账红包": "人情·转账", "充值提现": "金融·还款", "投资理财": "金融·理财",
  "医疗健康": "医疗", "学习教育": "学习", "有车一族": "交通·加油",
  "亲情关系": "人情·转账", "酒店旅游": "旅行", "数码电器": "购物·数码",
  "母婴亲子": "购物·日用", "宠物": "购物·日用", "公益": "人情",
  "信用借还": "金融·还款", "保险": "金融·保险", "其他": "未分类",
};

// 视为「不计收支」的关键词（内部转账、提现、充值等）
const NON_SPEND_KEYWORDS = ["不计收支", "零钱提现", "提现", "零钱充值", "充值", "信用卡还款", "转账到银行卡"];
// 视为「无效交易」直接跳过的状态
const INVALID_STATUS = ["交易关闭", "已关闭", "失败", "已全额退款", "已退款", "退款成功", "已撤销", "解冻成功", "冻结成功"];

function norm(s) {
  return String(s === null || s === undefined ? "" : s).trim().replace(/^"+|"+$/g, "").trim();
}

// ---------- 编码识别 ----------
function decodeBytes(buf) {
  // 先试 UTF-8（严格模式，乱码会抛错），失败再试 GB18030（覆盖 GBK）
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    try {
      return new TextDecoder("gb18030").decode(buf);
    } catch (e2) {
      return new TextDecoder("utf-8").decode(buf);
    }
  }
}

// ---------- 金额 ----------
function parseAmount(s) {
  if (s === null || s === undefined) return 0;
  let t = String(s).replace(/[¥￥,元\s]/g, "");
  const n = parseFloat(t);
  if (!isNaN(n)) return Math.abs(n);
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? Math.abs(parseFloat(m[0])) : 0;
}

// ---------- 时间（兼容 T 分隔，修复手动记账丢时分的问题）----------
function parseTime(s) {
  let t = norm(s);
  if (!t) return null;
  t = t.replace(/[\/.]/g, "-").replace(/\s+/g, " ").trim();
  // 兼容 datetime-local 的 "2026-09-01T19:48"
  t = t.replace("T", " ");
  const fmts = [
    "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M", "%Y-%m-%d",
  ];
  for (const f of fmts) {
    const d = strptime(t, f);
    if (d) return d;
  }
  const m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  return null;
}

// 简易 strptime（仅支持我们需要的格式）
function strptime(s, fmt) {
  const map = {
    "%Y": "(\\d{4})", "%m": "(\\d{1,2})", "%d": "(\\d{1,2})",
    "%H": "(\\d{1,2})", "%M": "(\\d{1,2})", "%S": "(\\d{1,2})",
    "%f": "(\\d+)",
  };
  let re = "^";
  const groups = [];
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === "%") {
      const key = fmt.substr(i, 2);
      if (map[key]) { re += map[key]; groups.push(key); i++; }
      else re += "%";
    } else if (fmt[i] === " ") {
      re += "\\s+";
    } else {
      re += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  const m = s.match(new RegExp(re));
  if (!m) return null;
  const g = (key) => {
    const idx = groups.indexOf(key);
    return idx >= 0 ? parseInt(m[idx + 1], 10) : (key === "%Y" ? 0 : 0);
  };
  const d = new Date(
    g("%Y"), g("%m") - 1, g("%d"),
    g("%H") || 0, g("%M") || 0, g("%S") || 0, 0
  );
  return isNaN(d) ? null : d;
}

// ---------- 找表头 ----------
function findHeader(lines) {
  for (let idx = 0; idx < Math.min(lines.length, 40); idx++) {
    const line = lines[idx];
    const low = line.toLowerCase();
    if (/(交易时间|交易创建时间|交易日期|时间)/.test(line) &&
        /(金额|amount)/.test(low)) {
      return { idx, line };
    }
  }
  return null;
}

// ---------- CSV 行切分（兼容引号内逗号、"" 转义）----------
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

// ---------- 列映射 ----------
function mapColumns(headerCells) {
  const mapping = {};
  const cells = headerCells.map(norm);
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    for (let i = 0; i < cells.length; i++) {
      if (aliases.includes(cells[i])) { mapping[field] = i; break; }
    }
  }
  return mapping;
}

function detectSource(text) {
  const head = text.slice(0, 400);
  if (head.includes("支付宝")) return "alipay";
  if (head.includes("微信")) return "wechat";
  return "generic";
}

// 统一的时间字符串（本地时区，指纹与展示都用它）
function fmtDateTime(dt) {
  const p = n => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ` +
         `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

// 内容指纹（FNV-1a 64 位，够用于去重）
function fingerprint(dt, amount, counterparty, description) {
  const base = `${fmtDateTime(dt)}|${amount.toFixed(2)}|${norm(counterparty)}|${norm(description).slice(0, 60)}`;
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000197) >>> 0;
  }
  return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
}

/**
 * 解析账单文本
 * @param {string} text 已解码的文本
 * @param {string} manualSource alipay/wechat/bank/generic/""（自动）
 * @returns {{records: object[], meta: object}}
 */
function parseBillText(text, manualSource = "") {
  const source = manualSource || detectSource(text);
  const warnings = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const header = findHeader(lines);
  if (!header) {
    return { records: [], meta: { source, total_rows: 0, skipped: 0, warnings: ["没找到表头行，请确认这是支付宝/微信导出的原始账单 CSV（先解压 zip）"] } };
  }
  const mapping = mapColumns(splitCsvLine(header.line));
  const missing = ["time", "amount"].filter(f => !(f in mapping));
  if (missing.length) {
    warnings.push(`表头缺少关键列：${missing.join("/")}，已尝试按通用格式解析`);
  }
  const body = lines.slice(header.idx + 1);

  const records = [];
  let skipped = 0;

  for (const line of body) {
    const cells = splitCsvLine(line);
    const cell = (field, def = "") => {
      const i = mapping[field];
      return (i === undefined || i >= cells.length) ? def : norm(cells[i]);
    };

    const timeIdx = mapping.time;
    const dt = (timeIdx !== undefined && timeIdx < cells.length) ? parseTime(cells[timeIdx]) : null;
    if (!dt) { skipped++; continue; }

    const amtIdx = mapping.amount;
    const amount = (amtIdx !== undefined && amtIdx < cells.length) ? parseAmount(cells[amtIdx]) : 0;
    if (amount <= 0) { skipped++; continue; }

    const counterparty = cell("counterparty");
    const description = cell("description");
    const method = cell("method");
    const status = cell("status");
    const rawDirection = cell("direction");
    const rawCategory = cell("category");

    // 跳过无效交易
    if (INVALID_STATUS.some(bad => status.includes(bad))) { skipped++; continue; }

    // 判定收支方向
    let direction;
    if (rawDirection === "支出" || rawDirection === "付款") direction = "expense";
    else if (rawDirection === "收入" || rawDirection === "收款") direction = "income";
    else {
      const joined = `${rawCategory}${description}${counterparty}${status}`;
      // 修复原版 bug：中性记录若命中「不计收支」关键词才记 transfer，否则按支出处理
      direction = NON_SPEND_KEYWORDS.some(k => joined.includes(k)) ? "transfer" : "expense";
    }

    records.push({
      occurred_at: dt,
      amount,
      direction,
      source: { alipay: "支付宝", wechat: "微信", bank: "银行卡" }[source] || source || "手动",
      counterparty,
      description,
      method,
      status,
      suggested_category: ALIPAY_CATEGORY_MAP[rawCategory] || "",
      fingerprint: fingerprint(dt, amount, counterparty, description),
    });
  }

  return {
    records,
    meta: { source, total_rows: records.length, skipped, warnings },
  };
}
