# Import order matters: parent models before child models,
# so SQLAlchemy can resolve all FK and relationship references.
from app.models.plan import Plan
from app.models.tenant import Tenant
from app.models.user import User
from app.models.obra import Obra, ObraStatus
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus
from app.models.supplier import Supplier
from app.models.task_material import TaskMaterial
from app.models.purchase_order import PurchaseOrder, PurchaseOrderItem
from app.models.bitacora import BitacoraEntry
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
from app.models.obra_team_member import ObraTeamMember

__all__ = [
    "Plan",
    "Tenant",
    "User",
    "Obra",
    "ObraStatus",
    "Responsible",
    "Task",
    "TaskStatus",
    "Supplier",
    "TaskMaterial",
    "PurchaseOrder",
    "PurchaseOrderItem",
    "BitacoraEntry",
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
    "ObraTeamMember",
]
