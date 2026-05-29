import enum
from datetime import date, datetime, time, timezone
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    Time,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

# Association table for M2M self-referential task dependencies
task_dependencies_table = Table(
    "task_dependencies",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("task_id",         Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
    Column("depends_on_id",   Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
    Column("dependency_type", String(2), nullable=False, server_default="FS"),
    Column("lag_days",        Integer,   nullable=False, server_default="0"),
)


class TaskStatus(str, enum.Enum):
    PENDIENTE = "pendiente"
    EN_PROGRESO = "en_progreso"
    BLOQUEADA = "bloqueada"
    COMPLETADA = "completada"
    CANCELADA = "cancelada"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    responsible_id: Mapped[int | None] = mapped_column(
        ForeignKey("responsibles.id", ondelete="SET NULL"), nullable=True, index=True
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Status is set by the system (chatbot pipeline), NOT by users directly.
    # Default is PENDIENTE. Transitions are enforced in TaskService.
    status: Mapped[TaskStatus] = mapped_column(
        SAEnum(
            TaskStatus,
            name="task_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        default=TaskStatus.PENDIENTE,
        nullable=False,
    )

    is_milestone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Populated by AI pipeline in Phase 2 (0–100)
    estimated_progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    start_date: Mapped[date | None] = mapped_column(Date)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date)
    due_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    completed_date: Mapped[date | None] = mapped_column(Date)

    # Display order for Gantt (Phase 3)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # WBS: parent task (same obra, forms a hierarchy)
    parent_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Simple dependency: this task waits for another (same obra)
    depends_on_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # WBS relationships
    parent: Mapped["Task | None"] = relationship(
        "Task",
        foreign_keys=[parent_task_id],
        remote_side="Task.id",
        back_populates="children",
    )
    children: Mapped[list["Task"]] = relationship(
        "Task",
        foreign_keys=[parent_task_id],
        back_populates="parent",
        lazy="select",
    )

    obra: Mapped["Obra"] = relationship("Obra", back_populates="tasks")
    responsible: Mapped["Responsible | None"] = relationship(
        "Responsible", back_populates="tasks"
    )
    # Self-referential: remote_side must reference the *column variable* (id), not a string
    depends_on: Mapped["Task | None"] = relationship(
        "Task", foreign_keys=[depends_on_id], remote_side=[id]
    )
    # M2M: tasks this task depends on (blocking tasks)
    dependencies: Mapped[list["Task"]] = relationship(
        "Task",
        secondary=task_dependencies_table,
        primaryjoin=lambda: Task.id == task_dependencies_table.c.task_id,
        secondaryjoin=lambda: Task.id == task_dependencies_table.c.depends_on_id,
        lazy="select",
    )
    # M2M: tasks that depend on this task (downstream tasks)
    dependents: Mapped[list["Task"]] = relationship(
        "Task",
        secondary=task_dependencies_table,
        primaryjoin=lambda: Task.id == task_dependencies_table.c.depends_on_id,
        secondaryjoin=lambda: Task.id == task_dependencies_table.c.task_id,
        lazy="select",
        overlaps="dependencies",
    )
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="task")
    historial: Mapped[list["HistorialEvento"]] = relationship(
        "HistorialEvento", back_populates="task"
    )
    alerts: Mapped[list["Alert"]] = relationship("Alert", back_populates="task")
