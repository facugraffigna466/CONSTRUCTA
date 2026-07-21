import asyncio

import jwt
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.core.deps import DbSession
from app.core.security import decode_access_token
from app.core.sse_manager import sse_manager
from app.repositories.obra import ObraRepository

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/obra/{obra_id}")
async def obra_events(
    obra_id: int,
    db: DbSession,
    token: str = Query(..., description="JWT access token"),
) -> StreamingResponse:
    """
    Server-Sent Events stream for a specific obra.
    Emits 'task_updated' whenever the chatbot modifies a task.
    Token is passed as query param because EventSource doesn't support headers.
    """
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    obra = await ObraRepository(db).get(obra_id)
    if not obra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    # Acceso por TENANT (no por creador): cualquier miembro de la empresa.
    from app.repositories.user import UserRepository
    user = await UserRepository(db).get(user_id)
    if not user or (obra.tenant_id is not None and obra.tenant_id != user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    q = sse_manager.subscribe(obra_id)

    async def stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {event}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            sse_manager.unsubscribe(obra_id, q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
