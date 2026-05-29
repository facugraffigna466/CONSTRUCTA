from fastapi import APIRouter

from app.core.deps import DbSession
from app.schemas.user import AcceptInviteRequest, LoginRequest, TokenResponse, UserCreate, UserRead
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=201)
async def register(data: UserCreate, db: DbSession):
    return await AuthService(db).register(data)


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: DbSession):
    token = await AuthService(db).login(data.email, data.password)
    return TokenResponse(access_token=token)


@router.post("/accept-invite", response_model=TokenResponse)
async def accept_invite(data: AcceptInviteRequest, db: DbSession):
    token = await AuthService(db).accept_invite(data)
    return TokenResponse(access_token=token)
