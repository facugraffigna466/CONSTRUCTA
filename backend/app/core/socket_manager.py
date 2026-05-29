"""
Socket.IO server — task events + real-time presence.

Rooms:
  "obra_{id}"  — all users join all obra rooms on connect (shared org)

Client → Server events:
  join_obra(obra_id)              user opened an obra page
  leave_obra(obra_id)             user left an obra page
  start_editing_task(task_id, obra_id)
  stop_editing_task(task_id, obra_id)

Server → Client events:
  online_users    {users: [...]}                     who is connected globally
  presence_update {obra_id, viewers: [...], editing: {task_id: editor}}
  task_updated    {taskId, obraId, ...}              task changed by chatbot
"""
import logging

import jwt
import socketio

from app.core.database import AsyncSessionLocal
from app.core.security import decode_access_token

logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
    ping_interval=10,   # server pings client every 10s
    ping_timeout=20,    # disconnect if no pong in 20s
)

_AVATAR_COLORS = ["#FF6B35", "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E", "#D03A3A", "#2C6571"]

# sid → {id, name, initials, color}
_sessions: dict[str, dict] = {}

# obra_id → set[sid]   — users actively viewing this obra
_viewers: dict[int, set[str]] = {}

# task_id → {sid, obra_id}
_editing: dict[int, dict] = {}


def _user_card(user_id: int, full_name: str) -> dict:
    words = full_name.split()
    initials = "".join(w[0].upper() for w in words[:2]) if words else "?"
    color = _AVATAR_COLORS[user_id % len(_AVATAR_COLORS)]
    return {"id": user_id, "name": full_name, "initials": initials, "color": color}


def _dedup(cards: list[dict]) -> list[dict]:
    seen: set[int] = set()
    out = []
    for c in cards:
        if c["id"] not in seen:
            seen.add(c["id"])
            out.append(c)
    return out


async def _broadcast_online() -> None:
    users = _dedup(list(_sessions.values()))
    await sio.emit("online_users", {"users": users})


async def _broadcast_presence(obra_id: int) -> None:
    sids = _viewers.get(obra_id, set())
    viewers = _dedup([_sessions[s] for s in sids if s in _sessions])
    editing = {
        str(tid): _sessions[info["sid"]]
        for tid, info in _editing.items()
        if info["obra_id"] == obra_id and info["sid"] in _sessions
    }
    await sio.emit(
        "presence_update",
        {"obra_id": obra_id, "viewers": viewers, "editing": editing},
        room=f"obra_{obra_id}",
    )


# ── Connection lifecycle ───────────────────────────────────────────────────────

@sio.event
async def connect(sid: str, environ: dict, auth: dict | None) -> None:
    token = (auth or {}).get("token", "")
    logger.info("connect attempt sid=%s has_token=%s", sid, bool(token))
    if not token:
        logger.warning("connect rejected sid=%s reason=no_token", sid)
        raise ConnectionRefusedError("no token")
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        logger.warning("connect rejected sid=%s reason=token_expired", sid)
        raise ConnectionRefusedError("token expired")
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        logger.warning("connect rejected sid=%s reason=invalid_token exc=%s", sid, exc)
        raise ConnectionRefusedError("invalid token")

    try:
        async with AsyncSessionLocal() as db:
            from app.repositories.user import UserRepository
            from app.repositories.obra import ObraRepository
            user = await UserRepository(db).get(user_id)
            if not user or not user.is_active:
                logger.warning("connect rejected sid=%s user_id=%d reason=user_inactive_or_not_found", sid, user_id)
                raise ConnectionRefusedError("user inactive")
            obras = await ObraRepository(db).list_all()
            for obra in obras:
                await sio.enter_room(sid, f"obra_{obra.id}")

        await sio.save_session(sid, {"user_id": user_id})
        _sessions[sid] = _user_card(user_id, user.full_name)
        await _broadcast_online()
        logger.info("connect OK sid=%s user_id=%d name=%s sessions=%d", sid, user_id, user.full_name, len(_sessions))
    except ConnectionRefusedError:
        raise
    except Exception as exc:
        logger.error("connect handler unexpected error sid=%s user_id=%d: %s", sid, user_id, exc, exc_info=True)
        raise ConnectionRefusedError("server error")


@sio.event
async def disconnect(sid: str) -> None:
    _sessions.pop(sid, None)

    affected = [oid for oid, sids in _viewers.items() if sid in sids]
    for oid in affected:
        _viewers[oid].discard(sid)

    stale = [tid for tid, info in _editing.items() if info["sid"] == sid]
    for tid in stale:
        del _editing[tid]

    await _broadcast_online()
    for oid in affected:
        await _broadcast_presence(oid)
    logger.info("disconnect sid=%s sessions=%d", sid, len(_sessions))


