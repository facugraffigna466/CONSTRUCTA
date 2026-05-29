import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { deleteTask } from "../api/tasks";
import { Button } from "./ui/Button";
import type { Task } from "../types";

interface TaskDeleteConfirmProps {
  task: Task;
  onClose: () => void;
  onDeleted: () => void;
}

export function TaskDeleteConfirm({
  task,
  onClose,
  onDeleted,
}: TaskDeleteConfirmProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onDeleted();
    } catch {
      setError("No se pudo eliminar la tarea. Intentá nuevamente.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded shadow-card-md w-full max-w-sm">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Trash2 className="w-5 h-5 text-constructa-danger" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-constructa-text">
                Eliminar tarea
              </h2>
              <p className="text-xs text-constructa-secondaryText mt-1 leading-relaxed">
                ¿Seguro que querés eliminar{" "}
                <span className="font-semibold text-constructa-text">
                  &ldquo;{task.title}&rdquo;
                </span>
                ? Esta acción eliminará la tarea y marcará como resueltas sus alertas activas.
              </p>
            </div>
          </div>

          {error && (
            <p className="text-xs text-constructa-danger bg-red-50 border border-constructa-danger/30 rounded px-3 py-2 mb-3">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Eliminando...
                </>
              ) : (
                "Eliminar tarea"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
