"""Redacción de conclusiones con IA (insights, etapa 3).

Consume el `ObraStatsSnapshot` que calculó la etapa 2 y produce conclusiones
narrativas guardadas en `obra_insights`.

**Regla de oro: la IA redacta, no calcula.** El único input del modelo es el
snapshot ya computado — nunca las tablas crudas de tareas/alertas/bitácoras.
Todo número que aparezca en el texto se valida programáticamente contra ese
snapshot antes de guardar (`_validate`); si cita un dato que no existe, la
conclusión se descarta y se loguea.

Ciclo de vida (código, no criterio de la IA):
  - patrón nuevo            → fila nueva en estado `nueva`
  - patrón ya activo        → se refuerza la fila existente (no se duplica)
  - patrón ya descartado    → solo resurge si la evidencia se DUPLICÓ
  - patrón que no apareció  → queda intacto
"""
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.obra import Obra, ObraStatus
from app.models.obra_insight import InsightStatus, ObraInsight
from app.models.obra_stats_snapshot import ObraStatsSnapshot

logger = logging.getLogger(__name__)

# Métricas sobre las que la IA puede concluir (las 5 de la etapa 2).
INSIGHT_METRICS = [
    "estimation_accuracy",
    "bitacora_themes",
    "schedule_deviation",
    "risk_concentration",
    "alert_reaction",
]

# Una conclusión descartada resurge solo si la evidencia de este mes es el
# DOBLE de fuerte que cuando se descartó. Con menos que eso se respeta la
# decisión del usuario: si descartó "falta de material" con 3 menciones, que
# vuelva con 4 es ruido; que vuelva con 6 es una señal distinta.
RESURFACE_STRENGTH_FACTOR = 2.0

# Estados en los que una conclusión sigue "viva" y por lo tanto se refuerza
# en vez de duplicarse.
ACTIVE_STATUSES = (InsightStatus.NUEVA, InsightStatus.VISTA, InsightStatus.APLICADA)

