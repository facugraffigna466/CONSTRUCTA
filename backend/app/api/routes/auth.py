from fastapi import APIRouter

from app.core.config import settings
from app.core.deps import DbSession
from app.schemas.user import (
    AcceptInviteRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserCreate,
    UserRead,
)
from app.services.auth_service import AuthService
from app.services.email_service import send_password_reset_email

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


@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordRequest, db: DbSession) -> dict[str, str]:
    """Envía un email con el link de recuperación. Siempre responde igual (200) para no
    revelar si el email existe."""
    result = await AuthService(db).request_password_reset(data.email)
    if result is not None:
        user, token = result
        reset_url = f"{settings.FRONTEND_URL}/reset-password/{token}"
        await send_password_reset_email(user.email, reset_url)
    return {"message": "Si el email existe, te enviamos un enlace para recuperar tu contraseña."}


@router.post("/reset-password", response_model=TokenResponse)
async def reset_password(data: ResetPasswordRequest, db: DbSession):
    """Valida el token y setea la nueva contraseña; deja al usuario logueado."""
    token = await AuthService(db).reset_password(data.token, data.new_password)
    return TokenResponse(access_token=token)
