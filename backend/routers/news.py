"""Noticias y análisis con IA (Claude) por activo."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from anthropic import Anthropic
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import requests
import yfinance as yf

from routers.market import fundamentals_from_info, normalize_ticker

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
NEWS_API_KEY = os.getenv("NEWS_API_KEY", "42dd9470a9dc46ed97c814b106ccd257")
ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_KEY", "")

router = APIRouter()


class NoticiaItem(BaseModel):
    titulo: str
    fecha: str
    url: str
    fuente: str = ""
    descripcion: str = ""
    impacto: str = Field(..., description="POSITIVO|NEGATIVO|NEUTRO")
    es_fundamental: bool
    analisis: str


class NewsResponse(BaseModel):
    noticias: list[NoticiaItem]
    resumen_macro: str
    oportunidad: bool
    razon_oportunidad: str


def _extract_json(text: str) -> dict[str, Any]:
    t = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if m:
        t = m.group(1).strip()
    return json.loads(t)


def _tickers_match(sym: str, av_ticker: str) -> bool:
    """Coincide símbolo pedido con ticker de Alpha Vantage (p. ej. BMA.BA vs BMA)."""
    a = (sym or "").strip().upper()
    b = (av_ticker or "").strip().upper()
    if not a or not b:
        return False
    if a == b:
        return True
    a_base = re.sub(r"\.BA$", "", a)
    b_base = re.sub(r"\.BA$", "", b)
    if a_base == b_base and (a_base or b_base):
        return True
    return False


def _av_time_published_to_iso(s: str) -> str:
    """Alpha Vantage: '20240330T123456' -> ISO 8601."""
    raw = (s or "").strip()
    if len(raw) >= 15 and "T" in raw:
        try:
            dt = datetime.strptime(raw[:15], "%Y%m%dT%H%M%S")
            return dt.replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return raw


def _news_from_alphavantage(ticker: str, api_key: str) -> list[dict[str, Any]]:
    """NEWS_SENTIMENT como fuente principal; filtra por relevance_score > 0.3 para el ticker."""
    sym = (ticker or "").strip()
    if not sym or not api_key.strip():
        return []

    url = "https://www.alphavantage.co/query"
    params: dict[str, Any] = {
        "function": "NEWS_SENTIMENT",
        "tickers": sym,
        "limit": 10,
        "sort": "LATEST",
        "apikey": api_key.strip(),
    }
    try:
        print(f"Alpha Vantage NEWS_SENTIMENT: tickers={sym}", file=sys.stderr)
        res = requests.get(url, params=params, timeout=20)
        res.raise_for_status()
        data = res.json()
    except Exception as e:
        print(f"Alpha Vantage error: {e!s}", file=sys.stderr)
        return []

    if not isinstance(data, dict):
        return []
    if data.get("Note") or data.get("Information"):
        print(
            f"Alpha Vantage aviso: {data.get('Note') or data.get('Information')}",
            file=sys.stderr,
        )
        return []

    feed = data.get("feed")
    if not isinstance(feed, list):
        return []

    out: list[dict[str, Any]] = []
    for article in feed:
        if not isinstance(article, dict):
            continue
        ts_list = article.get("ticker_sentiment")
        if not isinstance(ts_list, list):
            continue
        relevant = False
        for ts in ts_list:
            if not isinstance(ts, dict):
                continue
            t_sym = str(ts.get("ticker") or "").strip()
            try:
                rel = float(ts.get("relevance_score") or 0.0)
            except (TypeError, ValueError):
                rel = 0.0
            if rel <= 0.3:
                continue
            if _tickers_match(sym, t_sym):
                relevant = True
                break
        if not relevant:
            continue

        title = str(article.get("title") or "").strip()
        link = str(article.get("url") or "").strip()
        if not title or not link:
            continue

        src = str(article.get("source") or "").strip()
        summary = str(article.get("summary") or "").strip()
        tp = str(article.get("time_published") or "").strip()

        out.append(
            {
                "titulo": title,
                "fecha": _av_time_published_to_iso(tp),
                "url": link,
                "fuente": src or "—",
                "descripcion": summary,
            }
        )
        if len(out) >= 10:
            break

    print(f"Alpha Vantage: {len(out)} noticias tras filtro de relevancia", file=sys.stderr)
    return out


def _shortname_to_argentina_query(short_name: str) -> str:
    """Ej.: 'BANCO MACRO S.A.' -> 'Banco Macro Argentina'."""
    if not short_name or not str(short_name).strip():
        return ""
    s = str(short_name).strip()
    s = re.sub(
        r"\s*,?\s*("
        r"S\.?\s*A\.?|S\.A\.U\.C\.|S\.A\.I\.C\.|S\.C\.A\.|"
        r"SOCIEDAD\s+AN[OÓ]NIMA|SOCIEDAD\s+ANONIMA|"
        r"Y\s+C\.|INC\.?|CORP\.?|LIMITADA|LTD\.?)\s*\.?\s*$",
        "",
        s,
        flags=re.I,
    )
    s = re.sub(r"\s+", " ", s).strip(" ,.")
    if not s:
        return ""
    words = s.split()
    titled = " ".join(w[:1].upper() + w[1:].lower() if w.isupper() else w for w in words)
    return f"{titled} Argentina"


def _newsapi_fetch_articles(
    api_key: str,
    q: str,
    *,
    language: str,
    sort_by: str = "publishedAt",
    page_size: int = 15,
) -> list[dict[str, Any]]:
    url = "https://newsapi.org/v2/everything"
    from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    params: dict[str, Any] = {
        "q": q.strip(),
        "language": language,
        "sortBy": sort_by,
        "pageSize": page_size,
        "from": from_date,
        "apiKey": api_key,
    }
    try:
        print(
            f"NewsAPI búsqueda [{language}]: {params.get('q', '')}",
            file=sys.stderr,
        )
        res = requests.get(url, params=params, timeout=12)
        res.raise_for_status()
        j = res.json()
        articles = j.get("articles") or []
        print(f"NewsAPI resultado: {len(articles)} artículos", file=sys.stderr)
        return [a for a in articles if isinstance(a, dict)]
    except Exception:
        print("NewsAPI resultado: 0 artículos", file=sys.stderr)
        return []


def _articles_to_rows(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in articles:
        title = str(n.get("title") or "").strip()
        link = str(n.get("url") or "").strip()
        source = n.get("source") if isinstance(n.get("source"), dict) else {}
        pub = str((source or {}).get("name") or "").strip()
        fecha_iso = str(n.get("publishedAt") or "").strip()
        desc = str(n.get("description") or "").strip()
        out.append(
            {
                "titulo": title,
                "fecha": fecha_iso,
                "url": link,
                "fuente": pub or "—",
                "descripcion": desc,
            }
        )
    return out


def _merge_dedupe_rows(
    batches: list[list[dict[str, Any]]],
    *,
    limit: int = 10,
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    dedup: list[dict[str, Any]] = []
    for batch in batches:
        for row in batch:
            k = (row.get("url") or "").strip().lower()
            if not k or k in seen:
                continue
            seen.add(k)
            if row.get("titulo"):
                dedup.append(row)
            if len(dedup) >= limit:
                return dedup
    return dedup


def _news_from_newsapi(
    company_name: str,
    ticker: str,
    api_key: str,
    *,
    short_name: str = "",
) -> list[dict[str, Any]]:
    sym = (ticker or "").strip()
    is_ba = sym.upper().endswith(".BA")

    batches: list[list[dict[str, Any]]] = []

    q_primary = f"{company_name} OR {sym}".strip()
    en_main = _newsapi_fetch_articles(api_key, q_primary, language="en")
    batches.append(_articles_to_rows(en_main))

    if is_ba:
        es_q = _shortname_to_argentina_query(short_name)
        if es_q:
            es_articles = _newsapi_fetch_articles(
                api_key,
                f"{es_q} OR {sym}",
                language="es",
            )
            batches.append(_articles_to_rows(es_articles))

    merged = _merge_dedupe_rows(batches, limit=10)
    if merged:
        return merged

    fb_ticker = _newsapi_fetch_articles(
        api_key,
        sym,
        language="en",
        sort_by="relevancy",
        page_size=10,
    )
    merged = _merge_dedupe_rows([_articles_to_rows(fb_ticker)], limit=10)
    if merged:
        return merged

    if is_ba:
        base = re.sub(r"\.BA$", "", sym, flags=re.I).strip()
        q_ar = f"{base} Argentina"
        for lang in ("es", "en"):
            extra = _newsapi_fetch_articles(api_key, q_ar, language=lang)
            rows = _articles_to_rows(extra)
            merged = _merge_dedupe_rows([rows], limit=10)
            if merged:
                return merged

    return []


@router.get("/{ticker:path}", response_model=NewsResponse)
def news_monitor(ticker: str) -> NewsResponse:
    sym = normalize_ticker((ticker or "").strip())
    if not sym:
        raise HTTPException(status_code=400, detail="ticker requerido")

    yft = yf.Ticker(sym)
    info = yft.info or {}
    fundamentals = fundamentals_from_info(info)
    av_key = (ALPHA_VANTAGE_KEY or "").strip()
    news_key = (NEWS_API_KEY or "").strip()
    if not av_key and not news_key:
        raise HTTPException(
            status_code=503,
            detail="Configurá ALPHA_VANTAGE_KEY y/o NEWS_API_KEY en .env",
        )

    company_name = str(info.get("shortName") or info.get("longName") or sym).strip() or sym
    nombre_corto = str(info.get("shortName") or "").strip()

    raw_items: list[dict[str, Any]] = []
    if av_key:
        raw_items = _news_from_alphavantage(sym, av_key)
    if not raw_items and news_key:
        raw_items = _news_from_newsapi(company_name, sym, news_key, short_name=nombre_corto)

    if not raw_items:
        return NewsResponse(
            noticias=[],
            resumen_macro=(
                "No hay noticias recientes disponibles en fuentes confiables para "
                f"este activo ({sym})."
            ),
            oportunidad=False,
            razon_oportunidad="",
        )

    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY no configurada en .env",
        )

    bloque_noticias = json.dumps(raw_items, ensure_ascii=False, indent=2)[:12000]
    bloque_fund = json.dumps(fundamentals, ensure_ascii=False, indent=2)[:8000]

    prompt = f"""Sos analista financiero senior especializado en análisis fundamental.
