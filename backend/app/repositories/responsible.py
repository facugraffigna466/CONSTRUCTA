from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.responsible import Responsible
from app.repositories.base import BaseRepository


class ResponsibleRepository(BaseRepository[Responsible]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Responsible, session)

    async def get_by_whatsapp(self, number: str) -> Responsible | None:
        """Lookup principal del pipeline del chatbot.

        Solo devuelve responsables ACTIVOS. Un responsable con `is_active=False`
        (desactivado por su admin) no debe seguir siendo reconocido — antes
        este método lo devolvía igual, permitiéndole seguir usando el bot
        indefinidamente.

        Los callers que necesiten distinguir "desactivado" de "nunca existió"
        (para dar un mensaje diferenciado) deben usar `get_by_whatsapp_any`."""
        if not number:
            return None
        result = await self.session.execute(
            select(Responsible).where(
                Responsible.whatsapp_number == number,
                Responsible.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_whatsapp_in_tenant(
        self, number: str, tenant_id: int | None
    ) -> Responsible | None:
        """Lookup del mismo número dentro de un tenant específico.

        Hallazgo 6.3 auditoría 04: el número es unique por tenant, así que este
        es el chequeo correcto para "¿ya existe un responsable con este número
        en MI empresa?". El lookup global (get_by_whatsapp_any) solo se usa para
        el pipeline del webhook, donde el emisor no dice qué tenant es.
        """
        if not number:
            return None
        stmt = select(Responsible).where(Responsible.whatsapp_number == number)
        if tenant_id is not None:
            stmt = stmt.where(Responsible.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_whatsapp_any(self, number: str) -> Responsible | None:
        """Idem al anterior pero SIN filtrar por `is_active`. Uso: el webhook
        de mensajes lo llama para poder distinguir tres casos y dar mensajes
        diferentes:
          - número no registrado → "este número no está registrado…"
          - registrado pero desactivado → "ya no tenés acceso al sistema…"
          - registrado y activo → flujo normal
        """
        if not number:
            return None
        result = await self.session.execute(
            select(Responsible).where(Responsible.whatsapp_number == number)
        )
        return result.scalar_one_or_none()

    async def list_active(self, tenant_id: int | None = None) -> list[Responsible]:
        stmt = (
            select(Responsible)
            .where(Responsible.is_active.is_(True))
            .order_by(Responsible.full_name)
        )
        if tenant_id is not None:
            stmt = stmt.where(Responsible.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_all(self, tenant_id: int | None = None) -> list[Responsible]:
        stmt = select(Responsible).order_by(Responsible.full_name)
        if tenant_id is not None:
            stmt = stmt.where(Responsible.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
