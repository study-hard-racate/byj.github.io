"""
账单解析器

支持：
  1. 支付宝导出的账单（zip 解压后的 csv，GBK 编码）
  2. 微信支付的账单（csv，UTF-8 with BOM）
  3. 通用 csv（自动猜测列名，用户也可在页面上手动指定列映射）

两家官方导出方式（写在 README 里）：
  支付宝：App → 我的 → 账单 → 右上角「...」→ 开具交易流水证明 → 用于个人对账 → 下载
  微信  ：App → 我 → 服务 → 钱包 → 账单 → 右上角「...」→ 账单下载 → 用于个人对账
"""
import hashlib
import io
import re
import zipfile
from datetime import datetime

import chardet

# ---------- 列名同义词表 ----------
COL_ALIASES = {
    "time": ["交易时间", "交易创建时间", "付款时间", "时间", "date", "日期", "交易日期"],
    "category": ["交易分类", "交易类型", "类型", "分类"],
    "counterparty": ["交易对方", "对方", "商户", "收款方", "付款方"],
    "description": ["商品说明", "商品名称", "商品", "说明", "备注", "摘要"],
    "direction": ["收/支", "收支", "收支类型", "方向"],
    "amount": ["金额", "金额（元）", "金额(元)", "交易金额", "amount"],
    "method": ["收/付款方式", "支付方式", "付款方式", "账户"],
    "status": ["交易状态", "当前状态", "状态"],
}

# 支付宝自带的分类 -> 我们的分类（支付宝自身分类质量不错，优先采用）
ALIPAY_CATEGORY_MAP = {
    "餐饮美食": "餐饮", "交通出行": "交通", "日用百货": "购物·日用",
    "服饰装扮": "购物·服饰", "美容美发": "购物·日用", "文化休闲": "娱乐",
    "运动户外": "娱乐·运动", "住房物业": "居住", "生活缴费": "居住·水电",
    "转账红包": "人情·转账", "充值提现": "金融·还款", "投资理财": "金融·理财",
    "医疗健康": "医疗", "学习教育": "学习", "有车一族": "交通·加油",
    "亲情关系": "人情·转账", "酒店旅游": "旅行", "数码电器": "购物·数码",
    "母婴亲子": "购物·日用", "宠物": "购物·日用", "公益": "人情",
    "信用借还": "金融·还款", "保险": "金融·保险", "其他": "未分类",
}

# 视为「不计收支」的状态/类型：内部转账、提现、零钱充值等
NON_SPEND_KEYWORDS = ["不计收支", "零钱提现", "提现", "零钱充值", "充值", "信用卡还款", "转账到银行卡"]
# 视为「无效交易」的状态，直接跳过
INVALID_STATUS = ["交易关闭", "已关闭", "失败", "已全额退款", "已退款", "退款成功", "已撤销", "解冻成功", "冻结成功"]


def _decode(raw: bytes) -> str:
    """自动探测编码，中文账单常见 GBK / UTF-8-BOM"""
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig")
    guess = chardet.detect(raw[:200_000])
    enc = guess.get("encoding") or "utf-8"
    confidence = guess.get("confidence") or 0
    for candidate in [enc, "gbk", "gb18030", "utf-8"]:
        try:
            return raw.decode(candidate)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="ignore")


def _extract_csv_from_zip(raw: bytes) -> bytes:
    """支付宝导出的是 zip，里面装 csv"""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            for name in zf.namelist():
                if name.lower().endswith((".csv", ".txt")) and not name.startswith("__"):
                    return zf.read(name)
            # 兜底：取第一个文件
            return zf.read(zf.namelist()[0])
    except zipfile.BadZipFile:
        return raw


def _norm(s) -> str:
    return str(s or "").strip().strip('"').strip()


def _parse_amount(s) -> float:
    """把 '¥1,234.56' / '1234.56元' / '-35.00' 统一成 float"""
    if s is None:
        return 0.0
    t = str(s).replace("¥", "").replace(",", "").replace("￥", "").replace("元", "")
    t = t.replace(" ", "").strip()
    try:
        return abs(float(t))
    except ValueError:
        m = re.search(r"-?\d+(\.\d+)?", t)
        return abs(float(m.group())) if m else 0.0


def _parse_time(s):
    """兼容 '2024-01-01 12:00:00' / '2024/1/1 12:00' / '2024-01-01'"""
    t = _norm(s)
    if not t:
        return None
    t = t.replace("/", "-").replace(".", "-")
    t = re.sub(r"\s+", " ", t)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def _find_header(lines):
    """找到真正的表头行：同时含「时间」和「金额」类关键词的那一行"""
    for idx, line in enumerate(lines[:40]):
        low = line.lower()
        if ("交易时间" in line or "交易创建时间" in line or "交易日期" in line or "时间" in line) \
                and ("金额" in line or "amount" in low):
            return idx, line
    return None, None


