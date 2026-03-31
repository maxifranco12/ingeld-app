"""AI analysis via Anthropic Claude."""

from __future__ import annotations

import json
import math
import os
import re
from typing import Any, Optional

from anthropic import Anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# Promedios sectoriales (referencia)
SECTOR_PE_PB_PS: dict[str, tuple[float, float, float]] = {
    "technology": (28.0, 6.0, 5.0),
    "financial services": (12.0, 1.2, 2.0),
    "financial": (12.0, 1.2, 2.0),
    "energy": (14.0, 1.5, 1.5),
    "healthcare": (22.0, 3.0, 3.0),
    "health care": (22.0, 3.0, 3.0),
    "consumer cyclical": (20.0, 4.0, 1.5),
    "industrials": (18.0, 3.0, 1.5),
    "utilities": (16.0, 1.5, 2.0),
}
DEFAULT_SECTOR = (18.0, 2.5, 2.0)


def _sector_multiples(sector: str | None) -> tuple[float, float, float, str]:
    if not sector or not str(sector).strip():
        return (*DEFAULT_SECTOR, "Default")
    s = str(sector).lower().strip()
    for key, vals in SECTOR_PE_PB_PS.items():
        if key in s or s in key:
            return (*vals, sector.strip())
    for key, vals in SECTOR_PE_PB_PS.items():
        parts = key.split()
        if parts and parts[0] in s:
            return (*vals, sector.strip())
    return (*DEFAULT_SECTOR, "Default")


def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except (TypeError, ValueError):
        return None


def compute_relative_multiples(fund: dict[str, Any]) -> dict[str, Any]:
    sector = fund.get("sector")
    pe_s, pb_s, ps_s, ref_label = _sector_multiples(
        str(sector) if sector is not None else None
    )
    pe = _safe_float(fund.get("pe_ratio") or fund.get("trailingPE"))
    pb = _safe_float(fund.get("pb_ratio") or fund.get("priceToBook"))
    ps = _safe_float(fund.get("ps_ratio") or fund.get("priceToSalesTrailing12Months"))

    def desc(ref: float, act: float | None) -> float | None:
        if act is None or ref <= 0 or act <= 0:
            return None
        return (ref - act) / ref * 100.0

    d_pe = desc(pe_s, pe)
    d_pb = desc(pb_s, pb)
    d_ps = desc(ps_s, ps)
    vals = [x for x in (d_pe, d_pb, d_ps) if x is not None]
    prom = sum(vals) / len(vals) if vals else None

    if prom is None:
        rel = "Sin datos suficientes para múltiplos"
    elif prom > 5:
        rel = "Con descuento vs sector (múltiplos)"
    elif prom < -5:
        rel = "Con prima vs sector (múltiplos)"
    else:
        rel = "Alineado con sector (múltiplos)"

    return {
        "sector_referencia": ref_label,
        "referencia_pe": pe_s,
        "referencia_pb": pb_s,
        "referencia_ps": ps_s,
        "descuento_pe": d_pe,
        "descuento_pb": d_pb,
        "descuento_ps": d_ps,
        "promedio_descuento": prom,
        "valuacion_relativa": rel,
    }


