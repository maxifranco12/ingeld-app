"""Market data endpoints backed by yfinance."""

from __future__ import annotations

import copy
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
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

_ASSET_PERIOD_MAP: dict[str, str] = {
    "1M": "1mo",
    "3M": "3mo",
    "6M": "6mo",
    "1Y": "1y",
}

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
    return u if u in _ASSET_PERIOD_MAP else "6M"


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
    yf_period = _ASSET_PERIOD_MAP[cr]
    ticker = yf.Ticker(sym)
    hist = ticker.history(period=yf_period, interval="1d")
    if (hist is None or hist.empty) and yf_period != "3mo":
        hist = ticker.history(period="3mo", interval="1d")
    if hist is None or hist.empty:
        raise ValueError("No hay datos disponibles para este ticker")
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

    ma20_s = close.rolling(20).mean()
    ma50_s = close.rolling(50).mean()
    ma20v: Optional[float] = None
    ma50v: Optional[float] = None
    if len(close) >= 20 and not pd.isna(ma20_s.iloc[-1]):
        ma20v = float(ma20_s.iloc[-1])
    if len(close) >= 50 and not pd.isna(ma50_s.iloc[-1]):
        ma50v = float(ma50_s.iloc[-1])

    if last > bb_u:
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
            "linea": round(macd_line, 6),
            "senal": round(macd_sig, 6),
            "histograma": round(macd_hist, 6),
            "direccion": macd_dir,
        },
        "bollinger": {
            "superior": round(bb_u, 6),
            "media": round(bb_m, 6),
            "inferior": round(bb_l, 6),
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
        description="Ventana del gráfico: 1M, 3M, 6M, 1Y",
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