def _split_csv_line(line: str):
    """简单但够用的 CSV 行切分，兼容引号内逗号"""
    out, cur, in_q = [], [], False
    for ch in line:
        if ch == '"':
            in_q = not in_q
            continue
        if ch == "," and not in_q:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur).strip())
    return out


def _map_columns(header_cells):
    """把表头映射成标准字段名 -> 列下标"""
    mapping = {}
    cells = [_norm(c) for c in header_cells]
    for field, aliases in COL_ALIASES.items():
        for i, cell in enumerate(cells):
            if cell in aliases:
                mapping[field] = i
                break
    return mapping


def _detect_source(text: str) -> str:
    if "支付宝" in text[:400]:
        return "alipay"
    if "微信" in text[:400]:
        return "wechat"
    return "generic"


def _fingerprint(dt, amount, counterparty, description) -> str:
    base = f"{dt}|{amount:.2f}|{_norm(counterparty)}|{_norm(description)[:60]}"
    return hashlib.md5(base.encode("utf-8")).hexdigest()


def parse_bill(raw: bytes, filename: str = "", manual_source: str = "",
               column_mapping: dict | None = None):
    """
    解析账单文件。

    :param raw: 文件字节
    :param manual_source: 用户手动指定的来源 alipay/wechat/bank/generic
    :param column_mapping: 用户手动指定的列映射，形如 {"time": 0, "amount": 6, ...}
    :return: (records, meta)
        records: [dict] 标准化后的记录
        meta:    {"source": ..., "total_rows": n, "skipped": n, "warnings": [...]}
    """
    raw = _extract_csv_from_zip(raw)
    text = _decode(raw)
    source = manual_source or _detect_source(text)

    lines = [ln for ln in text.splitlines() if ln.strip()]
    warnings = []

    if column_mapping:
        header_idx = max(column_mapping.values())
        data_start = 0
        # 用户自定义映射时，跳过前面的非数据行：尝试逐行按时间解析
        mapping = {k: int(v) for k, v in column_mapping.items()}
        body_start_line = 0
        for i in range(len(lines)):
            cells = _split_csv_line(lines[i])
            if mapping.get("time", 99) < len(cells):
                if _parse_time(cells[mapping["time"]]):
                    body_start_line = i
                    break
        body = lines[body_start_line:]
    else:
        header_idx, header_line = _find_header(lines)
        if header_line is None:
            return [], {"source": source, "total_rows": 0, "skipped": 0,
                        "warnings": ["没找到表头行，请确认这是支付宝/微信导出的原始账单 CSV"]}
        mapping = _map_columns(_split_csv_line(header_line))
        missing = [f for f in ("time", "amount") if f not in mapping]
        if missing:
            warnings.append(f"表头缺少关键列：{'/'.join(missing)}，已尝试按通用格式解析")
        body = lines[header_idx + 1:]

    records, skipped = [], 0
    for line in body:
        cells = _split_csv_line(line)
        try:
            dt = _parse_time(cells[mapping["time"]]) if mapping.get("time", 99) < len(cells) else None
        except Exception:
            dt = None
        if dt is None:
            skipped += 1
            continue

        amount = _parse_amount(cells[mapping["amount"]]) if mapping.get("amount", 99) < len(cells) else 0.0
        if amount <= 0:
            skipped += 1
            continue

        def cell(field, default=""):
            i = mapping.get(field)
            if i is None or i >= len(cells):
                return default
            return _norm(cells[i])

        counterparty = cell("counterparty")
        description = cell("description")
        method = cell("method")
        status = cell("status")
        raw_direction = cell("direction")
        raw_category = cell("category")

        # 跳过无效交易
        if any(bad in status for bad in INVALID_STATUS):
            skipped += 1
            continue

        # 判定方向
        if raw_direction in ("支出", "付款"):
            direction = "expense"
        elif raw_direction in ("收入", "收款"):
            direction = "income"
        else:
            # 中性的（"/"、空、"不计收支"）按关键词再判一次
            joined = f"{raw_category}{description}{counterparty}{status}"
            if any(k in joined for k in NON_SPEND_KEYWORDS):
                direction = "transfer"
            else:
                direction = "transfer"

        records.append({
            "occurred_at": dt,
            "amount": amount,
            "direction": direction,
            "source": {"alipay": "支付宝", "wechat": "微信", "bank": "银行卡"}.get(source, source or "手动"),
            "counterparty": counterparty,
            "description": description,
            "method": method,
            "status": status,
            "suggested_category": ALIPAY_CATEGORY_MAP.get(raw_category, ""),
            "fingerprint": _fingerprint(dt, amount, counterparty, description),
        })

    meta = {
        "source": source,
        "total_rows": len(records),
        "skipped": skipped,
        "warnings": warnings,
    }
    return records, meta
