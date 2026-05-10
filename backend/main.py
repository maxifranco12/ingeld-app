"""
INGELD — API FastAPI para datos de mercado, análisis con Claude y alertas.
"""

from __future__ import annotations

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext

from database import SessionLocal, User, UserProfile, init_db
from routers import admin as admin_router
from routers import alerts, analysis, auth as auth_router, market, market_extensions, news
from routers.chat import router as chat_router
from routers.scanner import router as scanner_router

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def ensure_default_admin() -> None:
    db = SessionLocal()
    try:
        exists = db.query(User).filter(User.is_admin.is_(True)).first()
        if exists:
            return
        user = User(
            email="admin@ingeld.app",
            username="admin",
            hashed_password=_pwd.hash("Admin2026!"),
            is_active=True,
            is_admin=True,
            plan="free",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        prof = UserProfile(user_id=user.id)
        db.add(prof)
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ensure_default_admin()
    yield


app = FastAPI(
    title="INGELD API",
    description="Backend para INGELD — acciones, bonos y activos globales.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])
app.include_router(market.router, prefix="/api/market", tags=["market"])
app.include_router(market_extensions.router, prefix="/api/market", tags=["market"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(news.router, prefix="/api/news", tags=["news"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(scanner_router, prefix="/api/scanner", tags=["scanner"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ingeld"}


@app.get("/")
def root() -> dict[str, str]:
    return {"app": "INGELD API", "docs": "/docs"}
