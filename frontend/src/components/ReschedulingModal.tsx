import { useState } from "react";
import { X, AlertTriangle, Calendar, Loader2 } from "lucide-react";
import { updateTask } from "../api/tasks";
import type { TaskUpdatePayload } from "../api/tasks";
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

  const oldStart = task.start_date;
  const oldDue   = task.due_date;

  const oldDuration = oldStart && oldDue ? diffDays(oldStart, oldDue) : null;
  const newDuration = newStartDate && newDueDate ? diffDays(newStartDate, newDueDate) : null;

  const modalTitle =
    mode === "resize-start" ? "Ajustar inicio de tarea"
    : mode === "resize-end" ? "Ajustar vencimiento de tarea"
    : "Reprogramar tarea";

  async function handleConfirm() {
    setSaving(true);
    setApiError(null);
    try {
      const payload: TaskUpdatePayload = {};
      if (newStartDate !== null) payload.start_date = newStartDate;
      if (newDueDate   !== null) payload.due_date   = newDueDate;
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

          {/* Nearby tasks impact */}
          {nearbyCount > 0 && (
            <div className="flex items-start gap-2 bg-constructa-surface border border-constructa-border rounded px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-constructa-secondaryText flex-shrink-0 mt-0.5" />
              <p className="text-xs text-constructa-secondaryText">
                <span className="font-semibold text-constructa-text">{nearbyCount} tarea{nearbyCount !== 1 ? "s" : ""}</span> tienen fechas cercanas (±3 días). No se modificarán automáticamente.
              </p>
            </div>
          )}

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
            <Button type="button" variant="primary" onClick={handleConfirm} disabled={saving}>
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
          </div>
        </div>
      </div>
    </div>
  );
}
