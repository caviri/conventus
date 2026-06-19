"""The room Assistant: configuration + one-shot helpers.

`GET /api/agent` is readable by any member (so the UI knows the Assistant's name
and whether it's enabled). Configuration (`PATCH`) is admin-only and the api_key
is write-only, mirroring the bots router. The `/complete` and `/structured`
helpers power live-document completion and kanban card fill respectively.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import agent, db
from ..deps import current_user, require_admin
from ..ws import hub

router = APIRouter(prefix="/api/agent", tags=["agent"])

MASK = "•••"


class AgentUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    model_type: str | None = None  # standard | reasoning
    system_prompt: str | None = None
    color: str | None = None
    avatar: str | None = None
    enabled: bool | None = None


def _serialize(row: dict, *, reveal_key: bool = False) -> dict:
    return {
        "name": row["name"],
        "base_url": row["base_url"],
        "api_key": row["api_key"] if reveal_key else (MASK if row["api_key"] else ""),
        "model": row["model"],
        "model_type": row["model_type"],
        "system_prompt": row["system_prompt"],
        "color": row["color"],
        "avatar": row["avatar"],
        "enabled": bool(row["enabled"]),
    }


@router.get("")
async def get_agent(user=Depends(current_user)):
    return _serialize(agent.get_config())


@router.patch("")
async def update_agent(req: AgentUpdate, user=Depends(require_admin)):
    fields: dict[str, object] = {}
    for key in ("name", "base_url", "model", "system_prompt", "color", "avatar"):
        val = getattr(req, key)
        if val is not None:
            fields[key] = val
    if req.model_type is not None:
        if req.model_type not in ("standard", "reasoning"):
            raise HTTPException(status_code=400, detail="model_type must be 'standard' or 'reasoning'")
        fields["model_type"] = req.model_type
    if req.api_key is not None and req.api_key != MASK:
        fields["api_key"] = req.api_key
    if req.enabled is not None:
        fields["enabled"] = 1 if req.enabled else 0
    if fields:
        assignments = ", ".join(f"{k} = ?" for k in fields)
        db.execute(
            f"UPDATE agent SET {assignments} WHERE id = 1", (*fields.values(),)
        )
    # Nudge clients to refresh the roster (the Assistant appears/disappears there).
    await hub.broadcast("member.update", {"name": agent.get_config().get("name", "")})
    return _serialize(agent.get_config())


# --- one-shot helpers ----------------------------------------------------

class CompleteRequest(BaseModel):
    document: str = ""
    instruction: str = ""


def _require_enabled():
    cfg = agent.get_config()
    if not agent.is_enabled(cfg):
        raise HTTPException(status_code=409, detail="The Assistant isn't configured yet")
    return cfg


@router.post("/complete")
async def complete(req: CompleteRequest, user=Depends(current_user)):
    cfg = _require_enabled()
    system = (
        "You are a writing assistant embedded in a collaborative markdown document. "
        "Continue or extend the document naturally from where it leaves off. "
        "Reply with ONLY the new text to insert — no preamble, no code fences, no "
        "repetition of what's already written."
    )
    if cfg["system_prompt"]:
        system = f"{cfg['system_prompt']}\n\n{system}"
    instruction = req.instruction.strip() or "Continue the document."
    user_msg = f"Instruction: {instruction}\n\n--- DOCUMENT SO FAR ---\n{req.document}"
    try:
        text = await agent.complete(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            config=cfg,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Assistant error: {exc}")
    return {"text": text.strip()}


class StructuredRequest(BaseModel):
    text: str = Field(default="", description="The card's current text")
    members: list[str] = []


class CardFill(BaseModel):
    tags: str = ""        # comma-separated keywords
    due: str = ""         # YYYY-MM-DD or ""
    assignee: str = ""    # one of the provided members, or ""
    summary: str = ""     # a short refined description


@router.post("/structured")
async def structured(req: StructuredRequest, user=Depends(current_user)):
    """Generate structured kanban-card fields from a card's text (the row-level
    structured-output test)."""
    cfg = _require_enabled()
    members = ", ".join(req.members) or "(none)"
    system = (
        "You enrich kanban cards. Given a card's text, infer helpful metadata and "
        "respond with a SINGLE JSON object — no markdown, no commentary — with keys: "
        '"tags" (comma-separated keywords, string), '
        '"due" (a date as YYYY-MM-DD if the text implies one, else ""), '
        f'"assignee" (exactly one of these member names or "": {members}), '
        '"summary" (a one-sentence refined description of the task). '
        "Use empty strings when unsure. Do not invent assignees outside the list."
    )
    try:
        raw = await agent.complete(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": req.text or "(empty card)"},
            ],
            json_mode=True,
            config=cfg,
        )
        data = json.loads(raw)
        fill = CardFill(**{k: data.get(k, "") for k in CardFill.model_fields})
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Assistant returned invalid JSON")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Assistant error: {exc}")

    # Never trust the model with an assignee outside the room.
    if fill.assignee and fill.assignee not in req.members:
        fill.assignee = ""
    return fill.model_dump()


class CardsRequest(BaseModel):
    prompt: str = ""
    members: list[str] = []
    count: int | None = None  # optional hint for how many cards


class CardDraft(BaseModel):
    text: str = ""
    tags: str = ""
    due: str = ""
    assignee: str = ""


MAX_GENERATED_CARDS = 20


@router.post("/cards")
async def generate_cards(req: CardsRequest, user=Depends(current_user)):
    """Create one or many kanban cards from a natural-language request, returned
    as a pydantic-validated list the client inserts into the board's Yjs doc."""
    cfg = _require_enabled()
    members = ", ".join(req.members) or "(none)"
    count_hint = (
        f"Create about {req.count} card(s). " if req.count and req.count > 0 else ""
    )
    system = (
        "You create kanban cards from a request. Respond with a SINGLE JSON object "
        'of the form {"cards": [ {…}, {…} ]} — no markdown, no commentary. Each card '
        'object has keys: "text" (a short, actionable card title — required), '
        '"tags" (comma-separated keywords or ""), "due" (YYYY-MM-DD or ""), '
        f'"assignee" (exactly one of these member names or "": {members}). '
        f"{count_hint}Only include cards that are clearly warranted by the request, "
        "and never invent assignees outside the list."
    )
    try:
        raw = await agent.complete(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": req.prompt or "(no request)"},
            ],
            json_mode=True,
            config=cfg,
        )
        data = json.loads(raw)
        items = data.get("cards") if isinstance(data, dict) else data
        drafts = [
            CardDraft(**{k: c.get(k, "") for k in CardDraft.model_fields})
            for c in (items or [])
            if isinstance(c, dict)
        ]
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Assistant returned invalid JSON")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Assistant error: {exc}")

    clean: list[CardDraft] = []
    for d in drafts:
        if not d.text.strip():
            continue
        if d.assignee and d.assignee not in req.members:
            d.assignee = ""
        clean.append(d)
    return {"cards": [d.model_dump() for d in clean[:MAX_GENERATED_CARDS]]}
