import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RefreshCw, Pencil, UserX, X } from "lucide-react";
import {
  fetchResponsibles,
  updateResponsible,
  deactivateResponsible,
  type ResponsibleUpdatePayload,
} from "../api/responsibles";
import { Card } from "../components/ui/Card";
import { SectionTitle } from "../components/ui/SectionTitle";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/Spinner";
import type { Responsible } from "../types";

// ─── Active / Inactive badge ─────────────────────────────────────────────────

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border bg-green-50 text-constructa-success border-green-200">
      <span className="w-1.5 h-1.5 rounded-full bg-constructa-success" />
      Activo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border bg-constructa-surface text-constructa-secondaryText border-constructa-border">
      <span className="w-1.5 h-1.5 rounded-full bg-constructa-border" />
      Inactivo
    </span>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  responsible: Responsible;
  onClose: () => void;
  onSaved: (updated: Responsible) => void;
}

function EditModal({ responsible, onClose, onSaved }: EditModalProps) {
  const [fullName, setFullName] = useState(responsible.full_name);
  const [role, setRole] = useState(responsible.role ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: ResponsibleUpdatePayload = {
        full_name: fullName.trim() || undefined,
        role: role.trim() || null,
      };
      const updated = await updateResponsible(responsible.id, payload);
      onSaved(updated);
    } catch {
      setError("No se pudo guardar. Verificá los datos e intentá nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded shadow-card-md w-full max-w-md">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-constructa-border">
          <div>
            <h2 className="text-sm font-bold text-constructa-text uppercase tracking-widest">
              Editar responsable
            </h2>
            <p className="text-xs text-constructa-secondaryText mt-0.5">
              ID #{responsible.id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-constructa-surface text-constructa-secondaryText transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-constructa-secondaryText mb-1.5">
              Nombre completo
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={255}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full border border-constructa-border bg-white rounded px-3 py-2.5 text-sm text-constructa-text focus:outline-none focus:ring-2 focus:ring-constructa-primary focus:border-transparent transition"
              placeholder="Nombre del responsable"
            />
          </div>

          {/* whatsapp_number — read-only, not sent to API */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-constructa-secondaryText mb-1.5">
              WhatsApp
              <span className="ml-1.5 text-[10px] normal-case tracking-normal font-normal text-constructa-border">
                (no modificable)
              </span>
            </label>
            <input
              type="text"
              disabled
              value={responsible.whatsapp_number}
              className="w-full border border-constructa-surface bg-constructa-surface rounded px-3 py-2.5 text-sm text-constructa-secondaryText cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-constructa-secondaryText mb-1.5">
              Rol
            </label>
            <input
              type="text"
              maxLength={100}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border border-constructa-border bg-white rounded px-3 py-2.5 text-sm text-constructa-text focus:outline-none focus:ring-2 focus:ring-constructa-primary focus:border-transparent transition"
              placeholder="Ej: Albañil, Electricista, Capataz..."
            />
          </div>

          {error && (
            <p className="text-sm text-constructa-danger bg-red-50 border border-constructa-danger/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Deactivate confirmation modal ───────────────────────────────────────────

interface ConfirmDeactivateProps {
  responsible: Responsible;
  onClose: () => void;
  onConfirmed: (updated: Responsible) => void;
}

function ConfirmDeactivate({ responsible, onClose, onConfirmed }: ConfirmDeactivateProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const updated = await deactivateResponsible(responsible.id);
      onConfirmed(updated);
    } catch {
      setError("No se pudo desactivar. Intentá nuevamente.");
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
                ¿Desactivar a{" "}
                <span className="font-semibold text-constructa-text">
                  {responsible.full_name}
                </span>
                ? El responsable no recibirá nuevas asignaciones. Esta acción puede
                revertirse desde el backend.
              </p>
            </div>
          </div>

          {error && (
            <p className="text-sm text-constructa-danger bg-red-50 border border-constructa-danger/30 rounded px-3 py-2 mb-3">
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
              {loading ? "Desactivando..." : "Confirmar desactivación"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ResponsablesPage() {
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<Responsible | null>(null);
  const [deactivating, setDeactivating] = useState<Responsible | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await fetchResponsibles();
      setResponsibles(data);
    } catch {
      setError("No se pudieron cargar los responsables.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleSaved(updated: Responsible) {
    setResponsibles((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r))
    );
    setEditing(null);
  }

  function handleDeactivated(updated: Responsible) {
    setResponsibles((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r))
    );
    setDeactivating(null);
  }

  const active = responsibles.filter((r) => r.is_active).length;
  const inactive = responsibles.filter((r) => !r.is_active).length;

  return (
    <>
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white border border-constructa-border rounded shadow-card p-5 border-l-4 border-l-constructa-primary">
            <p className="text-xs font-bold uppercase tracking-widest text-constructa-secondaryText">
              Total
            </p>
            <p className="mt-2 text-3xl font-bold text-constructa-text">
              {responsibles.length}
            </p>
          </div>
          <div className="bg-white border border-constructa-border rounded shadow-card p-5 border-l-4 border-l-constructa-success">
            <p className="text-xs font-bold uppercase tracking-widest text-constructa-secondaryText">
              Activos
            </p>
            <p className="mt-2 text-3xl font-bold text-constructa-success">{active}</p>
          </div>
          <div className="bg-white border border-constructa-border rounded shadow-card p-5 border-l-4 border-l-constructa-border">
            <p className="text-xs font-bold uppercase tracking-widest text-constructa-secondaryText">
              Inactivos
            </p>
            <p className="mt-2 text-3xl font-bold text-constructa-secondaryText">
              {inactive}
            </p>
          </div>
        </div>

        {/* Table */}
        <section>
          <SectionTitle
            aside={
              <button
                onClick={() => loadData(true)}
                disabled={refreshing}
                title="Actualizar"
                className="p-1.5 rounded text-constructa-secondaryText hover:text-constructa-text hover:bg-constructa-surface disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            }
          >
            Responsables
          </SectionTitle>

          {error && (
            <div className="mb-4 text-sm text-constructa-danger bg-red-50 border border-constructa-danger/30 rounded px-4 py-3">
              {error}
            </div>
          )}

          {loading ? (
            <Spinner />
          ) : (
            <Card padding="none" className="overflow-hidden">
              {responsibles.length === 0 ? (
                <div className="py-12 text-center text-constructa-secondaryText text-sm">
                  No hay responsables registrados.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-constructa-surface border-b border-constructa-border">
                      {["#", "Nombre", "WhatsApp", "Rol", "Estado", "Acciones"].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-constructa-secondaryText"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-constructa-surface">
                    {responsibles.map((r) => (
                      <tr
                        key={r.id}
                        className={`hover:bg-constructa-bg transition-colors ${
                          !r.is_active ? "opacity-60" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-constructa-secondaryText text-xs font-mono">
                          {r.id}
                        </td>
                        <td className="px-4 py-3 font-semibold text-constructa-text">
                          {r.full_name}
                        </td>
                        <td className="px-4 py-3 text-constructa-secondaryText font-mono text-xs">
                          {r.whatsapp_number}
                        </td>
                        <td className="px-4 py-3 text-constructa-secondaryText">
                          {r.role ?? (
                            <span className="text-constructa-border italic">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <ActiveBadge active={r.is_active} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditing(r)}
                              title="Editar"
                              className="p-1.5 rounded text-constructa-secondaryText hover:text-constructa-info hover:bg-blue-50 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            {r.is_active && (
                              <button
                                onClick={() => setDeactivating(r)}
                                title="Desactivar"
                                className="p-1.5 rounded text-constructa-secondaryText hover:text-constructa-danger hover:bg-red-50 transition-colors"
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </section>
      </div>

      {/* Modals — rendered outside main scroll area */}
      {editing && (
        <EditModal
          responsible={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {deactivating && (
        <ConfirmDeactivate
          responsible={deactivating}
          onClose={() => setDeactivating(null)}
          onConfirmed={handleDeactivated}
        />
      )}
    </>
  );
}
