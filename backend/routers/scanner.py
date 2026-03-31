"""Scanner de candidatos técnicos (MERVAL + bonos) con análisis Claude."""

from __future__ import annotations

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
import pandas as pd
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from routers.market import normalize_ticker

router = APIRouter()

_SCANNER_CACHE: dict[str, Any] = {"data": None, "ts": None}
_SCANNER_TTL_SEC = 300.0

_SCANNER_TICKERS_DEFAULT: list[str] = [
    "GGAL.BA",
    "BMA.BA",
    "PAMP.BA",
    "TXAR.BA",
    "YPFD.BA",
    "TECO2.BA",
]

SCANNER_TICKERS: list[str] = list(_SCANNER_TICKERS_DEFAULT)


def _clear_scanner_cache() -> None:
    _SCANNER_CACHE["data"] = None
    _SCANNER_CACHE["ts"] = None


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


def _macd_components(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def _histogram_direction_last(hist_val: float) -> str:
    if pd.isna(hist_val):
        return "en cero"
    if hist_val > 0:
        return "positivo"
    if hist_val < 0:
        return "negativo"
    return "en cero"


def _histogram_recent_sign_cross(hist: pd.Series, lookback: int = 5) -> bool:
    if len(hist) < 2:
        return False
    tail = hist.tail(min(lookback + 1, len(hist)))
    for i in range(1, len(tail)):
        a, b = tail.iloc[i - 1], tail.iloc[i]
        if pd.isna(a) or pd.isna(b):
            continue
        if a * b < 0:
            return True
    return False


def _dario_score(
    rsi: Optional[float], cruce: bool, vol_rel: float
) -> int:
    s = 0
    if rsi is not None and (rsi < 35 or rsi > 70):
        s += 1
    if cruce:
        s += 1
    if vol_rel > 1.3:
        s += 1
    return s


def _analyze_ticker(symbol: str) -> Optional[dict[str, Any]]:
    symbol = normalize_ticker(symbol)
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="1y", interval="1d")
    if hist is None or hist.empty or len(hist) < 35:
        return None
    close = hist["Close"].astype(float)
    vol = hist["Volume"].astype(float)
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    variacion_pct = ((last - prev) / prev * 100.0) if prev else 0.0

    ma20 = close.rolling(20).mean()
    m20 = ma20.iloc[-1]
    vs_ma20 = "arriba" if (not pd.isna(m20) and last > m20) else "abajo"

    n = len(close)
    if n < 50:
        vs_ma50: Optional[str] = None
    else:
        ma50 = close.rolling(50).mean()
        m50 = ma50.iloc[-1]
        vs_ma50 = "arriba" if (not pd.isna(m50) and last > m50) else "abajo"

    rsi = _rsi(close, 14)
    macd_line, signal_line, histogram = _macd_components(close)
    macd_val = float(macd_line.iloc[-1])
    macd_sig = float(signal_line.iloc[-1])
    macd_hist_last = float(histogram.iloc[-1])
    macd_direccion = _histogram_direction_last(macd_hist_last)
    cruce = _histogram_recent_sign_cross(histogram, 5)

    vol_last = float(vol.iloc[-1])
    vol_avg20 = float(vol.tail(20).mean())
    volumen_relativo = vol_last / vol_avg20 if vol_avg20 > 0 else 0.0

    score = _dario_score(rsi, cruce, volumen_relativo)

    info = ticker.info or {}
    nombre = info.get("shortName") or info.get("longName") or symbol

    return {
        "ticker": symbol,
        "nombre": nombre,
        "precio": round(last, 4),
        "variacion_pct": round(variacion_pct, 2),
        "rsi": round(rsi, 2) if rsi is not None else None,
        "macd": round(macd_val, 6),
        "macd_signal": round(macd_sig, 6),
        "macd_hist": round(macd_hist_last, 6),
        "macd_direccion": macd_direccion,
        "cruce_histograma": cruce,
        "vs_ma20": vs_ma20,
        "vs_ma50": vs_ma50,
        "volumen_relativo": round(volumen_relativo, 3),
        "score": score,
    }


def _rank_tuple(r: dict[str, Any]) -> tuple[int, float, float]:
    return (
        int(r.get("score") or 0),
        float(r.get("volumen_relativo") or 0.0),
        abs((float(r["rsi"]) if r.get("rsi") is not None else 50.0) - 50.0),
    )


