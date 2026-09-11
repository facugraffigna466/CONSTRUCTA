"""Fire-and-forget asyncio tasks que sobreviven al garbage collector.

`asyncio.create_task(coro)` a secas es una trampa documentada: el event loop
solo guarda una referencia DÉBIL a la tarea. Si nada más la referencia, el GC
puede recolectarla en cualquier momento —incluso a mitad de ejecución, sin
excepción ni log— y la corrutina simplemente deja de correr. El riesgo es
real acá: estas tareas corren 20-40s (descarga de Twilio + Whisper + Claude),
una ventana larga para que un ciclo de GC se cruce.

`spawn_background` es el reemplazo: guarda una referencia fuerte en un set a
nivel de módulo hasta que la tarea termina, momento en el que se saca sola.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

# Referencia fuerte mientras la tarea está viva — sin esto, el garbage
# collector puede recolectarla en cualquier momento (ver docstring del módulo).
_background_tasks: set[asyncio.Task] = set()


def spawn_background(coro, *, name: str | None = None) -> asyncio.Task:
    """Lanza `coro` como tarea de background que no se pierde por GC.

    El caller sigue siendo responsable de que `coro` capture sus propias
    excepciones si no quiere que queden como "exception never retrieved" en
    los logs — este helper solo resuelve la retención de la referencia.
    """
    task = asyncio.create_task(coro, name=name)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task
