# Import order matters: parent models before child models,
# so SQLAlchemy can resolve all FK and relationship references.
from app.models.user import User
from app.models.obra import Obra, ObraStatus
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus
from app.models.historial import HistorialEvento
from app.models.message import (
    Message,
    MessageDirection,
    MessageChannel,
    MessageType,
    MessageProcessingStatus,
)
from app.models.alert import Alert, AlertType
from app.models.conversation_session import ConversationSession, ConversationStep
from app.models.settings import SystemSettings

__all__ = [
    "User",
    "Obra",
    "ObraStatus",
    "Responsible",
    "Task",
    "TaskStatus",
    "HistorialEvento",
    "Message",
    "MessageDirection",
    "MessageChannel",
    "MessageType",
    "MessageProcessingStatus",
    "Alert",
    "AlertType",
    "ConversationSession",
    "ConversationStep",
    "SystemSettings",
]