Evaluá cada noticia en contexto del negocio real de la empresa, no del ruido del precio de la acción.
Activo: {sym}

Fundamentals (JSON):
{bloque_fund}

Noticias recientes (JSON):
{bloque_noticias}

Tarea:
1) Para cada noticia, evaluá si afecta los FUNDAMENTOS REALES del negocio o es solo RUIDO DE MERCADO (rumores, corto plazo, titular sin sustancia).
2) impacto: POSITIVO, NEGATIVO o NEUTRO según el tono para el precio/negocio.
3) es_fundamental: true si el contenido puede cambiar flujos de caja, deuda, regulación, earnings estructurales, etc.; false si es ruido u oportunidad táctica.
4) analisis: una línea en español.
5) resumen_macro: un párrafo sobre el sentimiento general.
6) oportunidad: true si detectás una posible oportunidad de compra por sobre-reacción del mercado (ruido negativo sin deterioro fundamental, o noticia mal interpretada).
7) razon_oportunidad: breve explicación si oportunidad es true; si no, cadena vacía.

Respondé SOLO con JSON válido (sin markdown) con esta forma exacta:
{{
  "noticias": [
    {{
      "titulo": "mismo título que en la lista",
      "fecha": "misma fecha ISO o string",
      "url": "misma url",
      "impacto": "POSITIVO|NEGATIVO|NEUTRO",
      "es_fundamental": true,
      "analisis": "..."
    }}
  ],
  "resumen_macro": "...",
  "oportunidad": false,
  "razon_oportunidad": ""
}}

