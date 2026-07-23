import { useState, type ChangeEvent, type FormEvent } from "react";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import { updateTask } from "../api/tasks";
import { useDialog } from "../hooks/useDialog";
import type { TaskUpdatePayload } from "../api/tasks";
import { Button } from "./ui/Button";
import type { Responsible, Task } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────


const inputCls = (err = false) =>
  [
    "w-full border rounded px-3 py-2.5 text-sm text-constructa-text bg-white",
    "placeholder:text-constructa-border",
    "focus:outline-none focus:ring-2 focus:ring-constructa-primary focus:border-constructa-primary transition",
    err ? "border-constructa-danger" : "border-constructa-border",
  ].join(" ");

const BASE_SELECT: React.CSSProperties = {
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
  appearance: "none",
  cursor: "pointer",
};

function selectStyle(err = false): React.CSSProperties {
  return {
    ...BASE_SELECT,
    borderColor: err ? "#D03A3A" : "#E6E7E5",
    boxShadow: err ? "0 0 0 3px rgba(208,58,58,0.08)" : "none",
  };
}

function onFocusSelect(e: React.FocusEvent<HTMLSelectElement>, err = false) {
  if (err) return;
  e.currentTarget.style.borderColor = "#FF6B35";
  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(255,107,53,0.10)";
}

function onBlurSelect(e: React.FocusEvent<HTMLSelectElement>, err = false) {
  e.currentTarget.style.borderColor = err ? "#D03A3A" : "#E6E7E5";
  e.currentTarget.style.boxShadow = err ? "0 0 0 3px rgba(208,58,58,0.08)" : "none";
}

function Label({
  children,
  optional,
}: {
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-widest text-constructa-secondaryText mb-1.5">
      {children}
      {optional && (
        <span className="ml-1.5 normal-case tracking-normal font-normal text-constructa-border">
          (opcional)
        </span>
      )}
    </label>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SchedulingModalProps {
  task: Task;
  dropDate: string;
  responsibles: Responsible[];
  onClose: () => void;
  onSaved: (task: Task) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SchedulingModal({
  task,
  dropDate,
  responsibles,
  onClose,
  onSaved,
}: SchedulingModalProps) {
  const dialogRef = useDialog(onClose);
  const activeResponsibles = responsibles.filter((r) => r.is_active);

  // Preselect existing responsible only if still active
  const initialResponsibleId =
    task.responsible_id !== null &&
    activeResponsibles.some((r) => r.id === task.responsible_id)
      ? String(task.responsible_id)
      : "";

  const [startDate, setStartDate]         = useState(dropDate);
  const [dueDate, setDueDate]             = useState(dropDate);
  const [duration, setDuration]           = useState("1");
  const [responsibleId, setResponsibleId] = useState(initialResponsibleId);
  const [saving, setSaving]               = useState(false);
  const [apiError, setApiError]           = useState<string | null>(null);
  const [errors, setErrors]               = useState<Record<string, string>>({});

  function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function diffDays(a: string, b: string): number {
    return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000);
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!startDate)
      e.startDate = "La fecha de inicio es obligatoria.";
    if (!dueDate)
      e.dueDate = "La fecha de vencimiento es obligatoria.";
    else if (startDate && dueDate < startDate)
      e.dueDate = "La fecha de vencimiento debe ser posterior a la de inicio.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setApiError(null);
    try {
      const payload: TaskUpdatePayload = {
        start_date: startDate,
        due_date: dueDate,
        responsible_id: responsibleId ? Number(responsibleId) : null,
      };
      const saved = await updateTask(task.id, payload);
      onSaved(saved);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.error((err as any)?.response?.data || err);
      setApiError("No se pudo programar la tarea. Intentá nuevamente.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Programar tarea" className="bg-white rounded shadow-card-md w-full max-w-lg">
        {/* Header */}
        <div className="bg-constructa-dark px-6 py-4 rounded-t flex items-center justify-between">
          <div>
            <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">
              Programar tarea
            </p>
            <h2
              className="text-white font-bold text-base mt-0.5 truncate max-w-sm"
              title={task.title}
            >
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleConfirm} className="px-6 py-5 space-y-4">
          {/* Helper text */}
          <p className="text-xs text-constructa-secondaryText bg-constructa-surface rounded px-3 py-2">
            Completá estos datos para que la tarea quede visible y operativa en el cronograma.
          </p>

          {/* Dates + Duration */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Start date */}
            <div>
              <Label>Fecha de inicio</Label>
              <input
                type="date"
                className={inputCls(!!errors.startDate)}
                value={startDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const v = e.target.value;
                  setStartDate(v);
                  const d = parseInt(duration, 10);
                  if (v && d > 0) setDueDate(addDays(v, d - 1));
                }}
                autoFocus
              />
              {errors.startDate && (
                <p className="mt-1 text-xs text-constructa-danger">{errors.startDate}</p>
              )}
            </div>

            {/* Duration */}
            <div>
              <Label optional>Duración</Label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  placeholder="ej: 10"
                  className={inputCls()}
                  value={duration}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const v = e.target.value;
                    setDuration(v);
                    const d = parseInt(v, 10);
                    if (startDate && d > 0) setDueDate(addDays(startDate, d - 1));
                  }}
                />
                <span style={{ fontSize: 12.5, color: "#5B6770", fontWeight: 500, whiteSpace: "nowrap", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>días</span>
              </div>
            </div>

            {/* Due date */}
            <div>
              <Label>Fecha de vencimiento</Label>
              <input
                type="date"
                className={inputCls(!!errors.dueDate)}
                value={dueDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const v = e.target.value;
                  setDueDate(v);
                  if (v && startDate) setDuration(String(diffDays(startDate, v) + 1));
                }}
              />
              {errors.dueDate && (
                <p className="mt-1 text-xs text-constructa-danger">{errors.dueDate}</p>
              )}
            </div>
          </div>

          {/* Responsible */}
          <div>
            <Label optional>
              Responsable
            </Label>

            {activeResponsibles.length === 0 ? (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded px-3 py-2 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  No hay responsables activos disponibles. Podés asignarlo más adelante.
                </p>
              </div>
            ) : (
              <>
                <select
                  style={selectStyle(!!errors.responsibleId)}
                  value={responsibleId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setResponsibleId(e.target.value)
                  }
                  onFocus={ev => onFocusSelect(ev, !!errors.responsibleId)}
                  onBlur={ev => onBlurSelect(ev, !!errors.responsibleId)}
                >
                  <option value="">Seleccioná un responsable</option>
                  {activeResponsibles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.full_name}
                      {r.role ? ` · ${r.role}` : ""}
                    </option>
                  ))}
                </select>
                {errors.responsibleId && (
                  <p className="mt-1 text-xs text-constructa-danger">
                    {errors.responsibleId}
                  </p>
                )}
              </>
            )}
          </div>

          {/* API error */}
          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-constructa-danger/30 rounded px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-constructa-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-constructa-danger">{apiError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Confirmar programación"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
