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
from app.models.solicitud_cotizacion import SolicitudCotizacion, SolicitudSupplier
from app.models.bitacora import BitacoraEntry
from app.models.budget import Budget
from app.models.plano import Plano
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
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.tenant_membership import TenantMembership
from app.models.whatsapp_tenant_context import WhatsappTenantContext
from app.models.ai_mapping_cache import AiMappingCache
from app.models.obra_stats_snapshot import ObraStatsSnapshot

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
    "Budget",
    "Plano",
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
    "ObraUserRole",
    "ObraUserRoleType",
    "TenantMembership",
    "WhatsappTenantContext",
    "AiMappingCache",
    "SolicitudCotizacion",
    "SolicitudSupplier",
    "ObraStatsSnapshot",
]
