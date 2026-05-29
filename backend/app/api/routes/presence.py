from fastapi import APIRouter

from app.core.deps import CurrentUser
from app.core.presence import get_online, heartbeat

router = APIRouter(prefix="/presence", tags=["presence"])


@router.get("/online")
async def online_users(current_user: CurrentUser):
    heartbeat(current_user.id, current_user.full_name)
    return {"users": get_online()}
