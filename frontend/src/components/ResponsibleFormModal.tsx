import { useState, type FormEvent, type ChangeEvent } from "react";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import { createResponsible, updateResponsible } from "../api/responsibles";
import { Button } from "./ui/Button";
import type { Responsible } from "../types";

const inputCls = (err = false) =>
  [
    "w-full border rounded px-3 py-2.5 text-sm text-constructa-text bg-white",
    "placeholder:text-constructa-border",
    "focus:outline-none focus:ring-2 focus:ring-constructa-primary focus:border-constructa-primary transition",
    err ? "border-constructa-danger" : "border-constructa-border",
  ].join(" ");

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

interface ResponsibleFormModalProps {
  mode: "create" | "edit";
  responsible?: Responsible;
  onClose: () => void;
  onSaved: (responsible: Responsible) => void;
}

export function ResponsibleFormModal({
  mode,
  responsible,
  onClose,
  onSaved,
}: ResponsibleFormModalProps) {
  const [fullName, setFullName] = useState(responsible?.full_name ?? "");
  const [whatsapp, setWhatsapp] = useState(responsible?.whatsapp_number ?? "");
  const [role, setRole] = useState(responsible?.role ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  function validate() {
    const e: Record<string, string> = {};
    if (!fullName.trim() || fullName.trim().length < 2)
      e.fullName = "El nombre es obligatorio (mínimo 2 caracteres).";
    if (mode === "create") {
      if (!whatsapp.trim())
        e.whatsapp = "El número de WhatsApp es obligatorio.";
      else if (!/^\+\d{7,15}$/.test(whatsapp.trim()))
        e.whatsapp = "Formato inválido. Usá el formato internacional: +549...";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setApiError(null);
    try {
      let saved: Responsible;
      if (mode === "create") {
        saved = await createResponsible({
          full_name: fullName.trim(),
          whatsapp_number: whatsapp.trim(),
          role: role.trim() || null,
        });
      } else {
        saved = await updateResponsible(responsible!.id, {
          full_name: fullName.trim(),
          role: role.trim() || null,
        });
      }
      onSaved(saved);
    } catch {
      setApiError(
        mode === "create"
          ? "No se pudo crear el responsable. Verificá los datos e intentá nuevamente."
          : "No se pudo guardar los cambios. Intentá nuevamente."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded shadow-card-md w-full max-w-md">
        <div className="bg-constructa-dark px-6 py-4 rounded-t flex items-center justify-between">
          <div>
            <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">
              {mode === "create" ? "Nuevo responsable" : "Editar responsable"}
            </p>
            <h2 className="text-white font-bold text-base mt-0.5">
              {mode === "create" ? "Agregar responsable" : responsible?.full_name}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <Label>Nombre completo</Label>
            <input
              className={inputCls(!!errors.fullName)}
              placeholder="Ej: Juan García"
              value={fullName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)}
              maxLength={255}
              autoFocus
            />
            {errors.fullName && (
              <p className="mt-1 text-xs text-constructa-danger">{errors.fullName}</p>
            )}
          </div>

          <div>
            <Label optional={mode === "edit"}>Número de WhatsApp</Label>
            {mode === "create" ? (
              <>
                <input
                  className={inputCls(!!errors.whatsapp)}
                  placeholder="+5491112345678"
                  value={whatsapp}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setWhatsapp(e.target.value)}
                  maxLength={16}
                />
                {errors.whatsapp ? (
                  <p className="mt-1 text-xs text-constructa-danger">{errors.whatsapp}</p>
                ) : (
                  <p className="mt-1 text-xs text-constructa-secondaryText">
                    Formato internacional: +549... No se puede cambiar después.
                  </p>
                )}
              </>
            ) : (
              <input
                className={[inputCls(), "bg-constructa-surface cursor-not-allowed opacity-60"].join(" ")}
                value={responsible?.whatsapp_number ?? ""}
                readOnly
              />
            )}
          </div>

          <div>
            <Label optional>Rol / Cargo</Label>
            <input
              className={inputCls()}
              placeholder="Ej: Capataz, Arquitecto, Electricista..."
              value={role}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setRole(e.target.value)}
              maxLength={100}
            />
          </div>

          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-constructa-danger/30 rounded px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-constructa-danger flex-shrink-0 mt-0.5" />
              <p className="text-xs text-constructa-danger">{apiError}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : mode === "create" ? (
                "Crear responsable"
              ) : (
                "Guardar cambios"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