def _filter_dario(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    passed = [r for r in rows if int(r.get("score") or 0) >= 2]
    if passed:
        passed.sort(key=_rank_tuple, reverse=True)
        return passed[:5]
    scored = sorted(rows, key=_rank_tuple, reverse=True)
    return scored[:5]


def _parse_claude_json(text: str) -> list[dict[str, Any]]:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    raw = m.group(1).strip() if m else text
    data = json.loads(raw)
    if isinstance(data, dict) and "candidatos" in data:
        return list(data["candidatos"])
    if isinstance(data, list):
        return data
    return []


def _claude_analyze(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key or not rows:
        return []
    payload = []
    for r in rows:
        payload.append(
            {
                "ticker": r["ticker"],
                "nombre": r.get("nombre"),
                "precio": r["precio"],
                "variacion_pct": r["variacion_pct"],
                "rsi": r["rsi"],
                "macd_hist": r["macd_hist"],
                "macd_direccion": r["macd_direccion"],
                "cruce_histograma": r["cruce_histograma"],
                "vs_ma20": r["vs_ma20"],
                "vs_ma50": r["vs_ma50"],
                "volumen_relativo": r["volumen_relativo"],
                "score": r["score"],
            }
        )
    system = (
        "Sos un analista financiero senior especializado en mercado argentino (acciones BYMA, bonos, contexto macro). "
        "Respondé en español, tono directo y profesional. "
        "Tu salida debe ser únicamente JSON válido, sin markdown ni texto adicional."
    )
    user = f"""Candidatos técnicos filtrados (criterios Darío: RSI extremo, cruce MACD histograma, volumen > 1,3× media 20d):

{json.dumps(payload, ensure_ascii=False, indent=2)}

Devolvé un array JSON "candidatos" donde cada elemento tenga exactamente:
"ticker", "señal" (COMPRAR|VENDER|NEUTRO), "confianza" (Alta|Media|Baja), "razón" (un párrafo).

Ordená el array por relevancia operativa (los más accionables primero).
"""
    try:
        client = Anthropic(api_key=key)
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = ""
        for block in msg.content:
            if block.type == "text":
                text += block.text
        try:
            return _parse_claude_json(text)
        except Exception as parse_err:  # noqa: BLE001
            print(
                f"CLAUDE JSON PARSE ERROR: {parse_err!r}",
                file=sys.stderr,
            )
            snippet = text[:1200] if text else "(vacío)"
            print(f"CLAUDE RESPUESTA (recorte): {snippet!r}", file=sys.stderr)
            return []
    except Exception as api_err:  # noqa: BLE001
        print(f"CLAUDE API / RED ERROR: {api_err!r}", file=sys.stderr)
        return []


def _merge_ai(
    technical: list[dict[str, Any]], ai_rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_ticker = {str(r.get("ticker", "")).upper(): r for r in ai_rows}
    out: list[dict[str, Any]] = []
    for t in technical:
        sym = t["ticker"].upper()
        ai = by_ticker.get(sym, {})
        señal = ai.get("señal") or ai.get("senal") or "NEUTRO"
        if señal not in ("COMPRAR", "VENDER", "NEUTRO"):
            señal = "NEUTRO"
        conf = ai.get("confianza") or "Media"
        if conf not in ("Alta", "Media", "Baja"):
            conf = "Media"
        razón = ai.get("razón") or ai.get("razon") or ""
        row = {**t}
        row["señal"] = señal
        row["confianza"] = conf
        row["razón"] = razón
        out.append(row)
    return out


def _fallback_rows(top: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for t in top:
        out.append(
            {
                **t,
                "señal": "NEUTRO",
                "confianza": "Media",
                "razón": (
                    "Análisis IA no disponible. Métricas técnicas calculadas correctamente."
                ),
            }
        )
    return out


class CandidatoOut(BaseModel):
    ticker: str
    nombre: str
    precio: float
    variacion_pct: float
    rsi: Optional[float] = None
    macd: float = Field(description="Línea MACD actual")
    macd_signal: float = Field(description="Línea señal MACD")
    macd_hist: float
    macd_direccion: str
    cruce_histograma: bool
    vs_ma20: str
    vs_ma50: Optional[str] = None
    volumen_relativo: float
    score: int = Field(ge=0, le=3)
    señal: str
    confianza: str
    razón: str


class ScannerResponse(BaseModel):
    updatedAt: str
    candidatos: list[CandidatoOut]


class ScannerTickersBody(BaseModel):
    tickers: list[str]


@router.get("/tickers")
def get_scanner_tickers() -> dict[str, Any]:
    return {"tickers": list(SCANNER_TICKERS)}


@router.post("/tickers")
def post_scanner_tickers(body: ScannerTickersBody) -> dict[str, Any]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in body.tickers:
        s = str(raw).strip().upper()
        if not s or s in seen:
            continue
        seen.add(s)
        cleaned.append(s)
    if not cleaned:
        raise HTTPException(
            status_code=400,
            detail="Se requiere al menos un ticker válido (no vacío, sin duplicados).",
        )
    global SCANNER_TICKERS
    SCANNER_TICKERS = cleaned
    _clear_scanner_cache()
    return {"ok": True, "tickers": list(SCANNER_TICKERS)}


@router.get("/candidatos", response_model=ScannerResponse)
def scanner_candidatos() -> dict[str, Any]:
    now = time.time()
    cached = _SCANNER_CACHE["data"]
    ts = _SCANNER_CACHE["ts"]
    if cached is not None and ts is not None and (now - ts) < _SCANNER_TTL_SEC:
        return cached

    def _safe_analyze(sym: str) -> Optional[dict[str, Any]]:
        try:
            return _analyze_ticker(sym)
        except Exception:  # noqa: BLE001
            return None

    rows_raw: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for row in ex.map(_safe_analyze, SCANNER_TICKERS):
            if row:
                rows_raw.append(row)

    if not rows_raw:
        raise HTTPException(
            status_code=503,
            detail="No se pudieron obtener datos de mercado para los tickers.",
        )

    top = _filter_dario(rows_raw)
    ai_list = _claude_analyze(top)

    if ai_list:
        merged = _merge_ai(top, ai_list)
        order = [str(x.get("ticker", "")).upper() for x in ai_list if x.get("ticker")]

        def _sort_key(m: dict[str, Any]) -> int:
            u = str(m.get("ticker", "")).upper()
            try:
                return order.index(u)
            except ValueError:
                return 999

        merged.sort(key=_sort_key)
    else:
        merged = _fallback_rows(top)

    updated = datetime.now(timezone.utc).isoformat()
    out: dict[str, Any] = {"updatedAt": updated, "candidatos": merged}
    _SCANNER_CACHE["data"] = out
    _SCANNER_CACHE["ts"] = time.time()
    return out
