"""
个人财务看板 + 习惯健康追踪

启动： python app.py
然后浏览器打开 http://127.0.0.1:5000
"""
import csv
import io
import os
from collections import defaultdict
from datetime import date, datetime, timedelta

from flask import (
    Flask,
    Response,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)
from sqlalchemy import func

from categories import CATEGORY_COLORS, DEFAULT_RULES, build_rule_index, classify
from models import CategoryRule, HealthRecord, Transaction, init_db
from parsers import parse_bill

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 想换数据存放位置：设环境变量 PD_DB_PATH，例如放到网盘目录做多设备同步
DB_PATH = os.environ.get("PD_DB_PATH") or os.path.join(BASE_DIR, "data", "app.db")
os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)

app = Flask(__name__)
app.secret_key = "personal-dashboard-secret-key"
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32MB

SessionFactory = init_db(DB_PATH)


# ---------------- session 管理 ----------------
def get_session():
    if "db" not in g:
        g.db = SessionFactory()
    return g.db


@app.teardown_appcontext
def close_session(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def get_rules():
    """取出分类规则并建索引（默认规则 + 用户自定义）"""
    db = get_session()
    user_rules = db.query(CategoryRule).all()
    merged = [(kw, cat, prio) for kw, cat, prio in DEFAULT_RULES]
    merged += [(r.keyword, r.category, r.priority + 100) for r in user_rules]  # 用户规则优先级更高
    return build_rule_index(merged)


# ---------------- 工具函数 ----------------
def parse_month(s):
    try:
        return datetime.strptime(s, "%Y-%m")
    except (ValueError, TypeError):
        return datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_range(dt):
    start = dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nxt = (start + timedelta(days=32)).replace(day=1)
    return start, nxt


def fmt_month(dt):
    return dt.strftime("%Y-%m")


def all_months(db):
    rows = db.query(
        func.strftime("%Y-%m", Transaction.occurred_at).label("m")
    ).distinct().all()
    months = sorted([r.m for r in rows if r.m], reverse=True)
    return months


def seed_default_rules_if_empty():
    db = SessionFactory()
    try:
        if db.query(CategoryRule).count() == 0:
            # 默认规则写在代码里，这里只放几条用户级示例，方便用户看到可编辑的效果
            db.add_all([
                CategoryRule(keyword="华莱士", category="餐饮·快餐", priority=20),
            ])
            db.commit()
    finally:
        db.close()


# ---------------- 页面路由 ----------------
@app.context_processor
def inject_globals():
    return {"cat_colors": CATEGORY_COLORS, "now_month": datetime.now().strftime("%Y-%m")}


@app.route("/")
def index():
    db = get_session()
    months = all_months(db)
    return render_template("index.html", months=months, active="index")


@app.route("/finance")
def finance_page():
    db = get_session()
    months = all_months(db)
    cats = sorted({r[0] for r in db.query(Transaction.category).distinct().all() if r[0]})
    sources = sorted({r[0] for r in db.query(Transaction.source).distinct().all() if r[0]})
    return render_template(
        "finance.html", months=months, categories=cats, sources=sources, active="finance"
    )


@app.route("/health")
def health_page():
    return render_template("health.html", active="health", today=date.today().strftime("%Y-%m-%d"))


@app.route("/import", methods=["GET", "POST"])
def import_page():
    db = get_session()
    result = None
    if request.method == "POST":
        file = request.files.get("bill_file")
        source = request.form.get("source", "")
        if not file or not file.filename:
            flash("请先选择一个账单文件（.csv 或 .zip）", "warn")
            return redirect(url_for("import_page"))
        raw = file.read()
        if not raw:
            flash("文件是空的", "warn")
            return redirect(url_for("import_page"))
        records, meta = parse_bill(raw, file.filename, manual_source=source)
        if not records:
            flash(f"没能解析出有效记录。{'; '.join(meta['warnings']) or '请检查文件格式'}", "warn")
            return redirect(url_for("import_page"))

        rules = get_rules()
        added, dup = 0, 0
        for rec in records:
            suggested = rec.pop("suggested_category", "")
            fp = rec.pop("fingerprint")
            if db.query(Transaction.id).filter_by(fingerprint=fp).first():
                dup += 1
                continue
            # 支付宝自带分类优先，否则走关键词规则
            cat = suggested or classify(rec["counterparty"], rec["description"], rules)
            db.add(Transaction(fingerprint=fp, category=cat, **rec))
            added += 1
        db.commit()
        result = {"added": added, "dup": dup, "source": meta["source"],
                  "skipped": meta["skipped"], "warnings": meta["warnings"]}
        flash(f"导入成功：新增 {added} 条，跳过重复 {dup} 条", "ok")

    rules = db.query(CategoryRule).order_by(CategoryRule.priority.desc()).all()
    return render_template("import.html", active="import", result=result, rules=rules)


# ---------------- 财务 API ----------------
@app.get("/api/summary")
def api_summary():
    db = get_session()
    month_str = request.args.get("month")
    m = parse_month(month_str)
    start, nxt = month_range(m)

    base = db.query(Transaction).filter(
        Transaction.occurred_at >= start,
        Transaction.occurred_at < nxt,
        Transaction.direction.in_(["expense", "income"]),
    )

    expense = sum(t.amount for t in base if t.direction == "expense")
    income = sum(t.amount for t in base if t.direction == "income")
    expense_cnt = sum(1 for t in base if t.direction == "expense")

    days_in_month = (nxt - start).days
    passed_days = min((datetime.now() - start).days + 1, days_in_month) if start <= datetime.now() else days_in_month
    avg_daily = expense / max(passed_days, 1)

    # 上月同期对比
    prev_start = (start - timedelta(days=1)).replace(day=1)
    prev_end = start
    prev_expense = db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(
        Transaction.occurred_at >= prev_start,
        Transaction.occurred_at < prev_end,
        Transaction.direction == "expense",
    ).scalar() or 0.0

    # 分类占比
    cat_map = defaultdict(float)
    cat_cnt = defaultdict(int)
    for t in base:
        if t.direction == "expense":
            cat_map[t.category] += t.amount
            cat_cnt[t.category] += 1
    cat_list = sorted(cat_map.items(), key=lambda x: -x[1])

    # Top 商户
    merchant = defaultdict(float)
    for t in base:
        if t.direction == "expense" and t.counterparty:
            merchant[t.counterparty] += t.amount

    # 最大单笔
    biggest = db.query(Transaction).filter(
        Transaction.occurred_at >= start,
        Transaction.occurred_at < nxt,
        Transaction.direction == "expense",
    ).order_by(Transaction.amount.desc()).first()

    # 未分类数量
    uncategorized = sum(1 for t in base if t.category in ("未分类", "其他"))

    return jsonify({
        "month": fmt_month(m),
        "expense": round(expense, 2),
        "income": round(income, 2),
        "balance": round(income - expense, 2),
        "expense_count": expense_cnt,
        "avg_daily": round(avg_daily, 2),
        "prev_expense": round(prev_expense, 2),
        "mom": round((expense - prev_expense) / prev_expense * 100, 1) if prev_expense else None,
        "passed_days": passed_days,
        "days_in_month": days_in_month,
        "uncategorized": uncategorized,
        "categories": [
            {"name": k, "value": round(v, 2), "count": cat_cnt[k],
             "color": CATEGORY_COLORS.get(k, "#adb5bd")}
            for k, v in cat_list
        ],
        "top_merchants": [
            {"name": k, "value": round(v, 2)} for k, v in
            sorted(merchant.items(), key=lambda x: -x[1])[:10]
        ],
        "biggest": biggest.to_dict() if biggest else None,
    })


@app.get("/api/monthly_trend")
def api_monthly_trend():
    """近 N 个月的收支趋势"""
    db = get_session()
    n = int(request.args.get("months", 12))
    rows = db.query(
        func.strftime("%Y-%m", Transaction.occurred_at).label("m"),
        Transaction.direction,
        func.sum(Transaction.amount),
    ).filter(Transaction.direction.in_(["expense", "income"])).group_by("m", Transaction.direction).all()

    data = defaultdict(lambda: {"expense": 0.0, "income": 0.0})
    for m, d, s in rows:
        if m:
            data[m][d] = round(s or 0.0, 2)
    keys = sorted(data.keys(), reverse=True)[:n][::-1]
    return jsonify({
        "months": keys,
        "expense": [data[k]["expense"] for k in keys],
        "income": [data[k]["income"] for k in keys],
        "balance": [round(data[k]["income"] - data[k]["expense"], 2) for k in keys],
    })


@app.get("/api/daily_trend")
def api_daily_trend():
    """某月每日支出走势"""
    db = get_session()
    m = parse_month(request.args.get("month"))
    start, nxt = month_range(m)
    rows = db.query(
        func.strftime("%Y-%m-%d", Transaction.occurred_at).label("d"),
        func.sum(Transaction.amount),
    ).filter(
        Transaction.occurred_at >= start,
        Transaction.occurred_at < nxt,
        Transaction.direction == "expense",
    ).group_by("d").all()
    daily = {d: round(s or 0, 2) for d, s in rows if d}
    labels, values = [], []
    cur = start
    while cur < nxt:
        key = cur.strftime("%Y-%m-%d")
        labels.append(cur.day)
        values.append(daily.get(key, 0.0))
        cur += timedelta(days=1)
    return jsonify({"labels": [str(x) for x in labels], "values": values})


@app.get("/api/transactions")
def api_transactions():
    db = get_session()
    q = db.query(Transaction)

    month = request.args.get("month")
    if month and month != "all":
        start, nxt = month_range(parse_month(month))
        q = q.filter(Transaction.occurred_at >= start, Transaction.occurred_at < nxt)
    cat = request.args.get("category")
    if cat and cat != "all":
        q = q.filter(Transaction.category == cat)
    src = request.args.get("source")
    if src and src != "all":
        q = q.filter(Transaction.source == src)
    direction = request.args.get("direction")
    if direction and direction != "all":
        q = q.filter(Transaction.direction == direction)
    kw = request.args.get("q", "").strip()
    if kw:
        like = f"%{kw}%"
        q = q.filter(
            Transaction.counterparty.like(like)
            | Transaction.description.like(like)
            | Transaction.category.like(like)
        )
    limit = min(int(request.args.get("limit", 300)), 2000)
    rows = q.order_by(Transaction.occurred_at.desc()).limit(limit).all()
    return jsonify([t.to_dict() for t in rows])


@app.post("/api/transactions")
def api_add_transaction():
    db = get_session()
    data = request.get_json(force=True) or {}
    try:
        dt = _parse_dt(data.get("occurred_at"))
        amount = abs(float(data.get("amount") or 0))
        if amount <= 0:
            return jsonify({"ok": False, "msg": "金额必须大于 0"}), 400
    except (ValueError, TypeError):
        return jsonify({"ok": False, "msg": "金额或时间格式不对"}), 400

    direction = data.get("direction", "expense")
    counterparty = (data.get("counterparty") or "").strip()
    description = (data.get("description") or "").strip()
    category = (data.get("category") or "").strip()
    if not category:
        category = classify(counterparty, description, get_rules())

    import hashlib
    fp = "manual-" + hashlib.md5(
        f"{dt}|{amount}|{counterparty}|{description}|{datetime.now().timestamp()}".encode()
    ).hexdigest()

    t = Transaction(
        occurred_at=dt, amount=amount, direction=direction,
        source=data.get("source") or "手动", counterparty=counterparty,
        description=description, category=category,
        method=data.get("method") or "", fingerprint=fp,
        category_locked=bool(category),
    )
    db.add(t)
    db.commit()
    return jsonify({"ok": True, "id": t.id})


def _parse_dt(s):
    from parsers import _parse_time
    dt = _parse_time(s)
    return dt or datetime.now()


@app.patch("/api/transactions/<int:tid>/category")
def api_update_category(tid):
    db = get_session()
    t = db.get(Transaction, tid)
    if not t:
        return jsonify({"ok": False, "msg": "记录不存在"}), 404
    data = request.get_json(force=True) or {}
    new_cat = (data.get("category") or "").strip()
    if not new_cat:
        return jsonify({"ok": False, "msg": "分类不能为空"}), 400
    t.category = new_cat
    t.category_locked = True
    # 顺手学成规则：把商户名作为关键词记住
    learn = bool(data.get("learn", True))
    if learn and t.counterparty:
        exists = db.query(CategoryRule).filter_by(keyword=t.counterparty).first()
        if not exists:
            db.add(CategoryRule(keyword=t.counterparty, category=new_cat, priority=50))
    db.commit()
    return jsonify({"ok": True, "category": t.category})


@app.delete("/api/transactions/<int:tid>")
def api_delete_transaction(tid):
    db = get_session()
    t = db.get(Transaction, tid)
    if not t:
        return jsonify({"ok": False}), 404
    db.delete(t)
    db.commit()
    return jsonify({"ok": True})


@app.post("/api/reclassify")
def api_reclassify():
    """用当前规则重跑全部分类（不会覆盖手动锁定/手动改过的）"""
    db = get_session()
    rules = get_rules()
    changed = 0
    for t in db.query(Transaction).filter(Transaction.category_locked == False).all():  # noqa: E712
        new_cat = classify(t.counterparty, t.description, rules)
        if new_cat != t.category:
            t.category = new_cat
            changed += 1
    db.commit()
    return jsonify({"ok": True, "changed": changed})


# ---------------- 分类规则 API ----------------
@app.get("/api/rules")
def api_list_rules():
    db = get_session()
    rows = db.query(CategoryRule).order_by(CategoryRule.priority.desc(), CategoryRule.id).all()
    return jsonify([{"id": r.id, "keyword": r.keyword, "category": r.category, "priority": r.priority}
                    for r in rows])


@app.post("/api/rules")
def api_add_rule():
    db = get_session()
    data = request.get_json(force=True) or {}
    kw = (data.get("keyword") or "").strip()
    cat = (data.get("category") or "").strip()
    if not kw or not cat:
        return jsonify({"ok": False, "msg": "关键词和分类都要填"}), 400
    exist = db.query(CategoryRule).filter_by(keyword=kw).first()
    if exist:
        exist.category = cat
        exist.priority = int(data.get("priority", 50))
    else:
        db.add(CategoryRule(keyword=kw, category=cat, priority=int(data.get("priority", 50))))
    db.commit()
    return jsonify({"ok": True})


@app.delete("/api/rules/<int:rid>")
def api_delete_rule(rid):
    db = get_session()
    r = db.get(CategoryRule, rid)
    if not r:
        return jsonify({"ok": False}), 404
    db.delete(r)
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/categories")
def api_categories():
    db = get_session()
    cats = sorted({r[0] for r in db.query(Transaction.category).distinct().all() if r[0]})
    return jsonify(cats)


# ---------------- 健康 API ----------------
@app.get("/api/health")
def api_health_list():
    db = get_session()
    days = int(request.args.get("days", 90))
    end = date.today()
    start = end - timedelta(days=days - 1)
    rows = db.query(HealthRecord).filter(
        HealthRecord.day >= start, HealthRecord.day <= end
    ).order_by(HealthRecord.day).all()

    # 补齐日期轴，缺失的天填 0（前端画断线）
    by_day = {r.day: r for r in rows}
    series = []
    cur = start
    while cur <= end:
        r = by_day.get(cur)
        series.append(r.to_dict() if r else {
            "day": cur.strftime("%Y-%m-%d"), "sleep_hours": 0, "sleep_score": 0,
            "weight": 0, "mood": 0, "exercise_minutes": 0, "steps": 0,
            "focus_hours": 0, "note": "", "id": None,
        })
        cur += timedelta(days=1)

    def avg(vals):
        vals = [v for v in vals if v and v > 0]
        return round(sum(vals) / len(vals), 1) if vals else 0

    valid = [r for r in rows]
    weights = [r.weight for r in valid if r.weight > 0]
    stats = {
        "records": len(valid),
        "avg_sleep": avg([r.sleep_hours for r in valid]),
        "avg_mood": avg([r.mood for r in valid]),
        "avg_exercise": avg([r.exercise_minutes for r in valid]),
        "avg_focus": avg([r.focus_hours for r in valid]),
        "total_steps": sum(r.steps for r in valid),
        "weight_now": weights[-1] if weights else 0,
        "weight_start": weights[0] if weights else 0,
        "weight_delta": round(weights[-1] - weights[0], 1) if len(weights) >= 2 else 0,
        # 打卡达标天数：睡够 7h 或 运动 >= 30min
        "good_days": sum(1 for r in valid if r.sleep_hours >= 7 or r.exercise_minutes >= 30),
        "streak": calc_streak(valid),
    }
    return jsonify({"series": series, "stats": stats})


def calc_streak(records):
    """连续打卡天数（今天还没打卡的话，从昨天往前算）"""
    if not records:
        return 0
    day_set = {r.day for r in records}
    today = date.today()
    cursor = today if today in day_set else today - timedelta(days=1)
    if cursor not in day_set:
        return 0
    streak = 0
    while cursor in day_set:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


@app.post("/api/health")
def api_health_upsert():
    db = get_session()
    data = request.get_json(force=True) or {}
    try:
        day = datetime.strptime(data.get("day"), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return jsonify({"ok": False, "msg": "日期格式应为 YYYY-MM-DD"}), 400

    r = db.query(HealthRecord).filter_by(day=day).first()
    if not r:
        r = HealthRecord(day=day)
        db.add(r)

    def num(key, cast=float, default=0):
        try:
            v = data.get(key)
            if v in (None, ""):
                return default
            return cast(v)
        except (ValueError, TypeError):
            return default

    r.sleep_hours = num("sleep_hours", float)
    r.sleep_score = num("sleep_score", int)
    r.weight = num("weight", float)
    r.mood = num("mood", int)
    r.exercise_minutes = num("exercise_minutes", int)
    r.steps = num("steps", int)
    r.focus_hours = num("focus_hours", float)
    r.note = (data.get("note") or "").strip()
    db.commit()
    return jsonify({"ok": True, "record": r.to_dict()})


@app.delete("/api/health/<int:rid>")
def api_health_delete(rid):
    db = get_session()
    r = db.get(HealthRecord, rid)
    if not r:
        return jsonify({"ok": False}), 404
    db.delete(r)
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/health/<day>")
def api_health_get_day(day):
    db = get_session()
    try:
        d = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"ok": False}), 400
    r = db.query(HealthRecord).filter_by(day=d).first()
    return jsonify(r.to_dict() if r else {
        "day": day, "sleep_hours": 0, "sleep_score": 0, "weight": 0,
        "mood": 0, "exercise_minutes": 0, "steps": 0, "focus_hours": 0, "note": "",
    })


