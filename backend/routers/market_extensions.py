"""Market tools: screener, backtest, insiders, earnings calendar, heatmap."""

from __future__ import annotations

import copy
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import numpy as np
import pandas as pd
import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter, Body, HTTPException, Query

from routers.market import (
    fundamentals_from_info,
    normalize_ticker,
    _rsi,
    _safe_float,
)

router = APIRouter()

FEATURES_UNIVERSE: list[str] = [
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

_SCREENER_CACHE: dict[str, Any] = {"ts": 0.0, "rows": None}
_SCREENER_TTL_SEC = 3600.0

_HEATMAP_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_HEATMAP_TTL_SEC = 300.0

_EARNINGS_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_EARNINGS_TTL_SEC = 3600.0


def _cap_bucket(mc: float | None) -> str:
    if mc is None or mc <= 0:
        return "Unknown"
    if mc < 2e9:
        return "Small"
    if mc < 10e9:
        return "Mid"
    if mc < 200e9:
        return "Large"
    return "Mega"


def _fetch_screener_row(sym: str) -> dict[str, Any] | None:
    try:
        tk = yf.Ticker(sym)
        info = tk.info or {}
        hist = tk.history(period="6mo", interval="1d")
        if hist is None or hist.empty:
            return None
        close = hist["Close"].astype(float)
        last = float(close.iloc[-1])
        prev = float(close.iloc[-2]) if len(close) > 1 else last
        chg = ((last - prev) / prev * 100.0) if prev else 0.0
        rsi_v = _rsi(close)
        fu = fundamentals_from_info(info)
        mc = _safe_float(fu.get("market_cap"))
        pe = _safe_float(fu.get("pe_ratio"))
        pb = _safe_float(fu.get("pb_ratio"))
        roe = _safe_float(fu.get("roe"))
        dy = _safe_float(fu.get("dividend_yield"))
        rg = _safe_float(fu.get("revenue_growth"))
        sector = str(fu.get("sector") or info.get("sector") or "Unknown")
        name = str(info.get("shortName") or info.get("longName") or sym)
        return {
            "ticker": sym,
            "name": name,
            "sector": sector,
            "price": round(last, 4),
            "changePct": round(chg, 2),
            "pe": pe,
            "pb": pb,
            "roe": roe,
            "dividend_yield": dy,
            "revenue_growth": rg,
            "rsi": round(rsi_v, 2) if rsi_v is not None else None,
            "market_cap": mc,
            "cap_bucket": _cap_bucket(mc),
        }
    except Exception:
        return None


def _screener_universe_rows() -> list[dict[str, Any]]:
    now = time.time()
    hit = _SCREENER_CACHE.get("rows")
    ts = float(_SCREENER_CACHE.get("ts") or 0.0)
    if hit is not None and now - ts < _SCREENER_TTL_SEC:
        return copy.deepcopy(hit)

    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for row in ex.map(_fetch_screener_row, FEATURES_UNIVERSE):
            if row is not None:
                rows.append(row)
    _SCREENER_CACHE["ts"] = now
    _SCREENER_CACHE["rows"] = copy.deepcopy(rows)
    return copy.deepcopy(rows)


def _passes_screener_filters(
    row: dict[str, Any],
    pe_min: float | None,
    pe_max: float | None,
    pb_min: float | None,
    pb_max: float | None,
    roe_min: float | None,
    div_min: float | None,
    rev_g_min: float | None,
    rsi_min: float | None,
    rsi_max: float | None,
    cap_bucket: str | None,
    sector: str | None,
) -> bool:
    def rng(
        v: float | None, lo: float | None, hi: float | None, *, is_pct=False
    ) -> bool:
        if lo is None and hi is None:
            return True
        if v is None:
            return False
        x = v * 100 if is_pct and v is not None and abs(v) <= 1.5 else v
        if lo is not None and x < lo:
            return False
        if hi is not None and x > hi:
            return False
        return True

    pe = row.get("pe")
    pb = row.get("pb")
    roe = row.get("roe")
    if roe is not None and abs(roe) <= 2:
        roe_pct = roe * 100.0
    else:
        roe_pct = roe
    dy = row.get("dividend_yield")
    if dy is not None and dy <= 1.5:
        dy_pct = dy * 100.0
    else:
        dy_pct = dy
    rg = row.get("revenue_growth")
    if rg is not None and abs(rg) <= 1.5:
        rg_pct = rg * 100.0
    else:
        rg_pct = rg

    if not rng(pe, pe_min, pe_max):
        return False
    if not rng(pb, pb_min, pb_max):
        return False
    if roe_min is not None:
        if roe_pct is None or roe_pct < roe_min:
            return False
    if div_min is not None:
        if dy_pct is None or dy_pct < div_min:
            return False
    if rev_g_min is not None:
        if rg_pct is None or rg_pct < rev_g_min:
            return False
    rsi = row.get("rsi")
    if rsi_min is not None or rsi_max is not None:
        if rsi is None:
            return False
        if rsi_min is not None and rsi < rsi_min:
            return False
        if rsi_max is not None and rsi > rsi_max:
            return False
    if cap_bucket and str(cap_bucket).strip():
        if (row.get("cap_bucket") or "").lower() != cap_bucket.strip().lower():
            return False
    if sector and str(sector).strip():
        if (row.get("sector") or "").lower() != sector.strip().lower():
            return False
    return True


@router.get("/screener")
def market_screener(
    pe_min: Optional[float] = Query(None),
    pe_max: Optional[float] = Query(None),
    pb_min: Optional[float] = Query(None),
    pb_max: Optional[float] = Query(None),
    roe_min: Optional[float] = Query(None, description="ROE mínimo en % (ej 15)"),
    dividend_yield_min: Optional[float] = Query(
        None, alias="dividend_yield_min", description="Dividend yield mínimo en %"
    ),
    revenue_growth_min: Optional[float] = Query(
        None, description="Crecimiento revenue mínimo en %"
    ),
    rsi_min: Optional[float] = Query(None),
    rsi_max: Optional[float] = Query(None),
    market_cap: Optional[str] = Query(
        None, description="Small | Mid | Large | Mega"
    ),
    sector: Optional[str] = Query(None),
) -> dict[str, Any]:
    all_rows = _screener_universe_rows()
    out = [
        r
        for r in all_rows
        if _passes_screener_filters(
            r,
            pe_min,
            pe_max,
            pb_min,
            pb_max,
            roe_min,
            dividend_yield_min,
            revenue_growth_min,
            rsi_min,
            rsi_max,
            market_cap,
            sector,
        )
    ]
    return {"results": out, "universe_size": len(FEATURES_UNIVERSE), "matched": len(out)}


@router.post("/screener/analyze")
def screener_analyze(body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    items = body.get("items")
    if not isinstance(items, list):
        items = []
    top = items[:5]
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return {
            "analisis": "Configurá ANTHROPIC_API_KEY para análisis IA del screener.",
            "items": top,
        }
    try:
        client = Anthropic(api_key=key)
        prompt = (
            "Sos analista senior. Con estos hasta 5 activos filtrados por screener "
            "(JSON), resumí oportunidades, riesgos comunes y sugerencias de due diligence. "
            "Máximo 3 párrafos, en español.\n\n"
            + json.dumps(top, ensure_ascii=False, indent=2)
        )
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        text = ""
        for b in msg.content:
            if b.type == "text":
                text += b.text
        return {"analisis": text.strip() or "(Sin respuesta)", "items": top}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e)) from e


