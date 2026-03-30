"""Alertas de precio/RSI en memoria (sin persistencia en disco)."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from routers.market import _safe_quote

router = APIRouter()

_alerts: dict[str, dict[str, Any]] = {}
_alert_counter: int = 0

TIPOS_VALIDOS = frozenset(
    {
        "precio_sube",
        "precio_baja",
        "sube_pct",
        "baja_pct",
        "rsi_alto",
        "rsi_bajo",
    }
)


class AlertCreate(BaseModel):
    ticker: str = Field(..., min_length=1)
    tipo: str
    valor: float


def _eval_condicion(
    tipo: str, valor: float, price: float, change_pct: float, rsi: Optional[float]
) -> bool:
    if tipo == "precio_sube":
        return price >= valor
    if tipo == "precio_baja":
        return price <= valor
    if tipo == "sube_pct":
        return change_pct >= valor
    if tipo == "baja_pct":
        return change_pct <= -valor
    if tipo == "rsi_alto":
        return rsi is not None and rsi > valor
    if tipo == "rsi_bajo":
        return rsi is not None and rsi < valor
    return False


@router.get("/")
def list_alerts() -> dict[str, Any]:
    return {"alerts": list(_alerts.values())}


@router.post("/")
def create_alert(body: AlertCreate) -> dict[str, Any]:
    global _alert_counter
    t = body.ticker.strip().upper()
    tipo = body.tipo.strip()
    if tipo not in TIPOS_VALIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"tipo inválido. Usar uno de: {', '.join(sorted(TIPOS_VALIDOS))}",
        )
    _alert_counter += 1
    aid = str(_alert_counter)
    item: dict[str, Any] = {
        "id": aid,
        "ticker": t,
        "tipo": tipo,
        "valor": float(body.valor),
        "estado": "activa",
    }
    _alerts[aid] = item
    return item


@router.delete("/{alert_id}")
def delete_alert(alert_id: str) -> dict[str, str]:
    if alert_id not in _alerts:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    del _alerts[alert_id]
    return {"status": "ok", "id": alert_id}


@router.get("/check")
def check_alerts() -> dict[str, Any]:
    disparadas: list[dict[str, Any]] = []
    total_verificadas = 0
    for aid, a in list(_alerts.items()):
        if a.get("estado") != "activa":
            continue
        total_verificadas += 1
        sym = str(a.get("ticker", "")).strip()
        q = _safe_quote(sym)
        if q is None:
            continue
        price = float(q["price"])
        change_pct = float(q["changePct"])
        rsi = q.get("rsi")
        rsi_f = float(rsi) if rsi is not None else None
        tipo = str(a.get("tipo", ""))
        valor = float(a.get("valor", 0.0))
        if _eval_condicion(tipo, valor, price, change_pct, rsi_f):
            a["estado"] = "disparada"
            disparadas.append(dict(a))
    return {"disparadas": disparadas, "total_verificadas": total_verificadas}
