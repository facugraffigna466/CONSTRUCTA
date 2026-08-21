"""Limpieza de archivos huérfanos en backend/uploads/.

Un huérfano es un archivo en disco que ninguna fila de la base referencia: planos
borrados antes de que `PlanoService.delete()` limpiara el disco, obras borradas por
CASCADE, uploads que fallaron a mitad de camino, o basura de pruebas.

El código ya no genera huérfanos nuevos (ver migración 0045 y los fixes del audit
05), así que esto es para la basura acumulada. Corre en dry-run por defecto:

    python scripts/limpiar_uploads_huerfanos.py            # solo reporta
    python scripts/limpiar_uploads_huerfanos.py --borrar   # borra de verdad

Se salta los archivos modificados en las últimas 24 h para no pisar un upload que
esté a mitad de una transacción abierta.
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402

UPLOADS = Path(__file__).parent.parent / "uploads"
GRACIA_SEGUNDOS = 24 * 3600


async def referenciados() -> set[str]:
    """Todos los nombres de archivo que la base dice que están en uso."""
    async with AsyncSessionLocal() as s:
        planos = set((await s.execute(text("SELECT file_path FROM planos"))).scalars().all())
        audios = set((await s.execute(text(
            "SELECT regexp_replace(audio_path, '^/uploads/', '') FROM bitacora_entries "
            "WHERE audio_path IS NOT NULL"
        ))).scalars().all())
        imgs = set((await s.execute(text(
            "SELECT regexp_replace(image_url, '^.*/', '') FROM obras WHERE image_url IS NOT NULL"
        ))).scalars().all())
        avatares = set((await s.execute(text(
            "SELECT regexp_replace(avatar_url, '^.*/', '') FROM users WHERE avatar_url IS NOT NULL"
        ))).scalars().all())
    return {n for n in (planos | audios | imgs | avatares) if n}


async def main(borrar: bool) -> None:
    en_uso = await referenciados()
    ahora = time.time()

    huerfanos, recientes, total_bytes = [], 0, 0
    for f in UPLOADS.iterdir():
        if not f.is_file() or f.name.startswith("."):
            continue
        if f.name in en_uso:
            continue
        if ahora - f.stat().st_mtime < GRACIA_SEGUNDOS:
            recientes += 1
            continue
        huerfanos.append(f)
        total_bytes += f.stat().st_size

    print(f"En uso según la base : {len(en_uso)}")
    print(f"Huérfanos            : {len(huerfanos)} ({total_bytes / 1024 / 1024:.1f} MB)")
    if recientes:
        print(f"Omitidos (< 24 h)    : {recientes}")

    if not huerfanos:
        print("\nNada que limpiar.")
        return

    if not borrar:
        for f in sorted(huerfanos)[:20]:
            print(f"   {f.name}  {f.stat().st_size / 1024:.0f} KB")
        if len(huerfanos) > 20:
            print(f"   … y {len(huerfanos) - 20} más")
        print("\nDry-run: no se borró nada. Corré con --borrar para eliminarlos.")
        return

    for f in huerfanos:
        f.unlink(missing_ok=True)
    print(f"\nBorrados {len(huerfanos)} archivos ({total_bytes / 1024 / 1024:.1f} MB liberados).")


if __name__ == "__main__":
    asyncio.run(main(borrar="--borrar" in sys.argv))