# ── Presence events ────────────────────────────────────────────────────────────

@sio.event
async def request_online_users(sid: str) -> None:
    users = _dedup(list(_sessions.values()))
    await sio.emit("online_users", {"users": users}, room=sid)
    logger.debug("request_online_users sid=%s → %d users", sid, len(users))


@sio.event
async def join_obra(sid: str, data: dict) -> None:
    obra_id = data.get("obra_id")
    if not isinstance(obra_id, int):
        obra_id_raw = data.get("obra_id")
        logger.warning("join_obra got non-int obra_id=%r type=%s sid=%s", obra_id_raw, type(obra_id_raw).__name__, sid)
        return
    _viewers.setdefault(obra_id, set()).add(sid)
    logger.info("join_obra obra_id=%d sid=%s viewers=%d", obra_id, sid, len(_viewers[obra_id]))
    await _broadcast_presence(obra_id)


@sio.event
async def leave_obra(sid: str, data: dict) -> None:
    obra_id = data.get("obra_id")
    if not isinstance(obra_id, int):
        return
    _viewers.get(obra_id, set()).discard(sid)
    await _broadcast_presence(obra_id)


@sio.event
async def start_editing_task(sid: str, data: dict) -> None:
    task_id = data.get("task_id")
    obra_id = data.get("obra_id")
    if not isinstance(task_id, int) or not isinstance(obra_id, int):
        return
    _editing[task_id] = {"sid": sid, "obra_id": obra_id}
    await _broadcast_presence(obra_id)


@sio.event
async def stop_editing_task(sid: str, data: dict) -> None:
    task_id = data.get("task_id")
    obra_id = data.get("obra_id")
    if not isinstance(task_id, int) or not isinstance(obra_id, int):
        return
    if _editing.get(task_id, {}).get("sid") == sid:
        del _editing[task_id]
    await _broadcast_presence(obra_id)


# ── Task events (called from task_service & chatbot service) ─────────────────

async def emit_task_created(task, actor: dict | None = None) -> None:
    payload = {
        "taskId": task.id,
        "obraId": task.obra_id,
        "title": task.title,
        "description": task.description,
        "status": task.status.value,
        "responsibleId": task.responsible_id,
        "startDate": str(task.start_date) if task.start_date else None,
        "dueDate": str(task.due_date) if task.due_date else None,
        "startTime": str(task.start_time) if task.start_time else None,
        "dueTime": str(task.due_time) if task.due_time else None,
        "orderIndex": task.order_index,
        "createdAt": task.created_at.isoformat(),
        "updatedAt": task.updated_at.isoformat(),
        "actor": actor,
    }
    await sio.emit("task_created", payload, room=f"obra_{task.obra_id}")
    logger.debug("task_created taskId=%d obraId=%d", task.id, task.obra_id)


async def emit_task_updated(task, actor: dict | None = None) -> None:
    payload = {
        "taskId": task.id,
        "obraId": task.obra_id,
        "title": task.title,
        "responsibleId": task.responsible_id,
        "status": task.status.value,
        "startDate": str(task.start_date) if task.start_date else None,
        "dueDate": str(task.due_date) if task.due_date else None,
        "updatedAt": task.updated_at.isoformat(),
        "actor": actor,
    }
    await sio.emit("task_updated", payload, room=f"obra_{task.obra_id}")
    logger.debug("task_updated taskId=%d obraId=%d", task.id, task.obra_id)


async def emit_alert_created(alert) -> None:
    payload = {
        "id":         alert.id,
        "obraId":     alert.obra_id,
        "taskId":     alert.task_id,
        "type":       alert.type.value,
        "message":    alert.message,
        "is_read":    alert.is_read,
        "created_at": alert.created_at.isoformat(),
    }
    if alert.obra_id:
        await sio.emit("alert_created", payload, room=f"obra_{alert.obra_id}")
    logger.debug("alert_created alertId=%d obraId=%s", alert.id, alert.obra_id)


async def emit_task_deleted(task_id: int, obra_id: int, title: str, actor: dict | None = None) -> None:
    payload = {
        "taskId": task_id,
        "obraId": obra_id,
        "title": title,
        "actor": actor,
    }
    await sio.emit("task_deleted", payload, room=f"obra_{obra_id}")
    logger.debug("task_deleted taskId=%d obraId=%d", task_id, obra_id)
