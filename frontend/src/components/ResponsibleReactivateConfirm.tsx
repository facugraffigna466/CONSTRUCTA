import { useState } from "react";
import { UserCheck, Loader2 } from "lucide-react";
import { reactivateResponsible } from "../api/responsibles";
import { Button } from "./ui/Button";
import type { Responsible } from "../types";

interface ResponsibleReactivateConfirmProps {
  responsible: Responsible;
  onClose: () => void;
  onReactivated: () => void;
}

export function ResponsibleReactivateConfirm({
  responsible,
  onClose,
  onReactivated,
}: ResponsibleReactivateConfirmProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await reactivateResponsible(responsible.id);
      onReactivated();
    } catch {
      setError("No se pudo reactivar el responsable. Intentá nuevamente.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded shadow-card-md w-full max-w-sm">
        <div className="px-6 py-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <UserCheck className="w-5 h-5 text-constructa-success" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-constructa-text">
                Reactivar responsable
              </h2>
              <p className="text-xs text-constructa-secondaryText mt-1 leading-relaxed">
                ¿Reactivar a{" "}
                <span className="font-semibold text-constructa-text">
                  {responsible.full_name}
                </span>
                ? Este responsable volverá a estar disponible para nuevas
                tareas. No se reasignarán tareas automáticamente.
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
              variant="primary"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reactivando...
                </>
              ) : (
                "Reactivar"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
