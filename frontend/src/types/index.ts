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

export type ObraTab = "resumen" | "tareas" | "responsables" | "alertas" | "historial" | "presupuesto" | "planos";

export interface ObraTeamMember {
  responsible_id: number;
  full_name: string;
  whatsapp_number: string;
  role: string | null;
  is_active: boolean;
  plan_disciplines: string[] | null; // null = acceso a todos los planos
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
  materials_count?: number;
  materials_cost?: number;
  materials_pending?: number;
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

// Rol del usuario en una obra puntual (Fase 1+ del rediseño de roles).
// Backend enum: obra_user_role_type. jefe_obra > colaborador > solo_lectura.
export type ObraUserRoleType = "jefe_obra" | "colaborador" | "solo_lectura";

export interface ObraRoleForUser {
  obra_id: number;
  obra_name: string;
  role: ObraUserRoleType;
}

export interface TenantOption {
  id: number;
  name: string;
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: "admin" | "collaborator";
  avatar_url?: string | null;
  whatsapp_number?: string | null;
  tenant_name?: string | null;
  // Todas las empresas donde esta identidad tiene membership activa (una
  // misma persona puede pertenecer a varias). Alimenta el switcher del
  // Sidebar cuando tiene más de una.
  available_tenants: TenantOption[];
  // Obras a las que el usuario está asignado, con su rol en cada una. Se
  // pobla desde /users/me. Vacío = admin de empresa (superset absoluto) o
  // colaborador sin asignaciones. La UI resuelve la diferencia con `role`.
  obra_roles: ObraRoleForUser[];
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

// ─── Presupuestos (módulo de gestión documental con IA) ──────────────────────

export interface BudgetItem {
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario: number | null;
  subtotal: number | null;
}

export interface BudgetInconsistency {
  tipo: string;
  detalle: string;
  severidad: "alta" | "media" | "baja";
}

export interface BudgetData {
  proveedor: string | null;
  fecha: string | null;
  rubro: string | null;
  moneda: string;
  items: BudgetItem[];
  subtotal: number | null;
  iva_pct: number | null;
  iva_monto: number | null;
  total: number | null;
  incluye_flete: boolean | null;
  plazo_entrega: string | null;
  condiciones_pago: string | null;
  validez: string | null;
  inconsistencias: BudgetInconsistency[];
}

export interface Budget {
  id: number;
  obra_id: number | null;
  obra_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  rubro: string | null;
  source_type: "pdf" | "image" | "excel" | "texto";
  source_filename: string | null;
  total: number | null;
  currency: string;
  status: "procesado" | "error";
  error: string | null;
  data: BudgetData | null;
  inconsistencies: BudgetInconsistency[] | null;
  created_at: string;
}

export interface BudgetComparisonRow {
  budget_id: number;
  supplier_name: string | null;
  rubro: string | null;
  total: number | null;
  currency: string;
  plazo_entrega: string | null;
  condiciones_pago: string | null;
  validez: string | null;
  incluye_flete: boolean | null;
  pct_vs_promedio: number | null;
  es_mas_barato: boolean;
  flags: string[];
}

export interface BudgetComparison {
  rows: BudgetComparisonRow[];
  promedio: number | null;
  recomendacion: string | null;
}

// ─── Planos (documentos técnicos con versionado + consulta por chatbot) ──────

export interface Plano {
  id: number;
  obra_id: number;
  discipline: string;
  name: string | null;
  version: number;
  is_latest: boolean;
  file_url: string | null;
  original_filename: string | null;
  content_type: string | null;
  file_size: number | null;
  notes: string | null;
  uploaded_by: number | null;
  /** Nombre de quien subió esta versión, para el historial. */
  uploaded_by_name: string | null;
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
  responsible_id: number | null;
  responsible_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
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

// ─── Solicitudes de cotización ────────────────────────────────────────────────

export interface SolicitudCotizacion {
  id: number;
  obra_id: number;
  ref_code: string;
  status: "borrador" | "enviada" | "respondida" | "confirmada";
  notes: string | null;
  pdf_url: string | null;
  contratista_phone: string | null;
  created_at: string;
  sent_at: string | null;
  material_ids: number[];
  suppliers: SolicitudSupplier[];
  respuestas: RespuestaCotizacion[];
  analisis_ia: AnalisisComparativo | null;
}

export interface SolicitudSupplier {
  supplier_id: number;
  supplier_name: string;
  supplier_phone: string | null;
  status: "enviada" | "respondida";
  sent_at: string | null;
}

export interface RespuestaCotizacion {
  id: number;
  solicitud_id: number;
  supplier_id: number | null;
  supplier_name: string;
  total: number | null;
  currency: string;
  plazo_entrega: string | null;
  condiciones_pago: string | null;
  validez: string | null;
  rubro: string | null;
  proveedor_nombre: string | null;
  fecha: string | null;
  iva_pct: number | null;
  iva_monto: number | null;
  incluye_flete: boolean | null;
  inconsistencias: BudgetInconsistency[] | null;
  items: RespuestaItem[];
  created_at: string;
}

export interface RespuestaItem {
  nombre: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario: number | null;
  subtotal: number | null;
}

export interface AnalisisComparativo {
  resumen: string;
  comparacion_items: ComparacionItem[];
  donde_ganas: string[];
  donde_pierdes: string[];
  condiciones_pago: string;
  plazos: string;
  riesgos: string[];
  recomendacion: string;
  supplier_recomendado_id: number | null;  // null when contratista recommended or no clear winner
}

export interface ComparacionItem {
  nombre: string;
  precios: { supplier_id: number; supplier_name: string; precio_unitario: number | null; subtotal: number | null }[];
  mas_barato_id: number | null;
  diferencia: number | null;
}

// ─── Análisis histórico de compras (on-demand IA) ─────────────────────────────

export interface EstadisticaProveedor {
  nombre: string;
  cotizaciones_respondidas: number;
  precio_promedio: number | null;
  precio_min: number | null;
  precio_max: number | null;
  tendencia: string; // "competitivo" | "caro" | "variable" | "sin_datos"
  fortaleza: string;
}

export interface MaterialCritico {
  nombre: string;
  proveedor_mas_barato: string | null;
  diferencia_pct: number | null;
  veces_cotizado: number;
}

export interface AnalisisHistoricoCompras {
  proveedor_recomendado: string | null;
  motivo: string;
  por_proveedor: EstadisticaProveedor[];
  materiales_criticos: MaterialCritico[];
  alertas: string[];
  ahorro_potencial: number | null;
}
