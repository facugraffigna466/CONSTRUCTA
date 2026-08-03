from fastapi import APIRouter, Depends

from app.core.config import settings
from app.core.deps import DbSession
from app.core.rate_limit import rate_limit
from app.schemas.user import (
    AcceptInviteRequest,
    ForgotPasswordRequest,
    InviteContextResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserCreate,
    UserRead,
    VerifyEmailRequest,
)
from app.services.auth_service import AuthService
from app.services.email_service import send_password_reset_email, send_verification_email

router = APIRouter(prefix="/auth", tags=["auth"])

# Límites por IP (in-memory) contra fuerza bruta / abuso.
_login_limit  = rate_limit("login",  max_hits=10, window_secs=60)
_forgot_limit = rate_limit("forgot", max_hits=5,  window_secs=300)
_reset_limit  = rate_limit("reset",  max_hits=10, window_secs=60)


@router.post("/register", response_model=UserRead, status_code=201)
async def register(data: UserCreate, db: DbSession):
    user = await AuthService(db).register(data)
    if user.verification_token:
        verify_url = f"{settings.FRONTEND_URL}/verify-email/{user.verification_token}"
        await send_verification_email(user.email, verify_url)
    return user


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(_login_limit)])
async def login(data: LoginRequest, db: DbSession):
    access_token, refresh_token = await AuthService(db).login(data.email, data.password)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(data: RefreshRequest, db: DbSession):
    access_token, refresh_token = await AuthService(db).refresh(data.refresh_token)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout", status_code=204)
async def logout(data: LogoutRequest, db: DbSession):
    await AuthService(db).logout(data.refresh_token)


@router.get("/invite/{token}", response_model=InviteContextResponse)
async def invite_context(token: str, db: DbSession):
    """Devuelve la empresa, email y rol de una invitación pendiente (no la consume)."""
    return await AuthService(db).get_invite_context(token)


@router.post("/accept-invite", response_model=TokenResponse)
async def accept_invite(data: AcceptInviteRequest, db: DbSession):
    access_token, refresh_token = await AuthService(db).accept_invite(data)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/forgot-password", dependencies=[Depends(_forgot_limit)])
async def forgot_password(data: ForgotPasswordRequest, db: DbSession) -> dict[str, str]:
    """Envía un email con el link de recuperación. Siempre responde igual (200) para no
    revelar si el email existe."""
    result = await AuthService(db).request_password_reset(data.email)
    if result is not None:
        user, token = result
        reset_url = f"{settings.FRONTEND_URL}/reset-password/{token}"
        await send_password_reset_email(user.email, reset_url)
    return {"message": "Si el email existe, te enviamos un enlace para recuperar tu contraseña."}


@router.post("/reset-password", response_model=TokenResponse, dependencies=[Depends(_reset_limit)])
async def reset_password(data: ResetPasswordRequest, db: DbSession):
    """Valida el token y setea la nueva contraseña; deja al usuario logueado."""
    access_token, refresh_token = await AuthService(db).reset_password(data.token, data.new_password)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/verify-email")
async def verify_email(data: VerifyEmailRequest, db: DbSession) -> dict[str, str]:
    """Marca el email como verificado a partir del token del enlace."""
    await AuthService(db).verify_email(data.token)
    return {"message": "Email verificado."}
