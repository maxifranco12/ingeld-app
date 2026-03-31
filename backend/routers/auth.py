"""Registro, login, JWT, perfil y recuperación de contraseña."""

from __future__ import annotations

import os

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET no configurado en .env")

JWT_ALGORITHM = "HS256"

import json
import random
import re
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
from database import AnalysisHistory, PasswordReset, User, UserProfile, get_db, utcnow

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM", "noreply@ingeld.app")


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
            resend.api_key = RESEND_API_KEY
            html = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#faf6f0;font-family:Georgia,serif;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;
box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid rgba(0,168,122,0.15);">
<p style="color:#1a1c20;font-size:1rem;margin:0 0 12px;">INGELD</p>
<h1 style="color:#00a87a;font-size:1.5rem;margin:0 0 16px;">Tu código de recuperación</h1>
<p style="color:#5c5f66;line-height:1.5;">Usá este código en la app (vence en 15 minutos):</p>
<p style="font-size:1.75rem;font-weight:700;letter-spacing:0.2em;color:#00a87a;margin:20px 0;">{code}</p>
<p style="color:#8a8d94;font-size:0.85rem;">Si no solicitaste esto, ignorá este mensaje.</p>
</div></body></html>"""
            try:
                resend.Emails.send(
                    {
                        "from": RESEND_FROM,
                        "to": [user.email],
                        "subject": f"Tu código INGELD: {code}",
                        "html": html,
                    }
                )
            except Exception:
                pass
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
