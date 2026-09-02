"""Informe completo imprimible de una obra (insights).

Es el destino del botón del email: una página autocontenida que se abre en el
navegador y se imprime a PDF. No depende del frontend ni de JavaScript externo
— los gráficos son SVG generado acá, así que imprimen igual que se ven.

Sobre los colores de los gráficos: salen de la paleta validada del skill de
dataviz, no elegidos a ojo. El par divergente azul↔rojo pasó las seis
verificaciones (banda de luminosidad, chroma, separación para daltonismo, piso
de visión normal y contraste contra la superficie). Los colores de estado
(bien/atención/crítico) son fijos y **siempre van acompañados de texto**, nunca
solos.
"""
import html
import logging
from datetime import datetime, timezone
from typing import Any

from app.services.email_service import _period_label

logger = logging.getLogger(__name__)

# ── Paleta ────────────────────────────────────────────────────────────────────
# Marcas de datos: paleta validada.
C_DATA = "#2a78d6"        # azul — magnitud (serie única)
C_OVER = "#e34948"        # rojo — se pasó de lo estimado
C_UNDER = "#2a78d6"       # azul — terminó antes
C_NEUTRAL = "#f0efec"     # gris — punto medio del divergente

# Chrome del documento: marca CONSTRUCTA.
C_BRAND = "#FF6B35"
C_INK = "#1A2329"
C_MUTED = "#5B6770"
C_FAINT = "#94928D"
C_LINE = "#E6E7E5"
C_SURFACE = "#FBFAF8"

# Estado (fijos, siempre con texto al lado).
C_CRITICAL = "#d03b3b"
C_GOOD = "#0ca30c"


def _e(text: Any) -> str:
    return html.escape(str(text if text is not None else ""))


# ── Gráficos (SVG inline) ─────────────────────────────────────────────────────

def _hbar_chart(
    rows: list[tuple[str, float]],
    *,
    unit: str = "días",
    color: str = C_DATA,
    width: int = 620,
    label_w: int = 190,
) -> str:
    """Barras horizontales ordenadas de mayor a menor, con etiqueta directa.

    Serie única: sin leyenda, el título del bloque ya nombra qué mide. Cada barra
    lleva su valor escrito al lado — en papel no hay hover que valga.
    """
    if not rows:
        return ""
    bar_h, gap, pad_top = 22, 10, 6
    height = pad_top + len(rows) * (bar_h + gap) + 14
    max_v = max(abs(v) for _, v in rows) or 1
    plot_w = width - label_w - 70

    parts = []
    for i, (label, value) in enumerate(rows):
        y = pad_top + i * (bar_h + gap)
        w = max(2, abs(value) / max_v * plot_w)
        short = label if len(label) <= 26 else label[:25] + "…"
        parts.append(
            f'<text x="{label_w - 10}" y="{y + bar_h / 2 + 4:.0f}" text-anchor="end" '
            f'font-size="12" fill="{C_MUTED}">{_e(short)}</text>'
            # Extremo redondeado de 4px del lado del dato, anclado a la línea base
            f'<rect x="{label_w}" y="{y}" width="{w:.1f}" height="{bar_h}" rx="4" fill="{color}"/>'
            f'<text x="{label_w + w + 8:.1f}" y="{y + bar_h / 2 + 4:.0f}" font-size="12" '
            f'font-weight="700" fill="{C_INK}">{value:g}</text>'
        )

    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" role="img" '
        f'style="display:block;max-width:{width}px">'
        f'<line x1="{label_w}" y1="0" x2="{label_w}" y2="{height - 14}" '
        f'stroke="{C_LINE}" stroke-width="1"/>'
        + "".join(parts)
        + f'<text x="{label_w}" y="{height - 2}" font-size="10.5" fill="{C_FAINT}">en {_e(unit)}</text>'
        + "</svg>"
    )


