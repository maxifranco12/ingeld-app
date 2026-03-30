"""AI analysis via Anthropic Claude."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


class ChatMessage(BaseModel):
    role: str = Field(..., description="user o assistant")
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    system: Optional[str] = Field(
        default=None,
        description="Instrucciones de sistema opcionales",
    )


class ChatResponse(BaseModel):
    reply: str


SYSTEM_DEFAULT = (
    "Sos un analista financiero senior para un inversor argentino. "
    "Respondé en español, con rigor y claridad. "
    "Aclará cuando algo sea opinión o estimación. "
    "Mencioná riesgos de tipo de cambio y regulación cuando aplique."
)


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY no configurada en .env",
        )
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages requerido")

    client = Anthropic(api_key=key)
    api_messages = [
        {"role": m.role, "content": m.content}
        for m in req.messages
        if m.role in ("user", "assistant")
    ]
    if not api_messages or api_messages[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="El último mensaje debe ser del usuario")

    msg = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=4096,
        system=req.system or SYSTEM_DEFAULT,
        messages=api_messages,  # type: ignore[arg-type]
    )
    text = ""
    for block in msg.content:
        if block.type == "text":
            text += block.text
    return ChatResponse(reply=text.strip())


def _extract_json_object(text: str) -> dict[str, Any]:
    t = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if m:
        t = m.group(1).strip()
    return json.loads(t)


class FundamentalAnalysisRequest(BaseModel):
    ticker: str
    fundamentals: dict[str, Any] = Field(default_factory=dict)
    precio_actual: float


class FundamentalAnalysisResponse(BaseModel):
    valuacion: str
    confianza: str
    score_salud: int
    fortalezas: list[str]
    riesgos: list[str]
    resumen: str


@router.post("/fundamental", response_model=FundamentalAnalysisResponse)
def fundamental_analysis(req: FundamentalAnalysisRequest) -> FundamentalAnalysisResponse:
    ticker = (req.ticker or "").strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker requerido")

    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY no configurada en .env",
        )

    fund_block = json.dumps(req.fundamentals, ensure_ascii=False, indent=2)[:14000]
    user_prompt = f"""Activo: {ticker}
Precio actual de mercado: {req.precio_actual}

Fundamentals (JSON, Yahoo Finance / yfinance):
{fund_block}

Instrucciones:
1) Evaluá si la empresa está cara o barata según P/E, P/B, P/S, crecimiento de ingresos y beneficios, y márgenes.
2) Comentá salud financiera: deuda vs patrimonio, márgenes, ROE, flujo de caja libre.
3) Compará cualitativamente con promedios típicos del sector cuando los datos lo permitan (sin inventar cifras).
4) Veredicto final: INFRAVALORADA, JUSTA o SOBREVALORADA (una sola).
5) confianza: Alta, Media o Baja según completitud y coherencia de los datos.
6) score_salud: entero de 1 a 10 (salud financiera global).
7) fortalezas: lista de 2 a 5 frases cortas en español.
8) riesgos: lista de 2 a 5 frases cortas en español.
9) resumen: 3 a 4 párrafos en español, tono analista senior.

Respondé SOLO con JSON válido (sin markdown), forma exacta:
{{
  "valuacion": "INFRAVALORADA|JUSTA|SOBREVALORADA",
  "confianza": "Alta|Media|Baja",
  "score_salud": 6,
  "fortalezas": ["..."],
  "riesgos": ["..."],
  "resumen": "..."
}}
"""

    try:
        client = Anthropic(api_key=key)
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = ""
        for block in msg.content:
            if block.type == "text":
                text += block.text
        data = _extract_json_object(text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Error al generar análisis fundamental: {e!s}",
        ) from e

    raw_score = data.get("score_salud")
    try:
        score = int(raw_score)
    except (TypeError, ValueError):
        score = 5
    score = max(1, min(10, score))

    val = str(data.get("valuacion") or "JUSTA").upper()
    if val not in ("INFRAVALORADA", "JUSTA", "SOBREVALORADA"):
        val = "JUSTA"

    conf = str(data.get("confianza") or "Media")
    if conf not in ("Alta", "Media", "Baja"):
        conf = "Media"

    fort = data.get("fortalezas") or []
    ries = data.get("riesgos") or []
    if not isinstance(fort, list):
        fort = []
    if not isinstance(ries, list):
        ries = []

    return FundamentalAnalysisResponse(
        valuacion=val,
        confianza=conf,
        score_salud=score,
        fortalezas=[str(x) for x in fort if str(x).strip()][:8],
        riesgos=[str(x) for x in ries if str(x).strip()][:8],
        resumen=str(data.get("resumen") or "").strip() or "(Sin resumen)",
    )