_INSIGHTS_SCHEMA = {
    "type": "object",
    "properties": {
        "conclusions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "metric": {"type": "string", "enum": INSIGHT_METRICS},
                    "subject": {
                        "type": "string",
                        "description": (
                            "Sujeto concreto de la conclusión, para agrupar el mismo patrón "
                            "entre meses: la disciplina, la categoría de bitácora, 'task_<id>', "
                            "'by_task'/'by_responsible' o el tipo de alerta."
                        ),
                    },
                    "title": {"type": "string", "description": "Título corto, sin punto final"},
                    "description": {
                        "type": "string",
                        "description": "Narrativa de 2 a 4 líneas en español rioplatense",
                    },
                    "evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Ruta con puntos dentro del snapshot, ej 'risk_concentration.by_task.concentration_percent'",
                                },
                                "value": {"type": "string", "description": "El valor exacto que hay en esa ruta"},
                            },
                            "required": ["path", "value"],
                            "additionalProperties": False,
                        },
                    },
                    "recommendation": {
                        "type": ["string", "null"],
                        "description": "Sugerencia accionable con mirada hacia adelante, o null",
                    },
                },
                "required": ["metric", "subject", "title", "description", "evidence", "recommendation"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["conclusions"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """\
Sos el analista de obra de CONSTRUCTA, una app de gestión de obras de construcción. \
Recibís un informe de estadísticas YA CALCULADO de una obra y escribís las conclusiones \
para el jefe de obra.

REGLA MÁS IMPORTANTE: vos redactás, NO calculás. Cada número que escribas tiene que estar \
literalmente en el JSON que te paso. No estimes, no promedies, no redondees a ojo, no \
infieras cifras que no estén. Un número inventado invalida la conclusión entera y se \
descarta automáticamente.

Sobre qué concluir — recorré estas cinco métricas y generá una conclusión por cada una que \
tenga algo relevante que decir:
1. estimation_accuracy — precisión de la estimación, si alguna disciplina tiene un desvío \
   significativo respecto de lo planificado.
2. bitacora_themes — temas que se repiten en la bitácora y su correlación con retrasos. \
   OJO: es correlación temporal, NO causalidad. Escribí "en X de las Y veces que se mencionó \
   Z hubo un retraso en los días siguientes", nunca "Z causó los retrasos".
3. schedule_deviation — la cadena de hechos detrás del mayor desvío de cronograma. Acá SÍ \
   armás la historia: usá el paquete de evidencia (historial, bitácoras, alertas, cascada) \
   de top_deviations para explicar qué pasó y en qué orden.
4. risk_concentration — si el atraso está concentrado en pocas tareas o pocos responsables.
5. alert_reaction — si hay algo destacable en cuánto se tarda en reaccionar a las alertas.

Si una métrica no tiene nada relevante ese mes, NO generes una conclusión sobre ella. \
Mejor tres conclusiones que importen que cinco rellenadas con paja. Si el snapshot no tiene \
datos suficientes para ninguna, devolvé la lista vacía.

Antes de concluir, mirá `data_quality`: si hay muchas tareas excluidas del cálculo, las \
métricas hablan de una parte de la obra y tu redacción tiene que matizarlo, no afirmar \
sobre el total.

Para cada conclusión:
- `title`: corto y concreto, sin punto final.
- `description`: 2 a 4 líneas, español rioplatense, tono profesional y directo. Nada de \
  relleno tipo "es importante destacar que".
- `evidence`: los datos exactos del snapshot que la sustentan, cada uno con su ruta con \
  puntos y el valor tal cual figura ahí. Citá el dato preciso, no una paráfrasis vaga.
- `recommendation`: cuando aplique, una acción concreta con mirada hacia adelante — no \
  "esto pasó" sino "esto pasó, y para tu próxima obra convendría…". Es una lección \
  aprendida que tiene que servir más allá de esta obra. Si no hay nada accionable, null.
- `subject`: el sujeto concreto del patrón, para poder seguirlo mes a mes — el nombre de la \
  disciplina, la categoría de bitácora, "task_<id>" para un desvío puntual, "by_task" o \
  "by_responsible" para concentración, o el tipo de alerta.
"""


# ── Utilidades de validación ──────────────────────────────────────────────────

def _norm_key(text: str) -> str:
    """Normaliza el `subject` para armar una topic_key estable entre meses."""
    stripped = unicodedata.normalize("NFKD", (text or "").lower())
    stripped = "".join(c for c in stripped if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "_", stripped).strip("_") or "general"


def _walk(node: Any):
    """Recorre el JSON del snapshot devolviendo cada valor escalar."""
    if isinstance(node, dict):
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item)
    else:
        yield node


def collect_numbers(snapshot: dict) -> set[float]:
    """Todos los números que aparecen en el snapshot, a cualquier profundidad."""
    numbers: set[float] = set()
    for value in _walk(snapshot):
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            numbers.add(float(value))
    return numbers


def collect_strings(snapshot: dict) -> set[str]:
    """Strings del snapshot (fechas, títulos, nombres) — se recortan del texto
    antes de buscar números sueltos, para no marcar el '2026' de una fecha."""
    return {v for v in _walk(snapshot) if isinstance(v, str) and v}


def resolve_path(snapshot: dict, path: str) -> Any:
    """Resuelve una ruta dentro del snapshot; `KeyError` si no existe.

    Acepta las dos notaciones de índice, porque el modelo usa naturalmente la
    de corchetes y rechazar por eso descartaría evidencia correctamente citada:
        top_deviations.items[0].task.deviation_days
        top_deviations.items.0.task.deviation_days
    """
    normalized = re.sub(r"\[(\d+)\]", r".\1", path.strip())
    node: Any = snapshot
    for part in normalized.split("."):
        if part == "":
            continue
        if isinstance(node, dict):
            if part not in node:
                raise KeyError(path)
            node = node[part]
        elif isinstance(node, list):
            if not part.lstrip("-").isdigit() or int(part) >= len(node):
                raise KeyError(path)
            node = node[int(part)]
        else:
            raise KeyError(path)
    return node


def _same_value(claimed: str, actual: Any) -> bool:
    """¿El valor citado por la IA coincide con el que hay en el snapshot?"""
    if actual is None:
        return claimed.strip().lower() in ("none", "null", "")
    if isinstance(actual, bool):
        return claimed.strip().lower() == str(actual).lower()
    if isinstance(actual, (int, float)):
        try:
            return abs(float(claimed.replace(",", ".").strip().rstrip("%").strip()) - float(actual)) < 0.05
        except ValueError:
            return False
    return claimed.strip().lower() == str(actual).strip().lower()


def _numbers_in_text(text: str, snapshot_strings: set[str]) -> list[float]:
    """Números sueltos del texto, después de sacar los strings literales del
    snapshot (fechas, títulos) para no contar sus dígitos como cifras citadas."""
    cleaned = text
    for literal in sorted(snapshot_strings, key=len, reverse=True):
        if len(literal) >= 4 and literal in cleaned:
            cleaned = cleaned.replace(literal, " ")
    # Fechas sueltas que no venían del snapshot tal cual
    cleaned = re.sub(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", " ", cleaned)
    cleaned = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", cleaned)

    out: list[float] = []
    for raw in re.findall(r"\d+(?:[.,]\d+)?", cleaned):
        try:
            out.append(float(raw.replace(",", ".")))
        except ValueError:
            continue
    return out


def _number_is_supported(value: float, snapshot_numbers: set[float]) -> bool:
    """El número está en el snapshot, o es ese mismo número redondeado.

    Se acepta el redondeo porque escribir "35 %" para un 34.8 del snapshot es
    redacción legítima, no una cifra inventada. Lo que no se acepta es un
    número que no se derive de ninguno de los del snapshot.
    """
    if value in snapshot_numbers:
        return True
    return any(
        round(n, 1) == value or round(n) == value or (n != 0 and abs(n - value) < 0.05)
        for n in snapshot_numbers
    )


class ObraInsightService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── API pública ───────────────────────────────────────────────────────────

    async def generate_for_obra(self, obra_id: int, period: str) -> list[ObraInsight]:
        """Genera y persiste las conclusiones de una obra para un período.

        Devuelve las filas creadas o reforzadas. Si no hay snapshot, si la IA
        falla o si nada pasa la validación, no guarda nada y devuelve [].
        """
        snapshot = (await self.session.execute(
            select(ObraStatsSnapshot).where(
                ObraStatsSnapshot.obra_id == obra_id,
                ObraStatsSnapshot.period == period,
            )
        )).scalar_one_or_none()
        if snapshot is None:
            logger.warning(
                "Insights: no hay snapshot para la obra %d en %s — nada que redactar", obra_id, period
            )
            return []

        metrics = snapshot.metrics or {}
        raw = await self._call_model(metrics)

        valid = []
        for conclusion in raw:
            problem = self._validate(conclusion, metrics)
            if problem:
                logger.warning(
                    "Insights: conclusión descartada por validación (obra %d, %s): %s | título=%r",
                    obra_id, period, problem, conclusion.get("title"),
                )
                continue
            valid.append(conclusion)

        if not valid:
            logger.info("Insights: ninguna conclusión válida para la obra %d en %s", obra_id, period)
            return []

        obra = await self.session.get(Obra, obra_id)
        saved = []
        for conclusion in valid:
            row = await self._persist(conclusion, metrics, obra_id, obra, period)
            if row is not None:
                saved.append(row)
        await self.session.flush()
        return saved

    async def generate_for_all_active(self, period: str) -> int:
        """Redacta para todas las obras activas. Un fallo no corta el job."""
        obras = list((await self.session.execute(
            select(Obra).where(
                Obra.status.notin_([ObraStatus.COMPLETADA, ObraStatus.CANCELADA])
            )
        )).scalars().all())

        total = 0
        for obra in obras:
            try:
                total += len(await self.generate_for_obra(obra.id, period))
            except Exception:
                logger.exception(
                    "Insights: falló la redacción de la obra %d (%s) — sigo con la siguiente",
                    obra.id, period,
                )
        return total

    # ── Llamada al modelo ─────────────────────────────────────────────────────

    async def _call_model(self, metrics: dict) -> list[dict]:
        """Claude Haiku con structured output — mismo patrón que bitacora_service.

        El ÚNICO input es el snapshot ya calculado: el modelo no ve las tablas
        crudas, así que no puede "investigar" ni inventar un número plausible.
        """
        if not settings.ANTHROPIC_API_KEY:
            logger.warning("Insights: ANTHROPIC_API_KEY no configurada — no se redacta nada")
            return []

        import anthropic

        user_msg = (
            "Este es el informe de estadísticas ya calculado de la obra. Es tu única fuente: "
            "todo número que escribas tiene que salir de acá.\n\n"
            f"{json.dumps(metrics, ensure_ascii=False, indent=2)}"
        )

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
            output_config={"format": {"type": "json_schema", "schema": _INSIGHTS_SCHEMA}},
        )
        if response.stop_reason in ("refusal", "max_tokens"):
            logger.warning("Insights: el modelo cortó por %s", response.stop_reason)
            return []
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            return []
        return json.loads(text).get("conclusions", [])

    # ── Validación anti-alucinación (código, no IA) ───────────────────────────

    def _validate(self, conclusion: dict, metrics: dict) -> str | None:
        """Devuelve el motivo del descarte, o None si la conclusión es válida.

        Dos capas:
          1. Cada ítem de evidencia tiene que resolver contra el snapshot con el
             valor que la IA dice. Los que no resuelven se descartan; si no
             queda ninguno válido, se cae la conclusión entera.
          2. Todo número del título/descripción tiene que existir en el snapshot
             (o ser ese número redondeado).
        """
        if conclusion.get("metric") not in INSIGHT_METRICS:
            return f"métrica desconocida: {conclusion.get('metric')!r}"
        if not (conclusion.get("title") or "").strip():
            return "sin título"
        if not (conclusion.get("description") or "").strip():
            return "sin descripción"

        kept = []
        for item in conclusion.get("evidence") or []:
            path, claimed = item.get("path", ""), item.get("value", "")
            try:
                actual = resolve_path(metrics, path)
            except (KeyError, TypeError):
                logger.info("Insights: evidencia con ruta inexistente, se descarta el ítem: %r", path)
                continue
            if not _same_value(str(claimed), actual):
                logger.info(
                    "Insights: evidencia con valor que no coincide (%s): dice %r, el snapshot tiene %r",
                    path, claimed, actual,
                )
                continue
            kept.append({"path": path, "value": str(claimed)})

        if not kept:
            return "ningún ítem de evidencia resolvió contra el snapshot"
        conclusion["evidence"] = kept

        numbers = collect_numbers(metrics)
        strings = collect_strings(metrics)
        text = f"{conclusion['title']} {conclusion['description']}"
        for value in _numbers_in_text(text, strings):
            if not _number_is_supported(value, numbers):
                return f"el texto cita {value:g}, que no está en el snapshot"

        return None

    # ── Ciclo de vida ─────────────────────────────────────────────────────────

    def _topic_key(self, conclusion: dict) -> str:
        return f"{conclusion['metric']}:{_norm_key(conclusion.get('subject', ''))}"

    def _strength(self, conclusion: dict, metrics: dict) -> float | None:
        """Magnitud del patrón, para comparar meses entre sí.

        Cada métrica se mide con su propia unidad (no son comparables entre sí,
        pero sí contra el mismo topic_key de otro mes, que es lo único que se
        necesita para decidir si una descartada resurge).
        """
        metric, subject = conclusion["metric"], (conclusion.get("subject") or "")
        try:
            if metric == "bitacora_themes":
                for cat in metrics["bitacora_themes"]["categories"]:
                    if _norm_key(cat["category"]) == _norm_key(subject):
                        return float(cat["mentions"])
            elif metric == "estimation_accuracy":
                for disc in metrics["estimation_accuracy"]["by_discipline"]:
                    if _norm_key(disc["discipline"]) == _norm_key(subject):
                        return abs(float(disc["avg_deviation_percent"]))
            elif metric == "schedule_deviation":
                wanted = _norm_key(subject)
                for item in metrics["top_deviations"]["items"]:
                    if _norm_key(f"task_{item['task']['task_id']}") == wanted:
                        return abs(float(item["task"]["deviation_days"]))
            elif metric == "risk_concentration":
                block = "by_responsible" if "responsable" in _norm_key(subject) else "by_task"
                return float(metrics["risk_concentration"][block]["concentration_percent"])
            elif metric == "alert_reaction":
                for row in metrics["alert_reaction"]["by_type"]:
                    if _norm_key(row["type"]) == _norm_key(subject):
                        return float(row["avg_hours"])
        except (KeyError, TypeError, ValueError, IndexError):
            return None
        return None

    async def _persist(
        self, conclusion: dict, metrics: dict, obra_id: int, obra: Obra | None, period: str
    ) -> ObraInsight | None:
        topic_key = self._topic_key(conclusion)
        strength = self._strength(conclusion, metrics)

        existing = list((await self.session.execute(
            select(ObraInsight)
            .where(ObraInsight.obra_id == obra_id, ObraInsight.topic_key == topic_key)
            .order_by(ObraInsight.created_at.desc())
        )).scalars().all())

        active = next((i for i in existing if i.status in ACTIVE_STATUSES), None)
        if active is not None:
            # Mismo patrón, ya vivo: se refuerza, no se duplica.
            active.reinforcement_count += 1
            active.title = conclusion["title"]
            active.description = conclusion["description"]
            active.evidence = conclusion["evidence"]
            active.recommendation = conclusion.get("recommendation")
            active.strength = strength
            active.last_period = period
            active.updated_at = datetime.now(timezone.utc)
            return active

        dismissed = next((i for i in existing if i.status == InsightStatus.DESCARTADA), None)
        if dismissed is not None:
            previous = dismissed.strength
            strong_enough = (
                strength is not None
                and previous is not None
                and strength >= previous * RESURFACE_STRENGTH_FACTOR
            )
            if not strong_enough:
                logger.info(
                    "Insights: '%s' ya fue descartada y la evidencia de %s no la duplica "
                    "(antes %s, ahora %s) — no resurge",
                    topic_key, period, previous, strength,
                )
                return None
            return self._new_row(
                conclusion, obra_id, obra, period, topic_key, strength,
                resurfaced_from=dismissed.id,
            )

        return self._new_row(conclusion, obra_id, obra, period, topic_key, strength)

    def _new_row(
        self, conclusion: dict, obra_id: int, obra: Obra | None, period: str,
        topic_key: str, strength: float | None, resurfaced_from: int | None = None,
    ) -> ObraInsight:
        row = ObraInsight(
            obra_id=obra_id,
            tenant_id=obra.tenant_id if obra else None,
            metric=conclusion["metric"],
            topic_key=topic_key,
            title=conclusion["title"],
            description=conclusion["description"],
            evidence=conclusion["evidence"],
            recommendation=conclusion.get("recommendation"),
            status=InsightStatus.NUEVA,
            reinforcement_count=0,
            strength=strength,
            first_period=period,
            last_period=period,
            resurfaced_from_insight_id=resurfaced_from,
        )
        self.session.add(row)
        return row


# ── Disparo manual (consola / tests, sin endpoint HTTP) ───────────────────────

async def run_obra_insights(obra_id: int, period: str) -> int:
    """Redacta y guarda las conclusiones de UNA obra. Devuelve cuántas quedaron."""
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    from app.core.database import engine

    async with _Session(engine, expire_on_commit=False) as session:
        rows = await ObraInsightService(session).generate_for_obra(obra_id, period)
        count = len(rows)
        await session.commit()
        return count


async def run_all_active_insights(period: str) -> int:
    """Redacta para todas las obras activas. Devuelve el total de conclusiones."""
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    from app.core.database import engine

    async with _Session(engine, expire_on_commit=False) as session:
        total = await ObraInsightService(session).generate_for_all_active(period)
        await session.commit()
        return total