def _diverging_chart(rows: list[tuple[str, float]], *, width: int = 620) -> str:
    """Desvío de estimación por disciplina: dos polos y un cero neutro.

    Positivo = tardó más de lo planificado; negativo = terminó antes. Las dos
    leyendas del eje hacen el trabajo de una caja de leyenda, y cada barra lleva
    su valor: el color no carga solo el significado.
    """
    if not rows:
        return ""
    bar_h, gap, pad_top, label_w = 22, 10, 22, 150
    height = pad_top + len(rows) * (bar_h + gap)
    max_v = max(abs(v) for _, v in rows) or 1
    plot_w = width - label_w - 60
    zero_x = label_w + plot_w / 2
    arm = plot_w / 2

    parts = [
        f'<text x="{zero_x - 8:.0f}" y="12" text-anchor="end" font-size="10.5" '
        f'fill="{C_FAINT}">← terminó antes</text>',
        f'<text x="{zero_x + 8:.0f}" y="12" font-size="10.5" fill="{C_FAINT}">tardó más →</text>',
    ]
    for i, (label, value) in enumerate(rows):
        y = pad_top + i * (bar_h + gap)
        w = max(2, abs(value) / max_v * arm)
        over = value >= 0
        x = zero_x if over else zero_x - w
        short = label if len(label) <= 20 else label[:19] + "…"
        tx = x + w + 8 if over else x - 8
        parts.append(
            f'<text x="{label_w - 10}" y="{y + bar_h / 2 + 4:.0f}" text-anchor="end" '
            f'font-size="12" fill="{C_MUTED}">{_e(short)}</text>'
            f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="{bar_h}" rx="4" '
            f'fill="{C_OVER if over else C_UNDER}"/>'
            f'<text x="{tx:.1f}" y="{y + bar_h / 2 + 4:.0f}" text-anchor="{"start" if over else "end"}" '
            f'font-size="12" font-weight="700" fill="{C_INK}">{"+" if over else ""}{value:g}%</text>'
        )

    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" role="img" '
        f'style="display:block;max-width:{width}px">'
        f'<rect x="{zero_x - 1:.0f}" y="{pad_top - 6}" width="2" height="{height - pad_top + 4}" '
        f'fill="{C_NEUTRAL}"/>'
        + "".join(parts)
        + "</svg>"
    )


def _stat(value: Any, label: str, tone: str = "ink") -> str:
    color = {"critical": C_CRITICAL, "brand": C_BRAND, "good": C_GOOD}.get(tone, C_INK)
    return (
        f'<div style="flex:1;min-width:132px;padding:16px 18px;background:{C_SURFACE};'
        f'border:1px solid {C_LINE};border-radius:12px;">'
        f'<div style="font-size:26px;font-weight:800;color:{color};line-height:1.1;">{_e(value)}</div>'
        f'<div style="font-size:11.5px;color:{C_MUTED};margin-top:4px;line-height:1.35;">{_e(label)}</div>'
        f"</div>"
    )


def _section(title: str, body: str, *, subtitle: str = "") -> str:
    if not body:
        return ""
    sub = (
        f'<p style="margin:0 0 14px;font-size:12.5px;color:{C_FAINT};line-height:1.5;">{_e(subtitle)}</p>'
        if subtitle else ""
    )
    return (
        f'<section style="margin:0 0 34px;page-break-inside:avoid;">'
        f'<h2 style="margin:0 0 6px;font-size:15px;font-weight:800;color:{C_INK};'
        f'text-transform:uppercase;letter-spacing:0.07em;">{_e(title)}</h2>{sub}{body}</section>'
    )


# ── Bloques de contenido ──────────────────────────────────────────────────────

