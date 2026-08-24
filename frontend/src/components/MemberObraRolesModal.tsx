/**
 * Modal para editar las asignaciones (obra × rol) de un usuario del tenant.
 *
 * Fase 4 del rediseño de roles. Usado desde EquipoPage. Muestra la lista
 * completa de obras del tenant y permite:
 *   - Agregar una obra (elegir rol jefe_obra / colaborador / solo_lectura).
 *   - Cambiar el rol de una obra ya asignada.
 *   - Quitar una obra (rol "sin acceso").
 *
 * Aplica las diffs contra el backend al confirmar (POST/PATCH/DELETE
 * /obras/{id}/user-roles). Reglas de escalación las aplica el backend —
 * si el caller no puede setear `jefe_obra` recibe 403 y lo mostramos.
 *
 * Patrón visual: inspirado en `EditMemberModal` de ObraResponsablesTab
 * (backdrop fijo + card 480px + botones "Cancelar" / "Guardar cambios").
 */
import { useEffect, useMemo, useState } from "react";
import type { ApiUser, ObraUserRoleType } from "../api/users";
import type { Obra } from "../types";
import {
  assignObraUserRole,
  removeObraUserRole,
  updateObraUserRole,
} from "../api/obraUserRoles";
import { useCan } from "../hooks/usePermission";

type RoleOrNone = ObraUserRoleType | "none";

const C = {
  primary: "#FF6B35",
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", bg: "#F4F5F4", surface: "#fff",
  danger: "#D03A3A",
};

const ROLE_LABELS: Record<ObraUserRoleType, string> = {
  jefe_obra: "Jefe de obra",
  colaborador: "Colaborador",
  solo_lectura: "Solo lectura",
};

const ROLE_COLORS: Record<ObraUserRoleType, { bg: string; color: string; border: string }> = {
  jefe_obra:    { bg: "#FFF1E9", color: "#C45215", border: "#F7C9A3" },
  colaborador:  { bg: "#E4F3EC", color: "#1F8A5B", border: "#BFE3CE" },
  solo_lectura: { bg: "#EEF2F6", color: "#5B6770", border: "#D8DDE3" },
};

interface Props {
  member: ApiUser;
  obras: Obra[];
  onClose: () => void;
  onSaved: () => void; // trigger refetch en el padre
}

