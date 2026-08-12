"""Script para resetear la contraseña de un usuario existente en CONSTRUCTA.

Uso:  cd backend && .venv/bin/python reset_admin_password.py
Es interactivo: pide el email y la nueva contraseña (no queda en el historial).
"""
import asyncio
import getpass
import sys

import asyncpg
import bcrypt

DATABASE_URL = "postgresql://agustinllancaman@localhost:5432/constructa"


async def reset_password():
    print("=== Resetear contraseña de usuario ===")
    email = input("Email [admin@constructa.com]: ").strip() or "admin@constructa.com"
    password = getpass.getpass("Nueva contraseña (mín. 8): ")
    confirm = getpass.getpass("Confirmar contraseña: ")

    if password != confirm:
        print("ERROR: Las contraseñas no coinciden.")
        sys.exit(1)
    if len(password) < 8:
        print("ERROR: La contraseña debe tener al menos 8 caracteres.")
        sys.exit(1)

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        row = await conn.fetchrow("SELECT id, role, tenant_id FROM users WHERE email = $1", email)
        if not row:
            print(f"ERROR: No existe un usuario con el email {email}.")
            sys.exit(1)
        await conn.execute(
            "UPDATE users SET hashed_password = $1 WHERE email = $2",
            hashed, email,
        )
        print(
            f"\nContraseña actualizada para {email} "
            f"(rol: {row['role']}, id: {row['id']}, tenant_id: {row['tenant_id']})."
        )
        print("Ya podés iniciar sesión con la nueva contraseña.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(reset_password())
