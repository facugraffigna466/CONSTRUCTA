from sqlalchemy.ext.asyncio import AsyncSession

from app.models.whatsapp_tenant_context import WhatsappTenantContext


class WhatsappTenantContextRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, phone_number: str) -> WhatsappTenantContext | None:
        return await self.session.get(WhatsappTenantContext, phone_number)

    async def upsert(self, phone_number: str, **fields) -> WhatsappTenantContext:
        ctx = await self.get(phone_number)
        if ctx is None:
            ctx = WhatsappTenantContext(phone_number=phone_number, **fields)
            self.session.add(ctx)
        else:
            for key, value in fields.items():
                setattr(ctx, key, value)
        await self.session.flush()
        return ctx
