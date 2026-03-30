"""AI analysis via Anthropic Claude."""

from __future__ import annotations

import os
from typing import Optional

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