def compute_dcf_simple(fund: dict[str, Any], precio: float) -> dict[str, Any]:
    fcf = _safe_float(fund.get("free_cash_flow") or fund.get("freeCashflow"))
    mc = _safe_float(fund.get("market_cap") or fund.get("marketCap"))
    rg = _safe_float(fund.get("revenue_growth") or fund.get("revenueGrowth"))
    g = rg if rg is not None and rg > -0.5 else 0.10
    g = max(-0.2, min(0.35, g))
    r = 0.10
    g_t = 0.03

    if fcf is None or fcf <= 0 or precio <= 0:
        return {
            "disponible": False,
            "mensaje": "datos insuficientes",
            "valor_intrinseco": None,
            "precio_actual": precio,
            "upside_dcf": None,
            "confianza_dcf": "Baja",
        }

    if mc is None or mc <= 0:
        return {
            "disponible": False,
            "mensaje": "datos insuficientes (sin market cap)",
            "valor_intrinseco": None,
            "precio_actual": precio,
            "upside_dcf": None,
            "confianza_dcf": "Baja",
        }

    shares = mc / precio
    if shares <= 0:
        return {
            "disponible": False,
            "mensaje": "datos insuficientes",
            "valor_intrinseco": None,
            "precio_actual": precio,
            "upside_dcf": None,
            "confianza_dcf": "Baja",
        }

    pv = 0.0
    fcf_n = fcf
    for t in range(1, 6):
        fcf_n = fcf * (1 + g) ** t
        pv += fcf_n / (1 + r) ** t

    fcf_5 = fcf * (1 + g) ** 5
    tv = fcf_5 * (1 + g_t) / (r - g_t) if (r - g_t) > 0 else 0.0
    pv_tv = tv / (1 + r) ** 5
    ev = pv + pv_tv
    vi_per_share = ev / shares
    upside = (vi_per_share - precio) / precio * 100.0 if precio > 0 else None

    conf = "Media"
    if abs(upside or 0) > 40:
        conf = "Baja"
    elif abs(upside or 0) < 15:
        conf = "Alta"

    return {
        "disponible": True,
        "mensaje": None,
        "valor_intrinseco": round(vi_per_share, 6),
        "precio_actual": precio,
        "upside_dcf": round(upside, 2) if upside is not None else None,
        "confianza_dcf": conf,
        "fcf_base": fcf,
        "crecimiento_usado": g,
        "valor_empresa_estimado": round(ev, 2),
    }


def compute_ddm(fund: dict[str, Any], precio: float) -> dict[str, Any]:
    dy = _safe_float(fund.get("dividend_yield") or fund.get("dividendYield"))
    if dy is None or dy <= 0 or precio <= 0:
        return {"aplicable": False, "valor_ddm": None, "upside_ddm": None}

    d0 = precio * dy
    g = 0.05
    r = 0.10
    if r - g <= 0:
        return {"aplicable": False, "valor_ddm": None, "upside_ddm": None}
    d1 = d0 * (1 + g)
    p_ddm = d1 / (r - g)
    upside = (p_ddm - precio) / precio * 100.0
    return {
        "aplicable": True,
        "valor_ddm": round(p_ddm, 6),
        "upside_ddm": round(upside, 2),
        "dividendo_implicito_d0": round(d0, 6),
    }


def build_modelos_valuacion(fund: dict[str, Any], precio: float) -> dict[str, Any]:
    return {
        "relative_multiples": compute_relative_multiples(fund),
        "dcf": compute_dcf_simple(fund, precio),
        "ddm": compute_ddm(fund, precio),
    }


SYSTEM_DARIO = """Sos Darío, analista financiero senior con 20 años de experiencia en mercados argentinos y globales. Tu trabajo es ayudar a inversores a tomar decisiones concretas.
Nunca decís "depende" o "consulte a su asesor". Siempre das una señal clara y accionable.
Tenés acceso a: indicadores técnicos, fundamentals reales, modelos de valuación (DCF, múltiples relativos, DDM) y contexto macro/noticias cuando se provee.
Respondé en español. Usá los números de modelos_valuacion para fundamentar tu análisis, sin contradecirlos sin justificación."""


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
    tecnico: Optional[dict[str, Any]] = None
    contexto_noticias: Optional[str] = None


class FundamentalAnalysisResponse(BaseModel):
    valuacion: str
    confianza: str
    score_salud: int
    score_tecnico: int = 5
    score_fundamental: int = 5
    score_noticias: int = 5
    score_total: int = 5
    señal: str = "MANTENER"
    precio_entrada_sugerido: Optional[float] = None
    precio_objetivo: Optional[float] = None
    stop_loss_sugerido: Optional[float] = None
    horizonte: str = ""
    fortalezas: list[str]
    riesgos: list[str]
    catalizadores: list[str] = Field(default_factory=list)
    resumen: str
    accion_concreta: str = ""
    modelos_valuacion: dict[str, Any] = Field(default_factory=dict)


def _clamp_int(x: Any, default: int = 5) -> int:
    try:
        v = int(x)
    except (TypeError, ValueError):
        return default
    return max(1, min(10, v))