def _rsi_series(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _macd_line_signal(close: pd.Series) -> tuple[pd.Series, pd.Series]:
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    return macd_line, signal_line


def _buy_signals(hist: pd.DataFrame, estrategia: str) -> pd.Series:
    close = hist["Close"].astype(float)
    low = hist["Low"].astype(float) if "Low" in hist.columns else close
    rsi = _rsi_series(close)
    macd, sig = _macd_line_signal(close)
    ma200 = close.rolling(200).mean()
    buy = pd.Series(False, index=hist.index)
    if estrategia == "rsi30":
        buy = (rsi < 30) & (rsi.shift(1) >= 30)
    elif estrategia == "rsi30_macd_cross":
        cross = (macd > sig) & (macd.shift(1) <= sig.shift(1))
        buy = (rsi < 30) & cross
    elif estrategia == "touch_ma200":
        buy = (low <= ma200 * 1.005) & (close >= ma200 * 0.995) & ma200.notna()
    elif estrategia == "drop_month_20":
        chg = close / close.shift(21) - 1.0
        buy = chg <= -0.20
    else:
        buy = (rsi < 30) & (rsi.shift(1) >= 30)
    return buy.fillna(False)


def _simulate_backtest(
    hist: pd.DataFrame, buy_sig: pd.Series, capital: float, hold_bars: int = 30
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], float]:
    close = hist["Close"].astype(float)
    idx_dates = hist.index
    cash = float(capital)
    shares = 0.0
    entry_i: int | None = None
    entry_price = 0.0
    trades: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []

    for i in range(len(hist)):
        price = float(close.iloc[i])
        d = idx_dates[i]
        d_str = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]

        if entry_i is not None and shares > 0 and i - entry_i >= hold_bars:
            cash = shares * price
            pct = (price / entry_price - 1.0) * 100.0 if entry_price else 0.0
            ed = idx_dates[entry_i]
            ed_str = ed.strftime("%Y-%m-%d") if hasattr(ed, "strftime") else str(ed)[:10]
            trades.append(
                {
                    "fecha_entrada": ed_str,
                    "fecha_salida": d_str,
                    "precio_entrada": round(entry_price, 4),
                    "precio_salida": round(price, 4),
                    "resultado_pct": round(pct, 2),
                }
            )
            shares = 0.0
            entry_i = None
            entry_price = 0.0

        if shares == 0 and cash > 0 and bool(buy_sig.iloc[i]):
            shares = cash / price
            entry_i = i
            entry_price = price
            cash = 0.0

        eq = cash + shares * price
        equity_curve.append({"date": d_str, "equity": round(eq, 2)})

    if shares > 0 and entry_i is not None:
        price = float(close.iloc[-1])
        cash = shares * price
        pct = (price / entry_price - 1.0) * 100.0 if entry_price else 0.0
        ed = idx_dates[entry_i]
        ed_str = ed.strftime("%Y-%m-%d") if hasattr(ed, "strftime") else str(ed)[:10]
        ld = idx_dates[-1]
        ld_str = ld.strftime("%Y-%m-%d") if hasattr(ld, "strftime") else str(ld)[:10]
        trades.append(
            {
                "fecha_entrada": ed_str,
                "fecha_salida": ld_str,
                "precio_entrada": round(entry_price, 4),
                "precio_salida": round(price, 4),
                "resultado_pct": round(pct, 2),
            }
        )

    final_eq = equity_curve[-1]["equity"] if equity_curve else float(capital)
    return trades, equity_curve, float(final_eq)


