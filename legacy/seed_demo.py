"""
生成示例账单文件（放在 samples/ 目录），用途有二：
  1. 让你看清支付宝/微信账单 CSV 的真实结构，照着理解导出内容
  2. 喂进数据库当演示数据，打开页面立刻有图可看

运行： python seed_demo.py
      python seed_demo.py --reset   # 清空已有数据后重新生成
"""
import os
import random
import sys
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLE_DIR = os.path.join(BASE_DIR, "samples")
os.makedirs(SAMPLE_DIR, exist_ok=True)

random.seed(20260901)

# (交易对方, 商品说明, 分类, 金额区间, 每月笔数范围)
EXPENSE_POOL = [
    ("瑞幸咖啡", "生椰拿铁", "餐饮美食", (15, 32), (6, 14)),
    ("蜜雪冰城", "冰鲜柠檬水", "餐饮美食", (6, 12), (3, 8)),
    ("肯德基", "香辣鸡腿堡套餐", "餐饮美食", (28, 45), (1, 4)),
    ("美团外卖", "午餐订单", "餐饮美食", (18, 42), (5, 12)),
    ("学校食堂", "就餐", "餐饮美食", (8, 20), (10, 20)),
    ("沙县小吃", "拌面蒸饺", "餐饮美食", (12, 25), (2, 5)),
    ("滴滴出行", "快车行程", "交通出行", (12, 48), (2, 7)),
    ("深圳地铁", "乘车码", "交通出行", (3, 12), (8, 22)),
    ("哈啰单车", "骑行", "交通出行", (1.5, 5), (4, 12)),
    ("12306", "高铁票", "交通出行", (80, 550), (0, 2)),
    ("京东商城", "数码配件", "日用百货", (25, 320), (1, 4)),
    ("拼多多", "日用品", "日用百货", (9, 89), (2, 6)),
    ("嘉立创", "PCB打样+元器件", "数码电器", (30, 260), (1, 3)),
    ("优衣库", "服饰", "服饰装扮", (79, 399), (0, 2)),
    ("沃尔玛", "超市购物", "日用百货", (35, 180), (1, 4)),
    ("中国移动", "话费充值", "生活缴费", (30, 100), (1, 1)),
    ("国家电网", "电费", "生活缴费", (50, 220), (1, 1)),
    ("万达影城", "电影票", "文化休闲", (35, 98), (0, 2)),
    ("哔哩哔哩", "大会员", "文化休闲", (15, 25), (0, 1)),
    ("Steam", "游戏", "文化休闲", (30, 298), (0, 2)),
    ("健身房", "月卡", "运动户外", (99, 299), (0, 1)),
    ("当当网", "图书", "学习教育", (30, 150), (0, 2)),
    ("大药房", "药品", "医疗健康", (15, 120), (0, 2)),
]
INCOME_POOL = [
    ("公司", "工资代发", "收入", (8000, 8000), (1, 1)),
    ("导师", "助研津贴", "收入", (800, 1500), (0, 1)),
    ("妈妈", "生活费", "收入", (1500, 2000), (0, 1)),
]


