"""Panel administración — requiere is_admin."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth_middleware import AdminUser
from database import User, UserProfile, get_db, utcnow

router = APIRouter()


class AdminUserUpdateBody(BaseModel):
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    plan: Optional[Literal["free", "weekly"]] = None


def _user_list_row(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "email": u.email,
        "username": u.username,
        "plan": u.plan,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None,
    }


@router.get("/users")
def list_users(
    admin: AdminUser,
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    q = db.query(User).order_by(User.id.desc())
    total = q.count()
    offset = (page - 1) * limit
    rows = q.offset(offset).limit(limit).all()
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "users": [_user_list_row(u) for u in rows],
    }


@router.get("/users/{user_id}")
def get_user(
    user_id: int,
    admin: AdminUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    p = db.query(UserProfile).filter(UserProfile.user_id == u.id).first()
    prof = (
        {
            "favoritos": p.favoritos,
            "portfolio": p.portfolio,
            "scanner_tickers": p.scanner_tickers,
        }
        if p
        else None
    )
    return {
        "user": {
            "id": u.id,
            "email": u.email,
            "username": u.username,
            "plan": u.plan,
            "is_active": u.is_active,
            "is_admin": u.is_admin,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login": u.last_login.isoformat() if u.last_login else None,
        },
        "profile": prof,
    }


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    body: AdminUserUpdateBody,
    admin: AdminUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    if u.id == admin.id and body.is_admin is False:
        raise HTTPException(400, "No podés quitarte el rol admin a vos mismo")
    if body.is_active is not None:
        u.is_active = body.is_active
    if body.is_admin is not None:
        u.is_admin = body.is_admin
    if body.plan is not None:
        u.plan = body.plan
    db.commit()
    db.refresh(u)
    return _user_list_row(u)


@router.delete("/users/{user_id}")
def deactivate_user(
    user_id: int,
    admin: AdminUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if user_id == admin.id:
        raise HTTPException(400, "No podés desactivarte a vos mismo")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    u.is_active = False
    db.commit()
    return {"ok": "true"}


@router.get("/stats")
def stats(
    admin: AdminUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    now = utcnow()
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)

    total = db.query(func.count(User.id)).scalar() or 0

    active_7d = (
        db.query(func.count(User.id))
        .filter(User.last_login.isnot(None))
        .filter(User.last_login >= cutoff_7d)
        .scalar()
        or 0
    )

    by_plan_rows = db.query(User.plan, func.count(User.id)).group_by(User.plan).all()
    by_plan = {str(r[0]): int(r[1]) for r in by_plan_rows}

    # Registros por día últimos 30 días (SQLite: date(created_at))
    daily: List[dict[str, Any]] = []
    raw = (
        db.query(
            func.date(User.created_at).label("d"),
            func.count(User.id),
        )
        .filter(User.created_at >= cutoff_30d)
        .group_by(func.date(User.created_at))
        .order_by(func.date(User.created_at))
        .all()
    )
    for d, c in raw:
        daily.append({"date": str(d), "count": int(c)})

    return {
        "total_users": int(total),
        "active_last_7_days": int(active_7d),
        "users_by_plan": by_plan,
        "registrations_per_day": daily,
    }
