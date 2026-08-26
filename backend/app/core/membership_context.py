"""Facade que combina una identidad (`User`) con su `TenantMembership` activa.

Fase 2 del rediseño multi-tenant: `tenant_id`, `role`, `is_active` y
`whatsapp_number` dejan de leerse de `User` y pasan a resolverse desde la
membership correspondiente. Para no tocar los ~90 call sites que ya hacen
`current_user.tenant_id` / `.role` en el resto del backend (deps, permisos de
obra, servicios), este objeto se comporta como un `User` por duck typing:
delega todo lo que no sobreescribe explícitamente a la instancia real.

No asignar `user.tenant_id = ...` directo sobre el `User` cargado en su lugar
— son columnas mapeadas por SQLAlchemy y `get_db()` hace commit al final de
cada request, así que un atributo "sucio" se persistiría solo y corrompería
la fila de identidad.
"""
from __future__ import annotations

from typing import Any

from app.models.tenant_membership import TenantMembership
from app.models.user import User


class AuthenticatedUser:
    def __init__(self, user: User, membership: TenantMembership) -> None:
        self._user = user
        self._membership = membership

    def __getattr__(self, name: str) -> Any:
        return getattr(self._user, name)

    @property
    def tenant_id(self) -> int:
        return self._membership.tenant_id

    @property
    def role(self) -> str:
        return self._membership.role

    @property
    def is_active(self) -> bool:
        return self._membership.is_active

    @property
    def whatsapp_number(self) -> str | None:
        return self._membership.whatsapp_number

    @property
    def membership_id(self) -> int:
        return self._membership.id