def gen_records(months=6, end_month=None):
    end = end_month or datetime.now().replace(day=1)
    out = []
    for m_off in range(months - 1, -1, -1):
        # 该月第一天
        y, m = end.year, end.month - m_off
        while m <= 0:
            m += 12; y -= 1
        first = datetime(y, m, 1)
        days_in_month = ((first.replace(month=first.month % 12 + 1, year=first.year + (first.month // 12))
                          if first.month < 12 else first.replace(year=first.year + 1, month=1)) - first).days
        is_current = (m_off == 0)
        max_day = datetime.now().day if is_current else days_in_month

        pool = EXPENSE_POOL + INCOME_POOL
        for party, desc, cat, (lo, hi), (c_lo, c_hi) in pool:
            cnt = random.randint(c_lo, c_hi)
            for _ in range(cnt):
                d = random.randint(1, max(max_day, 1))
                t = first.replace(day=d, hour=random.randint(7, 23),
                                  minute=random.randint(0, 59), second=random.randint(0, 59))
                if t > datetime.now():
                    continue
                amt = round(random.uniform(lo, hi), 2)
                out.append({
                    "time": t, "party": party, "desc": desc,
                    "cat": cat, "amount": amt,
                    "direction": "收入" if cat == "收入" else "支出",
                })
    out.sort(key=lambda x: x["time"])
    return out


def write_alipay(path, records):
    lines = [
        "支付宝交易记录明细查询",
        "账号:[demo@example.com]",
        f"起始日期:[{records[0]['time']:%Y-%m-%d} 00:00:00]    终止日期:[{records[-1]['time']:%Y-%m-%d} 23:59:59]",
        "----------------------交易记录明细列表--------------------",
        "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注",
    ]
    for i, r in enumerate(records):
        method = random.choice(["余额宝", "花呗", "账户余额", "招商银行(1234)"])
        lines.append(
            f"{r['time']:%Y-%m-%d %H:%M:%S},{r['cat']},{r['party']},,"
            f"{r['desc']},{r['direction']},{r['amount']:.2f},{method},交易成功,"
            f"2026{r['time']:%m%d}000{i:05d},,"
        )
    with open(path, "w", encoding="gbk", newline="") as f:
        f.write("\n".join(lines))
    return len(records)


def write_wechat(path, records):
    """微信账单只留一部分，模拟"两个渠道各有一部分消费"的真实情况"""
    sub = [r for r in records if random.random() < 0.45]
    lines = [
        "微信支付账单明细",
        "微信昵称：[演示账号]",
        f"起始日期：[{sub[0]['time']:%Y-%m-%d}] 终止日期：[{sub[-1]['time']:%Y-%m-%d}]",
        "导出类型：[全部]",
        "----------------------微信支付账单明细列表--------------------",
        "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注",
    ]
    for i, r in enumerate(sub):
        lines.append(
            f"{r['time']:%Y-%m-%d %H:%M:%S},商户消费,{r['party']},/"
            f"{r['desc']},{r['direction']},¥{r['amount']:.2f},零钱,支付成功,"
            f"420000{i:06d}0000,/,,"
        )
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        f.write("\n".join(lines))
    return len(sub)


def seed_db(reset=False):
    """把示例数据直接写进数据库（不经过 CSV），方便一键看到效果"""
    from models import HealthRecord, Transaction, init_db
    from categories import DEFAULT_RULES, build_rule_index, classify

    db_path = os.environ.get("PD_DB_PATH") or os.path.join(BASE_DIR, "data", "app.db")
    Session = init_db(db_path)
    db = Session()
    try:
        if reset:
            db.query(Transaction).delete()
            db.query(HealthRecord).delete()
            db.commit()

        rules = build_rule_index(DEFAULT_RULES)
        import hashlib
        added = 0
        for r in gen_records(months=6):
            fp = hashlib.md5(
                f"{r['time']}|{r['amount']:.2f}|{r['party']}|{r['desc']}|demo".encode()
            ).hexdigest()
            if db.query(Transaction.id).filter_by(fingerprint=fp).first():
                continue
            src = "支付宝" if random.random() < 0.55 else "微信"
            cat = classify(r["party"], r["desc"], rules)
            db.add(Transaction(
                occurred_at=r["time"], amount=r["amount"],
                direction="expense" if r["direction"] == "支出" else "income",
                source=src, counterparty=r["party"], description=r["desc"],
                category=cat, method="余额", status="交易成功", fingerprint=fp,
            ))
            added += 1
        db.commit()

        # 健康打卡：近 100 天
        today = datetime.now().date()
        weight = 68.0
        h_added = 0
        for i in range(99, -1, -1):
            d = today - timedelta(days=i)
            if random.random() < 0.12:  # 偶尔漏打卡，更真实
                continue
            if db.query(HealthRecord.id).filter_by(day=d).first():
                continue
            sleep = round(random.uniform(5.5, 8.8), 1)
            ex = random.choice([0, 0, 15, 25, 30, 45, 60, 90])
            mood = max(1, min(5, int(round(random.gauss(3.5, 0.9)))))
            weight = round(weight + random.uniform(-0.35, 0.3), 1)
            db.add(HealthRecord(
                day=d, sleep_hours=sleep,
                sleep_score=max(1, min(5, int(round(sleep / 2)))),
                weight=weight if i % 2 == 0 else 0,  # 隔天称体重
                mood=mood, exercise_minutes=ex,
                steps=random.randint(2000, 16000),
                focus_hours=round(random.uniform(0.5, 7.5), 1),
                note=random.choice(["", "", "", "跑了 5 公里", "熬夜了", "状态不错",
                                    "调了一天 I2C 时序", "焊板子", "", ""]),
            ))
            h_added += 1
        db.commit()
        return added, h_added
    finally:
        db.close()


if __name__ == "__main__":
    reset = "--reset" in sys.argv
    records = gen_records(months=6)
    n1 = write_alipay(os.path.join(SAMPLE_DIR, "alipay_sample.csv"), records)
    n2 = write_wechat(os.path.join(SAMPLE_DIR, "wechat_sample.csv"), records)
    print(f"[示例文件] samples/alipay_sample.csv  ({n1} 条, GBK 编码)")
    print(f"[示例文件] samples/wechat_sample.csv  ({n2} 条, UTF-8-BOM 编码)")

    a, h = seed_db(reset=reset)
    print(f"[演示数据] 账单新增 {a} 条 · 健康打卡新增 {h} 天")
    print("\n现在运行： python app.py")
