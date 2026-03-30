"""
INGELD — API FastAPI para datos de mercado, análisis con Claude y alertas.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import alerts, analysis, market, news
from routers.chat import router as chat_router
from routers.scanner import router as scanner_router

ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_PATH)

app = FastAPI(
    title="INGELD API",
    description="Backend para INGELD — acciones, bonos y activos globales.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router, prefix="/api/market", tags=["market"])
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
