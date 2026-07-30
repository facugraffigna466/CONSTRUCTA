from datetime import datetime
from typing import Literal
from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=2, max_length=255)
    company_name: str | None = Field(None, max_length=255)


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
    token_type: str = "bearer"


class InviteRequest(BaseModel):
    email: EmailStr
    role: Literal["admin", "collaborator"] = "collaborator"


class InviteResponse(BaseModel):
    invite_token: str
    invite_url: str


class AcceptInviteRequest(BaseModel):
    token: str
    full_name: str = Field(..., min_length=2, max_length=255)
    password: str = Field(..., min_length=8)


class InviteContextResponse(BaseModel):
    """Contexto de una invitación pendiente para mostrar antes de aceptarla."""
    email: str
    role: str
    company_name: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)


class VerifyEmailRequest(BaseModel):
    token: str


class RoleUpdateRequest(BaseModel):
    role: Literal["admin", "collaborator"]