# ---------------- 导出 ----------------
def _csv_response(headers, rows, filename):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    return Response(
        buf.getvalue().encode("utf-8-sig"),  # 带 BOM，Excel 打开中文不乱码
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/export/csv")
def export_csv():
    db = get_session()
    rows = db.query(Transaction).order_by(Transaction.occurred_at.desc()).all()
    return _csv_response(
        ["日期", "分类", "收支", "金额", "来源", "交易对方", "商品说明", "支付方式"],
        [[t.occurred_at.strftime("%Y-%m-%d %H:%M"), t.category, t.direction,
          t.amount, t.source, t.counterparty, t.description, t.method] for t in rows],
        "bills_export.csv",
    )


@app.get("/export/health.csv")
def export_health_csv():
    db = get_session()
    rows = db.query(HealthRecord).order_by(HealthRecord.day).all()
    return _csv_response(
        ["日期", "睡眠时长", "睡眠质量", "体重", "心情", "运动分钟", "步数", "专注小时", "备注"],
        [[r.day.strftime("%Y-%m-%d"), r.sleep_hours, r.sleep_score, r.weight, r.mood,
          r.exercise_minutes, r.steps, r.focus_hours, r.note] for r in rows],
        "health_export.csv",
    )


if __name__ == "__main__":
    seed_default_rules_if_empty()
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "127.0.0.1")
    print("=" * 54)
    print("  个人财务看板 + 习惯健康追踪")
    print(f"  打开浏览器访问： http://{host}:{port}")
    print(f"  数据文件： {DB_PATH}")
    print("  停止服务： Ctrl+C")
    print("=" * 54)
    # 想让手机/局域网内其他设备也访问：设 HOST=0.0.0.0
    app.run(host=host, port=port, debug=os.environ.get("PD_DEBUG", "1") == "1")
