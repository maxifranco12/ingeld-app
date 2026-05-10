"""Market data endpoints backed by yfinance."""

from __future__ import annotations

import copy
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from datetime import date
from typing import Any, Optional

import numpy as np
import pandas as pd
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

TICKER_MAP: dict[str, str] = {
    "YPF.BA": "YPFD.BA",
    "YPFD.BA": "YPFD.BA",
    "GGAL.BA": "GGAL.BA",
    "BMA.BA": "BMA.BA",
    "PAMP.BA": "PAMP.BA",
    "TXAR.BA": "TXAR.BA",
    "TECO2.BA": "TECO2.BA",
    "SUPV.BA": "SUPV.BA",
    "BBAR.BA": "BBAR.BA",
    "ALUA.BA": "ALUA.BA",
    "CRES.BA": "CRES.BA",
    "EDN.BA": "EDN.BA",
    "TGNO4.BA": "TGNO4.BA",
    "VALO.BA": "VALO.BA",
    "MIRG.BA": "MIRG.BA",
}


def normalize_ticker(symbol: str) -> str:
    s = symbol.strip().upper()
    return TICKER_MAP.get(s, s)


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_QUOTE_TTL_SEC = 120.0

_ASSET_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_ASSET_TTL_SEC = 180.0

# Rango UI → (yfinance period, interval)
_ASSET_YF_SPEC: dict[str, tuple[str, str]] = {
    "1D": ("1d", "5m"),
    "1W": ("5d", "1h"),
    "1M": ("1mo", "1d"),
    "3M": ("3mo", "1d"),
    "6M": ("6mo", "1d"),
    "1Y": ("1y", "1d"),
    "5Y": ("5y", "1wk"),
}

_HIST_ANALYSIS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_HIST_ANALYSIS_TTL_SEC = 3600.0

DEFAULT_OVERVIEW_SYMBOLS = ["^MERV", "GGAL.BA", "AL30.BA", "SPY", "EWZ", "BMA.BA"]

TAPE_SYMBOLS = ["^MERV", "GGAL.BA", "AL30.BA", "SPY", "EWZ", "BMA.BA", "^GSPC"]

PULSE_SPECS: list[tuple[str, str]] = [
    ("^MERV", "MERVAL"),
    ("ARS=X", "USD/ARS (ref.)"),
    ("AL30.BA", "AL30"),
    ("^GSPC", "S&P 500"),
]

CANDIDATE_SYMBOLS = ["GGAL.BA", "SPY", "AL30.BA"]

USD_FALLBACKS = ["ARS=X", "USDARS=X"]
_AI_SUMMARY_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_AI_SUMMARY_TTL_SEC = 1800.0
_FINANCIALS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_FINANCIALS_TTL_SEC = 3600.0


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


def _macd_numbers(close: pd.Series) -> tuple[float, float, float]:
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


def _bollinger_triple(
    close: pd.Series, period: int = 20, num_std: float = 2.0
) -> tuple[float, float, float]:
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    return (
        float(upper.iloc[-1]),
        float(mid.iloc[-1]),
        float(lower.iloc[-1]),
    )


def _macd_label(close: pd.Series) -> str:
    if len(close) < 35:
        return "—"
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    sig = macd_line.ewm(span=9, adjust=False).mean()
    if pd.isna(macd_line.iloc[-1]) or pd.isna(sig.iloc[-1]):
        return "—"
    if macd_line.iloc[-1] > sig.iloc[-1]:
        return "alcista"
    if macd_line.iloc[-1] < sig.iloc[-1]:
        return "bajista"
    return "neutral"


def _volume_label(hist: pd.DataFrame) -> str:
    if hist is None or hist.empty or "Volume" not in hist.columns:
        return "—"
    vol = hist["Volume"].astype(float)
    if len(vol) < 5:
        return "—"
    last = vol.iloc[-1]
    mean20 = vol.tail(20).mean()
    if mean20 == 0 or pd.isna(mean20):
        return "—"
    ratio = last / mean20
    if ratio > 1.25:
        return "Alto"
    if ratio < 0.75:
        return "Bajo"
    return "Medio"


def _signal_from_rsi(rsi: Optional[float]) -> str:
    if rsi is None:
        return "NEUTRO"
    if rsi < 35:
        return "COMPRAR"
    if rsi > 65:
        return "VENDER"
    return "NEUTRO"


def _scanner_tag(symbol: str, name: str) -> str:
    u = symbol.upper()
    nm = (name or "").lower()
    if u == "^MERV":
        return "merval"
    if any(x in u for x in ("AL30", "GD30", "AE38", "AL29", "GD29")):
        return "bono_ar"
    if u in ("SPY", "EWZ", "QQQ", "IVV", "^GSPC", "^IXIC"):
        return "usa"
    if "cedear" in nm:
        return "cedear"
    if u.endswith(".BA"):
        return "merval"
    return "other"


def _quote_one_impl(symbol: str) -> dict[str, Any]:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="6mo", interval="1d")
    if hist is None or hist.empty:
        raise ValueError(f"No hay datos para {symbol}")
    close = hist["Close"].astype(float)
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    change_pct = ((last - prev) / prev * 100.0) if prev else 0.0
    info = ticker.info or {}
    name = info.get("shortName") or info.get("longName") or symbol
    currency = info.get("currency") or ""
    rsi = _rsi(close)
    macd = _macd_label(close)
    sig = _signal_from_rsi(rsi)
    tag = _scanner_tag(symbol, name)
    return {
        "symbol": symbol,
        "name": name,
        "price": round(last, 4),
        "changePct": round(change_pct, 2),
        "currency": currency,
        "rsi": round(rsi, 1) if rsi is not None else None,
        "macd": macd,
        "signal": sig,
        "scannerTag": tag,
    }


def _quote_one(symbol: str) -> dict[str, Any]:
    key = normalize_ticker(symbol.strip())
    now = time.time()
    hit = _CACHE.get(key)
    if hit is not None:
        ts, payload = hit
        if now - ts < _QUOTE_TTL_SEC:
            return copy.deepcopy(payload)
    data = _quote_one_impl(key)
    _CACHE[key] = (now, copy.deepcopy(data))
    return copy.deepcopy(data)


def _safe_quote(symbol: str) -> Optional[dict[str, Any]]:
    try:
        return _quote_one(symbol)
    except Exception:
        return None


@router.get("/quotes")
def market_quotes(
    symbols: str = Query("", description="Símbolos separados por comas"),
) -> dict[str, Any]:
    """Cotizaciones compactas; usa caché de _quote_one (TTL compartido)."""
    syms = [s.strip() for s in symbols.split(",") if s.strip()]
    if not syms:
        return {"quotes": []}

    def _one(sym: str) -> Optional[dict[str, Any]]:
        q = _safe_quote(sym)
        if q is None:
            return None
        return {
            "symbol": q["symbol"],
            "name": q.get("name", q["symbol"]),
            "price": q["price"],
            "changePct": q["changePct"],
            "currency": q.get("currency", ""),
        }

    out: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for row in ex.map(_one, syms):
            if row is not None:
                out.append(row)
    return {"quotes": out}


def _bar_timestamp(idx: Any) -> int:
    ts = pd.Timestamp(idx)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    else:
        ts = ts.tz_convert("UTC")
    return int(ts.timestamp())


