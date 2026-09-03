"""Renderizado de emails (insights, etapa 4) + guard del shell compartido.

La auditoría 01 §8.9 marcó que no hay tests que verifiquen el HTML de los
emails: si alguien rompe un template, la suite sigue verde. Estos tests cubren
al menos el shell compartido y el email de insights.
"""
from dataclasses import dataclass, field

from app.services.email_service import (
    _build_invite_html,
    _build_reset_html,
    _build_verification_html,
    _period_label,
    build_insights_email_html,
)

FRONT = "https://app.constructa.com.ar"
PERIOD = "2026-09"


@dataclass
class FakeInsight:
    title: str
    description: str
    last_period: str = PERIOD
    status: str = "nueva"
    reinforcement_count: int = 0
    recommendation: str | None = None
    impact: str | None = None
    priority: str | None = "media"
    evidence: list = field(default_factory=list)


def _render(insights, **over) -> str:
    kwargs = dict(
        obra_id=5, obra_name="Vivienda Unifamiliar — Barrio Jardín",
        period=PERIOD, insights=insights, frontend_url=FRONT,
    )
    kwargs.update(over)
    return build_insights_email_html(**kwargs)


# ── Shell compartido ──────────────────────────────────────────────────────────

def test_invitacion_conserva_su_contenido_tras_el_refactor():
    """El template de invitación pasó a usar _email_shell sin cambiar qué dice."""
    html = _build_invite_html("https://x.test/invite/tok123", "admin")

    assert "Te invitaron a unirte al equipo" in html
    assert "Invitación recibida" in html
    assert "Administrador" in html
    assert "Aceptar invitación" in html
    assert "https://x.test/invite/tok123" in html
    assert "Este link expira en 72 horas." in html
    assert "Si no esperabas esta invitación, podés ignorar este mensaje." in html
    # Sigue siendo table-based (compatibilidad Outlook) con header de marca
    assert "<table" in html and "linear-gradient(135deg,#1B2A34" in html


def test_invitacion_distingue_el_rol():
    assert "Colaborador" in _build_invite_html("https://x.test/i/t", "collaborator")
    assert "Administrador" in _build_invite_html("https://x.test/i/t", "admin")


def test_todos_los_emails_del_shell_traen_viewport_meta():
    """Bug menor del audit 01 §8.8: reset y verificación no lo tenían.

    Los que pasan por el shell lo traen siempre. Reset y verificación siguen
    sin migrar (fuera del alcance de esta etapa) y por eso siguen sin viewport
    — queda documentado, no silenciado.
    """
    viewport = '<meta name="viewport"'
    assert viewport in _build_invite_html("https://x.test/i/t", "admin")
    assert viewport in _render([FakeInsight("T", "D")])

    # Estado actual conocido de los que todavía no usan el shell
    assert viewport not in _build_reset_html("https://x.test/r/t")
    assert viewport not in _build_verification_html("https://x.test/v/t")


def test_el_email_no_es_de_ancho_fijo():
    """A 520px fijos había scroll horizontal en un viewport de 390 (verificado
    en navegador). El shell usa max-width para que se lea en el teléfono."""
    html = _render([FakeInsight("T", "D")])
    assert "max-width:520px" in html
    assert 'width="520"' not in html


# ── Email de insights ─────────────────────────────────────────────────────────
#
# El email es el vistazo de diez segundos: titular, prioridad e impacto. La
# narrativa, la evidencia y los gráficos viven en el informe completo, del otro
# lado del botón. Estos tests fijan esa división.

def test_encabezado_con_obra_y_periodo():
    html = _render([FakeInsight("T", "D")])
    assert "Vivienda Unifamiliar — Barrio Jardín" in html
    assert "septiembre de 2026" in html


def test_periodo_label():
    assert _period_label("2026-09") == "septiembre de 2026"
    assert _period_label("2025-01") == "enero de 2025"
    assert _period_label("basura") == "basura"


