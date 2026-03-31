"""Alertas de precio/RSI en memoria (sin persistencia en disco)."""

from __future__ import annotations

from typing import Any, Optional

import os
import resend
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from auth_middleware import decode_token_payload
from database import SessionLocal, User
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
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    token: Optional[str] = None


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
    uid = body.user_id
    uemail = body.user_email
    if body.token:
        try:
            payload = decode_token_payload(body.token)
            uid = int(str(payload.get("sub") or "0") or 0)
        except Exception:
            uid = body.user_id
    if uid and not uemail:
        db = SessionLocal()
        try:
            u = db.query(User).filter(User.id == uid).first()
            if u:
                uemail = u.email
        finally:
            db.close()
    item: dict[str, Any] = {
        "id": aid,
        "ticker": t,
        "tipo": tipo,
        "valor": float(body.valor),
        "estado": "activa",
        "user_id": uid,
        "user_email": uemail,
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
            email = str(a.get("user_email") or "").strip()
            if email:
                resend_key = (os.getenv("RESEND_API_KEY") or "").strip()
                if resend_key:
                    resend.api_key = resend_key
                    app_url = os.getenv("APP_URL", "http://localhost:5173")
                    html = f"""<!doctype html><html><body style="margin:0;background:#faf6f0;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid rgba(0,168,122,.18);border-radius:12px;overflow:hidden">
<div style="background:#00a87a;color:#fff;padding:14px 18px;font-weight:700">INGELD</div>
<div style="padding:18px">
<h2 style="margin:0 0 8px;color:#1a1c20">Tu alerta se disparó</h2>
<p style="margin:0 0 10px;color:#5c5f66">Ticker</p>
<p style="font-size:28px;font-weight:700;color:#00a87a;margin:0 0 12px">{sym}</p>
<p style="margin:0 0 6px;color:#1a1c20"><strong>Tipo:</strong> {tipo}</p>
<p style="margin:0 0 6px;color:#1a1c20"><strong>Valor alerta:</strong> {valor}</p>
<p style="margin:0 0 14px;color:#1a1c20"><strong>Precio actual:</strong> {price}</p>
<a href="{app_url}/activo/{sym}" style="display:inline-block;background:#00a87a;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px">Ver activo</a>
<p style="margin-top:16px;color:#8a8d94;font-size:12px">Este servicio es informativo y no constituye asesoramiento financiero.</p>
</div></div></body></html>"""
                    try:
                        resend.Emails.send(
                            {
                                "from": os.getenv("RESEND_FROM", "noreply@ingeld.app"),
                                "to": [email],
                                "subject": f"⚡ Alerta INGELD: {sym} llegó a tu precio",
                                "html": html,
                            }
                        )
                    except Exception:
                        pass
    return {"disparadas": disparadas, "total_verificadas": total_verificadas}


@router.get("/whoami")
def whoami(token: str) -> dict[str, Any]:
    payload = decode_token_payload(token)
    uid = int(str(payload.get("sub") or "0") or 0)
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == uid).first()
        if not u:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        return {"id": u.id, "email": u.email}
    finally:
        db.close()