Incluí una entrada en "noticias" por cada ítem de entrada, en el mismo orden. Si falta dato, usá cadena vacía."""

    try:
        client = Anthropic(api_key=key)
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = ""
        for block in msg.content:
            if block.type == "text":
                text += block.text
        data = _extract_json(text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo analizar noticias con IA: {e!s}",
        ) from e

    def _norm_imp(x: Any) -> str:
        u = str(x or "NEUTRO").strip().upper()
        if u in ("POSITIVO", "NEGATIVO", "NEUTRO"):
            return u
        return "NEUTRO"

    ai_rows = data.get("noticias") or []
    items: list[NoticiaItem] = []
    for i, r in enumerate(raw_items):
        ai: dict[str, Any] = (
            ai_rows[i]
            if isinstance(ai_rows, list)
            and i < len(ai_rows)
            and isinstance(ai_rows[i], dict)
            else {}
        )
        items.append(
            NoticiaItem(
                titulo=r["titulo"],
                fecha=r["fecha"],
                url=r["url"],
                fuente=str(r.get("fuente") or ""),
                descripcion=str(r.get("descripcion") or ""),
                impacto=_norm_imp(ai.get("impacto")),
                es_fundamental=bool(ai.get("es_fundamental")),
                analisis=str(ai.get("analisis") or "").strip(),
            )
        )

    imp = str(data.get("resumen_macro") or "").strip()
    if not imp:
        imp = "Análisis de noticias completado."

    return NewsResponse(
        noticias=items,
        resumen_macro=imp,
        oportunidad=bool(data.get("oportunidad")),
        razon_oportunidad=str(data.get("razon_oportunidad") or "").strip(),
    )
