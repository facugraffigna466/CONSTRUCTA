"""Script para crear un usuario administrador en CONSTRUCTA."""
import asyncio
import getpass
import sys

import asyncpg
import bcrypt

DATABASE_URL = "postgresql://agustinllancaman@localhost:5432/constructa"


async def create_admin():
    print("=== Crear usuario administrador ===")
    email = input("Email: ").strip()
    full_name = input("Nombre completo: ").strip()
    password = getpass.getpass("Contraseña: ")
    confirm = getpass.getpass("Confirmar contraseña: ")

    if password != confirm:
        print("ERROR: Las contraseñas no coinciden.")
        sys.exit(1)

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        existing = await conn.fetchval("SELECT id FROM users WHERE email = $1", email)
        if existing:
            print(f"ERROR: Ya existe un usuario con el email {email}.")
            sys.exit(1)

        user_id = await conn.fetchval(
            """
            INSERT INTO users (email, hashed_password, full_name, role, is_active, created_at)
            VALUES ($1, $2, $3, 'admin', true, NOW())
            RETURNING id
            """,
            email, hashed, full_name,
        )
        print(f"\nUsuario admin creado con ID {user_id}.")
        print(f"Email: {email}")
        print(f"Nombre: {full_name}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(create_admin())
