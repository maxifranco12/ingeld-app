"""Registro, login, JWT, perfil y recuperación de contraseña."""

from __future__ import annotations

import os
import sys

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET no configurado en .env")

JWT_ALGORITHM = "HS256"

import json
import random
import re
from datetime import date as date_type
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import resend
from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth_middleware import CurrentUser
from database import (
    AnalysisHistory,
    Asset,
    Goal,
    Liability,
    PasswordReset,
    User,
    UserProfile,
    get_db,
    utcnow,
)

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = "INGELD <onboarding@resend.dev>"
resend.api_key = os.getenv("RESEND_API_KEY", "")


def _hash_password(p: str) -> str:
    return pwd_context.hash(p)


def _verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {
        "sub": str(user.id),
        "exp": exp,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _user_short(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "email": u.email,
        "username": u.username,
        "is_admin": u.is_admin,
        "plan": u.plan,
    }


def _user_public(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "email": u.email,
        "username": u.username,
        "is_admin": u.is_admin,
        "plan": u.plan,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None,
    }


class RegisterBody(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=20)
    password: str = Field(..., min_length=8)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8)


class ProfileUpdateBody(BaseModel):
    favoritos: Optional[List[str]] = None
    portfolio: Optional[List[Dict[str, Any]]] = None
    scanner_tickers: Optional[List[str]] = None


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class HistorialCreateBody(BaseModel):
    ticker: str
    tipo: str
    señal: Optional[str] = None
    resumen: str
    score_total: Optional[int] = None


