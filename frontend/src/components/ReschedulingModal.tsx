import { useEffect, useState } from "react";
import { X, AlertTriangle, Calendar, Loader2, GitBranch } from "lucide-react";
import { fetchCascadePreview, updateTask } from "../api/tasks";
import type { CascadeAffectedTask, TaskUpdatePayload } from "../api/tasks";
import { Button } from "./ui/Button";
import type { Task } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ReschedulingModalProps {
  task: Task;
  newStartDate: string | null;
  newDueDate: string | null;
  nearbyCount: number;
  mode: "move" | "resize-start" | "resize-end";
  onClose: () => void;
  onSaved: (task: Task) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReschedulingModal({
  task,
  newStartDate,
  newDueDate,
  nearbyCount,
  mode,
  onClose,
  onSaved,
}: ReschedulingModalProps) {
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [affected, setAffected] = useState<CascadeAffectedTask[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Esc cierra (cancela la reprogramación)
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const oldStart = task.start_date;
  const oldDue   = task.due_date;

  // Preview: ¿qué tareas dependientes quedarían desfasadas con las nuevas fechas?
  useEffect(() => {
    let cancelled = false;
    fetchCascadePreview(task.id, {
      start_date: newStartDate ?? oldStart,
      due_date:   newDueDate   ?? oldDue,
    })
      .then(list => { if (!cancelled) setAffected(list); })
      .catch(() => { if (!cancelled) setAffected([]); })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, newStartDate, newDueDate]);

  const oldDuration = oldStart && oldDue ? diffDays(oldStart, oldDue) : null;
  const newDuration = newStartDate && newDueDate ? diffDays(newStartDate, newDueDate) : null;

  const modalTitle =
    mode === "resize-start" ? "Ajustar inicio de tarea"
    : mode === "resize-end" ? "Ajustar vencimiento de tarea"
    : "Reprogramar tarea";

  async function handleConfirm(cascade: boolean) {
    setSaving(true);
    setApiError(null);
    try {
      const payload: TaskUpdatePayload = {};
      if (newStartDate !== null) payload.start_date = newStartDate;
      if (newDueDate   !== null) payload.due_date   = newDueDate;
      if (cascade) payload.cascade_dates = true;
      const saved = await updateTask(task.id, payload);
      onSaved(saved);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (err as any)?.response?.data;
      console.error(data || err);
      const detail = typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((d: { msg?: string }) => d.msg).join(". ")
          : "No se pudo reprogramar la tarea. Intentá nuevamente.";
      setApiError(detail);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded shadow-card-md w-full max-w-md">
        {/* Header */}
        <div className="bg-constructa-dark px-6 py-4 rounded-t flex items-center justify-between">
          <div>
            <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">
              {modalTitle}
            </p>
            <h2
              className="text-white font-bold text-base mt-0.5 truncate max-w-xs"
              title={task.title}
            >
              {task.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Date comparison */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-constructa-surface rounded px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-constructa-secondaryText mb-2">
                Fechas actuales
              </p>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-sm text-constructa-secondaryText">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Inicio: <span className="font-semibold text-constructa-text">{fmtDate(oldStart)}</span></span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-constructa-secondaryText">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Vence: <span className="font-semibold text-constructa-text">{fmtDate(oldDue)}</span></span>
                </div>
              </div>
            </div>

            <div className="bg-constructa-primary/5 border border-constructa-primary/20 rounded px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-constructa-primary mb-2">
                Nuevas fechas
              </p>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-sm text-constructa-secondaryText">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-constructa-primary" />
                  <span>Inicio: <span className="font-semibold text-constructa-text">{fmtDate(newStartDate)}</span></span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-constructa-secondaryText">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-constructa-primary" />
                  <span>Vence: <span className="font-semibold text-constructa-text">{fmtDate(newDueDate)}</span></span>
                </div>
              </div>
            </div>
          </div>

          {/* Duration info */}
          {oldDuration !== null && (
            mode === "move" ? (
              <p className="text-xs text-constructa-secondaryText text-center">
                Duración: <span className="font-semibold text-constructa-text">{oldDuration} día{oldDuration !== 1 ? "s" : ""}</span>{" "}
                (sin cambio)
              </p>
            ) : (
              <div className="flex items-center justify-center gap-3 text-xs text-constructa-secondaryText">
                <span>
                  Duración anterior:{" "}
                  <span className="font-semibold text-constructa-text">
                    {oldDuration} d
                  </span>
                </span>
                <span className="text-constructa-primary font-bold">→</span>
                <span>
                  Nueva:{" "}
                  <span className="font-semibold text-constructa-primary">
                    {newDuration} d
                  </span>
                </span>
              </div>
            )
          )}

          {/* Dependent tasks impact (cascade) */}
          {loadingPreview ? (
            <p className="flex items-center gap-1.5 text-xs text-constructa-secondaryText">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Verificando tareas dependientes...
            </p>
          ) : affected.length > 0 ? (
            <div className="bg-amber-50 border border-amber-300 rounded px-3 py-2.5">
              <div className="flex items-start gap-2">
                <GitBranch className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-constructa-text">
                  <span className="font-semibold">{affected.length} tarea{affected.length !== 1 ? "s" : ""} dependiente{affected.length !== 1 ? "s" : ""}</span>{" "}
                  quedaría{affected.length !== 1 ? "n" : ""} desfasada{affected.length !== 1 ? "s" : ""} con este cambio. ¿Reprogramarla{affected.length !== 1 ? "s" : ""} automáticamente?
                </p>
              </div>
              <div className="mt-2 max-h-28 overflow-y-auto space-y-1 pl-6">
                {affected.map(a => (
                  <div key={a.task_id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate font-medium text-constructa-text" title={a.title}>{a.title}</span>
                    <span className="flex-shrink-0 text-constructa-secondaryText">
                      {fmtDate(a.old_start ?? a.old_due)} <span className="text-amber-600 font-bold">→</span> {fmtDate(a.new_start ?? a.new_due)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : nearbyCount > 0 ? (
            <div className="flex items-start gap-2 bg-constructa-surface border border-constructa-border rounded px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-constructa-secondaryText flex-shrink-0 mt-0.5" />
              <p className="text-xs text-constructa-secondaryText">
                <span className="font-semibold text-constructa-text">{nearbyCount} tarea{nearbyCount !== 1 ? "s" : ""}</span> tienen fechas cercanas (±3 días). No se modificarán automáticamente.
              </p>
            </div>
          ) : null}

          {/* API error */}
          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-constructa-danger/30 rounded px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-constructa-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-constructa-danger">{apiError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            {affected.length > 0 ? (
              <>
                <Button type="button" variant="secondary" onClick={() => handleConfirm(false)} disabled={saving}>
                  No, solo esta tarea
                </Button>
                <Button type="button" variant="primary" onClick={() => handleConfirm(true)} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    `Sí, reprogramar ${affected.length} dependiente${affected.length !== 1 ? "s" : ""}`
                  )}
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" onClick={() => handleConfirm(false)} disabled={saving || loadingPreview}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Guardando...
                  </>
                ) : mode === "move" ? (
                  "Confirmar reprogramación"
                ) : (
                  "Confirmar ajuste"
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
