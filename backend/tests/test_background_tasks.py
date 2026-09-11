"""spawn_background: la tarea sobrevive al garbage collector.

`asyncio.create_task(coro)` a secas solo deja al event loop con una
referencia DÉBIL — sin nada más apuntándola, el GC puede recolectarla a
mitad de ejecución, sin excepción ni log. Es justo el riesgo que corrían las
tareas de bitácora por WhatsApp (Whisper + Claude, 20-40s de ventana): la
nota de voz podía quedar sin procesar y sin avisar por WhatsApp, en
silencio. Este test reproduce el escenario: fuerza un ciclo de GC mientras
la tarea está en vuelo y verifica que igual termina.
"""
import asyncio
import gc

import pytest

from app.core.background_tasks import _background_tasks, spawn_background

pytestmark = pytest.mark.asyncio


async def test_spawn_background_survives_gc_mid_execution():
    started = asyncio.Event()
    finished = asyncio.Event()

    async def _slow():
        started.set()
        await asyncio.sleep(0.05)
        finished.set()

    spawn_background(_slow())  # sin guardar la referencia devuelta a propósito
    await started.wait()

    # El escenario exacto del bug: nada en el scope del caller referencia la
    # tarea. Sin la retención fuerte de spawn_background, este gc.collect()
    # podía recolectarla y la corrutina jamás llegaba a `finished.set()`.
    gc.collect()

    await asyncio.wait_for(finished.wait(), timeout=1)
    assert finished.is_set()


async def test_spawn_background_removes_itself_when_done():
    async def _noop():
        pass

    task = spawn_background(_noop())
    assert task in _background_tasks
    await task
    assert task not in _background_tasks


async def test_spawn_background_propagates_exceptions_to_the_task():
    """El helper no traga errores — solo evita que el GC se lleve la tarea.
    Si el caller no los atrapa adentro de la corrutina, quedan en la Task
    (comportamiento estándar de asyncio), no silenciados por spawn_background."""
    async def _boom():
        raise ValueError("kaboom")

    task = spawn_background(_boom())
    with pytest.raises(ValueError, match="kaboom"):
        await task
