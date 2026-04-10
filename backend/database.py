"""SQLite + SQLAlchemy — usuarios y perfiles INGELD."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

DB_PATH = Path(__file__).resolve().parent / "ingeld.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(80), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    plan = Column(String(32), default="free", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)

    profile = relationship(
        "UserProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    password_resets = relationship(
        "PasswordReset",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    favoritos = Column(Text, default="[]", nullable=False)
    portfolio = Column(Text, default="[]", nullable=False)
    scanner_tickers = Column(Text, default="[]", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", back_populates="profile")


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(16), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="password_resets")


class AnalysisHistory(Base):
    __tablename__ = "analysis_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(40), nullable=False, index=True)
    tipo = Column(String(32), nullable=False)
    señal = Column(String(16), nullable=True)
    resumen = Column(Text, nullable=False)
    score_total = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class Goal(Base):
    __tablename__ = "goals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(255), nullable=False)
    monto_objetivo = Column(Float, nullable=False)
    monto_actual = Column(Float, nullable=False, default=0.0)
    moneda = Column(String(8), default="USD", nullable=False)
    fecha_objetivo = Column(Date, nullable=True)
    color = Column(String(16), default="#00a87a", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class Asset(Base):
    __tablename__ = "net_assets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(255), nullable=False)
    tipo = Column(String(32), nullable=False)
    valor = Column(Float, nullable=False)
    moneda = Column(String(8), default="USD", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class Liability(Base):
    __tablename__ = "net_liabilities"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(255), nullable=False)
    tipo = Column(String(32), nullable=False)
    monto = Column(Float, nullable=False)
    moneda = Column(String(8), default="USD", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
