"""Noticias y análisis con IA (Claude) por activo."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import yfinance as yf
from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from routers.market import fundamentals_from_info

router = APIRouter()


class NoticiaItem(BaseModel):
    titulo: str
    fecha: str
    url: str
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


def _news_raw_from_yf(ticker: str) -> list[dict[str, Any]]:
    t = yf.Ticker(ticker)
    raw = getattr(t, "news", None) or []
    out: list[dict[str, Any]] = []
    for n in raw[:25]:
        if not isinstance(n, dict):
            continue
        title = str(n.get("title") or "").strip()
        link = str(n.get("link") or n.get("url") or "").strip()
        pub = str(n.get("publisher") or "").strip()
        ts = n.get("providerPublishTime")
        if ts is None and n.get("providerPublishTime") is None:
            ts = n.get("pubDate")
        fecha_iso = ""
        if isinstance(ts, (int, float)):
            try:
                fecha_iso = datetime.fromtimestamp(
                    float(ts), tz=timezone.utc
                ).isoformat()
            except (OSError, OverflowError, ValueError):
                fecha_iso = ""
        elif isinstance(ts, str):
            fecha_iso = ts
        out.append(
            {
                "titulo": title,
                "fecha": fecha_iso,
                "url": link,
                "fuente": pub or "—",
            }
        )
    return [x for x in out if x["titulo"]]


@router.get("/{ticker:path}", response_model=NewsResponse)
def news_monitor(ticker: str) -> NewsResponse:
    sym = (ticker or "").strip()
    if not sym:
        raise HTTPException(status_code=400, detail="ticker requerido")

    yft = yf.Ticker(sym)
    info = yft.info or {}
    fundamentals = fundamentals_from_info(info)
    raw_items = _news_raw_from_yf(sym)

    if not raw_items:
        return NewsResponse(
            noticias=[],
            resumen_macro=(
                "No hay noticias recientes indexadas en Yahoo Finance para "
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

    prompt = f"""Sos analista financiero senior. Activo: {sym}

Fundamentals (JSON):
{bloque_fund}

Noticias recientes (JSON, de Yahoo Finance):
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
