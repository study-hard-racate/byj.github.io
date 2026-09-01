"""
数据模型定义
使用 SQLAlchemy 2.0 风格，SQLite 存储，单文件数据库，方便备份和迁移。
"""
import os
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()


class Transaction(Base):
    """账单一行记录（支出或收入）"""

    __tablename__ = "transactions"
    __table_args__ = (
        # 用内容指纹去重，避免重复导入同一份账单
        UniqueConstraint("fingerprint", name="uq_tx_fingerprint"),
    )

    id = Column(Integer, primary_key=True)
    # 交易发生时间
    occurred_at = Column(DateTime, nullable=False, index=True)
    # 金额，统一为「正数」，方向由 direction 决定
    amount = Column(Float, nullable=False)
    # expense / income / transfer（转账类不计入收支统计）
    direction = Column(String(16), nullable=False, default="expense", index=True)
    # 支付宝 / 微信 / 银行卡 / 手动
    source = Column(String(32), nullable=False, default="manual", index=True)
    # 交易对方（商户名）
    counterparty = Column(String(255), default="")
    # 商品说明 / 备注
    description = Column(String(512), default="")
    # 分类（餐饮、交通、购物……）
    category = Column(String(64), default="未分类", index=True)
    # 支付方式（余额、花呗、招行信用卡……）
    method = Column(String(64), default="")
    # 交易状态（支付成功 / 已退款 / 交易关闭）
    status = Column(String(32), default="")
    # 用户手动改过分类后不再被自动覆盖
    category_locked = Column(Boolean, default=False)
    # 内容指纹，用于去重
    fingerprint = Column(String(64), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id": self.id,
            "occurred_at": self.occurred_at.strftime("%Y-%m-%d %H:%M"),
            "date": self.occurred_at.strftime("%Y-%m-%d"),
            "amount": round(self.amount, 2),
            "direction": self.direction,
            "source": self.source,
            "counterparty": self.counterparty,
            "description": self.description,
            "category": self.category,
            "method": self.method,
            "status": self.status,
        }


class CategoryRule(Base):
    """分类规则：关键词 -> 分类。命中即归类，按顺序优先级匹配。"""

    __tablename__ = "category_rules"

    id = Column(Integer, primary_key=True)
    keyword = Column(String(128), nullable=False, unique=True)
    category = Column(String(64), nullable=False)
    # 优先级，数字越大越先匹配
    priority = Column(Integer, default=0)


class HealthRecord(Base):
    """每日健康打卡：一人一天一条，重复打卡即覆盖"""

    __tablename__ = "health_records"

    id = Column(Integer, primary_key=True)
    # 日期唯一
    day = Column(Date, nullable=False, unique=True, index=True)
    # 睡眠时长（小时）
    sleep_hours = Column(Float, default=0)
    # 睡眠质量 1-5
    sleep_score = Column(Integer, default=0)
    # 体重 kg
    weight = Column(Float, default=0)
    # 心情 1-5
    mood = Column(Integer, default=0)
    # 运动时长（分钟）
    exercise_minutes = Column(Integer, default=0)
    # 步数
    steps = Column(Integer, default=0)
    # 专注学习/工作时长（小时）—— 学嵌入式时用得上
    focus_hours = Column(Float, default=0)
    note = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self):
        return {
            "id": self.id,
            "day": self.day.strftime("%Y-%m-%d"),
            "sleep_hours": self.sleep_hours,
            "sleep_score": self.sleep_score,
            "weight": self.weight,
            "mood": self.mood,
            "exercise_minutes": self.exercise_minutes,
            "steps": self.steps,
            "focus_hours": self.focus_hours,
            "note": self.note,
        }


def _probe_journal_mode(directory: str) -> str:
    """
    探测当前文件系统是否支持 SQLite 的 journal 文件。

    某些环境（网络挂载盘、容器的 virtio 挂载、部分 NAS）创建 -journal / -wal 文件会报
    "disk I/O error"，此时必须降级到 journal_mode=OFF 才能正常工作。
    探测一次即可，结果用于后续所有连接。
    """
    import sqlite3

    probe = os.path.join(directory, "_sqlite_probe.db")
    junk = [probe, probe + "-journal", probe + "-wal", probe + "-shm"]
    for f in junk:
        if os.path.exists(f):
            try:
                os.remove(f)
            except OSError:
                pass

    mode = "DELETE"
    try:
        con = sqlite3.connect(probe, timeout=5)
        con.execute("CREATE TABLE _probe (x INTEGER)")
        con.execute("INSERT INTO _probe VALUES (1)")
        con.commit()
        con.close()
    except Exception:
        mode = "OFF"
    finally:
        for f in junk:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except OSError:
                    pass
    return mode


def init_db(db_path: str):
    """初始化数据库，返回 sessionmaker"""
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    engine = create_engine(
        f"sqlite:///{db_path}",
        echo=False,
        connect_args={"check_same_thread": False},
    )

    mode = _probe_journal_mode(os.path.dirname(db_path) or ".")

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _connection_record):
        cur = dbapi_conn.cursor()
        try:
            cur.execute(f"PRAGMA journal_mode={mode}")
            if mode == "OFF":
                # 没有 journal 时关掉同步写，避免残留损坏的恢复文件
                cur.execute("PRAGMA synchronous=OFF")
        except Exception:
            pass
        finally:
            cur.close()

    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)