def _conclusions_block(insights: list) -> str:
    if not insights:
        return (
            f'<p style="margin:0;padding:20px;background:{C_SURFACE};border:1px solid {C_LINE};'
            f'border-radius:12px;font-size:14px;color:{C_MUTED};line-height:1.6;">'
            "Este mes no encontramos patrones nuevos que valga la pena marcarte. "
            "Los números de abajo se siguen midiendo igual.</p>"
        )
    cards = []
    for i in insights:
        reps = getattr(i, "reinforcement_count", 0) or 0
        badge = ""
        if reps:
            veces = "vez" if reps == 1 else "veces"
            badge = (
                f'<span style="margin-left:8px;padding:2px 8px;background:#FFF1EA;color:{C_BRAND};'
                f'font-size:10.5px;font-weight:700;border-radius:20px;white-space:nowrap;">'
                f'Se repitió {reps} {veces}</span>'
            )
        rec = getattr(i, "recommendation", None)
        rec_html = (
            f'<div style="margin:12px 0 0;padding:11px 13px;background:#FFF8F5;'
            f'border-left:3px solid {C_BRAND};border-radius:0 8px 8px 0;">'
            f'<div style="font-size:10px;font-weight:700;color:{C_BRAND};text-transform:uppercase;'
            f'letter-spacing:0.08em;margin-bottom:3px;">Para la próxima</div>'
            f'<div style="font-size:13px;color:{C_MUTED};line-height:1.55;">{_e(rec)}</div></div>'
        ) if rec else ""

        ev = getattr(i, "evidence", None) or []
        ev_html = ""
        if ev:
            items = "".join(
                f'<li style="margin:0 0 3px;font-size:11px;color:{C_FAINT};">'
                f'{_e(e.get("path"))} = <strong style="color:{C_MUTED};">{_e(e.get("value"))}</strong></li>'
                for e in ev[:6]
            )
            ev_html = (
                f'<div style="margin-top:10px;padding-top:8px;border-top:1px dashed {C_LINE};">'
                f'<div style="font-size:10px;font-weight:700;color:{C_FAINT};text-transform:uppercase;'
                f'letter-spacing:0.06em;margin-bottom:4px;">Datos que la respaldan</div>'
                f'<ul style="margin:0;padding-left:14px;">{items}</ul></div>'
            )

        cards.append(
            f'<article style="margin:0 0 16px;padding:18px 20px;background:#fff;'
            f'border:1px solid {C_LINE};border-radius:12px;page-break-inside:avoid;">'
            f'<h3 style="margin:0 0 8px;font-size:15px;font-weight:800;color:{C_INK};line-height:1.35;">'
            f'{_e(getattr(i, "title", ""))}{badge}</h3>'
            f'<p style="margin:0;font-size:14px;color:{C_MUTED};line-height:1.65;">'
            f'{_e(getattr(i, "description", ""))}</p>{rec_html}{ev_html}</article>'
        )
    return "".join(cards)


def _deviation_detail(metrics: dict) -> str:
    items = (metrics.get("top_deviations") or {}).get("items") or []
    if not items:
        return ""
    blocks = []
    for it in items:
        t = it["task"]
        ev_rows = "".join(
            f'<li style="margin:0 0 4px;font-size:12px;color:{C_MUTED};line-height:1.5;">'
            f'<span style="color:{C_FAINT};">{_e((e.get("created_at") or "")[:10])}</span> · '
            f'{_e(e.get("description"))}</li>'
            for e in (it.get("historial_events") or [])[-6:]
        )
        al_rows = "".join(
            f'<li style="margin:0 0 4px;font-size:12px;color:{C_MUTED};line-height:1.5;">'
            f'<span style="color:{C_FAINT};">{_e((a.get("created_at") or "")[:10])}</span> · '
            f'{_e(a.get("message"))}'
            + (f' <span style="color:{C_FAINT};">(de una predecesora)</span>'
               if a.get("on_predecessor") else "")
            + "</li>"
            for a in (it.get("alerts") or [])[:6]
        )
        casc = it.get("cascade_impact") or {}
        casc_txt = ""
        if casc.get("direct_dependent_count"):
            ids = ", #".join(str(x) for x in casc.get("direct_dependent_task_ids", []))
            casc_txt = (
                f'<p style="margin:8px 0 0;font-size:12px;color:{C_MUTED};line-height:1.5;">'
                f'Traba <strong>{casc["direct_dependent_count"]}</strong> tarea/s que dependen '
                f'directamente de ella (#{ids}).</p>'
            )
        cerro = (f'Cerró el {_e(t["completed_date"])}' if t.get("completed_date") else "Sin cerrar")

        blocks.append(
            f'<article style="margin:0 0 16px;padding:16px 18px;background:{C_SURFACE};'
            f'border:1px solid {C_LINE};border-radius:12px;page-break-inside:avoid;">'
            f'<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;">'
            f'<h3 style="margin:0;font-size:14px;font-weight:800;color:{C_INK};line-height:1.35;">'
            f'#{t["task_id"]} · {_e(t["title"])}</h3>'
            f'<span style="font-size:16px;font-weight:800;color:{C_CRITICAL};white-space:nowrap;">'
            f'{t["deviation_days"]:+d} días</span></div>'
            f'<p style="margin:6px 0 0;font-size:12px;color:{C_FAINT};line-height:1.5;">'
            f'Planificado {_e(t.get("start_date") or "—")} → {_e(t.get("due_date") or "—")} · '
            f'{_e(t.get("status"))} · {cerro}</p>'
            + casc_txt
            + (f'<div style="margin:12px 0 4px;font-size:10.5px;font-weight:700;color:{C_INK};'
               f'text-transform:uppercase;letter-spacing:0.06em;">Qué registró el sistema</div>'
               f'<ul style="margin:0;padding-left:16px;">{ev_rows}</ul>' if ev_rows else "")
            + (f'<div style="margin:12px 0 4px;font-size:10.5px;font-weight:700;color:{C_INK};'
               f'text-transform:uppercase;letter-spacing:0.06em;">Alertas</div>'
               f'<ul style="margin:0;padding-left:16px;">{al_rows}</ul>' if al_rows else "")
            + "</article>"
        )
    return "".join(blocks)


