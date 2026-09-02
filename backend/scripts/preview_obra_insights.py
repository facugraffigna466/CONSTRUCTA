"""Vista previa del informe de una obra, SIN mandar ningún email.

Corre las etapas 2 (estadísticas), 3 (IA) y 4 (render) contra los datos reales
de una obra y deja el email en un archivo HTML para abrir en el navegador.
La etapa 5 (envío) NO se ejecuta: esto es para mirar, no para entregar.

    python scripts/preview_obra_insights.py 6              # período: mes pasado
    python scripts/preview_obra_insights.py 6 2026-09      # período explícito
    python scripts/preview_obra_insights.py 6 2026-09 --sin-ia   # no regenera conclusiones
"""
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.database import engine  # noqa: E402
from app.models.obra import Obra  # noqa: E402
from app.models.obra_insight import InsightStatus, ObraInsight  # noqa: E402
from app.services.email_service import build_insights_email_html  # noqa: E402
from app.services.obra_insight_service import ObraInsightService  # noqa: E402
from app.services.obra_stats_service import ObraStatsService, previous_period  # noqa: E402

# Después de los imports a propósito: el engine se crea con echo=True y al
# construirse vuelve a poner su logger en INFO, tapando la salida de SQL.
engine.echo = False
for _noisy in ("sqlalchemy.engine", "sqlalchemy.engine.Engine", "httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logging.getLogger("app.services.obra_insight_service").setLevel(logging.INFO)

OUT = Path(__file__).resolve().parent.parent.parent / "docs" / "features" / "samples"
LIVE = (InsightStatus.NUEVA, InsightStatus.VISTA, InsightStatus.APLICADA)


def _line(char="─", n=78):
    print(char * n)


async def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sin_ia = "--sin-ia" in sys.argv
    obra_id = int(args[0])
    period = args[1] if len(args) > 1 else previous_period()

    async with AsyncSession(engine, expire_on_commit=False) as db:
        obra = await db.get(Obra, obra_id)
        if obra is None:
            print(f"No existe la obra {obra_id}")
            return

        _line("═")
        print(f"  {obra.name}   ·   período {period}")
        _line("═")

        # ── Etapa 2 ──
        print("\n▸ ETAPA 2 — estadísticas (matemática pura, sin IA)\n")
        snap = await ObraStatsService(db).snapshot(obra_id, period)
        m = snap.metrics

        print(f"  Tareas: {m['obra']['task_count']} "
              f"({m['obra']['completed_task_count']} completadas) · estado {m['obra']['status']}")

        est = m["estimation_accuracy"]
        if est["by_discipline"]:
            print("\n  Precisión de estimación por disciplina:")
            for d in est["by_discipline"]:
                signo = "+" if d["avg_deviation_percent"] >= 0 else ""
                print(f"    · {d['discipline']:<18} {signo}{d['avg_deviation_percent']}%"
                      f"   ({d['task_count']} tarea/s)")
        else:
            print(f"\n  Precisión de estimación: sin datos medibles "
                  f"(excluidas: {est['tasks_excluded']})")

        conc = m["risk_concentration"]["by_task"]
        print(f"\n  Atraso acumulado: {conc['total_delay_days']} días en "
              f"{conc['tasks_with_delay']} tarea/s")
        if conc["total_delay_days"]:
            print(f"    El top {m['params']['concentration_top_percent']}% "
                  f"({conc['top_task_count']} tarea/s) concentra el "
                  f"{conc['concentration_percent']}% del atraso")
        for r in m["risk_concentration"]["by_responsible"]["ranking"][:5]:
            print(f"    · {str(r['name'] or 'sin nombre'):<22} {r['delay_days']:>4} días "
                  f"en {r['task_count']} tarea/s")

        print("\n  Mayores desvíos de cronograma:")
        for it in m["top_deviations"]["items"]:
            t = it["task"]
            print(f"    · #{t['task_id']} {t['title'][:40]:<42} {t['deviation_days']:>4} días  "
                  f"({len(it['historial_events'])} eventos, {len(it['alerts'])} alertas)")

        ar = m["alert_reaction"]
        print(f"\n  Alertas: {ar['alerts_total']} totales · {ar['alerts_measured']} medibles"
              f" · {ar['alerts_resolved_without_timestamp']} resueltas sin timestamp")
        if ar["alerts_unresolved_by_type"]:
            print(f"    Sin resolver: {ar['alerts_unresolved_by_type']}")

        bt = m["bitacora_themes"]
        print(f"\n  Bitácora: {bt['entries_analyzed']} entradas · "
              f"{bt['delay_signals_total']} señales de retraso detectadas")
        for c in bt["categories"]:
            print(f"    · {c['category']:<20} {c['mentions']} menciones, "
                  f"{c['mentions_followed_by_delay']} seguidas de retraso "
                  f"(tasa {c['correlation_rate']})")

        dq = m["data_quality"]["tasks_excluded_from_deviations"]
        if dq:
            print(f"\n  ⚠ Excluidas del cálculo por falta de datos: {dq}")

        # ── Etapa 3 ──
        if not sin_ia:
            print("\n▸ ETAPA 3 — la IA redacta (solo lee los números de arriba)\n")
            await ObraInsightService(db).generate_for_obra(obra_id, period)

        insights = list((await db.execute(
            select(ObraInsight)
            .where(ObraInsight.obra_id == obra_id, ObraInsight.status.in_(LIVE))
            .order_by(ObraInsight.created_at)
        )).scalars().all())

        if not insights:
            print("  (sin conclusiones — el email va a decir que no hubo novedades)")
        for i in insights:
            marca = "NUEVA" if i.last_period == period and not i.reinforcement_count else (
                f"REFORZADA x{i.reinforcement_count}" if i.last_period == period else "EN SEGUIMIENTO"
            )
            prio = (i.priority or "?").upper()
            print(f"  [{prio}] [{marca}]  {i.title}")
            print(f"      {i.description}")
            if i.recommendation:
                print(f"      QUÉ HACER: {i.recommendation}")
            if i.impact:
                print(f"      SI LO HACÉS: {i.impact}")
            print()

        # ── Etapa 4 ──
        html = build_insights_email_html(
            obra_id=obra_id, obra_name=obra.name, period=period,
            insights=insights, frontend_url="https://app.constructa.com.ar",
        )
        OUT.mkdir(parents=True, exist_ok=True)
        out = OUT / f"preview-obra-{obra_id}-{period}.html"
        out.write_text(html, encoding="utf-8")

        _line()
        print(f"▸ ETAPA 4 — email listo: {out}")
        print("  (la etapa 5 NO se ejecutó: no se mandó ningún email)")
        _line()

        await db.commit()


asyncio.run(main())