export function MemberObraRolesModal({ member, obras, onClose, onSaved }: Props) {
  const can = useCan();
  // Estado local: rol por obra (o "none"). Arranca con las asignaciones
  // actuales del miembro (viene en member.obra_roles).
  const initial = useMemo<Record<number, RoleOrNone>>(() => {
    const out: Record<number, RoleOrNone> = {};
    for (const o of obras) out[o.id] = "none";
    for (const r of member.obra_roles) out[r.obra_id] = r.role;
    return out;
  }, [obras, member.obra_roles]);
  const [draft, setDraft] = useState<Record<number, RoleOrNone>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return obras;
    return obras.filter(o => o.name.toLowerCase().includes(q));
  }, [obras, search]);

  const changedCount = useMemo(() => {
    let n = 0;
    for (const o of obras) if (draft[o.id] !== initial[o.id]) n++;
    return n;
  }, [obras, draft, initial]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      // Aplicamos las diffs una por una. El backend ya valida escalación
      // (solo admin puede setear jefe_obra); si rebota, mostramos el
      // detalle y frenamos.
      for (const obra of obras) {
        const before = initial[obra.id];
        const after = draft[obra.id];
        if (before === after) continue;
        if (after === "none") {
          await removeObraUserRole(obra.id, member.id);
        } else if (before === "none") {
          await assignObraUserRole(obra.id, member.id, after);
        } else {
          await updateObraUserRole(obra.id, member.id, after);
        }
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,22,28,0.45)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface, borderRadius: 16, padding: 26, width: 520,
          maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px -12px rgba(0,0,0,0.28)",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>
              Asignaciones de obra
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.text2, wordBreak: "break-all" }}>
              {member.full_name || member.email}
            </p>
          </div>
          {member.role === "admin" && (
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 99,
              background: "#E5EEFB", color: "#2A6FDB", border: "1px solid #B8D0F5",
              flexShrink: 0,
            }}>Admin de empresa</span>
          )}
        </div>

        {member.role === "admin" ? (
          <div style={{
            marginTop: 18, padding: "14px 16px", borderRadius: 10,
            background: "#EEF5FE", border: "1px solid #C9DDF5", color: "#28497A",
            fontSize: 13, lineHeight: 1.5,
          }}>
            El admin de empresa tiene acceso total a todas las obras del tenant.
            No hace falta asignarle roles por obra — pasa por encima de esta tabla.
          </div>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar obra…"
              style={{
                marginTop: 14, padding: "9px 12px", borderRadius: 9,
                border: `1px solid ${C.line}`, background: C.bg, fontSize: 13,
                color: C.text, outline: "none",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            />

            <div style={{ marginTop: 12, overflowY: "auto", flex: 1, minHeight: 0 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: C.text3, fontSize: 13 }}>
                  {obras.length === 0
                    ? "Todavía no hay obras en la empresa."
                    : "Ninguna obra coincide con la búsqueda."}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filtered.map((o) => {
                    const cur = draft[o.id] ?? "none";
                    const changed = cur !== initial[o.id];
                    return (
                      <div key={o.id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", background: changed ? "#FFF7F0" : C.bg,
                        border: `1px solid ${changed ? "#F5CBAB" : "transparent"}`,
                        borderRadius: 10,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>
                            {o.name}
                          </div>
                          {o.location && (
                            <div style={{ fontSize: 11.5, color: C.text3 }}>{o.location}</div>
                          )}
                        </div>
                        <RoleSelect
                          value={cur}
                          canAssignJefeObra={can("miembro.invite") /* admin de empresa */}
                          onChange={(v) => setDraft((prev) => ({ ...prev, [o.id]: v }))}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {error && (
          <p style={{ marginTop: 10, fontSize: 12.5, color: C.danger, fontWeight: 600 }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose} disabled={saving}
            style={{
              padding: "9px 14px", borderRadius: 10, border: `1px solid ${C.line}`,
              background: "#fff", color: C.text2, fontSize: 13, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >Cancelar</button>
          {member.role !== "admin" && (
            <button
              onClick={save} disabled={saving || changedCount === 0}
              style={{
                padding: "9px 16px", borderRadius: 10, border: "none",
                background: changedCount === 0 ? "#F0C6A9" : C.primary, color: "#fff",
                fontSize: 13, fontWeight: 700,
                cursor: saving || changedCount === 0 ? "not-allowed" : "pointer",
                boxShadow: changedCount > 0 ? "0 6px 14px -6px rgba(255,107,53,0.55)" : "none",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              {saving ? "Guardando…" : changedCount === 0 ? "Sin cambios" : `Guardar (${changedCount})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface RoleSelectProps {
  value: RoleOrNone;
  canAssignJefeObra: boolean;
  onChange: (v: RoleOrNone) => void;
}
function RoleSelect({ value, canAssignJefeObra, onChange }: RoleSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RoleOrNone)}
      style={{
        fontSize: 11.5, fontWeight: 700, padding: "5px 10px", paddingRight: 26,
        borderRadius: 99, cursor: "pointer",
        background: value === "none" ? "#F4F5F4" : ROLE_COLORS[value].bg,
        color: value === "none" ? "#8E97A0" : ROLE_COLORS[value].color,
        border: `1px solid ${value === "none" ? "#E6E7E5" : ROLE_COLORS[value].border}`,
        appearance: "none",
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16'><path d='M4 6l4 4 4-4' fill='none' stroke='%23${value === "none" ? "8E97A0" : ROLE_COLORS[value].color.slice(1)}' stroke-width='1.6'/></svg>")`,
        backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <option value="none">Sin acceso</option>
      <option value="solo_lectura">{ROLE_LABELS.solo_lectura}</option>
      <option value="colaborador">{ROLE_LABELS.colaborador}</option>
      {/* jefe_obra solo se puede setear si el caller es admin de empresa
          (el backend rechaza si no). Ocultamos la opción para evitar
          intentos que van a fallar con 403. */}
      {canAssignJefeObra && (
        <option value="jefe_obra">{ROLE_LABELS.jefe_obra}</option>
      )}
    </select>
  );
}
