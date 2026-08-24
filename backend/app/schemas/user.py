from datetime import datetime
from typing import Literal
from pydantic import BaseModel, EmailStr, Field

from app.models.obra_user_role import ObraUserRoleType


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=2, max_length=255)
    company_name: str | None = Field(None, max_length=255)


class ObraRoleForUserRead(BaseModel):
    """Rol que el usuario tiene sobre una obra específica.

    Se pobla en `/users/me` y `/users` para que el frontend pueda mostrar
    a qué obras está asignado el usuario y con qué rol en cada una."""
    obra_id: int
    obra_name: str
    role: ObraUserRoleType

    model_config = {"from_attributes": True}


class UserRead(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    is_verified: bool = True
    avatar_url: str | None = None
    whatsapp_number: str | None = None
    tenant_name: str | None = None  # solo poblado en /users/me
    created_at: datetime
    # Asignaciones de obra actuales (Fase 3). Vacío = no está asignado a ninguna
    # obra concreta; en ese caso un non-admin no ve ninguna obra en su portfolio
    # hasta que un admin (o jefe de obra) le asigne al menos una.
    obra_roles: list[ObraRoleForUserRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UpdateProfileRequest(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=255)
    avatar_url: str | None = None
    whatsapp_number: str | None = Field(None, max_length=20)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ObraAssignmentInvite(BaseModel):
    """Una asignación individual dentro del payload de invitación.

    El validador acepta el enum ObraUserRoleType tanto por string ('jefe_obra')
    como por objeto. Fase 4 (frontend) va a exponer el selector."""
    obra_id: int
    role: ObraUserRoleType


class InviteRequest(BaseModel):
    email: EmailStr
    role: Literal["admin", "collaborator"] = "collaborator"
    # Asignaciones opcionales por-obra que se van a materializar cuando el
    # invitado acepte. Si viene None/vacío, el invitado se activa sin obras
    # y no ve nada hasta que alguien lo asigne después (comportamiento válido,
    # no es un error). Se mantiene opcional para no romper el frontend actual
    # que todavía manda el payload viejo — Fase 4 lo va a extender.
    obra_assignments: list[ObraAssignmentInvite] | None = None


class InviteResponse(BaseModel):
    invite_token: str
    invite_url: str
    # Devolvemos las asignaciones EFECTIVAS (después de filtrar cross-tenant),
    # así el frontend puede mostrar al admin "invitaste a X a estas obras".
    # Puede diferir del input si alguna obra_id era inválida (ver
    # docs/roles-redesign/fase-3-invitacion.md sobre el edge case).
    obra_assignments: list[ObraAssignmentInvite] = Field(default_factory=list)


class AcceptInviteRequest(BaseModel):
    token: str
    full_name: str = Field(..., min_length=2, max_length=255)
    password: str = Field(..., min_length=8)


class InviteContextResponse(BaseModel):
    """Contexto de una invitación pendiente para mostrar antes de aceptarla."""
    email: str
    role: str
    company_name: str | None = None
    # Obras a las que el invitado se va a asignar al aceptar (Fase 3). El
    # frontend usa esto para mostrar "vas a entrar a estas obras como X".
    obra_assignments: list[ObraRoleForUserRead] = Field(default_factory=list)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)


class VerifyEmailRequest(BaseModel):
    token: str


class RoleUpdateRequest(BaseModel):
    role: Literal["admin", "collaborator"]