class GoalCreateBody(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    monto_objetivo: float = Field(..., gt=0)
    monto_actual: float = Field(0, ge=0)
    moneda: str = Field("USD", max_length=8)
    fecha_objetivo: Optional[date_type] = None
    color: str = Field("#00a87a", max_length=16)


class GoalUpdateBody(BaseModel):
    nombre: Optional[str] = Field(None, max_length=255)
    monto_objetivo: Optional[float] = Field(None, gt=0)
    monto_actual: Optional[float] = Field(None, ge=0)
    moneda: Optional[str] = Field(None, max_length=8)
    fecha_objetivo: Optional[date_type] = None
    color: Optional[str] = Field(None, max_length=16)


class AssetCreateBody(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    tipo: str = Field(..., min_length=1, max_length=32)
    valor: float = Field(..., ge=0)
    moneda: str = Field("USD", max_length=8)


class LiabilityCreateBody(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    tipo: str = Field(..., min_length=1, max_length=32)
    monto: float = Field(..., ge=0)
    moneda: str = Field("USD", max_length=8)


def _ensure_profile(db: Session, user: User) -> UserProfile:
    p = db.query(UserProfile).filter(UserProfile.user_id == user.id).first()
    if p:
        return p
    p = UserProfile(user_id=user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _parse_json_list(raw: str, default: list[Any]) -> list[Any]:
    try:
        x = json.loads(raw or "[]")
        return x if isinstance(x, list) else default
    except json.JSONDecodeError:
        return default


@router.post("/register")
def register(body: RegisterBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    email_n = body.email.strip().lower()
    uname = body.username.strip()
    if not re.match(r"^[a-zA-Z0-9_]+$", uname):
        raise HTTPException(400, "Username solo letras, números y guión bajo")
    exists_e = db.query(User).filter(User.email == email_n).first()
    if exists_e:
        raise HTTPException(400, "El email ya está registrado")
    exists_u = db.query(User).filter(User.username == uname).first()
    if exists_u:
        raise HTTPException(400, "El nombre de usuario ya existe")
    user = User(
        email=email_n,
        username=uname,
        hashed_password=_hash_password(body.password),
        plan="free",
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "No se pudo crear la cuenta") from None
    _ensure_profile(db, user)
    token = create_access_token(user)
    return {"token": token, "user": _user_short(user)}


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    email_n = body.email.strip().lower()
    user = db.query(User).filter(User.email == email_n).first()
    if not user or not _verify_password(body.password, user.hashed_password):
        raise HTTPException(401, "Email o contraseña incorrectos")
    if not user.is_active:
        raise HTTPException(403, "Cuenta desactivada")
    user.last_login = utcnow()
    db.commit()
    db.refresh(user)
    token = create_access_token(user)
    return {"token": token, "user": _user_short(user)}


@router.get("/me")
def me(user: CurrentUser) -> dict[str, Any]:
    return _user_public(user)


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordBody, db: Session = Depends(get_db)) -> dict[str, str]:
    email_n = body.email.strip().lower()
    user = db.query(User).filter(User.email == email_n).first()
    if user:
        code = f"{random.randint(100000, 999999)}"
        pr = PasswordReset(
            user_id=user.id,
            code=code,
            expires_at=utcnow() + timedelta(minutes=15),
            used=False,
        )
        db.add(pr)
        db.commit()
        if RESEND_API_KEY:
            params = {
                "from": RESEND_FROM,
                "to": [user.email],
                "subject": f"Tu código INGELD: {code}",
                "html": f"""
      <div style="font-family: monospace; max-width: 500px; margin: 0 auto; padding: 40px;">
        <h1 style="color: #00a87a; font-size: 28px;">INGELD</h1>
        <p style="color: #666; font-size: 14px;">Financial Assistant</p>
        <hr style="border: 1px solid #e0ddd8; margin: 20px 0;">
        <h2 style="color: #1c1f24;">Tu código de recuperación</h2>
        <p style="color: #444;">Usá este código para restablecer tu contraseña:</p>
        <div style="background: #f0ede8; padding: 20px; text-align: center;
                    border-radius: 8px; margin: 20px 0;">
          <span style="font-size: 36px; font-weight: bold;
                       letter-spacing: 8px; color: #00a87a;">{code}</span>
        </div>
        <p style="color: #666; font-size: 12px;">
          Este código expira en 15 minutos.<br>
          Si no solicitaste este código, ignorá este email.
        </p>
        <hr style="border: 1px solid #e0ddd8; margin: 20px 0;">
        <p style="color: #999; font-size: 11px;">
          INGELD Financial Assistant · Este servicio es informativo
          y no constituye asesoramiento financiero.
        </p>
      </div>
    """,
            }
            try:
                print(
                    f"Enviando email a {user.email} con código {code}",
                    file=sys.stderr,
                )
                response = resend.Emails.send(params)
                print(f"Resend response: {response}", file=sys.stderr)
            except Exception as e:
                print(f"Resend error: {e!r}", file=sys.stderr)
    return {"ok": "true"}


@router.post("/reset-password")
def reset_password(body: ResetPasswordBody, db: Session = Depends(get_db)) -> dict[str, str]:
    email_n = body.email.strip().lower()
    user = db.query(User).filter(User.email == email_n).first()
    if not user:
        raise HTTPException(400, "Código inválido o expirado")
    pr = (
        db.query(PasswordReset)
        .filter(
            PasswordReset.user_id == user.id,
            PasswordReset.code == body.code.strip(),
            PasswordReset.used.is_(False),
        )
        .order_by(PasswordReset.id.desc())
        .first()
    )
    if not pr or pr.expires_at < utcnow():
        raise HTTPException(400, "Código inválido o expirado")
    user.hashed_password = _hash_password(body.new_password)
    pr.used = True
    db.commit()
    return {"ok": "true"}


@router.get("/profile")
def get_profile(user: CurrentUser, db: Session = Depends(get_db)) -> dict[str, Any]:
    p = _ensure_profile(db, user)
    return {
        "favoritos": _parse_json_list(p.favoritos, []),
        "portfolio": _parse_json_list(p.portfolio, []),
        "scanner_tickers": _parse_json_list(p.scanner_tickers, []),
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.put("/profile")
def put_profile(
    body: ProfileUpdateBody,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    p = _ensure_profile(db, user)
    if body.favoritos is not None:
        p.favoritos = json.dumps(body.favoritos, ensure_ascii=False)
    if body.portfolio is not None:
        p.portfolio = json.dumps(body.portfolio, ensure_ascii=False)
    if body.scanner_tickers is not None:
        p.scanner_tickers = json.dumps(body.scanner_tickers, ensure_ascii=False)
    p.updated_at = utcnow()
    db.commit()
    db.refresh(p)
    return {
        "favoritos": _parse_json_list(p.favoritos, []),
        "portfolio": _parse_json_list(p.portfolio, []),
        "scanner_tickers": _parse_json_list(p.scanner_tickers, []),
    }


@router.post("/change-password")
def change_password(
    body: ChangePasswordBody,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if not _verify_password(body.current_password, user.hashed_password):
        raise HTTPException(400, "Contraseña actual incorrecta")
    user.hashed_password = _hash_password(body.new_password)
    db.commit()
    return {"ok": "true"}


@router.get("/historial")
def get_historial(user: CurrentUser, db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = (
        db.query(AnalysisHistory)
        .filter(AnalysisHistory.user_id == user.id)
        .order_by(AnalysisHistory.id.desc())
        .limit(20)
        .all()
    )
    return {
        "items": [
            {
                "id": r.id,
                "ticker": r.ticker,
                "tipo": r.tipo,
                "señal": r.señal,
                "resumen": r.resumen,
                "score_total": r.score_total,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@router.post("/historial")
def post_historial(
    body: HistorialCreateBody,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    t = body.ticker.strip().upper()
    if not t:
        raise HTTPException(400, "ticker requerido")
    tipo = body.tipo.strip().lower()
    if tipo not in ("fundamental", "chat", "portfolio"):
        raise HTTPException(400, "tipo inválido")
    item = AnalysisHistory(
        user_id=user.id,
        ticker=t,
        tipo=tipo,
        señal=(body.señal or "").strip().upper() or None,
        resumen=body.resumen.strip() or "(Sin resumen)",
        score_total=body.score_total,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"ok": "true", "id": item.id}


def _goal_to_dict(g: Goal) -> dict[str, Any]:
    return {
        "id": g.id,
        "nombre": g.nombre,
        "monto_objetivo": g.monto_objetivo,
        "monto_actual": g.monto_actual,
        "moneda": g.moneda,
        "fecha_objetivo": g.fecha_objetivo.isoformat() if g.fecha_objetivo else None,
        "color": g.color,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


@router.get("/metas")
def list_metas(user: CurrentUser, db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.query(Goal).filter(Goal.user_id == user.id).order_by(Goal.id.desc()).all()
    return {"items": [_goal_to_dict(g) for g in rows]}


@router.post("/metas")
def create_meta(
    body: GoalCreateBody,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    g = Goal(
        user_id=user.id,
        nombre=body.nombre.strip(),
        monto_objetivo=body.monto_objetivo,
        monto_actual=body.monto_actual,
        moneda=body.moneda.strip().upper() or "USD",
        fecha_objetivo=body.fecha_objetivo,
        color=body.color or "#00a87a",
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return {"ok": "true", "id": g.id, "goal": _goal_to_dict(g)}


@router.put("/metas/{goal_id}")
def update_meta(
    goal_id: int,
    body: GoalUpdateBody,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    g = db.query(Goal).filter(Goal.id == goal_id, Goal.user_id == user.id).first()
    if not g:
        raise HTTPException(404, "Meta no encontrada")
    if body.nombre is not None:
        g.nombre = body.nombre.strip()
    if body.monto_objetivo is not None:
        g.monto_objetivo = body.monto_objetivo
    if body.monto_actual is not None:
        g.monto_actual = body.monto_actual
    if body.moneda is not None:
        g.moneda = body.moneda.strip().upper()
    if body.fecha_objetivo is not None:
        g.fecha_objetivo = body.fecha_objetivo
    if body.color is not None:
        g.color = body.color
    db.commit()
    db.refresh(g)
    return {"ok": "true", "goal": _goal_to_dict(g)}


@router.delete("/metas/{goal_id}")
def delete_meta(goal_id: int, user: CurrentUser, db: Session = Depends(get_db)) -> dict[str, str]:
    g = db.query(Goal).filter(Goal.id == goal_id, Goal.user_id == user.id).first()
    if not g:
        raise HTTPException(404, "Meta no encontrada")
    db.delete(g)
    db.commit()
    return {"ok": "true"}


def _asset_to_dict(a: Asset) -> dict[str, Any]:
    return {
        "id": a.id,
        "nombre": a.nombre,
        "tipo": a.tipo,
        "valor": a.valor,
        "moneda": a.moneda,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _liab_to_dict(l: Liability) -> dict[str, Any]:
    return {
        "id": l.id,
        "nombre": l.nombre,
        "tipo": l.tipo,
        "monto": l.monto,
        "moneda": l.moneda,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }


@router.get("/assets")
def list_assets(user: CurrentUser, db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.query(Asset).filter(Asset.user_id == user.id).order_by(Asset.id.desc()).all()
    return {"items": [_asset_to_dict(a) for a in rows]}


@router.post("/assets")
def create_asset(
    body: AssetCreateBody,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    a = Asset(
        user_id=user.id,
        nombre=body.nombre.strip(),
        tipo=body.tipo.strip().lower(),
        valor=body.valor,
        moneda=body.moneda.strip().upper() or "USD",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"ok": "true", "id": a.id, "asset": _asset_to_dict(a)}


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, user: CurrentUser, db: Session = Depends(get_db)) -> dict[str, str]:
    a = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == user.id).first()
    if not a:
        raise HTTPException(404, "Activo no encontrado")
    db.delete(a)
    db.commit()
    return {"ok": "true"}


@router.get("/liabilities")
def list_liabilities(user: CurrentUser, db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = (
        db.query(Liability)
        .filter(Liability.user_id == user.id)
        .order_by(Liability.id.desc())
        .all()
    )
    return {"items": [_liab_to_dict(x) for x in rows]}


@router.post("/liabilities")
def create_liability(
    body: LiabilityCreateBody,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    l = Liability(
        user_id=user.id,
        nombre=body.nombre.strip(),
        tipo=body.tipo.strip().lower(),
        monto=body.monto,
        moneda=body.moneda.strip().upper() or "USD",
    )
    db.add(l)
    db.commit()
    db.refresh(l)
    return {"ok": "true", "id": l.id, "liability": _liab_to_dict(l)}


@router.delete("/liabilities/{liability_id}")
def delete_liability(
    liability_id: int,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    l = db.query(Liability).filter(
        Liability.id == liability_id, Liability.user_id == user.id
    ).first()
    if not l:
        raise HTTPException(404, "Pasivo no encontrado")
    db.delete(l)
    db.commit()
    return {"ok": "true"}