def _max_drawdown(equity: list[dict[str, Any]]) -> float:
    peak = -1.0
    max_dd = 0.0
    for pt in equity:
        v = float(pt.get("equity") or 0)
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak * 100.0
            if dd > max_dd:
                max_dd = dd
    return round(max_dd, 2)


@router.post("/backtest")
def market_backtest(body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    ticker = normalize_ticker(str(body.get("ticker") or "").strip())
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker requerido")
    estrategia = str(body.get("estrategia") or "rsi30")
    periodo = str(body.get("periodo") or "1Y")
    capital = _safe_float(body.get("capital"))
    if capital is None or capital <= 0:
        capital = 10000.0

    spec = {"1Y": ("1y", "1d"), "3Y": ("3y", "1d"), "5Y": ("5y", "1d")}.get(periodo)
    if not spec:
        raise HTTPException(status_code=400, detail="periodo debe ser 1Y, 3Y o 5Y")

    per, interval = spec
    tk = yf.Ticker(ticker)
    hist = tk.history(period=per, interval=interval)
    if hist is None or hist.empty or len(hist) < 40:
        raise HTTPException(status_code=404, detail="Sin histórico suficiente para backtest")

    buy_sig = _buy_signals(hist, estrategia)
    trades, equity_curve, final_eq = _simulate_backtest(hist, buy_sig, capital)
    wins = [t for t in trades if t["resultado_pct"] > 0]
    losses = [t for t in trades if t["resultado_pct"] <= 0]
    win_rate = (len(wins) / len(trades) * 100.0) if trades else 0.0
    avg_gain = sum(t["resultado_pct"] for t in wins) / len(wins) if wins else 0.0
    avg_loss = sum(t["resultado_pct"] for t in losses) / len(losses) if losses else 0.0
    ret_total = (final_eq / capital - 1.0) * 100.0 if capital else 0.0
    mdd = _max_drawdown(equity_curve)

    summary = {
        "retorno_total_pct": round(ret_total, 2),
        "win_rate_pct": round(win_rate, 2),
        "avg_gain_pct": round(avg_gain, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "max_drawdown_pct": mdd,
        "trades_totales": len(trades),
        "capital_final": round(final_eq, 2),
    }

    blob = {
        "ticker": ticker,
        "estrategia": estrategia,
        "periodo": periodo,
        "capital_inicial": capital,
        "summary": summary,
        "trades": trades,
        "equity_curve": equity_curve,
        "analisis_ia": "",
    }

    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if key:
        try:
            client = Anthropic(api_key=key)
            prompt = (
                "Sos quant senior. Con este backtest (JSON resumen + últimos trades), "
                "respondé: ¿Esta estrategia parece funcionar? ¿Es confiable? Sé breve, español, 2-3 párrafos.\n\n"
                + json.dumps(
                    {"summary": summary, "muestra_trades": trades[-8:]},
                    ensure_ascii=False,
                    indent=2,
                )
            )
            msg = client.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=700,
                messages=[{"role": "user", "content": prompt}],
            )
            out = ""
            for b in msg.content:
                if b.type == "text":
                    out += b.text
            blob["analisis_ia"] = out.strip()
        except Exception:
            blob["analisis_ia"] = "No se pudo generar interpretación IA en este momento."

    return blob


def _parse_insider_df(df: pd.DataFrame) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if df is None or df.empty:
        return out
    dfx = df.reset_index()
    cols = {str(c).lower(): c for c in dfx.columns}

    def col(*cands: str) -> str | None:
        for c in cands:
            for k, v in cols.items():
                if c in k:
                    return v
        return None

    c_date = col("date", "start")
    c_name = col("insider", "filer")
    c_title = col("position", "relationship", "title")
    c_action = col("transaction", "type")
    c_shares = col("shares", "securities")
    c_value = col("value")

    for _, row in dfx.iterrows():
        dt_str = ""
        if c_date and row.get(c_date) is not None:
            try:
                dt_str = pd.Timestamp(row.get(c_date)).strftime("%Y-%m-%d")
            except Exception:
                dt_str = str(row.get(c_date))[:10]
        name = str(row.get(c_name, "")) if c_name else ""
        title = str(row.get(c_title, "")) if c_title else ""
        action = str(row.get(c_action, "Transaction")) if c_action else "Transaction"
        shares_v = _safe_float(row.get(c_shares)) if c_shares else None
        value_v = _safe_float(row.get(c_value)) if c_value else None
        out.append(
            {
                "name": name or "—",
                "title": title or "—",
                "date": dt_str or "—",
                "action": action,
                "shares": int(shares_v) if shares_v is not None else None,
                "value": value_v,
            }
        )
    return out[:80]


@router.get("/insiders/{symbol:path}")
def market_insiders(symbol: str) -> dict[str, Any]:
    sym = normalize_ticker(symbol.strip())
    if not sym:
        raise HTTPException(status_code=400, detail="ticker requerido")
    t = yf.Ticker(sym)
    trades: list[dict[str, Any]] = []
    try:
        df = getattr(t, "insider_transactions", None)
        if df is not None and hasattr(df, "empty") and not df.empty:
            trades = _parse_insider_df(df)
    except Exception:
        trades = []

    cutoff = datetime.now(timezone.utc) - timedelta(days=183)
    buys_6m = 0
    sells_6m = 0
    for tr in trades:
        ds = tr.get("date") or ""
        try:
            if len(ds) >= 10:
                d = datetime.strptime(ds[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if d < cutoff:
                    continue
        except Exception:
            continue
        act = str(tr.get("action") or "").lower()
        if "buy" in act or "purchase" in act or "acquisition" in act:
            buys_6m += 1
        elif "sale" in act or "sell" in act or "disposition" in act:
            sells_6m += 1

    if buys_6m > sells_6m:
        sentiment = "bullish"
    elif sells_6m > buys_6m:
        sentiment = "bearish"
    else:
        sentiment = "neutral"

    return {
        "ticker": sym,
        "insider_trades": trades,
        "summary": {
            "total_buys_6m": buys_6m,
            "total_sells_6m": sells_6m,
            "net_sentiment": sentiment,
        },
    }


@router.post("/insiders/interpret")
def insiders_interpret(body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return {"analisis": "Configurá ANTHROPIC_API_KEY para análisis IA de insiders."}
    try:
        client = Anthropic(api_key=key)
        prompt = (
            "Basándote en este JSON de transacciones de insiders y el resumen, "
            "respondé en español: ¿Los insiders están comprando o vendiendo? "
            "Un párrafo + una frase de riesgo.\n\n"
            + json.dumps(body, ensure_ascii=False, indent=2)[:12000]
        )
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = ""
        for b in msg.content:
            if b.type == "text":
                text += b.text
        return {"analisis": text.strip()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e)) from e


def _next_earnings_one(sym: str) -> dict[str, Any] | None:
    try:
        t = yf.Ticker(sym)
        info = t.info or {}
        nombre = str(info.get("shortName") or info.get("longName") or sym)
        fe: date | None = None
        ts = info.get("earningsTimestamp") or info.get("earningsCallTimestampStart")
        if ts is not None:
            try:
                fe = datetime.fromtimestamp(int(ts), tz=timezone.utc).date()
            except Exception:
                fe = None
        if fe is None:
            try:
                ed = t.earnings_dates
                if ed is not None and not ed.empty:
                    for ix in ed.index:
                        try:
                            d = pd.Timestamp(ix).date()
                            if d >= date.today():
                                fe = d
                                break
                        except Exception:
                            continue
            except Exception:
                pass
        if fe is None:
            return None
        dias = (fe - date.today()).days
        eps_est = _safe_float(
            info.get("forwardEps") or info.get("epsForward") or info.get("targetMeanPrice")
        )
        eps_prev = _safe_float(info.get("trailingEps"))
        rev_est = _safe_float(info.get("totalRevenue"))
        return {
            "ticker": sym,
            "nombre": nombre,
            "fecha": fe.isoformat(),
            "dias_para": int(dias),
            "eps_estimado": eps_est,
            "eps_anterior": eps_prev,
            "revenue_estimado": rev_est,
        }
    except Exception:
        return None


@router.get("/earnings-calendar")
def market_earnings_calendar() -> dict[str, Any]:
    now = time.time()
    hit = _EARNINGS_CACHE.get("payload")
    ts = float(_EARNINGS_CACHE.get("ts") or 0.0)
    if hit is not None and now - ts < _EARNINGS_TTL_SEC:
        return copy.deepcopy(hit)

    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for row in ex.map(_next_earnings_one, FEATURES_UNIVERSE):
            if row is not None:
                rows.append(row)
    rows.sort(key=lambda r: (r.get("fecha") or "", r.get("ticker") or ""))
    payload = {"proximos_earnings": rows}
    _EARNINGS_CACHE["ts"] = now
    _EARNINGS_CACHE["payload"] = copy.deepcopy(payload)
    return copy.deepcopy(payload)


def _heatmap_one(sym: str) -> dict[str, Any] | None:
    try:
        tk = yf.Ticker(sym)
        info = tk.info or {}
        name = str(info.get("shortName") or info.get("longName") or sym)
        sector = str(info.get("sector") or "Other")
        mc = _safe_float(info.get("marketCap"))
        chg = _safe_float(
            info.get("regularMarketChangePercent")
            or info.get("postMarketChangePercent")
        )
        if chg is None:
            hist = tk.history(period="5d", interval="1d")
            if hist is not None and not hist.empty and len(hist) > 1:
                c = hist["Close"].astype(float)
                chg = (float(c.iloc[-1]) / float(c.iloc[-2]) - 1.0) * 100.0
        price = _safe_float(
            info.get("currentPrice") or info.get("regularMarketPrice")
        )
        if chg is None:
            chg = 0.0
        if price is None:
            price = 0.0
        return {
            "ticker": sym,
            "name": name,
            "sector": sector,
            "changePct": round(chg or 0.0, 2),
            "marketCap": mc or 0.0,
            "price": round(price or 0.0, 4),
        }
    except Exception:
        return None


@router.get("/heatmap")
def market_heatmap() -> dict[str, Any]:
    now = time.time()
    hit = _HEATMAP_CACHE.get("payload")
    ts = float(_HEATMAP_CACHE.get("ts") or 0.0)
    if hit is not None and now - ts < _HEATMAP_TTL_SEC:
        return copy.deepcopy(hit)

    flat: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for row in ex.map(_heatmap_one, FEATURES_UNIVERSE):
            if row is not None:
                flat.append(row)
    sectors: dict[str, list[dict[str, Any]]] = {}
    for r in flat:
        sec = r.get("sector") or "Other"
        sectors.setdefault(sec, []).append(r)
    payload = {"sectors": sectors}
    _HEATMAP_CACHE["ts"] = now
    _HEATMAP_CACHE["payload"] = copy.deepcopy(payload)
    return copy.deepcopy(payload)


@router.get("/screener/sectors")
def screener_sectors() -> dict[str, Any]:
    rows = _screener_universe_rows()
    secs = sorted({str(r.get("sector") or "Unknown") for r in rows})
    return {"sectors": secs}
