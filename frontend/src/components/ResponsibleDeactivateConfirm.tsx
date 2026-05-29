import { useState } from "react";
import { UserX, Loader2, AlertTriangle } from "lucide-react";
import { deactivateResponsible } from "../api/responsibles";
import { Button } from "./ui/Button";
import type { Responsible, Task } from "../types";

interface ResponsibleDeactivateConfirmProps {
  responsible: Responsible;
  obraTasks: Task[];
  onClose: () => void;
  onDeactivated: () => void;
}

export function ResponsibleDeactivateConfirm({
  responsible,
  obraTasks,
  onClose,
  onDeactivated,
}: ResponsibleDeactivateConfirmProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTasks = obraTasks.filter(
    (t) =>
      t.responsible_id === responsible.id &&
      t.status !== "completada" &&
      t.status !== "cancelada"
  );

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await deactivateResponsible(responsible.id);
      onDeactivated();
    } catch {
      setError("No se pudo desactivar el responsable. Intentá nuevamente.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded shadow-card-md w-full max-w-sm">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <UserX className="w-5 h-5 text-constructa-danger" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-constructa-text">
                Desactivar responsable
              </h2>
              <p className="text-xs text-constructa-secondaryText mt-1 leading-relaxed">
                ¿Seguro que querés desactivar a{" "}
                <span className="font-semibold text-constructa-text">
                  {responsible.full_name}
                </span>
                ? Ya no podrá ser asignado a nuevas tareas.
              </p>
            </div>
          </div>

          {activeTasks.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded px-3 py-2.5 mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                Este responsable tiene{" "}
                <span className="font-semibold">{activeTasks.length}</span>{" "}
                tarea{activeTasks.length !== 1 ? "s" : ""} activa
                {activeTasks.length !== 1 ? "s" : ""} en esta obra. Las tareas
                quedarán sin responsable asignado.
              </p>
            </div>
          )}

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
                  Desactivando...
                </>
              ) : (
                "Desactivar"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
