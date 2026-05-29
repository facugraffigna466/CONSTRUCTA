from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation_session import ConversationSession, ConversationStep
from app.repositories.base import BaseRepository

SESSION_TTL_MINUTES = 30


class ConversationSessionRepository(BaseRepository[ConversationSession]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ConversationSession, session)

    async def get_by_responsible(self, responsible_id: int) -> ConversationSession | None:
        result = await self.session.execute(
            select(ConversationSession).where(
                ConversationSession.responsible_id == responsible_id
            )
        )
        return result.scalar_one_or_none()

    async def upsert(
        self,
        responsible_id: int,
        step: ConversationStep,
        selected_task_id: int | None = None,
        task_options: list[dict[str, Any]] | None = None,
    ) -> ConversationSession:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=SESSION_TTL_MINUTES)
        existing = await self.get_by_responsible(responsible_id)
        if existing:
            return await self.update_fields(
                existing.id,
                step=step,
                selected_task_id=selected_task_id,
                task_options=task_options,
                expires_at=expires_at,
            )
        sess = ConversationSession(
            responsible_id=responsible_id,
            step=step,
            selected_task_id=selected_task_id,
            task_options=task_options,
            expires_at=expires_at,
        )
        return await self.create(sess)
