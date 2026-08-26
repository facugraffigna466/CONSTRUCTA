from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Un pre_auth_token (Fase 3, emitido cuando el login tiene que
    # desambiguar entre varias empresas) NO es un Bearer de sesión válido —
    # solo sirve para canjear en /auth/select-tenant.
    if payload.get("typ") == "pre_auth":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    from app.repositories.user import UserRepository
    user = await UserRepository(db).get(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Fase 2/3 rediseño multi-tenant: tenant_id/role/is_active/whatsapp_number
    # se resuelven desde la TenantMembership, no desde las columnas de User.
    # El JWT lleva el tenant_id de la sesión explícito cuando login tuvo que
    # elegir entre varias empresas; si no vino (tokens viejos, o el usuario
    # solo tiene una membership) cae de vuelta a User.tenant_id ("última
    # empresa activa"). Ver membership_context.py.
    tenant_id = payload.get("tenant_id", user.tenant_id)
    from app.repositories.tenant_membership import TenantMembershipRepository
    authenticated: User = user
    if tenant_id is not None:
        membership = await TenantMembershipRepository(db).get_by_user_and_tenant(
            user.id, tenant_id
        )
        if membership is not None:
            from app.core.membership_context import AuthenticatedUser
            authenticated = AuthenticatedUser(user, membership)  # type: ignore[assignment]

    if not authenticated.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return authenticated


async def get_current_user_id(user: User = Depends(get_current_user)) -> int:
    return user.id


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de administrador",
        )
    return user


_api_key_header = APIKeyHeader(name="X-Api-Key", auto_error=False)


async def verify_api_key(key: str | None = Security(_api_key_header)) -> None:
    from app.core.config import settings
    expected = settings.INTERNAL_API_KEY
    if not expected or key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )


# Reusable Annotated aliases
DbSession     = Annotated[AsyncSession, Depends(get_db)]
CurrentUser   = Annotated[User, Depends(get_current_user)]
CurrentUserId = Annotated[int, Depends(get_current_user_id)]
AdminUser     = Annotated[User, Depends(require_admin)]
InternalAuth  = Annotated[None, Depends(verify_api_key)]
