"""Price alerts — almacenamiento local en JSON."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ALERTS_FILE = DATA_DIR / "alerts.json"


class AlertCreate(BaseModel):
    symbol: str = Field(..., min_length=1)
    target_price: float = Field(..., description="Precio objetivo")
    direction: str = Field("above", description="above o below")


class AlertItem(BaseModel):
    id: str
    symbol: str
    target_price: float
    direction: str
    created_at: str
    active: bool = True


def _load() -> list[dict]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not ALERTS_FILE.is_file():
        return []
    try:
        raw = ALERTS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save(items: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ALERTS_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")


@router.get("/", response_model=list[AlertItem])
def list_alerts() -> list[AlertItem]:
    return [AlertItem(**x) for x in _load() if x.get("active", True)]


@router.post("/", response_model=AlertItem)
def create_alert(body: AlertCreate) -> AlertItem:
    if body.direction not in ("above", "below"):
        raise HTTPException(status_code=400, detail="direction debe ser above o below")
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "id": str(uuid.uuid4()),
        "symbol": body.symbol.strip().upper(),
        "target_price": body.target_price,
        "direction": body.direction,
        "created_at": now,
        "active": True,
    }
    all_items = _load()
    all_items.append(item)
    _save(all_items)
    return AlertItem(**item)


@router.delete("/{alert_id}")
def delete_alert(alert_id: str) -> dict[str, str]:
    items = _load()
    new_items = [x for x in items if x.get("id") != alert_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    _save(new_items)
    return {"status": "ok", "id": alert_id}