def test_muestra_titulo_e_impacto_pero_no_la_narrativa():
    """Lo largo va al informe: en el email entra el titular y qué se destraba."""
    html = _render([FakeInsight(
        "Obra civil traba tres frentes",
        "Narrativa larga que explica todo el detalle y no debería viajar en el email.",
        impact="Destraba 3 tareas y 92 días de atraso.",
    )])
    assert "Obra civil traba tres frentes" in html
    assert "Destraba 3 tareas y 92 días de atraso." in html
    assert "Narrativa larga" not in html


def test_la_decision_tampoco_va_en_el_email():
    """La acción concreta se lee en el informe, no en la vista previa."""
    html = _render([FakeInsight("T", "D", recommendation="Sentate con Carlos el lunes.")])
    assert "Sentate con Carlos el lunes." not in html


def test_las_prioridades_se_ven_y_ordenan():
    """Primero lo que más mueve la aguja, sin importar el orden de entrada."""
    html = _render([
        FakeInsight("La de prioridad baja", "x", priority="baja"),
        FakeInsight("La urgente", "x", priority="alta"),
        FakeInsight("La del medio", "x", priority="media"),
    ])
    assert "Alta" in html and "Media" in html and "Baja" in html
    assert html.index("La urgente") < html.index("La del medio") < html.index("La de prioridad baja")


def test_avisa_cuantas_necesitan_decision():
    html = _render([
        FakeInsight("Una", "x", priority="alta"),
        FakeInsight("Otra", "x", priority="alta"),
        FakeInsight("Tercera", "x", priority="baja"),
    ])
    assert "3 cosas para revisar" in html
    assert "2 de las 3 necesitan una decisión tuya" in html


def test_sin_prioridades_altas_lo_dice_distinto():
    html = _render([FakeInsight("Una", "x", priority="media")])
    assert "Ninguna urgente, pero conviene mirarlas" in html


def test_descartadas_nunca_entran():
    html = _render([
        FakeInsight("Visible", "x"),
        FakeInsight("Descartada por el jefe", "x", status="descartada"),
    ])
    assert "Visible" in html
    assert "Descartada por el jefe" not in html


def test_sin_conclusiones_lo_dice_explicitamente():
    """Nunca un email vacío o con secciones en blanco sin explicación."""
    html = _render([])
    assert "no encontramos nada nuevo que valga la pena marcarte" in html
    assert "Descargar informe completo" in html      # el CTA sigue estando


def test_solo_descartadas_cae_en_el_estado_vacio():
    html = _render([FakeInsight("Descartada", "x", status="descartada")])
    assert "no encontramos nada nuevo" in html


def test_html_del_contenido_se_escapa():
    """Los textos vienen de la IA: no deben poder inyectar markup en el email."""
    html = _render([FakeInsight("<script>alert(1)</script>", "x", impact="5 < 7 & 8 > 2")])
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "5 &lt; 7 &amp; 8 &gt; 2" in html


def test_cta_apunta_al_informe_imprimible_firmado():
    """El botón lleva al informe completo del backend, con la URL firmada.

    No apunta al frontend: el informe es una página autocontenida que se imprime
    a PDF, así que no depende de que exista una pantalla en la app.
    """
    html = _render([FakeInsight("T", "D")], obra_id=42, tenant_id=7)
    assert "/api/v1/obras/42/insights/report?period=2026-09" in html
    assert "sig=" in html and "tid=7" in html and "exp=" in html
    assert "Descargar informe completo" in html


def test_el_link_del_informe_no_sirve_para_otra_obra():
    """La firma ata el link a una obra y un período concretos."""
    import urllib.parse as up

    from app.core.signing import verify_report
    from app.services.email_service import insights_report_url

    url = insights_report_url(42, "2026-09", 7)
    q = dict(up.parse_qsl(up.urlparse(url).query))

    assert verify_report(42, "2026-09", q["tid"], q["exp"], q["sig"]) is True
    assert verify_report(43, "2026-09", q["tid"], q["exp"], q["sig"]) is False
    assert verify_report(42, "2026-08", q["tid"], q["exp"], q["sig"]) is False
    assert verify_report(42, "2026-09", "8", q["exp"], q["sig"]) is False
