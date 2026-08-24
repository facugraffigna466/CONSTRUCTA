"""Verificación del backfill de asignaciones (Fase 5 del rediseño de roles).

Uso:

    cd backend
    .venv/bin/python scripts/verify_fase5_backfill.py

El script NO modifica datos. Corre 4 queries de solo lectura contra la BD
apuntada por DATABASE_URL y valida las invariantes que la migración 0049
debería cumplir:

1. Conteo esperado: para cada collaborator activo, hay 1 fila en
   ``obra_user_roles`` por cada obra de su tenant.
2. Sin duplicados: el ``UNIQUE(obra_id, user_id)`` no fue violado.
3. Sin cross-tenant: para cada fila con ``origin='backfill_fase5'``, se
   verifica que el user y la obra pertenezcan al mismo tenant.
4. Solo collaborators: ningún admin recibió filas del backfill (no las
   necesita — es superset).

Salida en formato tabular con OK/FAIL por check. Exit code != 0 si algún
check falla.

Correr ANTES de la migración → todos los checks van a mostrar el estado
inicial (tipicamente 0 filas del backfill).
Correr DESPUÉS → todos deben pasar. El bloque de "sanity" al final imprime
también el diff detallado por tenant para poder auditar.
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import text

from app.core.database import AsyncSessionLocal


BACKFILL_ORIGIN = "backfill_fase5"


async def _scalar(session, sql: str, **params) -> int:
    result = await session.execute(text(sql), params)
    row = result.scalar()
    return int(row or 0)


async def _rows(session, sql: str, **params):
    result = await session.execute(text(sql), params)
    return result.all()


async def run() -> int:
    ok_all = True
    async with AsyncSessionLocal() as s:
        print("─" * 70)
        print("  Verificación de backfill Fase 5 — collaborators × obras")
        print("─" * 70)

        # ── 1. Estado general ────────────────────────────────────────────────
        n_collabs = await _scalar(s, """
            SELECT COUNT(*) FROM users
            WHERE role = 'collaborator' AND is_active = TRUE AND tenant_id IS NOT NULL
        """)
        n_obras = await _scalar(s, """
            SELECT COUNT(*) FROM obras WHERE tenant_id IS NOT NULL
        """)
        n_total_rows = await _scalar(s, "SELECT COUNT(*) FROM obra_user_roles")
        n_backfill_rows = await _scalar(
            s, "SELECT COUNT(*) FROM obra_user_roles WHERE origin = :o",
            o=BACKFILL_ORIGIN,
        )
        n_manual_rows = n_total_rows - n_backfill_rows

        print(f"  · Collaborators activos con tenant : {n_collabs}")
        print(f"  · Obras totales con tenant         : {n_obras}")
        print(f"  · Filas ObraUserRole totales       : {n_total_rows}")
        print(f"    - marcadas 'backfill_fase5'      : {n_backfill_rows}")
        print(f"    - manuales / invite (origin NULL): {n_manual_rows}")
        print()

        # ── 2. Conteo esperado por tenant ────────────────────────────────────
        # Para cada tenant: n_collabs × n_obras = filas esperadas totales
        # (activas + backfill, cualquier origen). Comparamos contra las que
        # efectivamente existen en ese tenant, para users con role='collaborator'.
        expected_per_tenant = await _rows(s, """
            SELECT
                t.id                       AS tenant_id,
                t.name                     AS tenant_name,
                (SELECT COUNT(*) FROM users
                   WHERE tenant_id = t.id AND role = 'collaborator'
                     AND is_active = TRUE) AS n_collabs,
                (SELECT COUNT(*) FROM obras
                   WHERE tenant_id = t.id) AS n_obras,
                (SELECT COUNT(*)
                   FROM obra_user_roles our
                   JOIN users u ON u.id = our.user_id
                   WHERE our.tenant_id = t.id AND u.role = 'collaborator') AS n_actual
            FROM tenants t
            ORDER BY t.id
        """)

        mismatches = []
        print(f"  Detalle por tenant:")
        print(f"  {'tenant_id':>9}  {'name':<24}  {'collabs':>8}  {'obras':>6}  {'esperado':>9}  {'actual':>7}  {'diff':>5}")
        for row in expected_per_tenant:
            tid, tname, nc, no, na = row
            expected = nc * no
            diff = na - expected
            marker = "" if diff == 0 else "  ⚠"
            print(f"  {tid:>9}  {(tname or '')[:24]:<24}  {nc:>8}  {no:>6}  {expected:>9}  {na:>7}  {diff:>+5d}{marker}")
            if diff != 0:
                mismatches.append((tid, tname, expected, na))
        print()

        if not expected_per_tenant:
            print("  (BD vacía o sin tenants — nada para verificar)")
        elif mismatches:
            ok_all = False
            print(f"  FAIL: {len(mismatches)} tenant(s) con mismatch entre esperado y actual.")
        else:
            print(f"  OK  : todos los tenants tienen exactamente collabs×obras filas.")
        print()

        # ── 3. Sin duplicados (UNIQUE constraint íntegro) ────────────────────
        n_dupes = await _scalar(s, """
            SELECT COUNT(*) FROM (
                SELECT obra_id, user_id
                FROM obra_user_roles
                GROUP BY obra_id, user_id
                HAVING COUNT(*) > 1
            ) t
        """)
        if n_dupes > 0:
            ok_all = False
            print(f"  FAIL: {n_dupes} par(es) (obra_id, user_id) duplicado(s).")
        else:
            print(f"  OK  : sin duplicados en (obra_id, user_id).")

        # ── 4. Sin cross-tenant ──────────────────────────────────────────────
        n_cross = await _scalar(s, """
            SELECT COUNT(*)
            FROM obra_user_roles our
            JOIN users u  ON u.id = our.user_id
            JOIN obras o  ON o.id = our.obra_id
            WHERE our.origin = :o
              AND (u.tenant_id != o.tenant_id
                   OR u.tenant_id IS NULL
                   OR o.tenant_id IS NULL
                   OR our.tenant_id != o.tenant_id)
        """, o=BACKFILL_ORIGIN)
        if n_cross > 0:
            ok_all = False
            print(f"  FAIL: {n_cross} fila(s) del backfill cruzan tenants.")
        else:
            print(f"  OK  : ningún cross-tenant en filas del backfill.")

        # ── 5. Ningún admin recibió filas del backfill ───────────────────────
        n_admin_backfill = await _scalar(s, """
            SELECT COUNT(*)
            FROM obra_user_roles our
            JOIN users u ON u.id = our.user_id
            WHERE our.origin = :o AND u.role = 'admin'
        """, o=BACKFILL_ORIGIN)
        if n_admin_backfill > 0:
            ok_all = False
            print(f"  FAIL: {n_admin_backfill} fila(s) del backfill creadas para admins de empresa (no deberían existir — el admin es superset).")
        else:
            print(f"  OK  : ningún admin de empresa tiene filas del backfill.")

        print("─" * 70)
        print("  RESULTADO:", "OK ✓" if ok_all else "FAIL ✗")
        print("─" * 70)

    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
