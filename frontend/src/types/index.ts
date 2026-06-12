export type ObraStatus =
  | "planificada"
  | "en_progreso"
  | "pausada"
  | "completada"
  | "cancelada";

export interface Obra {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  image_url: string | null;
  status: ObraStatus;
  manager_id: number;
  start_date: string | null;
  expected_end_date: string | null;
  actual_end_date: string | null;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  created_at: string;
  updated_at: string;
  completed_tasks: number;
  total_tasks: number;
}

export type Page = "panel" | "configuracion" | "equipo" | "bitacora" | "presupuestos" | "admin";

export type ObraTab = "resumen" | "tareas" | "responsables" | "alertas" | "historial" | "presupuesto";

export interface ObraTeamMember {
  responsible_id: number;
  full_name: string;
  whatsapp_number: string;
  role: string | null;
  is_active: boolean;
}

export interface Responsible {
  id: number;
  full_name: string;
  whatsapp_number: string;
  role: string | null;
  is_active: boolean;
  created_at: string;
}

export type TaskStatus =
  | "pendiente"
  | "en_progreso"
  | "bloqueada"
  | "completada"
  | "cancelada";

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface DependencyLink {
  depends_on_id: number;
  dependency_type: DependencyType;
  lag_days: number;
}

export interface Task {
  id: number;
  obra_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  responsible_id: number | null;
  start_date: string | null;
  start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  completed_date: string | null;
  order_index: number;
  parent_task_id: number | null;
  depends_on_id: number | null;
  dependency_ids: number[];
  dependency_links: DependencyLink[];
  is_milestone: boolean;
  estimated_progress: number;
  created_at: string;
  updated_at: string;
}

export interface HistorialEvento {
  id: number;
  obra_id: number | null;
  task_id: number | null;
  event_type: string;
  description: string;
  payload: Record<string, unknown> | null;
  triggered_by: string;
  created_at: string;
}

export type AlertType = "task_blocked" | "delay_risk" | "task_overdue" | "no_response" | "reschedule_requested" | "order_received";

export interface Alert {
  id: number;
  obra_id: number | null;
  task_id: number | null;
  type: AlertType;
  message: string;
  is_read: boolean;
  created_at: string;
}

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface Workspace {
  id: number;
  name: string;
  slug: string;
  color: string; // hex color for workspace avatar
  role: WorkspaceRole;
  members_count: number;
  created_at: string;
}

export interface WorkspaceMember {
  id: number;
  user_id: number;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: WorkspaceRole;
  joined_at: string;
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: "admin" | "collaborator";
  avatar_url?: string | null;
  tenant_name?: string | null;
}

export interface Supplier {
  id: number;
  tenant_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  category: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export type MaterialStatus = "pendiente" | "pedido" | "recibido";

export interface TaskMaterial {
  id: number;
  task_id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  status: MaterialStatus;
  created_at: string;
}


export interface Plan {
  id: number;
  name: string;
  max_obras: number | null;
  max_users: number | null;
  max_tasks_per_obra: number | null;
  price_monthly: number | null;
}

export interface Tenant {
  id: number;
  name: string;
  plan_id: number | null;
  owner_user_id: number | null;
  created_at: string;
  active_until: string | null;
  plan: Plan | null;
}

export interface PlanUsage {
  tenant: Tenant;
  obras_count: number;
  users_count: number;
  tasks_count: number;
  obras_limit: number | null;
  users_limit: number | null;
  tasks_per_obra_limit: number | null;
}
