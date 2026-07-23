import { useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import { X, AlertTriangle, Loader2, ClipboardList, GitBranch } from "lucide-react";
import { createTask, fetchCascadePreview, updateTask } from "../api/tasks";
import type { CascadeAffectedTask } from "../api/tasks";
import { UpgradeModal, getPlanLimitError, type PlanLimitInfo } from "./UpgradeModal";
import { TaskMaterialsSection, type DraftMaterial } from "./TaskMaterialsSection";
import { TaskBitacoraOrigin } from "./TaskBitacoraOrigin";
import { createMaterial } from "../api/taskMaterials";
import { emitStartEditing, emitStopEditing } from "../hooks/useEditingSimulation";
import { useDialog } from "../hooks/useDialog";
import type { DependencyType, Responsible, Task } from "../types";

type DepLink = { depends_on_id: number; dependency_type: DependencyType; lag_days: number };

const DEP_TYPES: { value: DependencyType; label: string; description: string }[] = [
  { value: "FS", label: "FS", description: "Fin → Inicio" },
  { value: "SS", label: "SS", description: "Inicio → Inicio" },
  { value: "FF", label: "FF", description: "Fin → Fin" },
  { value: "SF", label: "SF", description: "Inicio → Fin" },
];

// ─── Design helpers ────────────────────────────────────────────────────────────


const BASE_INPUT: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 12px",
  fontSize: 13,
  fontFamily: "'Plus Jakarta Sans', sans-serif",
  color: "#1A2329",
  background: "#fff",
  border: "1px solid #E6E7E5",
  borderRadius: 10,
  outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

function inputStyle(err = false): React.CSSProperties {
  return {
    ...BASE_INPUT,
    borderColor: err ? "#D03A3A" : "#E6E7E5",
    boxShadow: err ? "0 0 0 3px rgba(208,58,58,0.08)" : "none",
  };
}

function onFocusInput(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>, err = false) {
  if (err) return;
  e.currentTarget.style.borderColor = "#FF6B35";
  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(255,107,53,0.10)";
}
function onBlurInput(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>, err = false) {
  e.currentTarget.style.borderColor = err ? "#D03A3A" : "#E6E7E5";
  e.currentTarget.style.boxShadow = err ? "0 0 0 3px rgba(208,58,58,0.08)" : "none";
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function fmtShortDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em",
        textTransform: "uppercase", color: "#5B6770",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}>
        {children}
      </span>
      {optional && (
        <span style={{ fontSize: 10.5, color: "#7D7973", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
          (opcional)
        </span>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TaskFormModalProps {
  mode: "create" | "edit";
  obraId: number;
  task?: Task;
  tasks?: Task[];
  responsibles: Responsible[];
  taskCount: number;
  onClose: () => void;
  onSaved: (task: Task) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskFormModal({
  mode,
  obraId,
  task,
  tasks = [],
  responsibles,
  taskCount,
  onClose,
  onSaved,
}: TaskFormModalProps) {
  // escClose:false → el Esc en capas propio (cierra subdiálogos primero) sigue mandando.
  const dialogRef = useDialog(onClose, { escClose: false });
  useEffect(() => {
    if (mode === "edit" && task) {
      emitStartEditing(task.id, obraId);
      return () => { emitStopEditing(task.id, obraId); };
    }
  }, [mode, task?.id, obraId]);

  // Lock body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc cierra (primero los sub-diálogos, después el modal)
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      setCascadePrompt(prev => {
        if (prev !== null) return null;
        setPlanLimit(pl => {
          if (pl !== null) return null;
          onClose();
          return pl;
        });
        return prev;
      });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeResponsibles = responsibles.filter(r => r.is_active);
  const previousResponsibleInactive =
    mode === "edit" &&
    task?.responsible_id != null &&
    !activeResponsibles.some(r => r.id === task.responsible_id);

  const [title,         setTitle]         = useState(task?.title ?? "");
  const [description,   setDescription]   = useState(task?.description ?? "");
  const [responsibleId, setResponsibleId] = useState<string>(
    previousResponsibleInactive ? "" : task?.responsible_id != null ? String(task.responsible_id) : ""
  );
  const [startDate, setStartDate] = useState(task?.start_date ?? "");
  const [startTime, setStartTime] = useState(task?.start_time?.slice(0, 5) ?? "");
  const [dueDate,   setDueDate]   = useState(task?.due_date ?? "");
  const [dueTime,   setDueTime]   = useState(task?.due_time?.slice(0, 5) ?? "");
  const [duration,  setDuration]  = useState<string>(
    task?.start_date && task?.due_date ? String(diffDays(task.start_date, task.due_date) + 1) : ""
  );

  const [parentTaskId,  setParentTaskId]  = useState<string>(
    task?.parent_task_id != null ? String(task.parent_task_id) : ""
  );
  const [depLinks, setDepLinks] = useState<DepLink[]>(
    task?.dependency_links?.length
      ? task.dependency_links.map(l => ({ ...l }))
      : (task?.dependency_ids ?? []).map(id => ({ depends_on_id: id, dependency_type: "FS" as DependencyType, lag_days: 0 }))
  );
  const [isMilestone,       setIsMilestone]       = useState(task?.is_milestone ?? false);
  const [estimatedProgress, setEstimatedProgress] = useState(task?.estimated_progress ?? 0);

  const [errors,   setErrors]   = useState<Record<string, string>>({});
  const [saving,   setSaving]   = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [cascadePrompt, setCascadePrompt] = useState<CascadeAffectedTask[] | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
  const [draftMaterials, setDraftMaterials] = useState<DraftMaterial[]>([]);
  // El modal arranca simple (4 campos); "Avanzado" se abre solo si la tarea ya usa esos campos
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() =>
    mode === "edit" && !!task && (
      !!task.description || task.parent_task_id != null ||
      (task.dependency_links?.length ?? 0) > 0 || task.is_milestone ||
      (task.estimated_progress ?? 0) > 0
    )
  );

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim() || title.trim().length < 2)
      e.title = "El título es obligatorio (mínimo 2 caracteres).";
    if (startDate && dueDate && dueDate < startDate)
      e.dueDate = "La fecha de vencimiento debe ser posterior a la de inicio.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    // Edición con fechas cambiadas → chequear dependientes antes de guardar
    if (mode === "edit" && task) {
      const datesChanged =
        (startDate || null) !== (task.start_date ?? null) ||
        (dueDate   || null) !== (task.due_date   ?? null);
      if (datesChanged) {
        setSaving(true);
        try {
          const affected = await fetchCascadePreview(task.id, {
            start_date: startDate || null,
            due_date:   dueDate   || null,
          });
          if (affected.length > 0) {
            setCascadePrompt(affected);
            setSaving(false);
            return;
          }
        } catch { /* si el preview falla, guardamos sin cascade */ }
      }
    }
    await doSave(false);
  }

  async function doSave(cascade: boolean) {
    setSaving(true);
    setApiError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        responsible_id: responsibleId ? Number(responsibleId) : null,
        start_date: startDate || null,
        start_time: startTime || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
        parent_task_id: parentTaskId ? Number(parentTaskId) : null,
        dependency_links: depLinks,
        is_milestone: isMilestone,
        estimated_progress: estimatedProgress,
      };
      let saved: Task;
      if (mode === "create") {
        saved = await createTask({ ...payload, obra_id: obraId, order_index: taskCount });
        // Persistir los materiales cargados en borrador contra la tarea recién creada
        if (draftMaterials.length > 0) {
          await Promise.all(draftMaterials.map(m =>
            createMaterial(saved.id, {
              name: m.name,
              quantity: m.quantity,
              unit: m.unit,
              unit_price: m.unit_price,
              supplier_id: m.supplier_id,
            }).catch(() => { /* no bloquear la creación de la tarea por un material */ })
          ));
        }
      } else {
        saved = await updateTask(task!.id, { ...payload, cascade_dates: cascade });
      }
      onSaved(saved);
    } catch (err) {
      const limitInfo = getPlanLimitError(err);
      if (limitInfo) { setPlanLimit(limitInfo); setSaving(false); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (err as any)?.response?.data;
      console.error(data || err);
      const detail = typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail
              .map((d: { msg?: string }) =>
                (d.msg ?? "").replace(/^Value error,\s*/i, "").trim()
              )
              .filter(Boolean)
              .join(" · ")
          : null;
      setApiError(
        detail ??
        (mode === "create"
          ? "No se pudo crear la tarea. Verificá los datos e intentá nuevamente."
          : "No se pudo guardar los cambios. Intentá nuevamente.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      background: "rgba(15,22,28,0.50)",
      backdropFilter: "blur(3px)",
      padding: "24px 16px",
      overflowY: "auto",
      overscrollBehavior: "contain",
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={mode === "edit" ? "Editar tarea" : "Nueva tarea"} style={{
        background: "#fff",
        borderRadius: 18,
        width: "100%",
        maxWidth: 520,
        boxShadow: "0 32px 64px -16px rgba(15,22,28,0.30), 0 8px 24px -8px rgba(15,22,28,0.12)",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        overflow: "visible",
        margin: "auto",
      }}>

        {/* ── Header ── */}
        <div style={{
          background: "linear-gradient(135deg, #1B2A34 0%, #243642 100%)",
          padding: "20px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0,
              background: "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 12px -4px rgba(232,90,38,0.55)",
            }}>
              <ClipboardList style={{ width: 17, height: 17, color: "#fff" }} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
                {mode === "create" ? "Nueva tarea" : "Editar tarea"}
              </p>
              <h2 style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.015em", lineHeight: 1.2 }}>
                {mode === "create" ? "Agregar tarea a la obra" : task?.title}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 9, border: "none",
              background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.55)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s, color 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.10)"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
          >
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit}>
          <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Title */}
            <div>
              <FieldLabel>Título</FieldLabel>
              <input
                style={inputStyle(!!errors.title)}
                placeholder="Ej: Excavación y nivelación del terreno"
                value={title}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                onFocus={ev => onFocusInput(ev, !!errors.title)}
                onBlur={ev => onBlurInput(ev, !!errors.title)}
                maxLength={255}
                autoFocus
              />
              {errors.title && (
                <p style={{ margin: "5px 0 0", fontSize: 11.5, color: "#D03A3A", display: "flex", alignItems: "center", gap: 5 }}>
                  <AlertTriangle style={{ width: 11, height: 11 }} />
                  {errors.title}
                </p>
              )}
            </div>

            {/* Description (avanzado) */}
            {showAdvanced && <div>
              <FieldLabel optional>Descripción</FieldLabel>
              <textarea
                style={{ ...inputStyle(), resize: "none" } as React.CSSProperties}
                placeholder="Descripción adicional de la tarea..."
                rows={3}
                value={description}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                onFocus={ev => onFocusInput(ev)}
                onBlur={ev => onBlurInput(ev)}
              />
            </div>}

            {/* Parent task (avanzado) */}
            {showAdvanced && tasks.filter(t => t.id !== task?.id).length > 0 && (
              <div>
                <FieldLabel optional>Tarea padre (WBS)</FieldLabel>
                <select
                  style={{ ...inputStyle(), cursor: "pointer", appearance: "none" } as React.CSSProperties}
                  value={parentTaskId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setParentTaskId(e.target.value)}
                  onFocus={ev => onFocusInput(ev)}
                  onBlur={ev => onBlurInput(ev)}
                >
                  <option value="">Sin tarea padre</option>
                  {tasks
                    .filter(t => t.id !== task?.id)
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))
                  }
                </select>
              </div>
            )}

            {/* Responsible */}
            <div>
              <FieldLabel optional>Responsable</FieldLabel>
              {previousResponsibleInactive && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  background: "#FDF1DE", border: "1px solid #E89B14",
                  borderRadius: 10, padding: "10px 12px", marginBottom: 8,
                }}>
                  <AlertTriangle style={{ width: 13, height: 13, color: "#C97D0E", flexShrink: 0, marginTop: 1 }} />
                  <p style={{ margin: 0, fontSize: 12, color: "#8B5E0A" }}>
                    El responsable anterior fue desactivado. Seleccioná uno activo o dejá la tarea sin asignar.
                  </p>
                </div>
              )}
              <select
                style={{
                  ...inputStyle(), cursor: "pointer", appearance: "none",
                  paddingRight: 34,
                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none'><path d='M4 6l4 4 4-4' stroke='%238E97A0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
                } as React.CSSProperties}
                value={responsibleId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setResponsibleId(e.target.value)}
                onFocus={ev => onFocusInput(ev)}
                onBlur={ev => onBlurInput(ev)}
              >
                <option value="">Sin responsable</option>
                {activeResponsibles.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}{r.role ? ` · ${r.role}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Dates + Duration + Times */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Start */}
              <div>
                <FieldLabel optional>Fecha y hora de inicio</FieldLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8 }}>
                  <input
                    type="date"
                    style={inputStyle(!!errors.startDate)}
                    value={startDate}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const v = e.target.value;
                      setStartDate(v);
                      if (v && duration) {
                        const d = parseInt(duration, 10);
                        if (d > 0) setDueDate(addDays(v, d - 1));
                      }
                    }}
                    onFocus={ev => onFocusInput(ev, !!errors.startDate)}
                    onBlur={ev => onBlurInput(ev, !!errors.startDate)}
                  />
                  <input
                    type="time"
                    style={{ ...inputStyle(), opacity: startDate ? 1 : 0.45 }}
                    value={startTime}
                    disabled={!startDate}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)}
                    onFocus={ev => onFocusInput(ev)}
                    onBlur={ev => onBlurInput(ev)}
                  />
                </div>
                {errors.startDate && (
                  <p style={{ margin: "5px 0 0", fontSize: 11.5, color: "#D03A3A", display: "flex", alignItems: "center", gap: 5 }}>
                    <AlertTriangle style={{ width: 11, height: 11 }} />
                    {errors.startDate}
                  </p>
                )}
              </div>

              {/* Duration */}
              {!isMilestone && (
                <div>
                  <FieldLabel optional>Duración</FieldLabel>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      min={1}
                      placeholder="ej: 10"
                      style={inputStyle()}
                      value={duration}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const v = e.target.value;
                        setDuration(v);
                        const d = parseInt(v, 10);
                        if (startDate && d > 0) setDueDate(addDays(startDate, d - 1));
                      }}
                      onFocus={ev => onFocusInput(ev)}
                      onBlur={ev => onBlurInput(ev)}
                    />
                    <span style={{ fontSize: 12.5, color: "#5B6770", fontWeight: 500, whiteSpace: "nowrap" }}>días</span>
                  </div>
                </div>
              )}

              {/* Due */}
              <div>
                <FieldLabel optional>Fecha y hora de vencimiento</FieldLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8 }}>
                  <input
                    type="date"
                    style={inputStyle(!!errors.dueDate)}
                    value={dueDate}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const v = e.target.value;
                      setDueDate(v);
                      if (v && startDate) setDuration(String(diffDays(startDate, v) + 1));
                    }}
                    onFocus={ev => onFocusInput(ev, !!errors.dueDate)}
                    onBlur={ev => onBlurInput(ev, !!errors.dueDate)}
                  />
                  <input
                    type="time"
                    style={{ ...inputStyle(!!errors.dueDate), opacity: dueDate ? 1 : 0.45 }}
                    value={dueTime}
                    disabled={!dueDate}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDueTime(e.target.value)}
                    onFocus={ev => onFocusInput(ev, !!errors.dueDate)}
                    onBlur={ev => onBlurInput(ev, !!errors.dueDate)}
                  />
                </div>
                {errors.dueDate && (
                  <p style={{ margin: "5px 0 0", fontSize: 11.5, color: "#D03A3A", display: "flex", alignItems: "center", gap: 5 }}>
                    <AlertTriangle style={{ width: 11, height: 11 }} />
                    {errors.dueDate}
                  </p>
                )}
              </div>
            </div>

            {/* Depende de (avanzado) */}
            {showAdvanced && tasks.filter(t => t.id !== task?.id).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <FieldLabel optional>Depende de</FieldLabel>

                {/* Existing dependency rows */}
                {depLinks.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {depLinks.map((link, idx) => {
                      const dep = tasks.find(t => t.id === link.depends_on_id);
                      if (!dep) return null;
                      return (
                        <div key={link.depends_on_id} style={{
                          display: "grid", gridTemplateColumns: "1fr 72px 72px 28px",
                          gap: 6, alignItems: "center",
                          background: "#FFF8F5", border: "1px solid #FFD5BB",
                          borderRadius: 9, padding: "7px 10px",
                        }}>
                          {/* Task name */}
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dep.title.length > 35 ? dep.title.slice(0, 35) + "…" : dep.title}
                          </span>
                          {/* Type selector */}
                          <select
                            value={link.dependency_type}
                            onChange={e => setDepLinks(prev => prev.map((l, i) => i === idx ? { ...l, dependency_type: e.target.value as DependencyType } : l))}
                            title={DEP_TYPES.find(d => d.value === link.dependency_type)?.description}
                            style={{
                              height: 28, padding: "0 4px", border: "1px solid #E6E7E5",
                              borderRadius: 7, fontSize: 12, fontWeight: 700, color: "#E85A26",
                              background: "#fff", outline: "none", cursor: "pointer",
                              fontFamily: "'Plus Jakarta Sans', sans-serif",
                              appearance: "none", textAlign: "center",
                            }}
                          >
                            {DEP_TYPES.map(dt => (
                              <option key={dt.value} value={dt.value} title={dt.description}>{dt.label}</option>
                            ))}
                          </select>
                          {/* Lag input */}
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <input
                              type="number"
                              min={-365} max={365}
                              value={link.lag_days}
                              onChange={e => setDepLinks(prev => prev.map((l, i) => i === idx ? { ...l, lag_days: Number(e.target.value) } : l))}
                              style={{
                                width: "100%", height: 28, padding: "0 4px", border: "1px solid #E6E7E5",
                                borderRadius: 7, fontSize: 12, color: "#1A2329",
                                background: "#fff", outline: "none", textAlign: "center",
                                fontFamily: "'Plus Jakarta Sans', sans-serif",
                              }}
                            />
                            <span style={{ fontSize: 10, color: "#6B7580", whiteSpace: "nowrap" }}>d</span>
                          </div>
                          {/* Remove */}
                          <button
                            type="button"
                            onClick={() => setDepLinks(prev => prev.filter((_, i) => i !== idx))}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "#6B7580", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                          >×</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Type legend */}
                {depLinks.length > 0 && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {DEP_TYPES.map(dt => (
                      <span key={dt.value} style={{ fontSize: 10.5, color: "#6B7580" }}>
                        <b style={{ color: "#5B6770" }}>{dt.value}</b> {dt.description}
                      </span>
                    ))}
                  </div>
                )}

                {/* Add dependency */}
                <select
                  value=""
                  onChange={e => {
                    const id = Number(e.target.value);
                    if (id && !depLinks.some(l => l.depends_on_id === id)) {
                      setDepLinks(prev => [...prev, { depends_on_id: id, dependency_type: "FS", lag_days: 0 }]);
                    }
                  }}
                  style={{
                    height: 38, padding: "0 34px 0 12px", border: "1px solid #E6E7E5",
                    background: "#fff", borderRadius: 9, color: "#5B6770", fontSize: 13,
                    width: "100%", outline: "none", appearance: "none", WebkitAppearance: "none",
                    backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none'><path d='M4 6l4 4 4-4' stroke='%238E97A0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
                    backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
                    cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}
                >
                  <option value="">+ Agregar dependencia…</option>
                  {tasks
                    .filter(t => t.id !== task?.id && !depLinks.some(l => l.depends_on_id === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title.length > 50 ? t.title.slice(0, 50) + "…" : t.title}
                      </option>
                    ))
                  }
                </select>
              </div>
            )}

            {/* Tipo + % avance (avanzado) */}
            {showAdvanced && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* Tipo */}
              <div>
                <FieldLabel>Tipo</FieldLabel>
                <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid #E6E7E5" }}>
                  {([false, true] as const).map(val => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setIsMilestone(val)}
                      style={{
                        flex: 1, padding: "8px 0", fontSize: 12.5, fontWeight: 600,
                        border: "none", cursor: "pointer", transition: "background 0.15s, color 0.15s",
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        background: isMilestone === val ? (val ? "#1B2A34" : "#FF6B35") : "#fff",
                        color: isMilestone === val ? "#fff" : "#5B6770",
                      }}
                    >
                      {val ? "◆ Hito" : "■ Tarea"}
                    </button>
                  ))}
                </div>
              </div>

              {/* % Avance */}
              <div>
                <FieldLabel optional>% Avance</FieldLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range"
                    min={0} max={100} step={5}
                    value={estimatedProgress}
                    onChange={e => setEstimatedProgress(Number(e.target.value))}
                    disabled={isMilestone}
                    style={{ flex: 1, accentColor: "#FF6B35", opacity: isMilestone ? 0.35 : 1 }}
                  />
                  <span style={{
                    minWidth: 36, textAlign: "right",
                    fontSize: 13, fontWeight: 700, color: isMilestone ? "#ADAAA4" : "#1A2329",
                  }}>
                    {isMilestone ? "—" : `${estimatedProgress}%`}
                  </span>
                </div>
              </div>
            </div>}

            {/* Toggle Avanzado */}
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              aria-expanded={showAdvanced}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "9px 12px", borderRadius: 10,
                fontSize: 12.5, fontWeight: 600, textAlign: "left",
                background: "#F8F7F4", border: "1px dashed #DDD6C9",
                color: "#5B6770", cursor: "pointer",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" style={{ transform: showAdvanced ? "none" : "rotate(-90deg)", transition: "transform 0.15s", flexShrink: 0 }}>
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {showAdvanced ? "Ocultar opciones avanzadas" : "Opciones avanzadas"}
              {!showAdvanced && (
                <span style={{ fontWeight: 400, color: "#7D7973", fontSize: 11.5 }}>
                  descripción · subtarea · dependencias · hito · % avance
                </span>
              )}
            </button>

            {/* Info notes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#F4F5F4", borderRadius: 10, padding: "10px 14px" }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1, color: "#6B7580" }}>
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                  <path d="M8 7v4M8 5.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                <p style={{ margin: 0, fontSize: 12, color: "#5B6770", lineHeight: 1.45 }}>
                  Las fechas son opcionales, pero necesarias para visualizar la tarea en el cronograma.
                </p>
              </div>
            </div>

            {/* Materiales — persistente al editar, borrador al crear */}
            {mode === "edit" && task
              ? <TaskMaterialsSection taskId={task.id} />
              : <TaskMaterialsSection draft={draftMaterials} onDraftChange={setDraftMaterials} />}

            {/* Origen: notas de voz que originaron/modificaron esta tarea */}
            {mode === "edit" && task && <TaskBitacoraOrigin taskId={task.id} />}

            {/* API error */}
            {apiError && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                background: "#FCE5E5", border: "1px solid #F0B0B0",
                borderRadius: 10, padding: "10px 14px",
              }}>
                <AlertTriangle style={{ width: 13, height: 13, color: "#D03A3A", flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 12, color: "#D03A3A" }}>{apiError}</p>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div style={{
            display: "flex", justifyContent: "flex-end", gap: 8,
            padding: "14px 24px 20px",
            borderTop: "1px solid #F0F1EF",
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5",
                cursor: "pointer", transition: "border-color 0.15s, color 0.15s",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#D03A3A"; e.currentTarget.style.color = "#D03A3A"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#E6E7E5"; e.currentTarget.style.color = "#5B6770"; }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "9px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: saving ? "#F0A882" : "#FF6B35", color: "#fff",
                border: "none", cursor: saving ? "not-allowed" : "pointer",
                boxShadow: saving ? "none" : "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
                transition: "background 0.15s",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
              onMouseEnter={e => { if (!saving) e.currentTarget.style.background = "#E85A26"; }}
              onMouseLeave={e => { if (!saving) e.currentTarget.style.background = "#FF6B35"; }}
            >
              {saving ? (
                <>
                  <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
                  Guardando...
                </>
              ) : mode === "create" ? "Crear tarea" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>

      {planLimit && <UpgradeModal info={planLimit} onClose={() => setPlanLimit(null)} />}

      {/* ── Confirmación de cascade: la tarea tiene dependientes ── */}
      {cascadePrompt && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(15,22,28,0.45)", padding: 16,
        }}>
          <div style={{
            background: "#fff", borderRadius: 14, width: "100%", maxWidth: 440,
            boxShadow: "0 24px 48px -12px rgba(15,22,28,0.35)",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            padding: "20px 22px",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: "#FFF4E8", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <GitBranch style={{ width: 16, height: 16, color: "#FF6B35" }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "#1A2329" }}>
                  Esta tarea tiene {cascadePrompt.length} tarea{cascadePrompt.length !== 1 ? "s" : ""} dependiente{cascadePrompt.length !== 1 ? "s" : ""}
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#5B6770", lineHeight: 1.45 }}>
                  Con las nuevas fechas, esta{cascadePrompt.length !== 1 ? "s" : ""} tarea{cascadePrompt.length !== 1 ? "s" : ""} quedaría{cascadePrompt.length !== 1 ? "n" : ""} desfasada{cascadePrompt.length !== 1 ? "s" : ""}. ¿Reprogramarla{cascadePrompt.length !== 1 ? "s" : ""} automáticamente?
                </p>
              </div>
            </div>

            <div style={{
              margin: "14px 0 0", maxHeight: 132, overflowY: "auto",
              border: "1px solid #F0EBE2", borderRadius: 10, padding: "8px 12px",
            }}>
              {cascadePrompt.map(a => (
                <div key={a.task_id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 10, padding: "4px 0", fontSize: 12,
                }}>
                  <span style={{
                    fontWeight: 600, color: "#1A2329", whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis",
                  }} title={a.title}>{a.title}</span>
                  <span style={{ flexShrink: 0, color: "#5B6770", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                    {fmtShortDate(a.old_start ?? a.old_due)} <span style={{ color: "#FF6B35", fontWeight: 700 }}>→</span> {fmtShortDate(a.new_start ?? a.new_due)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => setCascadePrompt(null)}
                style={{
                  padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                  color: "#6B7580", background: "#fff", border: "none", cursor: "pointer",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                Volver
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => doSave(false)}
                style={{
                  padding: "8px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                  color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5",
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                No, solo esta tarea
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => doSave(true)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                  background: saving ? "#F0A882" : "#FF6B35", color: "#fff", border: "none",
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                {saving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                Sí, reprogramar {cascadePrompt.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
