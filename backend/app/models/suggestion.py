import enum
from datetime import date, datetime, timezone

from sqlalchemy import (
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SuggestionType(str, enum.Enum):
    RESCHEDULE_TASK = "reschedule_task"
    CREATE_TASK = "create_task"
    UPDATE_STATUS = "update_status"
    NOTE = "note"


class SuggestionStatus(str, enum.Enum):
    PENDIENTE = "pendiente"
    APLICADA = "aplicada"
    DESCARTADA = "descartada"


class Suggestion(Base):
    """Acción concreta sobre el plan de obra propuesta por la IA a partir de lo
    que se dijo en el campo (hoy: una nota de bitácora).

    Antes vivía como un objeto dentro del blob JSON `bitacora_entries.suggestions`
    y se direccionaba **por índice**. Eso la ataba a la pantalla de bitácora: sin
    id estable no se la puede consultar por tarea, contar en SQL, ni resolver
    desde otra pantalla. Como fila propia, la sugerencia es una entidad del
    dominio: la tarea afectada la puede mostrar y aplicar sin saber de dónde
    salió (migración 0072).

    `source_entry_id` es el origen, no el dueño: si mañana las sugerencias
    salen de un mensaje de texto o de un análisis de riesgo, se agrega el
    origen nuevo sin tocar a quien las consume.
    """

    __tablename__ = "suggestions"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Denormalizado desde la obra (o desde la entrada de origen, que puede no
    # tener obra todavía) para que el aislamiento multi-tenant no dependa de
    # tener obra_id — mismo criterio que BitacoraEntry.
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True, index=True
    )
    obra_id: Mapped[int | None] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # ── Origen ────────────────────────────────────────────────────────────────
    source: Mapped[str] = mapped_column(String(20), default="bitacora", nullable=False)
    source_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("bitacora_entries.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Posición dentro de la entrada de origen: conserva el orden en que la IA
    # las propuso y mantiene vivos los endpoints legacy por índice.
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # ── Contenido de la propuesta ─────────────────────────────────────────────
    type: Mapped[SuggestionType] = mapped_column(
        SAEnum(
            SuggestionType,
            name="suggestion_type",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
    )
    # Tarea que la sugerencia quiere modificar (reschedule/update_status).
    # SET NULL y no CASCADE: si la tarea se borra, la propuesta queda como
    # registro de lo que se pidió, no desaparece del historial.
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Título de la tarea tal como lo vio la IA — sobrevive al borrado de la tarea.
    task_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    new_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    new_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    new_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # % de avance propuesto (0-100). El audio dice "va al 75%" y esto lo captura;
    # se aplica sobre tasks.estimated_progress junto con el cambio de estado.
    new_progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # La frase del audio que justifica la propuesta.
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # ── Resolución ────────────────────────────────────────────────────────────
    status: Mapped[SuggestionStatus] = mapped_column(
        SAEnum(
            SuggestionStatus,
            name="suggestion_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        default=SuggestionStatus.PENDIENTE,
        nullable=False,
        index=True,
    )
    # Tarea creada o modificada al aplicarla (traza sugerencia → tarea).
    result_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Aviso si el backend corrió una fecha al día laboral más cercano.
    result_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    source_entry: Mapped["BitacoraEntry | None"] = relationship(
        "BitacoraEntry", back_populates="suggestion_rows"
    )

    # ── Helpers de estado ─────────────────────────────────────────────────────

    @property
    def applied(self) -> bool:
        return self.status == SuggestionStatus.APLICADA

    @property
    def dismissed(self) -> bool:
        return self.status == SuggestionStatus.DESCARTADA
