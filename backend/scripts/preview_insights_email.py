"""Genera un HTML de ejemplo del email mensual de insights, para abrirlo en el navegador.

    python scripts/preview_insights_email.py            # caso normal
    python scripts/preview_insights_email.py --vacio    # caso sin conclusiones

Los textos son las conclusiones REALES que generó la etapa 3 sobre la obra #5
(período 2026-09), para que la vista previa represente el largo y el tono que
produce la IA de verdad y no un lorem ipsum optimista.
"""
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.email_service import build_insights_email_html  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent.parent / "docs" / "features" / "samples"


@dataclass
class FakeInsight:
    """Duck-type de ObraInsight: el builder solo lee estos atributos."""
    title: str
    description: str
    last_period: str
    status: str = "nueva"
    reinforcement_count: int = 0
    recommendation: str | None = None
    evidence: list = field(default_factory=list)


PERIOD = "2026-09"

NUEVAS = [
    FakeInsight(
        title="'Estructura y losa' acumula 39 días de retraso y arrastra al resto de la obra",
        description=(
            "La tarea 'Estructura y losa' (task 36) venció el 22/08 y al cierre del período sigue "
            "en progreso, acumulando 39 días de retraso medidos contra el 30/09. El sistema generó "
            "dos alertas el 24/08 — dos días después del vencimiento — pero ninguna fue resuelta. "
            "Su único dependiente directo es la tarea 37 ('Mampostería'), que a su vez es predecesora "
            "de 'Instalaciones sanitarias' (task 39) e 'Instalaciones eléctricas' (task 40), ambas "
            "también vencidas. El bloqueo en la estructura es el punto de origen visible de una cadena "
            "de tareas sin avance."
        ),
        recommendation=(
            "Cuando una tarea de estructura se vence y no avanza en 48 horas, conviene escalar "
            "inmediatamente a una reunión de obra con foco en destrabar el cuello de botella, antes "
            "de que el retraso se propague a toda la cadena de dependencias."
        ),
        last_period=PERIOD,
    ),
    FakeInsight(
        title="Carlos Méndez concentra el 39% del retraso total asignado",
        description=(
            "De los 3 responsables con retraso, Carlos Méndez (responsible_id 13) acumula 73 días de "
            "delay en 2 tareas, representando el 39% del total de 187 días asignados a responsables. "
            "Juan Pérez suma 65 días en 2 tareas y Ana López 49 días en 2 tareas. El retraso está "
            "distribuido entre todos los responsables, pero Méndez encabeza con una diferencia "
            "apreciable respecto del segundo."
        ),
        recommendation=(
            "Cuando un responsable concentra más de un tercio del retraso total, vale revisar si tiene "
            "sobrecarga de tareas simultáneas o si sus asignaciones están trabadas por factores "
            "externos, y redistribuir o reforzar antes de que el desvío siga creciendo."
        ),
        last_period=PERIOD,
        status="vista",
        reinforcement_count=2,
    ),
    FakeInsight(
        title="7 de 7 tareas con retraso: toda la obra activa está demorada",
        description=(
            "El universo de tareas con desvío incluye las 7 tareas consideradas, todas con delay mayor "
            "a cero. El total acumulado es de 210 días de retraso. Las 2 tareas del top 20% "
            "('Estructura y losa' con 39 días e 'Instalaciones sanitarias' con 34 días) concentran el "
            "34,8% de ese total. Cabe notar que 2 tareas completadas quedaron excluidas del cálculo por "
            "falta de fecha de completado, por lo que las métricas reflejan las 7 tareas restantes."
        ),
        recommendation=(
            "Registrar la fecha de completado en el momento exacto en que se cierra cada tarea es clave "
            "para que las métricas de concentración y precisión de estimación reflejen la obra completa, "
            "no solo las tareas abiertas."
        ),
        last_period=PERIOD,
    ),
]

EN_SEGUIMIENTO = [
    FakeInsight(
        title="La falta de material precede a los retrasos en la mayoría de los casos",
        description=(
            "Se mencionó falta de material 5 veces en la bitácora y en 4 de esas hubo un retraso dentro "
            "de los 5 días siguientes. La correlación es temporal, no causal, pero el patrón se sostiene "
            "desde julio."
        ),
        recommendation="Confirmá el stock la semana previa a cada hito de hormigonado.",
        last_period="2026-08",
        status="vista",
        reinforcement_count=1,
    ),
    FakeInsight(
        title="Electricidad se estima 25% por debajo de lo que después tarda",
        description=(
            "Las 3 tareas de electricidad cerradas tardaron en promedio un 25% más que lo planificado. "
            "El desvío viene siendo consistente desde el inicio de la obra."
        ),
        recommendation="Sumá un 25% de colchón a las estimaciones de electricidad en la próxima obra.",
        last_period="2026-07",
        status="vista",
    ),
]


def main() -> None:
    vacio = "--vacio" in sys.argv
    insights = [] if vacio else NUEVAS + EN_SEGUIMIENTO
    html = build_insights_email_html(
        obra_id=5,
        obra_name="Vivienda Unifamiliar — Barrio Jardín",
        period=PERIOD,
        insights=insights,
        frontend_url="https://app.constructa.com.ar",
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    name = "insights-email-sin-novedades.html" if vacio else "insights-email-ejemplo.html"
    out = OUT_DIR / name
    out.write_text(html, encoding="utf-8")
    print(f"{out}  ({len(html):,} bytes, {len(insights)} conclusiones)")


if __name__ == "__main__":
    main()
