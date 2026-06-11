import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { fetchAlerts, markAlertRead } from "../api/alerts";
import { fetchHistorial } from "../api/historial";
import { fetchObraTeam } from "../api/obraTeam";
import { fetchTasksByObra, updateTaskStatus } from "../api/tasks";
import { exportObraExcel } from "../api/exports";
import { AlertasTab } from "../components/AlertasTab";
import { HistorialPanel } from "../components/HistorialPanel";
import { ResumenTab } from "../components/ResumenTab";
import { Spinner } from "../components/Spinner";
import { TaskDeleteConfirm } from "../components/TaskDeleteConfirm";
import { TaskFormModal } from "../components/TaskFormModal";
import { TaskTable } from "../components/TaskTable";
import { TaskSheetView, type SheetViewHandle } from "../components/TaskSheetView";
import { ImportModal } from "../components/ImportModal";
import { useAlertSocket } from "../hooks/useAlertSocket";
import { useTaskSocket } from "../hooks/useTaskSocket";
import { useCan } from "../hooks/usePermission";
import { useEditingSimulation } from "../hooks/useEditingSimulation";
import { useViewingUsers } from "../hooks/useOnlineUsers";
import { ObraResponsablesTab } from "../components/ObraResponsablesTab";
import type { Alert, HistorialEvento, Obra, ObraStatus, ObraTab, Responsible, Task, TaskStatus } from "../types";

// ── Visual helpers ─────────────────────────────────────────────────────────────

const HERO_GRADIENTS = [
  "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
  "linear-gradient(135deg, #3D8BFF 0%, #1A63D4 100%)",
  "linear-gradient(135deg, #2AC58A 0%, #19956B 100%)",
  "linear-gradient(135deg, #B07CF7 0%, #8350D4 100%)",
  "linear-gradient(135deg, #8FA8B5 0%, #627E8E 100%)",
  "linear-gradient(135deg, #E8B14A 0%, #C98A1F 100%)",
  "linear-gradient(135deg, #5DA8B5 0%, #3A8994 100%)",
];

const STATUS_PILL: Record<ObraStatus, { label: string; bg: string; border: string; dot: string; color: string; glow?: string }> = {
  planificada: { label: "Planificada", bg: "#F0F1EF", border: "#E6E7E5", dot: "#8E97A0", color: "#5B6770" },
  en_progreso: { label: "En progreso", bg: "#E4F3EC", border: "#BFE3CE", dot: "#1F8A5B", color: "#136E47", glow: "0 0 0 3px rgba(31,138,91,0.18)" },
  pausada:     { label: "Pausada",     bg: "#FDF1DE", border: "#F0D5A0", dot: "#C97D0E", color: "#9A5D08" },
  completada:  { label: "Completada",  bg: "#E4F3EC", border: "#BFE3CE", dot: "#1F8A5B", color: "#136E47" },
  cancelada:   { label: "Cancelada",   bg: "#FCE5E5", border: "#F0B0B0", dot: "#D03A3A", color: "#A82B2B" },
};

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export type AlertFocusField = "responsible" | "taskStatus" | "due";

interface ObraDetailPageProps {
  obra: Obra;
  activeTab: ObraTab;
  onTabChange: (tab: ObraTab) => void;
  onCounts?: (counts: { tasks: number; alerts: number }) => void;
  focusAlert?: { taskId: number; field: AlertFocusField } | null;
}

