from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.membership_context import AuthenticatedUser
from app.models.tenant_membership import TenantMembership
from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(User, session)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def get_by_reset_token(self, token: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.reset_token == token)
        )
        return result.scalar_one_or_none()

    async def get_by_verification_token(self, token: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.verification_token == token)
        )
        return result.scalar_one_or_none()

    async def get_by_whatsapp(self, number: str) -> User | None:
        """Fase 2 rediseño multi-tenant: whatsapp_number vive en
        TenantMembership, no en User. Devuelve un `AuthenticatedUser` (User +
        la membership dueña del número) para que `.tenant_id`/`.role` sigan
        resolviendo correcto en los call sites existentes (message_service.py).

        `.first()` sin desambiguar: si el mismo número queda en más de un
        tenant (recién posible desde la Fase 3), la Fase 3 agrega la
        desambiguación conversacional en el webhook — acá se mantiene el
        comportamiento actual a propósito."""
        result = await self.session.execute(
            select(User, TenantMembership)
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .where(TenantMembership.whatsapp_number == number, TenantMembership.is_active.is_(True))
        )
        row = result.first()
        if row is None:
            return None
        user, membership = row
        return AuthenticatedUser(user, membership)  # type: ignore[return-value]

    async def get_by_whatsapp_in_tenant(
        self, number: str, tenant_id: int | None
    ) -> User | None:
        """Lookup del mismo whatsapp dentro de un tenant específico.

        Hallazgo 6.4 auditoría 04: para el chequeo cruzado User↔Responsible al
        crear/editar, necesitamos saber si el número ya está tomado por un User
        del mismo tenant (independientemente de is_active — la colisión también
        importa contra memberships desactivadas)."""
        if not number:
            return None
        stmt = (
            select(User)
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .where(TenantMembership.whatsapp_number == number)
        )
        if tenant_id is not None:
            stmt = stmt.where(TenantMembership.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def count(self) -> int:
        from sqlalchemy import func
        result = await self.session.execute(select(func.count()).select_from(User))
        return result.scalar_one()