def _norm_signal(s: str) -> str:
    u = (s or "").strip().upper()
    if u in ("COMPRAR", "VENDER", "MANTENER", "ESPERAR"):
        return u
    return "MANTENER"


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

    fund = req.fundamentals or {}
    modelos = build_modelos_valuacion(fund, req.precio_actual)

    fund_block = json.dumps(fund, ensure_ascii=False, indent=2)[:12000]
    modelos_block = json.dumps(modelos, ensure_ascii=False, indent=2)[:8000]
    tech_block = json.dumps(req.tecnico or {}, ensure_ascii=False, indent=2)[:4000]
    news_ctx = (req.contexto_noticias or "").strip()[:6000]

    user_prompt = f"""Activo: {ticker}
Precio actual de mercado: {req.precio_actual}

Fundamentals (JSON):
{fund_block}

Modelos de valuación calculados (usá estos datos en tu análisis):
{modelos_block}

Indicadores técnicos (JSON):
{tech_block}

Resumen de contexto de noticias / macro (si hay):
{news_ctx if news_ctx else "(no provisto)"}

Instrucciones:
1) Integrá los tres modelos (múltiples relativos, DCF, DDM si aplica) con el precio actual y el sector.
2) Completá los scores 1-10 de forma coherente con datos y modelos.
3) score_total debe ser un síntesis ponderada (no promedio mecánico obligatorio, pero coherente).
4) señal: COMPRAR, VENDER, MANTENER o ESPERAR — una sola, clara.
5) precio_entrada_sugerido, precio_objetivo, stop_loss_sugerido: números o null si no aplica.
6) horizonte: una de estas opciones exactas: "Corto plazo (días)" | "Swing (semanas)" | "Largo plazo (meses)".
7) catalizadores: 2 a 5 bullets de catalizadores a monitorear.
8) accion_concreta: una sola oración imperativa para el inversor.
9) resumen: 3 a 4 párrafos, tono analista senior.

Respondé SOLO con JSON válido (sin markdown), forma exacta:
{{
  "valuacion": "INFRAVALORADA|JUSTA|SOBREVALORADA",
  "confianza": "Alta|Media|Baja",
  "score_salud": 6,
  "score_tecnico": 6,
  "score_fundamental": 6,
  "score_noticias": 6,
  "score_total": 6,
  "señal": "COMPRAR|VENDER|MANTENER|ESPERAR",
  "precio_entrada_sugerido": null,
  "precio_objetivo": null,
  "stop_loss_sugerido": null,
  "horizonte": "Swing (semanas)",
  "fortalezas": ["..."],
  "riesgos": ["..."],
  "catalizadores": ["..."],
  "resumen": "...",
  "accion_concreta": "..."
}}
"""

    try:
        client = Anthropic(api_key=key)
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=8192,
            system=SYSTEM_DARIO,
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

    score = _clamp_int(data.get("score_salud"), 5)

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

    cat = data.get("catalizadores") or []
    if not isinstance(cat, list):
        cat = []

    def _f(x: Any) -> Optional[float]:
        if x is None:
            return None
        try:
            v = float(x)
            if math.isnan(v) or math.isinf(v):
                return None
            return v
        except (TypeError, ValueError):
            return None

    senal_raw = data.get("señal") if "señal" in data else data.get("senal")
    return FundamentalAnalysisResponse(
        valuacion=val,
        confianza=conf,
        score_salud=score,
        score_tecnico=_clamp_int(data.get("score_tecnico"), 5),
        score_fundamental=_clamp_int(data.get("score_fundamental"), 5),
        score_noticias=_clamp_int(data.get("score_noticias"), 5),
        score_total=_clamp_int(data.get("score_total"), 5),
        señal=_norm_signal(str(senal_raw or "MANTENER")),
        precio_entrada_sugerido=_f(data.get("precio_entrada_sugerido")),
        precio_objetivo=_f(data.get("precio_objetivo")),
        stop_loss_sugerido=_f(data.get("stop_loss_sugerido")),
        horizonte=str(data.get("horizonte") or "").strip() or "Swing (semanas)",
        fortalezas=[str(x) for x in fort if str(x).strip()][:8],
        riesgos=[str(x) for x in ries if str(x).strip()][:8],
        catalizadores=[str(x) for x in cat if str(x).strip()][:8],
        resumen=str(data.get("resumen") or "").strip() or "(Sin resumen)",
        accion_concreta=str(data.get("accion_concreta") or "").strip(),
        modelos_valuacion=modelos,
    )
