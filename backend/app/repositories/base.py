from typing import Any, Generic, Type, TypeVar
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    def __init__(self, model: Type[ModelT], session: AsyncSession) -> None:
        self.model = model
        self.session = session

    async def get(self, id: int) -> ModelT | None:
        return await self.session.get(self.model, id)

    async def create(self, obj: ModelT) -> ModelT:
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update_fields(self, id: int, **fields: Any) -> ModelT | None:
        await self.session.execute(
            update(self.model).where(self.model.id == id).values(**fields)
        )
        # Expire so the next get() fetches fresh state from DB, not the session cache
        instance = await self.session.get(self.model, id)
        if instance is not None:
            await self.session.refresh(instance)
        return instance

    async def delete(self, id: int) -> bool:
        result = await self.session.execute(
            delete(self.model).where(self.model.id == id)
        )
        return result.rowcount > 0