export function ObraDetailPage({ obra, activeTab, onTabChange, onCounts, focusAlert }: ObraDetailPageProps) {
  const can = useCan();
  const viewingUsers = useViewingUsers(obra.id);
  const [tasks, setTasks] = useState<Task[]>([]);
  const editingMap   = useEditingSimulation(obra.id);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [historial, setHistorial] = useState<HistorialEvento[]>([]);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [taskView, setTaskView] = useState<"tabla" | "planilla">("tabla");
  const [showImport, setShowImport] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const sheetViewRef = useRef<SheetViewHandle>(null);

  useEffect(() => {
    if (!focusAlert || loading) return;
    onTabChange("tareas");
    setTaskView("planilla");
    const t = setTimeout(() => {
      sheetViewRef.current?.focusTask(focusAlert.taskId, focusAlert.field);
    }, 80);
    return () => clearTimeout(t);
  }, [focusAlert, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const tasksData = await fetchTasksByObra(obra.id);
      const [allAlerts, historialData, obraTeam] = await Promise.all([
        fetchAlerts(),
        fetchHistorial(obra.id),
        fetchObraTeam(obra.id),
      ]);
      setTasks(tasksData);
      setAlerts(allAlerts.filter((a) => a.obra_id === obra.id));
      setHistorial(historialData);
      // Convertir ObraTeamMember[] → Responsible[] para compatibilidad con componentes hijos
      setResponsibles(obraTeam.map(m => ({
        id: m.responsible_id,
        full_name: m.full_name,
        whatsapp_number: m.whatsapp_number,
        role: m.role,
        is_active: m.is_active,
        created_at: "",
      })));
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError("No tenés permiso para ver el contenido de esta obra.");
      } else {
        setError("No se pudo conectar con el servidor. Verificá que el backend esté corriendo.");
      }
    } finally {
      setLoading(false);
    }
  }, [obra.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refreshTasks = useCallback(async () => {
    try {
      const fresh = await fetchTasksByObra(obra.id);
      setTasks((prev) => {
        const hasChanges =
          fresh.length !== prev.length ||
          fresh.some((t) => {
            const old = prev.find((p) => p.id === t.id);
            return !old || old.status !== t.status || old.due_date !== t.due_date;
          });
        return hasChanges ? fresh : prev;
      });
    } catch { /* silent */ }
  }, [obra.id]);

  useEffect(() => {
    window.addEventListener("focus", refreshTasks);
    return () => window.removeEventListener("focus", refreshTasks);
  }, [refreshTasks]);

  useEffect(() => { refreshTasks(); }, [activeTab, refreshTasks]);

  useTaskSocket({
    obraId: obra.id,
    onTaskUpdated: useCallback((payload) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === payload.taskId
            ? { ...t, title: payload.title, status: payload.status, responsible_id: payload.responsibleId, start_date: payload.startDate, due_date: payload.dueDate, updated_at: payload.updatedAt }
            : t
        )
      );
    }, []),
    onTaskCreated: useCallback((payload) => {
      setTasks((prev) => {
        if (prev.some((t) => t.id === payload.taskId)) return prev;
        const newTask = {
          id: payload.taskId, obra_id: payload.obraId, title: payload.title,
          description: payload.description, status: payload.status,
          responsible_id: payload.responsibleId,
          start_date: payload.startDate, due_date: payload.dueDate,
          start_time: payload.startTime, due_time: payload.dueTime,
          order_index: payload.orderIndex, depends_on_id: null, completed_date: null,
          created_at: payload.createdAt, updated_at: payload.updatedAt,
        };
        return [...prev, newTask];
      });
    }, []),
    onTaskDeleted: useCallback((payload) => {
      setTasks((prev) => prev.filter((t) => t.id !== payload.taskId));
    }, []),
  });

  useAlertSocket(
    obra.id,
    useCallback((alert) => {
      setAlerts((prev) => prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev]);
    }, []),
  );

  async function handleMarkRead(alertId: number) {
    try {
      const updated = await markAlertRead(alertId);
      setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch { /* silent */ }
  }

  async function handleMarkAllRead() {
    const unread = alerts.filter((a) => !a.is_read);
    if (unread.length === 0) return;
    try {
      const updated = await Promise.all(unread.map((a) => markAlertRead(a.id)));
      setAlerts((prev) => prev.map((a) => updated.find((u) => u.id === a.id) ?? a));
    } catch { loadData(true); }
  }

  function handleTaskSaved(savedTask: Task) {
    setShowCreateTask(false);
    setTaskToEdit(null);
    setTasks((prev) =>
      prev.some((t) => t.id === savedTask.id)
        ? prev.map((t) => (t.id === savedTask.id ? savedTask : t))
        : [...prev, savedTask]
    );
    loadData(true);
  }

  function handleTaskDeleted() {
    setTaskToDelete(null);
    loadData(true);
  }

  async function handleStatusChange(task: Task, newStatus: TaskStatus) {
    try {
      const updated = await updateTaskStatus(task.id, newStatus);
      setTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    } catch {
      loadData(true);
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const unreadAlerts = alerts.filter((a) => !a.is_read).length;

  const onCountsRef = useRef(onCounts);
  useEffect(() => { onCountsRef.current = onCounts; });
  useEffect(() => {
    onCountsRef.current?.({ tasks: tasks.length, alerts: unreadAlerts });
  }, [tasks.length, unreadAlerts, responsibles.length]);

  const initials = getInitials(obra.name);
  const badgeGradient = HERO_GRADIENTS[obra.id % HERO_GRADIENTS.length];
  const statusCfg = STATUS_PILL[obra.status];

  // ── Tab content ─────────────────────────────────────────────────────────────
  function renderTab() {
    if (loading) return <Spinner />;

    switch (activeTab) {
      case "resumen":
        return (
          <ResumenTab
            tasks={tasks}
            alerts={alerts}
            historial={historial}
            responsibles={responsibles}
            obraStartDate={obra.start_date}
            obraExpectedEndDate={obra.expected_end_date}
            obraId={obra.id}
            error={error}
            onMarkRead={handleMarkRead}
            onViewAlerts={() => onTabChange("alertas")}
            onViewTareas={() => onTabChange("tareas")}
            onViewHistorial={() => onTabChange("historial")}
            onEditTask={(t) => setTaskToEdit(t)}
            onDeleteTask={(t) => setTaskToDelete(t)}
            onTaskRescheduled={() => loadData(true)}
            onStatusChange={handleStatusChange}
          />
        );

      case "tareas": {
        const TODAY_T = new Date().toISOString().slice(0, 10);
        const isActiveFn = (t: Task) => t.status !== "completada" && t.status !== "cancelada";
        const seen = new Set<number>();
        const criticalTasks: Task[] = [];
        for (const t of tasks) {
          if (!isActiveFn(t)) continue;
          const isBlocked    = t.status === "bloqueada";
          const isOverdue    = !!t.due_date && t.due_date < TODAY_T;
          const noResponsible = !t.responsible_id;
          if (!isBlocked && !isOverdue && !noResponsible) continue;
          if (!seen.has(t.id) && criticalTasks.length < 5) { seen.add(t.id); criticalTasks.push(t); }
        }
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

            {/* ── Tareas críticas ── */}
            {criticalTasks.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #F0B0B0", borderRadius: 14, overflow: "hidden" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: "1px solid #FCE5E5" }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: "linear-gradient(135deg, #FCE5E5 0%, #F9CCCC 100%)",
                    border: "1px solid #F0B0B0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2L14.5 13.5H1.5L8 2Z" stroke="#D03A3A" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
                      <path d="M8 6.5v3M8 11v.5" stroke="#D03A3A" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.015em" }}>
                    Tareas críticas
                  </span>
                  <span style={{
                    display: "inline-flex", alignItems: "center",
                    padding: "2px 9px", borderRadius: 99,
                    fontSize: 11.5, fontWeight: 600, color: "#D03A3A",
                    background: "#FCE5E5", border: "1px solid #F0B0B0",
                  }}>
                    {criticalTasks.length}
                  </span>
                </div>
                {/* List */}
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {criticalTasks.map((t, idx) => {
                    const isBlocked    = t.status === "bloqueada";
                    const isOverdue    = isActiveFn(t) && !!t.due_date && t.due_date < TODAY_T;
                    const noResponsible = isActiveFn(t) && !t.responsible_id;
                    return (
                      <li key={t.id} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 20px",
                        borderBottom: idx < criticalTasks.length - 1 ? "1px solid #FDF0F0" : "none",
                        background: "#FFFAFA",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>
                            {t.title}
                          </p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" as const, justifyContent: "flex-end" }}>
                          {isBlocked && (
                            <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", background: "#FCE5E5", color: "#D03A3A" }}>
                              Bloqueada
                            </span>
                          )}
                          {isOverdue && (
                            <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", background: "#FCE5E5", color: "#D03A3A" }}>
                              Vencida
                            </span>
                          )}
                          {noResponsible && (
                            <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", background: "#FDF1DE", color: "#C97D0E" }}>
                              Sin resp.
                            </span>
                          )}
                          {can("tarea.edit") && (
                            <button
                              onClick={() => setTaskToEdit(t)}
                              style={{
                                padding: "5px 10px", borderRadius: 7, border: "1px solid #E6E7E5",
                                fontSize: 12, fontWeight: 600, color: "#5B6770",
                                background: "#fff", cursor: "pointer",
                                transition: "border-color 0.15s, color 0.15s",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = "#FF6B35"; e.currentTarget.style.color = "#FF6B35"; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = "#E6E7E5"; e.currentTarget.style.color = "#5B6770"; }}
                            >
                              Editar
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* ── Todas las tareas ── */}
            <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #F0F1EF" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                    border: "1px solid #F5D5C0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                      <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="#E76A2D" strokeWidth="1.4" fill="none"/>
                      <path d="M5 6h6M5 9h6M5 12h3" stroke="#E76A2D" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.015em" }}>
                    Todas las tareas
                  </span>
                  <span style={{
                    display: "inline-flex", alignItems: "center",
                    padding: "2px 9px", borderRadius: 99,
                    fontSize: 11.5, fontWeight: 600, color: "#5B6770",
                    background: "#F0F1EF", border: "1px solid #E6E7E5",
                  }}>
                    {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Vista toggle */}
                  <div style={{ display: "flex", borderRadius: 8, border: "1px solid #E6E7E5", overflow: "hidden" }}>
                    <button
                      onClick={() => setTaskView("tabla")}
                      title="Vista tabla"
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 32, height: 32,
                        background: taskView === "tabla" ? "#FF6B35" : "#fff",
                        border: "none", cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <rect x="1" y="1" width="14" height="14" rx="1.5" stroke={taskView === "tabla" ? "#fff" : "#8E97A0"} strokeWidth="1.3" fill="none"/>
                        <path d="M1 5h14M1 9h14M5 5v9" stroke={taskView === "tabla" ? "#fff" : "#8E97A0"} strokeWidth="1.3"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => setTaskView("planilla")}
                      title="Vista planilla (tipo Project)"
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 32, height: 32,
                        background: taskView === "planilla" ? "#FF6B35" : "#fff",
                        border: "none", borderLeft: "1px solid #E6E7E5", cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <rect x="1" y="1" width="14" height="3" rx="1" fill={taskView === "planilla" ? "#fff" : "#8E97A0"}/>
                        <rect x="1" y="6" width="14" height="3" rx="1" fill={taskView === "planilla" ? "rgba(255,255,255,0.6)" : "#C8CDD1"}/>
                        <rect x="1" y="11" width="14" height="3" rx="1" fill={taskView === "planilla" ? "rgba(255,255,255,0.4)" : "#E0E3E6"}/>
                      </svg>
                    </button>
                  </div>
                  {can("tarea.create") && (
                    <button
                      onClick={() => setShowImport(true)}
                      title="Importar desde MS Project o Excel"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "8px 12px", borderRadius: 9,
                        fontSize: 12.5, fontWeight: 600,
                        background: "#fff", color: "#5B6770",
                        border: "1px solid #E6E7E5", cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#FF6B35"; e.currentTarget.style.color = "#FF6B35"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#E6E7E5"; e.currentTarget.style.color = "#5B6770"; }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                        <path d="M8 4v7M5 8l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Importar
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      setExportLoading(true);
                      try { await exportObraExcel(obra.id, obra.name); }
                      finally { setExportLoading(false); }
                    }}
                    disabled={exportLoading || tasks.length === 0}
                    title="Exportar tareas a Excel"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "8px 12px", borderRadius: 9,
                      fontSize: 12.5, fontWeight: 600,
                      background: "#fff", color: "#5B6770",
                      border: "1px solid #E6E7E5", cursor: exportLoading || tasks.length === 0 ? "not-allowed" : "pointer",
                      opacity: tasks.length === 0 ? 0.5 : 1,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!exportLoading && tasks.length > 0) { e.currentTarget.style.borderColor = "#1F8A5B"; e.currentTarget.style.color = "#1F8A5B"; } }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#E6E7E5"; e.currentTarget.style.color = "#5B6770"; }}
                  >
                    {exportLoading ? (
                      <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                        <path d="M8 4v7M5 9l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {exportLoading ? "Exportando..." : "Exportar"}
                  </button>
                  {can("tarea.create") && (
                    <button
                      onClick={() => {
                        if (taskView === "tabla") {
                          setShowCreateTask(true);
                        } else {
                          sheetViewRef.current?.startNewRow();
                        }
                      }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 7,
                        padding: "8px 14px", borderRadius: 9,
                        fontSize: 13, fontWeight: 600,
                        background: "#FF6B35", color: "#fff",
                        border: "none", cursor: "pointer",
                        boxShadow: "0 4px 12px -4px rgba(255,107,53,0.5)",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#E85A26")}
                      onMouseLeave={e => (e.currentTarget.style.background = "#FF6B35")}
                    >
                      <Plus style={{ width: 13, height: 13 }} />
                      Nueva tarea
                    </button>
                  )}
                </div>
              </div>
              {/* Table / Sheet */}
              {taskView === "tabla" ? (
                <TaskTable tasks={tasks} responsibles={responsibles} onEdit={(t) => setTaskToEdit(t)} onDelete={(t) => setTaskToDelete(t)} onStatusChange={handleStatusChange} editingMap={editingMap} />
              ) : (
                <TaskSheetView ref={sheetViewRef} tasks={tasks} responsibles={responsibles} obraId={obra.id} onTaskSaved={handleTaskSaved} />
              )}
            </div>

          </div>
        );
      }


      case "responsables":
        return <ObraResponsablesTab obraId={obra.id} onTeamChanged={() => loadData(true)} />;

      case "alertas":
        return (
          <AlertasTab
            alerts={alerts} tasks={tasks}
            onMarkRead={handleMarkRead} onMarkAllRead={handleMarkAllRead}
            onViewTask={(taskId) => {
              onTabChange("tareas");
              if (taskId !== undefined) { const task = tasks.find((t) => t.id === taskId); if (task) setTaskToEdit(task); }
            }}
          />
        );

      case "historial":
        return (
          <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {/* Integrated header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: "1px solid #F0F1EF" }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                border: "1px solid #F5D5C0",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="#E76A2D" strokeWidth="1.4" fill="none"/>
                  <path d="M8 5v3.5l2 1.5" stroke="#E76A2D" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.015em" }}>
                Historial de actividad
              </span>
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "2px 9px", borderRadius: 99,
                fontSize: 11.5, fontWeight: 600, color: "#5B6770",
                background: "#F0F1EF", border: "1px solid #E6E7E5",
              }}>
                {historial.length} eventos
              </span>
            </div>
            {/* Panel */}
            <div style={{ padding: "16px 20px" }}>
              <HistorialPanel events={historial} tasks={tasks} filterable />
            </div>
          </div>
        );
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

        {/* ── Project header card ── */}
        <header style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
          padding: "18px 20px",
          background: "#fff",
          border: "1px solid #E6E7E5",
          borderRadius: 14,
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Subtle gradient overlay */}
          <div style={{
            position: "absolute",
            top: 0, bottom: 0, left: 0,
            width: "30%",
            background: "linear-gradient(135deg, rgba(255,107,53,0.055), transparent 70%)",
            pointerEvents: "none",
          }} />

          {/* Left: badge + info */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", position: "relative", minWidth: 0 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 12, flexShrink: 0,
              background: badgeGradient,
              color: "#fff",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontWeight: 700, fontSize: 18, letterSpacing: "0.02em",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 8px 18px -8px rgba(232,90,38,0.5)",
            }}>{initials}</div>

            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10.5, color: "#8E97A0",
                letterSpacing: "0.1em", marginBottom: 3,
              }}>
                #{obra.id.toString().padStart(3, "0")} · OBRA
              </div>
              <h1 style={{
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontSize: 24, fontWeight: 700, color: "#1A2329",
                margin: 0, letterSpacing: "-0.025em",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{obra.name}</h1>

              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                marginTop: 7, fontSize: 12.5, color: "#5B6770", flexWrap: "wrap",
              }}>
                {/* Status pill */}
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "3px 9px 3px 8px", borderRadius: 99,
                  fontSize: 11.5, fontWeight: 600,
                  background: statusCfg.bg,
                  border: `1px solid ${statusCfg.border}`,
                  color: statusCfg.color,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: 99,
                    background: statusCfg.dot,
                    boxShadow: statusCfg.glow,
                    display: "inline-block", flexShrink: 0,
                  }} />
                  {statusCfg.label}
                </span>

                {obra.location && (
                  <>
                    <span style={{ color: "#D5D7D3" }}>·</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ color: "#8E97A0", flexShrink: 0 }}>
                        <path d="M8 2.5a3.8 3.8 0 013.8 3.8c0 2.8-3.8 7.2-3.8 7.2S4.2 9.1 4.2 6.3A3.8 3.8 0 018 2.5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
                        <circle cx="8" cy="6.3" r="1.3" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                      </svg>
                      {obra.location}
                    </span>
                  </>
                )}

                {obra.client_name && (
                  <>
                    <span style={{ color: "#D5D7D3" }}>·</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ color: "#8E97A0", flexShrink: 0 }}>
                        <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                        <path d="M2.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                      </svg>
                      {obra.client_name}
                    </span>
                  </>
                )}

                {obra.expected_end_date && (
                  <>
                    <span style={{ color: "#D5D7D3" }}>·</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ color: "#8E97A0", flexShrink: 0 }}>
                        <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                        <path d="M5.5 2v3M10.5 2v3M2.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                      Entrega {formatDate(obra.expected_end_date)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: avatars + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, position: "relative" }}>

            {/* Viewing users — other users in this obra */}
            {viewingUsers.length > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "#fff",
                border: "1px solid #E6E7E5",
                borderRadius: 99,
                padding: "5px 12px 5px 6px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              }}>
                {/* Avatar stack */}
                <div style={{ display: "flex" }}>
                  {viewingUsers.slice(0, 3).map((u, i) => (
                    <div
                      key={u.id}
                      style={{
                        width: 24, height: 24, borderRadius: 99,
                        background: u.color, color: "#fff",
                        fontSize: 9, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        border: "2px solid #fff",
                        marginLeft: i > 0 ? -6 : 0,
                        zIndex: 3 - i, position: "relative",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.10)",
                      }}
                    >
                      {u.initials}
                    </div>
                  ))}
                  {viewingUsers.length > 3 && (
                    <div style={{
                      width: 24, height: 24, borderRadius: 99,
                      background: "#F0F1EF", color: "#5B6770",
                      fontSize: 9, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: "2px solid #fff",
                      marginLeft: -6, position: "relative",
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                    }}>
                      +{viewingUsers.length - 3}
                    </div>
                  )}
                </div>

                {/* Dot + label */}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: 99,
                    background: "#1F8A5B", flexShrink: 0,
                    boxShadow: "0 0 0 2.5px rgba(31,138,91,0.18)",
                    animation: "pulse-green 2s ease-in-out infinite",
                  }} />
                  <span style={{
                    fontSize: 11.5, color: "#5B6770",
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    whiteSpace: "nowrap",
                  }}>
                    {viewingUsers.length === 1
                      ? `${viewingUsers[0].name.includes("@") ? viewingUsers[0].name.split("@")[0] : viewingUsers[0].name.split(" ")[0]} también está aquí`
                      : `${viewingUsers.length} personas aquí`
                    }
                  </span>
                </div>
              </div>
            )}

            {/* Nueva tarea — solo en resumen */}
            {activeTab === "resumen" && can("tarea.create") && (
              <button
                onClick={() => setShowCreateTask(true)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "9px 14px", borderRadius: 10,
                  fontSize: 13, fontWeight: 500,
                  background: "#FF6B35", color: "#fff",
                  border: "none", cursor: "pointer",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#E85A26")}
                onMouseLeave={e => (e.currentTarget.style.background = "#FF6B35")}
              >
                <Plus style={{ width: 13, height: 13 }} />
                Nueva tarea
              </button>
            )}
          </div>
        </header>

        {/* ── Tab content ── */}
        {renderTab()}
      </div>

      {/* ── Modals ── */}
      {showCreateTask && (
        <TaskFormModal
          mode="create" obraId={obra.id} tasks={tasks} responsibles={responsibles} taskCount={tasks.length}
          onClose={() => setShowCreateTask(false)} onSaved={handleTaskSaved}
        />
      )}
      {taskToEdit && (
        <TaskFormModal
          mode="edit" obraId={obra.id} task={taskToEdit} tasks={tasks} responsibles={responsibles} taskCount={tasks.length}
          onClose={() => setTaskToEdit(null)} onSaved={handleTaskSaved}
        />
      )}
      {taskToDelete && (
        <TaskDeleteConfirm task={taskToDelete} onClose={() => setTaskToDelete(null)} onDeleted={handleTaskDeleted} />
      )}
      {showImport && (
        <ImportModal
          obraId={obra.id}
          onClose={() => setShowImport(false)}
          onImported={(count) => { setShowImport(false); if (count > 0) loadData(true); }}
        />
      )}

    </>
  );
}
