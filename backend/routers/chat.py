"""Chat de análisis de activos con Claude e indicadores técnicos."""

from __future__ import annotations

import copy
import time
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

import os

import numpy as np
import pandas as pd
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

_SNAPSHOT_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SNAPSHOT_TTL_SEC = 300.0

SYSTEM_BASE = (
    "Sos un analista financiero senior especializado en mercado argentino "
    "(acciones BYMA, CEDEARs, bonos, contexto macro y tipo de cambio). "
    "Hablás en español, con tono directo y preciso. "
    "Cuando tengas indicadores técnicos en contexto, usalos como datos objetivos; "
    "marcá claramente cuando algo sea interpretación u opinión. "
    "No inventes precios ni indicadores que no figuren en el contexto."
)


def _rsi(close: pd.Series, period: int = 14) -> Optional[float]:
    if len(close) < period + 1:
        return None
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    if pd.isna(val):
        return None
    return float(val)


def _macd(close: pd.Series) -> tuple[float, float, float]:
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    histogram = macd_line - signal_line
    return (
        float(macd_line.iloc[-1]),
        float(signal_line.iloc[-1]),
        float(histogram.iloc[-1]),
    )


def _bollinger(close: pd.Series, period: int = 20, num_std: float = 2.0) -> tuple[float, float, float]:
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    return (
        float(upper.iloc[-1]),
        float(mid.iloc[-1]),
        float(lower.iloc[-1]),
    )


def _snapshot_tecnico_fetch(symbol: str) -> Optional[dict[str, Any]]:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="1y", interval="1d")
    if hist is None or hist.empty or len(hist) < 50:
        return None
    close = hist["Close"].astype(float)
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    variacion_pct = ((last - prev) / prev * 100.0) if prev else 0.0
    rsi = _rsi(close, 14)
    macd_line, macd_signal, macd_hist = _macd(close)
    bb_upper, bb_mid, bb_lower = _bollinger(close, 20, 2.0)
    ma20 = float(close.rolling(20).mean().iloc[-1])
    ma50 = float(close.rolling(50).mean().iloc[-1])
    info = ticker.info or {}
    nombre = info.get("shortName") or info.get("longName") or symbol
    return {
        "symbol": symbol,
        "nombre": nombre,
        "precio": round(last, 6),
        "variacion_pct": round(variacion_pct, 4),
        "rsi_14": round(rsi, 2) if rsi is not None else None,
        "macd_linea": round(macd_line, 6),
        "macd_senal": round(macd_signal, 6),
        "macd_histograma": round(macd_hist, 6),
        "bb_superior_20_2": round(bb_upper, 6),
        "bb_media_20": round(bb_mid, 6),
        "bb_inferior_20_2": round(bb_lower, 6),
        "ma20": round(ma20, 6),
        "ma50": round(ma50, 6),
    }


def _snapshot_tecnico(symbol: str) -> Optional[dict[str, Any]]:
    key = symbol.strip()
    now = time.time()
    hit = _SNAPSHOT_CACHE.get(key)
    if hit is not None:
        ts, payload = hit
        if now - ts < _SNAPSHOT_TTL_SEC:
            return copy.deepcopy(payload)
    out = _snapshot_tecnico_fetch(key)
    if out is not None:
        _SNAPSHOT_CACHE[key] = (now, copy.deepcopy(out))
    return copy.deepcopy(out) if out is not None else None


def _format_indicators_block(s: dict[str, Any]) -> str:
    rsi_txt = f"{s['rsi_14']}" if s["rsi_14"] is not None else "N/D"
    return f"""Ticker: {s['symbol']}
Nombre: {s['nombre']}
Precio actual: {s['precio']}
Variación % día: {s['variacion_pct']}%
RSI(14): {rsi_txt}
MACD(12,26,9) — línea: {s['macd_linea']}, señal: {s['macd_senal']}, histograma: {s['macd_histograma']}
Bollinger(20, 2σ) — superior: {s['bb_superior_20_2']}, media: {s['bb_media_20']}, inferior: {s['bb_inferior_20_2']}
MA20: {s['ma20']}
MA50: {s['ma50']}
"""


class HistorialMsg(BaseModel):
    role: str = Field(..., description="user o assistant")
    content: str


class AnalizarRequest(BaseModel):
    ticker: str
    mensaje: str
    historial: list[HistorialMsg] = Field(default_factory=list)


class AnalizarResponse(BaseModel):
    respuesta: str
    ticker: str


@router.post("/analizar", response_model=AnalizarResponse)
def chat_analizar(req: AnalizarRequest) -> AnalizarResponse:
    ticker = (req.ticker or "").strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker requerido")

    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return AnalizarResponse(
            ticker=ticker,
            respuesta=(
                "El análisis con inteligencia artificial no está disponible: "
                "no hay clave de API configurada (ANTHROPIC_API_KEY). "
                "Configurá la variable en backend/.env para habilitar Claude."
            ),
        )

    system = SYSTEM_BASE
    if not req.historial:
        snap = _snapshot_tecnico(ticker)
        if snap is None:
            raise HTTPException(
                status_code=404,
                detail="No se pudieron obtener datos históricos suficientes para el ticker.",
            )
        system = (
            SYSTEM_BASE
            + "\n\nTenés acceso a los siguientes indicadores técnicos calculados con datos recientes (yfinance, cierre diario). "
            "Usalos como referencia objetiva en tus respuestas:\n\n"
            + _format_indicators_block(snap)
        )
    else:
        system = (
            SYSTEM_BASE
            + f"\n\nSeguís la conversación sobre el activo **{ticker}**. "
            "El usuario ya recibió indicadores en el primer mensaje; mantené coherencia con lo dicho antes."
        )

    api_messages: list[dict[str, str]] = []
    for h in req.historial:
        if h.role in ("user", "assistant"):
            api_messages.append({"role": h.role, "content": h.content})
    api_messages.append({"role": "user", "content": req.mensaje})

    try:
        client = Anthropic(api_key=key)
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1000,
            system=system,
            messages=api_messages,  # type: ignore[arg-type]
        )
        text = ""
        for block in msg.content:
            if block.type == "text":
                text += block.text
        return AnalizarResponse(ticker=ticker, respuesta=text.strip() or "(Sin texto)")
    except Exception as e:  # noqa: BLE001
        return AnalizarResponse(
            ticker=ticker,
            respuesta=(
                f"No se pudo obtener respuesta del modelo de IA. "
                f"Detalle: {e!s}. Verificá la clave, el nombre del modelo y la conexión."
            ),
        )