def _search_from_yahoo(q: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        search = yf.Search(q, max_results=8)
        quotes = getattr(search, "quotes", None) or []
        for quote in quotes[:8]:
            sym = str(quote.get("symbol") or "").strip()
            if not sym:
                continue
            out.append(
                {
                    "symbol": sym,
                    "name": quote.get("shortname")
                    or quote.get("longname")
                    or quote.get("dispSecInd")
                    or sym,
                    "exchange": str(
                        quote.get("exchDisp") or quote.get("exchange") or ""
                    ),
                    "type": str(quote.get("quoteType") or quote.get("typeDisp") or ""),
                    "currency": str(quote.get("currency") or ""),
                }
            )
    except Exception:
        return []
    return out


def _search_ticker_fallback(candidates: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw in candidates:
        s = raw.strip()
        if not s:
            continue
        try:
            t = yf.Ticker(s)
            info = t.info or {}
            hist = t.history(period="5d", interval="1d")
            if (not info) and (hist is None or hist.empty):
                continue
            sym = str(info.get("symbol") or s).strip()
            if not sym:
                sym = s
            rows.append(
                {
                    "symbol": sym,
                    "name": info.get("shortName")
                    or info.get("longName")
                    or sym,
                    "exchange": str(
                        info.get("exchange") or info.get("fullExchangeName") or ""
                    ),
                    "type": str(info.get("quoteType") or ""),
                    "currency": str(info.get("currency") or ""),
                }
            )
        except Exception:
            continue
    return rows


def _merge_search_results(
    primary: list[dict[str, Any]], extra: list[dict[str, Any]], limit: int = 8
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in primary + extra:
        sym = str(row.get("symbol") or "").strip()
        if not sym or sym.upper() in seen:
            continue
        seen.add(sym.upper())
        out.append(row)
        if len(out) >= limit:
            break
    return out


def _norm_chart_range(r: str) -> str:
    u = (r or "6M").strip().upper()
    return u if u in _ASSET_YF_SPEC else "6M"


def _scalar_json(v: Any) -> Any:
    """Convierte valores de yfinance a tipos JSON-serializables."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    try:
        x = float(v)
        if math.isnan(x) or math.isinf(x):
            return None
        if abs(x - round(x)) < 1e-9 and abs(x) < 1e15:
            return int(round(x))
        return x
    except (TypeError, ValueError, OverflowError):
        return str(v) if v is not None else None


def _pick_ts_row(df: pd.DataFrame, candidates: list[str]) -> pd.Series | None:
    if df is None or df.empty:
        return None
    idx_map = {str(i).lower().replace(" ", "_"): i for i in df.index}
    for c in candidates:
        k = c.lower().replace(" ", "_")
        if k in idx_map:
            return df.loc[idx_map[k]]
    return None


def _series_to_year_values(s: pd.Series | None, years: list[int]) -> list[float | None]:
    if s is None:
        return [None for _ in years]
    out: list[float | None] = []
    for y in years:
        val = None
        for c in s.index:
            try:
                ts = pd.Timestamp(c)
                if ts.year == y:
                    val = _safe_float(s[c])
                    break
            except Exception:
                continue
        out.append(val)
    return out


def _safe_float(x: Any) -> float | None:
    try:
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except Exception:
        return None


def _calc_dcf_20y(
    fcf: float | None,
    growth: float,
    discount: float = 0.10,
    terminal_growth: float = 0.03,
) -> float | None:
    if fcf is None or fcf <= 0:
        return None
    g = max(-0.1, min(0.25, growth))
    pv = 0.0
    for t in range(1, 21):
        cf = fcf * (1 + g) ** t
        pv += cf / (1 + discount) ** t
    cf20 = fcf * (1 + g) ** 20
    denom = discount - terminal_growth
    if denom <= 0:
        return pv
    tv = (cf20 * (1 + terminal_growth)) / denom
    pv += tv / (1 + discount) ** 20
    return pv


def fundamentals_from_info(info: dict[str, Any]) -> dict[str, Any]:
    """Métricas fundamentales desde ticker.info (yfinance)."""
    raw_desc = info.get("longBusinessSummary") or ""
    if not isinstance(raw_desc, str):
        raw_desc = str(raw_desc) if raw_desc is not None else ""
    desc = raw_desc[:500] if len(raw_desc) > 500 else raw_desc

    def pick(key: str) -> Any:
        return _scalar_json(info.get(key))

    return {
        "pe_ratio": pick("trailingPE"),
        "pb_ratio": pick("priceToBook"),
        "ps_ratio": pick("priceToSalesTrailing12Months"),
        "eps": pick("trailingEps"),
        "revenue": pick("totalRevenue"),
        "revenue_growth": pick("revenueGrowth"),
        "earnings_growth": pick("earningsGrowth"),
        "profit_margin": pick("profitMargins"),
        "debt_to_equity": pick("debtToEquity"),
        "roe": pick("returnOnEquity"),
        "free_cash_flow": pick("freeCashflow"),
        "market_cap": pick("marketCap"),
        "dividend_yield": pick("dividendYield"),
        "52w_high": pick("fiftyTwoWeekHigh"),
        "52w_low": pick("fiftyTwoWeekLow"),
        "target_price": pick("targetMeanPrice"),
        "analyst_recommendation": pick("recommendationKey"),
        "sector": pick("sector"),
        "industry": pick("industry"),
        "description": desc,
    }


def _asset_payload_impl(symbol: str, chart_range: str) -> dict[str, Any]:
    sym = normalize_ticker(symbol.strip())
    cr = _norm_chart_range(chart_range)
    yf_period, yf_interval = _ASSET_YF_SPEC[cr]
    ticker = yf.Ticker(sym)
    hist = ticker.history(period=yf_period, interval=yf_interval)
    if hist is None or hist.empty:
        hist = ticker.history(period="1mo", interval="1d")
    if hist is None or hist.empty:
        raise ValueError("No hay datos disponibles para este ticker")

    if cr == "1D":
        idx_utc = pd.DatetimeIndex(pd.to_datetime(hist.index, utc=True))
        cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=6)
        hist_f = hist.loc[idx_utc >= cutoff]
        if hist_f is not None and not hist_f.empty and len(hist_f) >= 12:
            hist = hist_f

    close = hist["Close"].astype(float)
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else last
    change_pct = ((last - prev) / prev * 100.0) if prev else 0.0
    vol = hist["Volume"].astype(float)
    last_vol = (
        int(vol.iloc[-1])
        if len(vol) and not pd.isna(vol.iloc[-1])
        else 0
    )

    rsi = _rsi(close, 14)
    macd_line, macd_sig, macd_hist = _macd_numbers(close)
    macd_dir = _macd_label(close)
    bb_u, bb_m, bb_l = _bollinger_triple(close, 20, 2.0)
    macd_ok = all(math.isfinite(x) for x in (macd_line, macd_sig, macd_hist))
    bb_ok = all(math.isfinite(x) for x in (bb_u, bb_m, bb_l))

    ma20_s = close.rolling(20).mean()
    ma50_s = close.rolling(50).mean()
    ma20v: Optional[float] = None
    ma50v: Optional[float] = None
    if len(close) >= 20 and not pd.isna(ma20_s.iloc[-1]):
        ma20v = float(ma20_s.iloc[-1])
    if len(close) >= 50 and not pd.isna(ma50_s.iloc[-1]):
        ma50v = float(ma50_s.iloc[-1])

    if not bb_ok:
        bb_vs = "dentro"
    elif last > bb_u:
        bb_vs = "sobre_banda_superior"
    elif last < bb_l:
        bb_vs = "bajo_banda_inferior"
    else:
        bb_vs = "dentro"

    vs_ma20 = (
        "arriba"
        if ma20v is not None and last > ma20v
        else "abajo"
        if ma20v is not None and last < ma20v
        else "en"
    )
    vs_ma50: Optional[str] = None
    if ma50v is not None:
        vs_ma50 = (
            "arriba" if last > ma50v else "abajo" if last < ma50v else "en"
        )

    info = ticker.info or {}
    desc = info.get("longBusinessSummary") or info.get("description") or ""
    if not isinstance(desc, str):
        desc = str(desc) if desc is not None else ""
    if len(desc) > 480:
        desc = desc[:477] + "…"

    bars: list[dict[str, Any]] = []
    for idx, row in hist.iterrows():
        bars.append(
            {
                "time": _bar_timestamp(idx),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
            }
        )

    return {
        "symbol": sym,
        "range": cr,
        "price": round(last, 6),
        "changePct": round(change_pct, 2),
        "volume": last_vol,
        "rsi14": round(rsi, 2) if rsi is not None else None,
        "macd": {
            "linea": round(macd_line, 6) if macd_ok else None,
            "senal": round(macd_sig, 6) if macd_ok else None,
            "histograma": round(macd_hist, 6) if macd_ok else None,
            "direccion": macd_dir,
        },
        "bollinger": {
            "superior": round(bb_u, 6) if bb_ok else None,
            "media": round(bb_m, 6) if bb_ok else None,
            "inferior": round(bb_l, 6) if bb_ok else None,
            "precio_vs_bandas": bb_vs,
        },
        "ma20": round(ma20v, 6) if ma20v is not None else None,
        "ma50": round(ma50v, 6) if ma50v is not None else None,
        "precio_vs_ma20": vs_ma20,
        "precio_vs_ma50": vs_ma50,
        "bars": bars,
        "info": {
            "nombre": info.get("shortName") or info.get("longName") or sym,
            "exchange": str(info.get("exchange") or info.get("fullExchangeName") or ""),
            "moneda": str(info.get("currency") or ""),
            "descripcion": desc,
        },
        "fundamentals": fundamentals_from_info(info),
    }


@router.get("/search")
def market_search(
    q: str = Query("", description="Ticker, empresa o texto"),
) -> list[dict[str, Any]]:
    q_raw = (q or "").strip()
    if not q_raw:
        return []
    found = _search_from_yahoo(q_raw)
    if len(found) < 8:
        extra = _search_ticker_fallback(
            [q_raw, q_raw.upper(), q_raw.replace(" ", "").upper()]
        )
        found = _merge_search_results(found, extra, 8)
    return found[:8]


@router.get("/asset/{symbol:path}")
def market_asset(
    symbol: str,
    range_: str = Query(
        "6M",
        alias="range",
        description="Ventana del gráfico: 1D, 1W, 1M, 3M, 6M, 1Y, 5Y",
    ),
) -> dict[str, Any]:
    chart_r = _norm_chart_range(range_)
    sym_key = normalize_ticker(symbol.strip())
    cache_key = f"{sym_key.upper()}|{chart_r}"
    now = time.time()
    hit = _ASSET_CACHE.get(cache_key)
    if hit is not None:
        ts, payload = hit
        if now - ts < _ASSET_TTL_SEC:
            return copy.deepcopy(payload)
    try:
        payload = _asset_payload_impl(sym_key, chart_r)
    except ValueError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e).strip() or "No hay datos disponibles para este ticker",
        ) from e
    except Exception:
        raise HTTPException(
            status_code=404,
            detail="No hay datos disponibles para este ticker",
        ) from None
    _ASSET_CACHE[cache_key] = (now, copy.deepcopy(payload))
    return copy.deepcopy(payload)


@router.get("/overview")
def market_overview(
    symbols: Optional[str] = Query(
        None,
        description="Lista separada por comas; por defecto índices y activos AR + global",
    ),
) -> dict[str, Any]:
    """Cotizaciones resumidas para el panel principal (incl. RSI/MACD/señal para scanner)."""
    syms = (
        [s.strip() for s in symbols.split(",") if s.strip()]
        if symbols
        else DEFAULT_OVERVIEW_SYMBOLS
    )

    def _overview_one(sym: str) -> tuple[Optional[dict[str, Any]], Optional[str]]:
        try:
            return _quote_one(sym), None
        except Exception as e:  # noqa: BLE001
            return None, f"{sym}: {e!s}"

    items: list[dict[str, Any]] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        pairs = list(ex.map(_overview_one, syms))
    for row, err in pairs:
        if row is not None:
            items.append(row)
        elif err:
            errors.append(err)
    return {"items": items, "errors": errors}


def _pulse_one(spec: tuple[str, str]) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    sym, label = spec
    if sym == "ARS=X":
        for alt in USD_FALLBACKS:
            row = _safe_quote(alt)
            if row:
                r = dict(row)
                r["label"] = label
                r["symbol"] = alt
                return (
                    {
                        "label": r.get("label", label),
                        "symbol": r["symbol"],
                        "price": r["price"],
                        "changePct": r["changePct"],
                        "currency": r.get("currency", ""),
                    },
                    None,
                )
        return None, f"{sym}: sin cotización USD/ARS"
    try:
        q = _quote_one(sym)
        r = dict(q)
        r["label"] = label
        return (
            {
                "label": r.get("label", label),
                "symbol": r["symbol"],
                "price": r["price"],
                "changePct": r["changePct"],
                "currency": r.get("currency", ""),
            },
            None,
        )
    except Exception as e:  # noqa: BLE001
        return None, f"{sym}: {e!s}"


@router.get("/pulse")
def market_pulse() -> dict[str, Any]:
    """Cuatro referencias: MERVAL, USD/ARS, AL30, S&P 500."""
    items: list[dict[str, Any]] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        pairs = list(ex.map(_pulse_one, PULSE_SPECS))
    for item, err in pairs:
        if item is not None:
            items.append(item)
        elif err:
            errors.append(err)
    return {"items": items, "errors": errors}


@router.get("/tape")
def market_tape() -> dict[str, Any]:
    """Cotizaciones compactas para ticker tape."""
    items: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(_safe_quote, TAPE_SYMBOLS))
    for row in rows:
        if row:
            items.append(
                {
                    "symbol": row["symbol"],
                    "price": row["price"],
                    "changePct": row["changePct"],
                    "currency": row.get("currency", ""),
                }
            )
    return {"items": items}


@router.get("/ai-summary")
def ai_summary() -> dict[str, Any]:
    now = time.time()
    hit = _AI_SUMMARY_CACHE.get("payload")
    ts = float(_AI_SUMMARY_CACHE.get("ts") or 0.0)
    if hit is not None and now - ts < _AI_SUMMARY_TTL_SEC:
        return copy.deepcopy(hit)

    specs = [
        ("^MERV", "MERVAL"),
        ("^GSPC", "S&P500"),
        ("^IXIC", "Nasdaq"),
        ("BTC-USD", "BTC"),
        ("DX-Y.NYB", "DXY"),
        ("CL=F", "Petróleo"),
        ("GC=F", "Oro"),
    ]
    mercados: dict[str, dict[str, Any]] = {}
    for sym, label in specs:
        q = _safe_quote(sym)
        if q:
            mercados[label] = {
                "symbol": sym,
                "price": q.get("price"),
                "changePct": q.get("changePct"),
                "currency": q.get("currency", ""),
            }

    fecha = date.today().isoformat()
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    resumen = (
        "No se pudo generar briefing IA en este momento. "
        "Revisá conectividad o la clave de Anthropic."
    )
    if key:
        try:
            client = Anthropic(api_key=key)
            user_prompt = (
                "Mercados (JSON):\n"
                + json.dumps(mercados, ensure_ascii=False, indent=2)
                + "\n\nGenerá briefing diario."
            )
            msg = client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=900,
                system=(
                    "Sos un analista financiero senior. Generá un briefing profesional de mercado para "
                    "inversores de equity global y argentino. Máximo 4 párrafos. "
                    "Destacá las oportunidades y riesgos del día. Sé directo y accionable."
                ),
                messages=[{"role": "user", "content": user_prompt}],
            )
            out = ""
            for b in msg.content:
                if b.type == "text":
                    out += b.text
            if out.strip():
                resumen = out.strip()
        except Exception:
            pass

    payload = {"fecha": fecha, "resumen": resumen, "mercados": mercados}
    _AI_SUMMARY_CACHE["ts"] = now
    _AI_SUMMARY_CACHE["payload"] = copy.deepcopy(payload)
    return payload


@router.get("/candidates")
def market_candidates() -> dict[str, Any]:
    """Tres candidatos con métricas reales y texto explicativo placeholder."""
    out: list[dict[str, Any]] = []
    rationales = [
        "Placeholder: liquidez BYMA y momentum de corto plazo a vigilar.",
        "Placeholder: referencia global; correlación con ADR y tipo de cambio implícito.",
        "Placeholder: bono soberano en pesos; sensibilidad a riesgo país y tasa.",
    ]
    for i, sym in enumerate(CANDIDATE_SYMBOLS):
        try:
            ticker = yf.Ticker(sym)
            hist = ticker.history(period="6mo", interval="1d")
            if hist is None or hist.empty:
                raise ValueError("sin histórico")
            close = hist["Close"].astype(float)
            last = float(close.iloc[-1])
            prev = float(close.iloc[-2]) if len(close) > 1 else last
            chg = ((last - prev) / prev * 100.0) if prev else 0.0
            rsi = _rsi(close)
            macd = _macd_label(close)
            vol = _volume_label(hist)
            sig = _signal_from_rsi(rsi)
            out.append(
                {
                    "ticker": sym,
                    "signal": sig,
                    "price": round(last, 4),
                    "changePct": round(chg, 2),
                    "rsi": f"{rsi:.0f}" if rsi is not None else "—",
                    "macd": macd,
                    "volume": vol,
                    "rationale": rationales[i % len(rationales)],
                }
            )
        except Exception as e:  # noqa: BLE001
            out.append(
                {
                    "ticker": sym,
                    "signal": "NEUTRO",
                    "price": 0.0,
                    "changePct": 0.0,
                    "rsi": "—",
                    "macd": "—",
                    "volume": "—",
                    "rationale": f"Sin datos: {e!s}",
                }
            )
    return {"items": out}


def _fwd_trading_return(close: pd.Series, start_pos: int, days: int) -> Optional[float]:
    if start_pos < 0 or start_pos >= len(close):
        return None
    end_pos = min(len(close) - 1, start_pos + days)
    if end_pos <= start_pos:
        return None
    a = float(close.iloc[start_pos])
    b = float(close.iloc[end_pos])
    if a == 0:
        return None
    return round((b / a - 1.0) * 100.0, 2)


def _local_extrema_lows(low: pd.Series, w: int = 5) -> list[tuple[int, float]]:
    out: list[tuple[int, float]] = []
    for i in range(w, len(low) - w):
        seg = low.iloc[i - w : i + w + 1]
        if float(low.iloc[i]) <= float(seg.min()) + 1e-12:
            out.append((i, float(low.iloc[i])))
    return out


def _local_extrema_highs(hi: pd.Series, w: int = 5) -> list[tuple[int, float]]:
    out: list[tuple[int, float]] = []
    for i in range(w, len(hi) - w):
        seg = hi.iloc[i - w : i + w + 1]
        if float(hi.iloc[i]) >= float(seg.max()) - 1e-12:
            out.append((i, float(hi.iloc[i])))
    return out


def _cluster_key_levels(prices: list[float], min_touches: int = 3) -> list[float]:
    if not prices:
        return []
    mx = max(abs(p) for p in prices)
    step = max(mx * 0.02, 1e-6)
    buck: Counter = Counter()
    for p in prices:
        k = round(p / step) * step
        buck[k] += 1
    pairs = [(c, float(k)) for k, c in buck.items() if c >= min_touches]
    pairs.sort(key=lambda x: -x[0])
    return [p for _, p in pairs[:12]]


def _historical_analysis_payload(symbol: str) -> dict[str, Any]:
    sym = normalize_ticker(symbol.strip())
    t = yf.Ticker(sym)
    hist = t.history(period="5y", interval="1d")
    if hist is None or hist.empty:
        raise ValueError("sin datos históricos")
    close = hist["Close"].astype(float)
    low = hist["Low"].astype(float)
    high = hist["High"].astype(float)
    if len(close) < 60:
        raise ValueError("historial insuficiente")

    running_max = close.cummax()
    dd_pct = (close / running_max - 1.0) * 100.0
    max_drawdown = round(float(dd_pct.min()), 2)

    trough_candidates: list[int] = []
    for i in range(15, len(dd_pct) - 15):
        seg = dd_pct.iloc[i - 5 : i + 6]
        if float(dd_pct.iloc[i]) <= -20.0 and float(dd_pct.iloc[i]) <= float(seg.min()) + 1e-9:
            trough_candidates.append(i)

    merged_troughs: list[int] = []
    for idx in trough_candidates:
        if not merged_troughs or idx - merged_troughs[-1] > 20:
            merged_troughs.append(idx)
        elif dd_pct.iloc[idx] < dd_pct.iloc[merged_troughs[-1]]:
            merged_troughs[-1] = idx

    caidas: list[dict[str, Any]] = []
    for ti in merged_troughs:
        trough_px = float(close.iloc[ti])
        peak_seg = close.iloc[: ti + 1]
        peak_idx = int(peak_seg.argmax())
        peak_px = float(close.iloc[peak_idx])
        drop_pct = round((trough_px / peak_px - 1.0) * 100.0, 2) if peak_px else 0.0
        if drop_pct > -18.0:
            continue
        tiers: list[str] = []
        if drop_pct <= -20.0:
            tiers.append("20%")
        if drop_pct <= -30.0:
            tiers.append("30%")
        if drop_pct <= -40.0:
            tiers.append("40%")
        if not tiers:
            continue
        peak_date = str(hist.index[peak_idx])[:10]
        trough_date = str(hist.index[ti])[:10]
        caidas.append(
            {
                "peak_date": peak_date,
                "trough_date": trough_date,
                "drawdown_pct": drop_pct,
                "umbrales": tiers,
                "rebote_3m_pct": _fwd_trading_return(close, ti, 63),
                "rebote_6m_pct": _fwd_trading_return(close, ti, 126),
                "rebote_12m_pct": _fwd_trading_return(close, ti, 252),
            }
        )

    caidas = sorted(caidas, key=lambda x: float(x["drawdown_pct"]))[:15]

    low_pts = _local_extrema_lows(low, 5)
    high_pts = _local_extrema_highs(high, 5)
    soportes = _cluster_key_levels([p for _, p in low_pts], 3)
    resistencias = _cluster_key_levels([p for _, p in high_pts], 3)

    px_now = float(close.iloc[-1])
    hi5 = float(close.max())
    lo5 = float(close.min())
    vs_max = round((px_now / hi5 - 1.0) * 100.0, 2) if hi5 else None
    vs_min = round((px_now / lo5 - 1.0) * 100.0, 2) if lo5 else None

    sorted_closes = np.sort(close.to_numpy(dtype=float))
    rank_i = int(np.searchsorted(sorted_closes, px_now, side="right"))
    pct_rank = round(rank_i / len(sorted_closes) * 100.0, 2)

    precio_vs: dict[str, Any] = {
        "vs_maximo_5y": vs_max,
        "vs_minimo_5y": vs_min,
        "percentil_historico": pct_rank,
    }

    info = t.info or {}
    nombre = info.get("shortName") or info.get("longName") or sym

    blob: dict[str, Any] = {
        "symbol": sym,
        "nombre": nombre,
        "precio_actual": round(px_now, 4),
        "caidas_historicas": caidas,
        "soportes": [round(x, 4) for x in soportes],
        "resistencias": [round(x, 4) for x in resistencias],
        "max_drawdown": max_drawdown,
        "precio_vs_historico": precio_vs,
    }

    insight = (
        "No se pudo generar el insight en este momento. "
        "Revisá la clave de Anthropic o intentá más tarde."
    )
    anth = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if anth:
        try:
            client = Anthropic(api_key=anth)
            prompt = (
                "Datos estructurados (JSON) sobre drawdowns y precio histórico de 5 años:\n"
                + json.dumps(blob, ensure_ascii=False, indent=2)
                + "\n\nRedactá 3–5 oraciones en español para un inversor retail: contexto de caídas "
                "pasadas, rebotes típicos (3m/6m/12m cuando aparecen), soportes/resistencias y dónde "
                "queda el precio vs el rango 5 años. Tono claro, sin jerga. Sin listas numeradas."
            )
            msg = client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=600,
                system=(
                    "Sos analista senior de equity. Usá solo la información del JSON; no inventes cifras. "
                    "Si falta dato, no lo menciones."
                ),
                messages=[{"role": "user", "content": prompt}],
            )
            parts: list[str] = []
            for b in msg.content:
                if b.type == "text":
                    parts.append(b.text)
            text = "".join(parts).strip()
            if text:
                insight = text
        except Exception:
            pass

    blob["insight_claude"] = insight
    return blob


@router.get("/historical-analysis/{symbol:path}")
def market_historical_analysis(symbol: str) -> dict[str, Any]:
    sym = normalize_ticker(symbol.strip())
    if not sym:
        raise HTTPException(status_code=400, detail="ticker requerido")
    now = time.time()
    hit = _HIST_ANALYSIS_CACHE.get(sym.upper())
    if hit and now - hit[0] < _HIST_ANALYSIS_TTL_SEC:
        return copy.deepcopy(hit[1])
    try:
        payload = _historical_analysis_payload(sym)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Sin análisis: {e!s}") from e
    _HIST_ANALYSIS_CACHE[sym.upper()] = (now, copy.deepcopy(payload))
    return copy.deepcopy(payload)


def _quarterly_row_series(
    df: pd.DataFrame | None, row_names: list[str]
) -> pd.Series | None:
    if df is None or df.empty:
        return None
    for name in row_names:
        if name in df.index:
            return df.loc[name]
    return None


def _earnings_surprise_block(t: Any, n: int = 8) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        df = getattr(t, "earnings_dates", None)
        if df is None or (hasattr(df, "empty") and df.empty):
            return out
        df = df.copy()
        df = df.sort_index(ascending=False).head(n)
        for idx, row in df.iterrows():
            try:
                lab = pd.Timestamp(idx).strftime("%Y-%m-%d")
            except Exception:
                lab = str(idx)[:16]
            est = _safe_float(row["EPS Estimate"] if "EPS Estimate" in row.index else None)
            act = _safe_float(row["Reported EPS"] if "Reported EPS" in row.index else None)
            sur = _safe_float(row["Surprise(%)"] if "Surprise(%)" in row.index else None)
            out.append(
                {
                    "periodo": lab,
                    "estimate": est,
                    "actual": act,
                    "surprise_pct": sur,
                }
            )
    except Exception:
        return out
    return out


def _next_earnings_meta(info: dict[str, Any], t: Any) -> tuple[Optional[str], Optional[float]]:
    next_dt: Optional[str] = None
    est: Optional[float] = None
    ts = info.get("earningsTimestamp")
    if ts is not None:
        try:
            next_dt = pd.Timestamp(ts, unit="s", tz="UTC").strftime("%Y-%m-%d")
        except Exception:
            try:
                next_dt = str(pd.Timestamp(ts))[:10]
            except Exception:
                next_dt = None
    if next_dt is None:
        try:
            cal = getattr(t, "calendar", None)
            if cal is not None and not getattr(cal, "empty", True):
                if isinstance(cal, pd.DataFrame) and "Earnings Date" in cal.index:
                    raw = cal.loc["Earnings Date"].iloc[0]
                    next_dt = str(pd.Timestamp(raw))[:10]
        except Exception:
            pass
    est = _safe_float(info.get("forwardEps"))
    return next_dt, est


def _quarterly_metrics_pack(
    t: Any, n: int = 8
) -> tuple[
    list[str],
    list[float | None],
    list[float | None],
    list[float | None],
    list[float | None],
]:
    qf = getattr(t, "quarterly_financials", None)
    if qf is None or getattr(qf, "empty", True):
        return [], [], [], [], []
    cols = list(qf.columns)[:n]
    periods: list[str] = []
    for c in cols:
        try:
            periods.append(pd.Timestamp(c).strftime("%Y-%m-%d"))
        except Exception:
            periods.append(str(c)[:16])

    def col_vals(df: pd.DataFrame | None, names: list[str]) -> list[float | None]:
        s = _quarterly_row_series(df, names)
        if s is None:
            return [None] * len(cols)
        out: list[float | None] = []
        for c in cols:
            if c not in s.index:
                out.append(None)
            else:
                out.append(_safe_float(s.loc[c]))
        return out

    rev = col_vals(qf, ["Total Revenue", "Revenue"])
    earn = col_vals(qf, ["Net Income"])
    qcf = getattr(t, "quarterly_cashflow", None)
    fcf = col_vals(qcf, ["Free Cash Flow"])
    qbs = getattr(t, "quarterly_balance_sheet", None)
    debt = col_vals(qbs, ["Total Debt", "Long Term Debt"])
    return periods, rev, earn, fcf, debt


@router.get("/financials/{symbol:path}")
def market_financials(symbol: str) -> dict[str, Any]:
    sym = normalize_ticker(symbol.strip())
    if not sym:
        raise HTTPException(status_code=400, detail="ticker requerido")
    now = time.time()
    hit = _FINANCIALS_CACHE.get(sym.upper())
    if hit and now - hit[0] < _FINANCIALS_TTL_SEC:
        return copy.deepcopy(hit[1])

    t = yf.Ticker(sym)
    fin = t.financials
    cf = t.cashflow
    bs = t.balance_sheet
    info = t.info or {}
    hist_px = t.history(period="5y", interval="1d")

    cols: list[pd.Timestamp] = []
    for df in (fin, cf, bs):
        if df is None or df.empty:
            continue
        for c in df.columns:
            try:
                cols.append(pd.Timestamp(c))
            except Exception:
                continue
    years = sorted({c.year for c in cols})[-5:]
    if not years:
        y = date.today().year
        years = [y - 4, y - 3, y - 2, y - 1, y]

    revenue_s = _pick_ts_row(fin, ["Total Revenue", "Revenue"])
    op_income_s = _pick_ts_row(fin, ["Operating Income"])
    net_income_s = _pick_ts_row(fin, ["Net Income"])
    op_cf_s = _pick_ts_row(cf, ["Operating Cash Flow", "Total Cash From Operating Activities"])
    fcf_s = _pick_ts_row(cf, ["Free Cash Flow"])
    bs_equity_s = _pick_ts_row(bs, ["Stockholders Equity", "Total Stockholder Equity"])

    rev_vals = _series_to_year_values(revenue_s, years)
    op_inc_vals = _series_to_year_values(op_income_s, years)
    net_inc_vals = _series_to_year_values(net_income_s, years)
    op_cf_vals = _series_to_year_values(op_cf_s, years)
    fcf_vals = _series_to_year_values(fcf_s, years)

    pe = _safe_float(info.get("trailingPE"))
    pb = _safe_float(info.get("priceToBook"))
    ps = _safe_float(info.get("priceToSalesTrailing12Months"))
    eps = _safe_float(info.get("trailingEps"))
    market_cap = _safe_float(info.get("marketCap"))
    shares = _safe_float(info.get("sharesOutstanding"))
    price_now = _safe_float(info.get("currentPrice")) or _safe_float(info.get("regularMarketPrice"))
    if price_now is None and hist_px is not None and not hist_px.empty:
        price_now = _safe_float(hist_px["Close"].iloc[-1])

    if shares is None and market_cap is not None and price_now and price_now > 0:
        shares = market_cap / price_now

    # promedios simples 5y de múltiplos (si no hay histórico anual de múltiplos, usamos actual como proxy)
    mean_pe = pe
    mean_pb = pb
    mean_ps = ps

    book_value_ps = None
    if bs_equity_s is not None:
        latest_eq = _safe_float(bs_equity_s.iloc[0])
        if latest_eq is not None and shares and shares > 0:
            book_value_ps = latest_eq / shares

    rev_ps = None
    if rev_vals and rev_vals[-1] is not None and shares and shares > 0:
        rev_ps = rev_vals[-1] / shares

    val_mean_pe = (mean_pe * eps) if (mean_pe is not None and eps is not None) else None
    val_mean_pb = (
        (mean_pb * book_value_ps)
        if (mean_pb is not None and book_value_ps is not None)
        else None
    )
    val_mean_ps = (
        (mean_ps * rev_ps)
        if (mean_ps is not None and rev_ps is not None)
        else None
    )

    fcf_latest = fcf_vals[-1] if fcf_vals else None
    rev_growth = _safe_float(info.get("revenueGrowth")) or 0.10
    dcf_ev_20 = _calc_dcf_20y(fcf_latest, rev_growth)
    dcf_terminal = _calc_dcf_20y(fcf_latest, rev_growth, terminal_growth=0.03)

    q_per, q_rev, q_earn, q_fcf, q_debt = _quarterly_metrics_pack(t, 8)
    earn_surp = _earnings_surprise_block(t, 8)
    next_earn, next_est = _next_earnings_meta(info, t)

    to_per_share = (
        lambda v: (v / shares) if (v is not None and shares and shares > 0) else None
    )
    payload = {
        "años": years,
        "income": {
            "revenue": rev_vals,
            "operating_income": op_inc_vals,
            "net_income": net_inc_vals,
        },
        "cashflow": {
            "operating_cashflow": op_cf_vals,
            "free_cashflow": fcf_vals,
            "net_income": net_inc_vals,
        },
        "valuacion_modelos": {
            "dcf_20y": to_per_share(dcf_ev_20),
            "dfcf_20y": to_per_share(dcf_ev_20),
            "dni_20y": to_per_share(dcf_ev_20),
            "dfcf_terminal": to_per_share(dcf_terminal),
            "mean_ps": val_mean_ps,
            "mean_pe": val_mean_pe,
            "mean_pb": val_mean_pb,
            "precio_actual": price_now,
        },
        "quarterly_periods": q_per,
        "quarterly_revenue": q_rev,
        "quarterly_earnings": q_earn,
        "quarterly_fcf": q_fcf,
        "quarterly_debt": q_debt,
        "earnings_surprise": earn_surp,
        "next_earnings_date": next_earn,
        "next_earnings_estimate": next_est,
    }
    _FINANCIALS_CACHE[sym.upper()] = (now, copy.deepcopy(payload))
    return payload


_BENCHMARK_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_BENCHMARK_TTL_SEC = 300.0


@router.get("/benchmark")
def market_benchmark(
    symbols: str = Query("SPY", description="Símbolo (primero de la lista)"),
    period: str = Query(
        "6mo",
        description="Período yfinance: 1d,5d,1mo,3mo,6mo,1y,2y,5y,ytd,max",
    ),
) -> dict[str, Any]:
    """Retorno % del benchmark en el período (primera cotización vs última)."""
    raw = (symbols or "SPY").split(",")[0].strip()
    sym = normalize_ticker(raw)
    if not sym:
        raise HTTPException(status_code=400, detail="símbolo requerido")
    cache_key = f"{sym.upper()}|{period}"
    now = time.time()
    hit = _BENCHMARK_CACHE.get(cache_key)
    if hit and now - hit[0] < _BENCHMARK_TTL_SEC:
        return copy.deepcopy(hit[1])
    try:
        t = yf.Ticker(sym)
        hist = t.history(period=period, interval="1d")
        if hist is None or hist.empty:
            raise ValueError("sin datos")
        close = hist["Close"].astype(float)
        first = float(close.iloc[0])
        last = float(close.iloc[-1])
        ret_pct = ((last - first) / first * 100.0) if first else 0.0
        payload = {
            "symbol": sym,
            "period": period,
            "returnPct": round(ret_pct, 2),
            "firstClose": round(first, 6),
            "lastClose": round(last, 6),
        }
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Benchmark sin datos: {e!s}") from e
    _BENCHMARK_CACHE[cache_key] = (now, copy.deepcopy(payload))
    return copy.deepcopy(payload)


_DIVIDENDS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_DIVIDENDS_TTL_SEC = 3600.0


@router.get("/dividends/{symbol:path}")
def market_dividends(symbol: str) -> dict[str, Any]:
    """Últimos dividendos (hasta 4 trimestres) y metadatos desde yfinance."""
    sym = normalize_ticker(symbol.strip())
    if not sym:
        raise HTTPException(status_code=400, detail="ticker requerido")
    now = time.time()
    hit = _DIVIDENDS_CACHE.get(sym.upper())
    if hit and now - hit[0] < _DIVIDENDS_TTL_SEC:
        return copy.deepcopy(hit[1])
    try:
        t = yf.Ticker(sym)
        div = t.dividends
        rows: list[dict[str, Any]] = []
        if div is not None and len(div) > 0:
            tail = div.tail(4)
            for idx, val in tail.items():
                ts = idx.isoformat() if hasattr(idx, "isoformat") else str(idx)
                rows.append({"fecha": ts, "monto": float(val)})
        info = t.info or {}
        dy = info.get("dividendYield")
        yield_anual: Optional[float] = None
        if dy is not None:
            try:
                yf_val = float(dy)
                yield_anual = yf_val * 100.0 if yf_val <= 1.0 else yf_val
            except (TypeError, ValueError):
                yield_anual = None
        ex_raw = info.get("exDividendDate")
        proximo: Optional[str] = None
        if ex_raw is not None:
            try:
                proximo = pd.Timestamp(ex_raw).isoformat()
            except Exception:
                proximo = str(ex_raw)
        payload = {
            "symbol": sym,
            "dividendos": rows,
            "yield_anual": round(yield_anual, 2) if yield_anual is not None else None,
            "proximo_dividendo": proximo,
        }
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Dividendos no disponibles: {e!s}") from e
    _DIVIDENDS_CACHE[sym.upper()] = (now, copy.deepcopy(payload))
    return copy.deepcopy(payload)


@router.get("/quote/{symbol:path}")
def quote(symbol: str) -> dict[str, Any]:
    """Cotización detallada para un símbolo (soporta puntos en tickers)."""
    try:
        return _quote_one(symbol)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/history/{symbol:path}")
def history(
    symbol: str,
    period: str = Query("3mo", description="1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max"),
    interval: str = Query("1d", description="1m,2m,5m,15m,30m,60m,90m,1h,1d,5d,1wk,1mo,3mo"),
) -> dict[str, Any]:
    """Serie histórica OHLCV para gráficos."""
    sym = normalize_ticker(symbol.strip())
    ticker = yf.Ticker(sym)
    hist = ticker.history(period=period, interval=interval)
    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail="Sin datos históricos")
    rows: list[dict[str, Any]] = []
    for idx, row in hist.iterrows():
        ts = idx.isoformat() if hasattr(idx, "isoformat") else str(idx)
        rows.append(
            {
                "time": ts,
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
            }
        )
    return {"symbol": sym, "period": period, "interval": interval, "bars": rows}


@router.get("/ai-portfolios")
def ai_portfolios() -> dict[str, Any]:
    return {
        "portfolios": [
            {
                "id": "claude",
                "nombre": "Claude Portfolio",
                "gestor": "Anthropic Claude",
                "plataforma": "Autopilot",
                "url": "https://joinautopilot.com/landing/5/950048",
                "twitter": "@theaiportfolios",
                "capital_inicial": 50000,
                "capital_actual": 50013.79,
                "inicio": "2026-04-01",
                "color": "#00a87a",
                "posiciones": [
                    {
                        "ticker": "AVGO",
                        "nombre": "Broadcom",
                        "peso": 10,
                        "sector": "Technology",
                    },
                    {"ticker": "VST", "nombre": "Vistra", "peso": 10, "sector": "Energy"},
                    {"ticker": "LLY", "nombre": "Eli Lilly", "peso": 8, "sector": "Healthcare"},
                    {"ticker": "GLD", "nombre": "Gold ETF", "peso": 11, "sector": "Commodities"},
                    {"ticker": "MSFT", "nombre": "Microsoft", "peso": 8, "sector": "Technology"},
                    {
                        "ticker": "HWM",
                        "nombre": "Howmet Aerospace",
                        "peso": 4,
                        "sector": "Industrials",
                    },
                    {
                        "ticker": "AU",
                        "nombre": "Anglogold Ashanti",
                        "peso": 4,
                        "sector": "Mining",
                    },
                ],
            },
            {
                "id": "grok",
                "nombre": "Grok Portfolio",
                "gestor": "xAI Grok",
                "plataforma": "Autopilot",
                "url": "https://marketplace.joinautopilot.com/landing/5/568906",
                "twitter": "@grkportfolio",
                "capital_inicial": 50000,
                "capital_actual": 57500,
                "inicio": "2025-02-12",
                "color": "#6366f1",
                "posiciones": [
                    {"ticker": "VST", "nombre": "Vistra", "peso": 12, "sector": "Energy"},
                    {"ticker": "TLN", "nombre": "Talen Energy", "peso": 10, "sector": "Energy"},
                    {"ticker": "NRG", "nombre": "NRG Energy", "peso": 8, "sector": "Energy"},
                    {"ticker": "DVN", "nombre": "Devon Energy", "peso": 7, "sector": "Energy"},
                    {"ticker": "LMT", "nombre": "Lockheed Martin", "peso": 10, "sector": "Defense"},
                    {"ticker": "GD", "nombre": "General Dynamics", "peso": 8, "sector": "Defense"},
                    {"ticker": "BWXT", "nombre": "BWX Technologies", "peso": 7, "sector": "Defense"},
                    {"ticker": "AMTM", "nombre": "Amentum Holdings", "peso": 8, "sector": "Defense"},
                    {"ticker": "MSFT", "nombre": "Microsoft", "peso": 10, "sector": "Technology"},
                    {"ticker": "PSN", "nombre": "Parsons Corp", "peso": 6, "sector": "Defense"},
                    {"ticker": "KBR", "nombre": "KBR Inc", "peso": 6, "sector": "Defense"},
                ],
                "operaciones": [
                    {
                        "fecha": "2026-04-07",
                        "accion": "REBALANCEÓ",
                        "ticker": "VST",
                        "razon": "Refuerza energía ante demanda de data centers",
                    },
                    {
                        "fecha": "2026-04-07",
                        "accion": "COMPRÓ",
                        "ticker": "LMT",
                        "razon": "Backlog defense ante conflicto Iran",
                    },
                    {
                        "fecha": "2026-04-07",
                        "accion": "COMPRÓ",
                        "ticker": "AMTM",
                        "razon": "Descuento con backlog $47B",
                    },
                ],
            },
            {
                "id": "gemini",
                "nombre": "Portfolio próximamente — Google Gemini no tiene portfolio público en Autopilot todavía.",
                "gestor": "Google Gemini",
                "plataforma": "Autopilot",
                "url": "https://joinautopilot.com",
                "twitter": "@geminiportfolio",
                "capital_inicial": 50000,
                "capital_actual": 50000,
                "inicio": "2026-04-01",
                "color": "#4285f4",
                "posiciones": [],
            },
            {
                "id": "gpt",
                "nombre": "GPT Portfolio",
                "gestor": "OpenAI GPT-5",
                "plataforma": "Autopilot",
                "url": "https://www.joinautopilot.com/landing/5/63080",
                "twitter": "@thegptfund",
                "capital_inicial": 50000,
                "capital_actual": 52900,
                "inicio": "2023-05-16",
                "color": "#10a37f",
                "posiciones": [
                    {"ticker": "MSFT", "nombre": "Microsoft", "peso": 8, "sector": "Technology"},
                    {"ticker": "NVDA", "nombre": "Nvidia", "peso": 10, "sector": "Technology"},
                    {"ticker": "AAPL", "nombre": "Apple", "peso": 8, "sector": "Technology"},
                    {"ticker": "AMZN", "nombre": "Amazon", "peso": 8, "sector": "Technology"},
                    {"ticker": "META", "nombre": "Meta", "peso": 7, "sector": "Technology"},
                    {"ticker": "GOOGL", "nombre": "Alphabet", "peso": 7, "sector": "Technology"},
                    {"ticker": "BRK-B", "nombre": "Berkshire Hathaway", "peso": 6, "sector": "Financial"},
                    {"ticker": "NFLX", "nombre": "Netflix", "peso": 5, "sector": "Communication"},
                    {"ticker": "WMT", "nombre": "Walmart", "peso": 5, "sector": "Consumer"},
                    {"ticker": "V", "nombre": "Visa", "peso": 5, "sector": "Financial"},
                ],
                "operaciones": [
                    {
                        "fecha": "2025-08-01",
                        "accion": "REBALANCEÓ",
                        "ticker": "NVDA",
                        "razon": "Upgrade a GPT-5, nuevos picks de agosto",
                    },
                    {
                        "fecha": "2025-08-01",
                        "accion": "COMPRÓ",
                        "ticker": "META",
                        "razon": "Fuerte crecimiento AI y publicidad",
                    },
                    {
                        "fecha": "2025-08-01",
                        "accion": "COMPRÓ",
                        "ticker": "WMT",
                        "razon": "Defensivo con crecimiento e-commerce",
                    },
                ],
            },
        ]
    }


@router.get("/ai-operations")
def ai_operations() -> dict[str, Any]:
    """Últimas operaciones por portfolio (demo); fechas al día actual."""
    today = date.today().isoformat()
    return {
        "operations": {
            "claude": [
                {
                    "fecha": today,
                    "accion": "COMPRÓ",
                    "ticker": "GLD",
                    "razon": "Refuerzo de cobertura ante volatilidad macro.",
                },
                {
                    "fecha": today,
                    "accion": "COMPRÓ",
                    "ticker": "AVGO",
                    "razon": "Exposición semiconductores; tesis de IA en infraestructura.",
                },
                {
                    "fecha": today,
                    "accion": "COMPRÓ",
                    "ticker": "MSFT",
                    "razon": "Core quality + flujos recurrentes en nube.",
                },
            ],
            "grok": [
                {
                    "fecha": today,
                    "accion": "REBALANCEÓ",
                    "ticker": "VST",
                    "razon": "Refuerza energía ante demanda de data centers",
                },
                {
                    "fecha": today,
                    "accion": "COMPRÓ",
                    "ticker": "LMT",
                    "razon": "Backlog defense ante conflicto Iran",
                },
                {
                    "fecha": today,
                    "accion": "COMPRÓ",
                    "ticker": "AMTM",
                    "razon": "Descuento con backlog $47B",
                },
            ],
            "gemini": [],
            "gpt": [
                {
                    "fecha": today,
                    "accion": "REBALANCEÓ",
                    "ticker": "NVDA",
                    "razon": "Upgrade a GPT-5, nuevos picks de agosto",
                },
                {
                    "fecha": today,
                    "accion": "COMPRÓ",
                    "ticker": "META",
                    "razon": "Fuerte crecimiento AI y publicidad",
                },
                {
                    "fecha": today,
                    "accion": "COMPRÓ",
                    "ticker": "WMT",
                    "razon": "Defensivo con crecimiento e-commerce",
                },
            ],
        }
    }


_IDEA_SEMANAL_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_IDEA_SEMANAL_TTL_SEC = 24 * 3600.0

INGELD_UNIVERSE_30: list[str] = [
    "AAPL",
    "MSFT",
    "GOOGL",
    "AMZN",
    "META",
    "NVDA",
    "TSLA",
    "JPM",
    "V",
    "JNJ",
    "WMT",
    "PG",
    "UNH",
    "HD",
    "MA",
    "BAC",
    "DIS",
    "NFLX",
    "ADBE",
    "CRM",
    "GGAL.BA",
    "BMA.BA",
    "PAMP.BA",
    "YPFD.BA",
    "TXAR.BA",
    "TECO2.BA",
    "BTC-USD",
    "ETH-USD",
    "SPY",
    "QQQ",
]
_INGELD_PORTFOLIO_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_INGELD_PORTFOLIO_TTL_SEC = 24 * 3600.0


def _ingeld_universe_row(sym: str) -> dict[str, Any] | None:
    try:
        t = yf.Ticker(sym)
        hist = t.history(period="6mo", interval="1d")
        if hist is None or hist.empty:
            return None
        close = hist["Close"].astype(float)
        last = float(close.iloc[-1])
        prev = float(close.iloc[-2]) if len(close) > 1 else last
        chg = ((last - prev) / prev * 100.0) if prev else 0.0
        info = t.info or {}
        f = fundamentals_from_info(info)
        return {
            "ticker": sym,
            "nombre": str(info.get("shortName") or info.get("longName") or sym),
            "sector": str(f.get("sector") or info.get("sector") or "Other"),
            "precio": round(last, 4),
            "changePct": round(chg, 2),
            "rsi": _rsi(close),
            "pe": _safe_float(f.get("pe_ratio")),
            "revenue_growth": _safe_float(f.get("revenue_growth")),
            "dividend_yield": _safe_float(f.get("dividend_yield")),
        }
    except Exception:
        return None


def _ingeld_fallback_payload(rows: list[dict[str, Any]], today_iso: str) -> dict[str, Any]:
    scored = []
    for r in rows:
        rg = _safe_float(r.get("revenue_growth")) or 0.0
        dy = _safe_float(r.get("dividend_yield")) or 0.0
        rsi = _safe_float(r.get("rsi")) or 50.0
        ch = _safe_float(r.get("changePct")) or 0.0
        pe = _safe_float(r.get("pe"))
        pe_score = 0.0 if pe is None else (30 - min(30.0, max(0.0, pe))) / 30.0
        score = rg * 100 * 0.45 + dy * 100 * 0.20 + pe_score * 100 * 0.20 + ch * 0.10 + (
            100 - abs(rsi - 50) * 2
        ) * 0.05
        scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = [r for _, r in scored[:10]]
    if not top:
        top = rows[:10]
    n = len(top) or 1
    base = [14, 13, 12, 11, 10, 10, 9, 8, 7, 6]
    if n != 10:
        per = round(100 / n)
        base = [per for _ in range(n)]
    pos = []
    for i, r in enumerate(top):
        pos.append(
            {
                "ticker": r.get("ticker"),
                "nombre": r.get("nombre") or r.get("ticker"),
                "peso": base[i] if i < len(base) else max(1, round(100 / n)),
                "sector": r.get("sector") or "Other",
                "razon": "Selección cuantitativa fallback por momentum, crecimiento y valuación.",
                "precio_actual": _safe_float(r.get("precio")) or 0,
            }
        )
    return {
        "nombre": "INGELD Portfolio Semana IA",
        "fecha": today_iso,
        "tesis": (
            "Portafolio balanceado entre tecnología de calidad, defensivos y beta táctica, "
            "priorizando crecimiento de ingresos, solidez relativa y momentum controlado."
        ),
        "posiciones": pos,
        "riesgo_principal": "Shock macro que eleve correlaciones y reduzca múltiplos simultáneamente.",
        "retorno_esperado": "8-15% en 3 meses",
        "benchmark": "SPY",
    }


@router.get("/ingeld-portfolio")
def ingeld_portfolio(force: bool = Query(False, description="Regenera ignorando caché")) -> dict[str, Any]:
    now = time.time()
    cached = _INGELD_PORTFOLIO_CACHE.get("payload")
    ts = float(_INGELD_PORTFOLIO_CACHE.get("ts") or 0.0)
    if (not force) and cached is not None and now - ts < _INGELD_PORTFOLIO_TTL_SEC:
        return copy.deepcopy(cached)

    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for row in ex.map(_ingeld_universe_row, INGELD_UNIVERSE_30):
            if row is not None:
                rows.append(row)
    today_iso = date.today().isoformat()
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()

    if not rows:
        raise HTTPException(status_code=502, detail="No se pudieron obtener métricas del universo.")

    data: dict[str, Any]
    if not key:
        data = _ingeld_fallback_payload(rows, today_iso)
    else:
        prompt = (
            "Sos el analista senior de INGELD. Tu trabajo es armar el mejor portfolio de 10 "
            "acciones para esta semana basándote en análisis técnico + fundamental.\n\n"
            "Datos del mercado:\n"
            + json.dumps(rows, ensure_ascii=False, indent=2)
            + '\n\nRespondé SOLO JSON válido:\n{\n'
            + '  "nombre": "INGELD Portfolio Semana X",\n'
            + f'  "fecha": "{today_iso}",\n'
            + '  "tesis": "Párrafo explicando la tesis macro",\n'
            + '  "posiciones": [\n'
            + "    {\n"
            + '      "ticker": "AAPL",\n'
            + '      "nombre": "Apple Inc.",\n'
            + '      "peso": 12,\n'
            + '      "sector": "Technology",\n'
            + '      "razon": "Una oración de por qué"\n'
            + "    }\n"
            + "  ],\n"
            + '  "riesgo_principal": "Una oración",\n'
            + '  "retorno_esperado": "10-15% en 3 meses",\n'
            + '  "benchmark": "SPY"\n'
            + "}"
        )
        try:
            client = Anthropic(api_key=key)
            msg = client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=1800,
                system="Respondé SOLO JSON válido, sin markdown.",
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
            raw = text
            if "```" in raw:
                for chunk in raw.split("```"):
                    c = chunk.strip()
                    if c.lower().startswith("json"):
                        c = c[4:].lstrip()
                    if c.startswith("{") and c.endswith("}"):
                        raw = c
                        break
            data = json.loads(raw)
        except Exception:
            data = _ingeld_fallback_payload(rows, today_iso)

    by_ticker = {str(r.get("ticker") or "").upper(): r for r in rows}
    posiciones = []
    for p in list(data.get("posiciones") or [])[:10]:
        tkr = str(p.get("ticker") or "").upper()
        m = by_ticker.get(tkr, {})
        posiciones.append(
            {
                "ticker": tkr,
                "nombre": str(p.get("nombre") or m.get("nombre") or tkr),
                "peso": float(_safe_float(p.get("peso")) or 0),
                "sector": str(p.get("sector") or m.get("sector") or "Other"),
                "razon": str(p.get("razon") or "").strip(),
                "precio_actual": float(_safe_float(m.get("precio")) or 0),
            }
        )

    payload = {
        "id": "ingeld",
        "nombre": str(data.get("nombre") or "INGELD Portfolio Semana IA"),
        "fecha": str(data.get("fecha") or today_iso),
        "tesis": str(data.get("tesis") or "").strip(),
        "posiciones": posiciones,
        "riesgo_principal": str(data.get("riesgo_principal") or "").strip(),
        "retorno_esperado": str(data.get("retorno_esperado") or "8-15% en 3 meses").strip(),
        "benchmark": str(data.get("benchmark") or "SPY").strip().upper(),
    }
    _INGELD_PORTFOLIO_CACHE["ts"] = now
    _INGELD_PORTFOLIO_CACHE["payload"] = copy.deepcopy(payload)
    return payload


@router.get("/idea-semanal")
def idea_semanal() -> dict[str, Any]:
    """Idea semanal de compra generada por Claude (cache 24h)."""
    now = time.time()
    today = date.today()
    is_weekend = today.weekday() >= 5
    cached = _IDEA_SEMANAL_CACHE.get("payload")
    ts = float(_IDEA_SEMANAL_CACHE.get("ts") or 0.0)

    if is_weekend and cached is not None:
        return copy.deepcopy(cached)

    if cached is not None and now - ts < _IDEA_SEMANAL_TTL_SEC:
        return copy.deepcopy(cached)

    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        if cached is not None:
            return copy.deepcopy(cached)
        return {
            "ticker": "AAPL",
            "nombre": "Apple Inc.",
            "señal": "COMPRAR",
            "precio_entrada": 246,
            "precio_objetivo": 280,
            "stop_loss": 230,
            "horizonte": "1-4 semanas",
            "racional": (
                "Idea fallback por falta de ANTHROPIC_API_KEY. "
                "Configurá la variable para generar la idea semanal en vivo."
            ),
            "riesgo_principal": "Volatilidad macro y compresión de múltiplos.",
            "confianza": "Media",
            "fecha_generada": today.isoformat(),
        }

    prompt = """Sos un analista financiero senior. Es lunes.
Analizá el mercado global (USA, emergentes, commodities)
y elegí UN SOLO papel para comprar esta semana.

Respondé en JSON:
{
  "ticker": "AAPL",
  "nombre": "Apple Inc.",
  "señal": "COMPRAR",
  "precio_entrada": 246,
  "precio_objetivo": 280,
  "stop_loss": 230,
  "horizonte": "1-4 semanas",
  "racional": "3 párrafos explicando por qué",
  "riesgo_principal": "una oración",
  "confianza": "Alta|Media|Baja"
}
"""

    try:
        client = Anthropic(api_key=key)
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1000,
            system="Respondé SOLO JSON válido, sin markdown.",
            messages=[{"role": "user", "content": prompt}],
        )
        text = ""
        for block in msg.content:
            if block.type == "text":
                text += block.text
        raw = text.strip()
        if "```" in raw:
            for chunk in raw.split("```"):
                c = chunk.strip()
                if c.lower().startswith("json"):
                    c = c[4:].lstrip()
                if c.startswith("{") and c.endswith("}"):
                    raw = c
                    break
        data = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        if cached is not None:
            return copy.deepcopy(cached)
        raise HTTPException(status_code=502, detail=f"No se pudo generar idea semanal: {e!s}") from e

    payload = {
        "ticker": str(data.get("ticker") or "AAPL").upper(),
        "nombre": str(data.get("nombre") or "Apple Inc.").strip(),
        "señal": str(data.get("señal") or "COMPRAR").upper(),
        "precio_entrada": float(data.get("precio_entrada") or 0),
        "precio_objetivo": float(data.get("precio_objetivo") or 0),
        "stop_loss": float(data.get("stop_loss") or 0),
        "horizonte": str(data.get("horizonte") or "1-4 semanas").strip(),
        "racional": str(data.get("racional") or "").strip(),
        "riesgo_principal": str(data.get("riesgo_principal") or "").strip(),
        "confianza": str(data.get("confianza") or "Media").title(),
        "fecha_generada": today.isoformat(),
    }
    _IDEA_SEMANAL_CACHE["ts"] = now
    _IDEA_SEMANAL_CACHE["payload"] = copy.deepcopy(payload)
    return payload