def build_full_report_html(*, obra_name: str, period: str, metrics: dict, insights: list) -> str:
    """Informe completo autocontenido, listo para imprimir a PDF."""
    m = metrics or {}
    obra = m.get("obra") or {}
    conc = (m.get("risk_concentration") or {}).get("by_task") or {}
    by_resp = (m.get("risk_concentration") or {}).get("by_responsible") or {}
    est = m.get("estimation_accuracy") or {}
    alert = m.get("alert_reaction") or {}
    bit = m.get("bitacora_themes") or {}
    dq = (m.get("data_quality") or {}).get("tasks_excluded_from_deviations") or {}
    label = _period_label(period)

    unresolved = sum((alert.get("alerts_unresolved_by_type") or {}).values())
    stats = "".join([
        _stat(conc.get("total_delay_days", 0), "días de atraso acumulados",
              tone="critical" if conc.get("total_delay_days") else "good"),
        _stat(f'{conc.get("tasks_with_delay", 0)} de {conc.get("tasks_considered", 0)}',
              "tareas con retraso"),
        _stat(f'{obra.get("completed_task_count", 0)} de {obra.get("task_count", 0)}',
              "tareas completadas"),
        _stat(unresolved, "alertas sin resolver", tone="critical" if unresolved else "good"),
    ])

    task_rows = [(r["title"], r["delay_days"])
                 for r in (conc.get("ranking") or [])[:8] if r.get("delay_days")]
    chart_tasks = _section(
        "Dónde está el atraso",
        _hbar_chart(task_rows),
        subtitle=(
            f'Las {conc.get("top_task_count", 0)} tareas del top '
            f'{(m.get("params") or {}).get("concentration_top_percent", 20)}% concentran el '
            f'{conc.get("concentration_percent", 0)}% de los {conc.get("total_delay_days", 0)} '
            "días de atraso de la obra."
        ) if task_rows else "",
    )

    resp_rows = [(r.get("name") or f'Responsable {r.get("responsible_id")}', r["delay_days"])
                 for r in (by_resp.get("ranking") or [])[:8] if r.get("delay_days")]
    chart_resp = _section(
        "Atraso por responsable",
        _hbar_chart(resp_rows),
        subtitle=(
            f'{by_resp.get("unassigned_delay_days", 0)} días son de tareas sin responsable '
            "asignado y no aparecen en este gráfico."
        ) if by_resp.get("unassigned_delay_days") else "",
    )

    disc_rows = [(d["discipline"], d["avg_deviation_percent"]) for d in (est.get("by_discipline") or [])]
    if disc_rows:
        chart_est = _section(
            "Precisión de la estimación por disciplina",
            _diverging_chart(disc_rows),
            subtitle=("Cuánto se desvió la duración real respecto de la planificada. La disciplina "
                      "se deduce del título de cada tarea, no es un dato cargado a mano."),
        )
    else:
        faltan = ", ".join(f'{v} {k.replace("_", " ")}' for k, v in (est.get("tasks_excluded") or {}).items())
        chart_est = _section(
            "Precisión de la estimación por disciplina",
            f'<p style="margin:0;font-size:13px;color:{C_MUTED};line-height:1.6;">'
            "Todavía no hay tareas medibles: para comparar lo estimado con lo real hace falta que "
            "la tarea esté cerrada y tenga fecha de inicio, de fin planificado y de completado."
            + (f' Quedaron afuera: {_e(faltan)}.' if faltan else "")
            + "</p>",
        )

    bit_rows = "".join(
        f'<tr><td style="padding:7px 10px;font-size:12.5px;color:{C_INK};border-bottom:1px solid {C_LINE};">'
        f'{_e(c["category"].replace("_", " "))}</td>'
        f'<td style="padding:7px 10px;font-size:12.5px;color:{C_MUTED};text-align:center;'
        f'border-bottom:1px solid {C_LINE};">{c["mentions"]}</td>'
        f'<td style="padding:7px 10px;font-size:12.5px;color:{C_MUTED};text-align:center;'
        f'border-bottom:1px solid {C_LINE};">{c["mentions_followed_by_delay"]}</td>'
        f'<td style="padding:7px 10px;font-size:12.5px;font-weight:700;color:{C_INK};text-align:center;'
        f'border-bottom:1px solid {C_LINE};">{int(c["correlation_rate"] * 100)}%</td></tr>'
        for c in (bit.get("categories") or [])
    )
    bitacora_block = _section(
        "Temas de la bitácora",
        (f'<table style="width:100%;border-collapse:collapse;">'
         f'<tr><th style="text-align:left;padding:6px 10px;font-size:10px;color:{C_FAINT};'
         f'text-transform:uppercase;letter-spacing:0.06em;">Tema</th>'
         f'<th style="padding:6px 10px;font-size:10px;color:{C_FAINT};text-transform:uppercase;'
         f'letter-spacing:0.06em;">Menciones</th>'
         f'<th style="padding:6px 10px;font-size:10px;color:{C_FAINT};text-transform:uppercase;'
         f'letter-spacing:0.06em;">Con retraso después</th>'
         f'<th style="padding:6px 10px;font-size:10px;color:{C_FAINT};text-transform:uppercase;'
         f'letter-spacing:0.06em;">Tasa</th></tr>{bit_rows}</table>') if bit_rows else "",
        subtitle=(
            f'Sobre {bit.get("entries_analyzed", 0)} entradas de bitácora. Es correlación temporal, '
            f'no causa: mide si hubo un retraso dentro de los '
            f'{bit.get("correlation_window_days", 5)} días siguientes a cada mención.'
        ),
    )

    alert_rows = [(r["type"].replace("_", " "), r["avg_hours"]) for r in (alert.get("by_type") or [])]
    if alert_rows:
        alert_body = _hbar_chart(alert_rows, unit="horas promedio hasta resolverla")
        alert_sub = f'Sobre {alert.get("alerts_measured", 0)} alertas con tiempo medible.'
    else:
        pend = ", ".join(f'{v} de {k.replace("_", " ")}'
                         for k, v in (alert.get("alerts_unresolved_by_type") or {}).items())
        alert_body = (
            f'<p style="margin:0;font-size:13px;color:{C_MUTED};line-height:1.6;">'
            f'De {alert.get("alerts_total", 0)} alertas de esta obra, ninguna tiene todavía un tiempo '
            f'de reacción medible: {alert.get("alerts_resolved_without_timestamp", 0)} se resolvieron '
            "antes de que el sistema empezara a registrar el momento exacto."
            + (f' Siguen sin resolver: {_e(pend)}.' if pend else "")
            + "</p>"
        )
        alert_sub = ""
    alerts_block = _section("Velocidad de reacción a las alertas", alert_body, subtitle=alert_sub)

    dq_block = _section(
        "Qué quedó afuera de las cuentas",
        (f'<p style="margin:0;font-size:13px;color:{C_MUTED};line-height:1.6;">'
         + " ".join(f'<strong>{v}</strong> {k.replace("_", " ")}.' for k, v in dq.items())
         + " Esas tareas no entran en el cálculo de atraso ni de precisión, así que los números de "
           "arriba hablan del resto de la obra.</p>") if dq else "",
    )

    generated = datetime.now(timezone.utc).strftime("%d/%m/%Y")

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Informe {_e(obra_name)} — {_e(label)}</title>
<style>
  @page {{ margin: 15mm 13mm; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:#F5F3EF; color:{C_INK};
          font-family:'Segoe UI',-apple-system,Arial,sans-serif; }}
  .sheet {{ max-width:800px; margin:0 auto; padding:0 0 40px; background:#fff; }}
  .pad {{ padding:0 44px; }}
  .print-bar {{ position:sticky; top:0; z-index:5; display:flex; justify-content:space-between;
                align-items:center; gap:16px; padding:13px 44px; background:#fff;
                border-bottom:1px solid {C_LINE}; }}
  .print-btn {{ padding:11px 22px; background:{C_BRAND}; color:#fff; border:none; border-radius:10px;
                font-size:14px; font-weight:700; cursor:pointer; font-family:inherit;
                box-shadow:0 6px 20px -6px rgba(255,107,53,0.5); }}
  @media print {{
    body {{ background:#fff; }}
    .print-bar {{ display:none !important; }}
    .sheet {{ max-width:none; padding:0; }}
    .pad {{ padding:0; }}
    article, section {{ page-break-inside:avoid; }}
  }}
  @media (max-width:640px) {{
    .pad {{ padding:0 20px; }}
    .print-bar {{ padding:12px 20px; }}
  }}
</style>
</head>
<body>
<div class="sheet">

  <div class="print-bar">
    <span style="font-size:12.5px;color:{C_MUTED};">Informe generado el {generated}</span>
    <button class="print-btn" onclick="window.print()">Imprimir informe completo</button>
  </div>

  <header style="background:linear-gradient(135deg,#1B2A34 0%,#243642 100%);padding:34px 44px;color:#fff;">
    <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8FA8B5;">
      Constructa · Informe mensual de obra
    </div>
    <h1 style="margin:10px 0 4px;font-size:27px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;">
      {_e(obra_name)}</h1>
    <div style="font-size:14px;color:#B9CAD4;">{_e(label)}</div>
  </header>

  <div class="pad" style="padding-top:30px;">

    <div style="display:flex;flex-wrap:wrap;gap:12px;margin:0 0 34px;">{stats}</div>

    {_section("Conclusiones", _conclusions_block(insights),
              subtitle="Redactadas automáticamente a partir de los números de esta obra. Cada cifra "
                       "que aparece acá sale del cálculo — no es una estimación del modelo.")}
    {chart_tasks}
    {chart_resp}
    {chart_est}
    {_section("Detalle de los mayores desvíos", _deviation_detail(m),
              subtitle="Lo que registró el sistema alrededor de cada tarea: los cambios, las alertas "
                       "que se dispararon y el efecto sobre las tareas que dependían de ella.")}
    {alerts_block}
    {bitacora_block}
    {dq_block}

    <section style="margin:38px 0 0;padding-top:18px;border-top:1px solid {C_LINE};">
      <p style="margin:0;font-size:11.5px;color:{C_FAINT};line-height:1.6;">
        <strong style="color:{C_MUTED};">Cómo se hizo este informe.</strong>
        Los números salen de un cálculo determinístico sobre las tareas, alertas, historial y bitácora
        de la obra. Las conclusiones las redacta un modelo de lenguaje que <strong>solo lee esos
        números ya calculados</strong>: no accede a la base de datos ni estima por su cuenta, y cada
        cifra que escribe se verifica automáticamente contra el cálculo antes de publicarse.
      </p>
    </section>
  </div>
</div>
</body>
</html>"""
