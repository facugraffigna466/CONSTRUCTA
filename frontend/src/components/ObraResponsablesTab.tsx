import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchResponsibles } from "../api/responsibles";
import {
  addObraTeamMember,
  fetchObraTeam,
  removeObraTeamMember,
  updateObraTeamMember,
} from "../api/obraTeam";

const MEMBER_TYPES: { value: "equipo" | "contratista"; label: string; desc: string }[] = [
  { value: "equipo",      label: "Equipo",      desc: "Empleado o colaborador estable" },
  { value: "contratista", label: "Contratista", desc: "Contratado para esta obra" },
];

const ALL_DISCIPLINES = [
  { key: "arquitectura",  label: "Arquitectura"  },
  { key: "estructura",    label: "Estructura"    },
  { key: "electricidad",  label: "Electricidad"  },
  { key: "sanitarios",    label: "Sanitarios"    },
  { key: "gas",           label: "Gas"           },
  { key: "incendio",      label: "Incendio"      },
  { key: "termomecanica", label: "Termomecánica" },
  { key: "pluviales",     label: "Pluviales"     },
  { key: "instalaciones", label: "Instalaciones" },
  { key: "replanteo",     label: "Replanteo"     },
];

function MemberTypeSelector({ value, onChange }: {
  value: "equipo" | "contratista";
  onChange: (v: "equipo" | "contratista") => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", fontFamily: "'Plus Jakarta Sans', sans-serif", flexShrink: 0 }}>
        Tipo
      </span>
      <div style={{ display: "flex", background: "#F4F5F4", borderRadius: 9, padding: 3, gap: 2 }}>
        {MEMBER_TYPES.map(t => {
          const active = value === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange(t.value)}
              style={{
                padding: "5px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 12.5, fontWeight: active ? 600 : 500,
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                background: active ? "#fff" : "transparent",
                color: active ? "#1A2329" : "#6B7580",
                boxShadow: active ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
                transition: "all 0.12s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlanDisciplinesSelector({ value, onChange }: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  const allAccess = value === null;
  return (
    <div>
      <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", display: "block", marginBottom: 8, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Planos que puede pedir por WhatsApp
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={allAccess}
          onChange={e => onChange(e.target.checked ? null : [])}
          style={{ accentColor: "#FF6B35", width: 14, height: 14 }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Todos los planos
        </span>
        <span style={{ fontSize: 11, color: "#6B7580", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>(capataz, jefe de obra)</span>
      </label>
      {!allAccess && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, paddingLeft: 4 }}>
          {ALL_DISCIPLINES.map(d => {
            const checked = (value ?? []).includes(d.key);
            return (
              <label key={d.key} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => {
                    const current = value ?? [];
                    onChange(e.target.checked ? [...current, d.key] : current.filter(x => x !== d.key));
                  }}
                  style={{ accentColor: "#FF6B35", width: 13, height: 13 }}
                />
                <span style={{ fontSize: 12, color: "#3E4A52", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{d.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
import type { ObraTeamMember, Responsible } from "../types";
import { useCan } from "../hooks/usePermission";
import { AlertTriangle, Pencil, Trash2, UserPlus } from "lucide-react";
import { normalizePhone, PHONE_ERROR_HINT } from "../utils/phone";

const AVATAR_COLORS = ["#E76A2D","#3A6BD9","#1F9A5A","#9A4DC9","#D03A3A","#E89B14"];
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

const E164 = /^\+\d{7,15}$/;

const BASE: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13,
  fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#1A2329",
  background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10, outline: "none",
};

// ── Autocomplete input ────────────────────────────────────────────────────────

function AutocompleteInput({ value, onChange, onSelect, suggestions, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (r: Responsible) => void;
  suggestions: Responsible[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = value.trim()
    ? suggestions.filter(r =>
        r.full_name.toLowerCase().includes(value.toLowerCase()) ||
        r.whatsapp_number.includes(value)
      )
    : suggestions;

  function openList() {
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + window.scrollY + 2, left: rect.left + window.scrollX, width: rect.width });
    setOpen(true);
  }

  const list = open && filtered.length > 0 && pos ? createPortal(
    <div onMouseDown={e => e.preventDefault()} style={{
      position: "absolute", top: pos.top, left: pos.left, width: pos.width,
      zIndex: 99999, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10,
      boxShadow: "0 6px 24px -6px rgba(0,0,0,0.18)", maxHeight: 220, overflowY: "auto", padding: 4,
    }}>
      {filtered.map(r => (
        <div key={r.id} onMouseDown={() => { onSelect(r); setOpen(false); }}
          style={{ padding: "8px 12px", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F4"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <div style={{ width: 28, height: 28, borderRadius: 99, background: avatarColor(r.full_name), color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {getInitials(r.full_name)}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{r.full_name}</div>
            <div style={{ fontSize: 11, color: "#6B7580", fontFamily: "'JetBrains Mono', monospace" }}>{r.whatsapp_number}{r.role ? ` · ${r.role}` : ""}</div>
          </div>
        </div>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <input
        ref={inputRef}
        style={BASE}
        placeholder={placeholder}
        value={value}
        onChange={e => { onChange(e.target.value); openList(); }}
        onFocus={openList}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {list}
    </>
  );
}

// ── Edit member modal ─────────────────────────────────────────────────────────

import { updateResponsible } from "../api/responsibles";

function EditMemberModal({ member, obraId, onSaved, onClose }: {
  member: ObraTeamMember; obraId: number; onSaved: (m: ObraTeamMember) => void; onClose: () => void;
}) {
  const [name, setName] = useState(member.full_name);
  const [phone, setPhone] = useState(member.whatsapp_number);
  const [role, setRole] = useState(member.role ?? "");
  const [memberType, setMemberType] = useState<"equipo" | "contratista">(member.member_type ?? "equipo");
  const [planDisc, setPlanDisc] = useState<string[] | null>(member.plan_disciplines ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const E164 = /^\+\d{7,15}$/;

  async function save() {
    if (!name.trim() || name.trim().length < 2) return setError("El nombre es obligatorio (mínimo 2 caracteres).");
    if (!phone.trim() || !E164.test(phone.trim())) return setError("Formato de WhatsApp inválido — usá E.164: +5491112345678");
    setSaving(true); setError(null);
    try {
      await updateResponsible(member.responsible_id, { full_name: name.trim(), whatsapp_number: phone.trim(), role: role.trim() || null });
      const updated = await updateObraTeamMember(obraId, member.responsible_id, { role: role.trim() || null, member_type: memberType, plan_disciplines: planDisc });
      onSaved({ ...updated, full_name: name.trim(), whatsapp_number: phone.trim() });
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? "Ese número de WhatsApp ya está en uso por otro responsable." : "Error al guardar. Intentá de nuevo.");
    } finally { setSaving(false); }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.45)", backdropFilter: "blur(3px)" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 440, boxShadow: "0 24px 60px -16px rgba(0,0,0,0.3)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1A2329" }}>Editar responsable</h3>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#F4F5F4", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7580" }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <MemberTypeSelector value={memberType} onChange={setMemberType} />
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", display: "block", marginBottom: 6 }}>Nombre</label>
            <input style={BASE} autoFocus placeholder="Juan Pérez" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", display: "block", marginBottom: 6 }}>WhatsApp</label>
            <input style={BASE} placeholder="+5491112345678" value={phone} onChange={e => setPhone(e.target.value)} />
            {phone !== member.whatsapp_number && (
              <p style={{ margin: "5px 0 0", fontSize: 11.5, color: "#C97D0E", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                ⚠ Si este responsable usa el chatbot, cambiarlo hará que deje de ser reconocido por su número anterior.
              </p>
            )}
          </div>
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", display: "block", marginBottom: 6 }}>Rol en esta obra <span style={{ fontWeight: 400 }}>(opcional)</span></label>
            <input style={BASE} placeholder="Capataz, Electricista, Director..." value={role} onChange={e => setRole(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
          </div>
          <div style={{ paddingTop: 4, borderTop: "1px solid #F0F1EF" }}>
            <PlanDisciplinesSelector value={planDisc} onChange={setPlanDisc} />
          </div>
        </div>
        {error && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#D03A3A" }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button onClick={onClose} style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, borderRadius: 10, background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", color: "#5B6770" }}>Cancelar</button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600, borderRadius: 10, background: "#FF6B35", border: "none", color: "#fff", cursor: "pointer", opacity: saving ? 0.7 : 1, boxShadow: "0 4px 12px -4px rgba(255,107,53,0.5)" }}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Remove confirm ────────────────────────────────────────────────────────────

function RemoveConfirm({ member, onConfirm, onClose }: {
  member: ObraTeamMember; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  async function confirm() { setRemoving(true); await onConfirm(); setRemoving(false); }
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.45)", backdropFilter: "blur(3px)" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 400, boxShadow: "0 24px 60px -16px rgba(0,0,0,0.3)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "#1A2329" }}>¿Quitar del equipo?</h3>
        <p style={{ margin: "0 0 6px", fontSize: 13, color: "#5B6770", lineHeight: 1.5 }}>
          <strong style={{ color: "#1A2329" }}>{member.full_name}</strong> dejará de aparecer en esta obra. No se elimina del directorio global — podés volver a agregarlo cuando quieras.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, borderRadius: 10, background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", color: "#5B6770" }}>Cancelar</button>
          <button onClick={confirm} disabled={removing} style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600, borderRadius: 10, background: "#D03A3A", border: "none", color: "#fff", cursor: "pointer", opacity: removing ? 0.7 : 1 }}>
            {removing ? "Quitando..." : "Sí, quitar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MemberCard ────────────────────────────────────────────────────────────────

function MemberCard({ m, isAdmin, onEdit, onRemove }: {
  m: ObraTeamMember;
  isAdmin: boolean;
  onEdit: (m: ObraTeamMember) => void;
  onRemove: (m: ObraTeamMember) => void;
}) {
  const color = avatarColor(m.full_name);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #ECEEED", borderRadius: 11, padding: "10px 12px", opacity: m.is_active ? 1 : 0.5 }}>
      <div style={{ width: 34, height: 34, borderRadius: 99, background: color, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {getInitials(m.full_name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{m.full_name}</span>
          {m.role && <span style={{ fontSize: 10.5, color: "#5B6770", background: "#F0F1EF", border: "1px solid #E6E7E5", borderRadius: 99, padding: "1px 7px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{m.role}</span>}
          {m.plan_disciplines === null
            ? <span style={{ fontSize: 10.5, color: "#1F8A5B", background: "#E8F7EF", border: "1px solid #B3E0CA", borderRadius: 99, padding: "1px 7px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Todos los planos</span>
            : m.plan_disciplines.length === 0
              ? <span style={{ fontSize: 10.5, color: "#9B4D00", background: "#FFF0E5", border: "1px solid #FFD0A8", borderRadius: 99, padding: "1px 7px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Sin acceso a planos</span>
              : <span title={m.plan_disciplines.join(", ")} style={{ fontSize: 10.5, color: "#2A6FDB", background: "#EBF3FE", border: "1px solid #BDD6F7", borderRadius: 99, padding: "1px 7px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{m.plan_disciplines.length} disciplina{m.plan_disciplines.length !== 1 ? "s" : ""}</span>
          }
          {!m.is_active && <span style={{ fontSize: 10.5, color: "#D03A3A", background: "#FCE5E5", border: "1px solid #F0B0B0", borderRadius: 99, padding: "1px 7px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Inactivo</span>}
        </div>
        <span style={{ fontSize: 11, color: "#8E97A0", fontFamily: "'JetBrains Mono', monospace" }}>{m.whatsapp_number}</span>
      </div>
      {isAdmin && (
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <button onClick={() => onEdit(m)} title="Editar"
            style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#8E97A0" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#EAF1FB"; e.currentTarget.style.color = "#2A6FDB"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}>
            <Pencil style={{ width: 12, height: 12 }} />
          </button>
          <button onClick={() => onRemove(m)} title="Quitar"
            style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#8E97A0" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#FCE5E5"; e.currentTarget.style.color = "#D03A3A"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}>
            <Trash2 style={{ width: 12, height: 12 }} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

function Column({ type, list, total, search, onSearch, isAdmin, isAddingHere, onOpenForm, onCloseForm, nameInput, onNameChange, phoneInput, onPhoneChange, roleInput, onRoleChange, selectedExisting, onSelectExisting, available, formError, onAdd, saving, onEditMember, onRemoveMember }: {
  type: "equipo" | "contratista";
  list: ObraTeamMember[];
  total: number;
  search: string;
  onSearch: (v: string) => void;
  isAdmin: boolean;
  isAddingHere: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  nameInput: string;
  onNameChange: (v: string) => void;
  phoneInput: string;
  onPhoneChange: (v: string) => void;
  roleInput: string;
  onRoleChange: (v: string) => void;
  selectedExisting: Responsible | null;
  onSelectExisting: (r: Responsible) => void;
  available: Responsible[];
  formError: string | null;
  onAdd: () => void;
  saving: boolean;
  onEditMember: (m: ObraTeamMember) => void;
  onRemoveMember: (m: ObraTeamMember) => void;
}) {
  const isEquipo = type === "equipo";
  const label = isEquipo ? "Equipo" : "Contratistas";
  const placeholder = isEquipo ? "Buscar por nombre o teléfono..." : "Buscar contratista...";

  return (
    <div style={{ display: "flex", flexDirection: "column", background: "#F9FAF8", border: "1px solid #ECEEED", borderRadius: 14, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: "1px solid #ECEEED", background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{label}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#6B7580", background: "#F0F1EF", border: "1px solid #E6E7E5", borderRadius: 99, padding: "1px 8px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{total}</span>
        </div>
        {isAdmin && !isAddingHere && (
          <button onClick={onOpenForm}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, background: "#FF6B35", border: "none", color: "#fff", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: "0 3px 8px -3px rgba(255,107,53,0.4)" }}>
            <UserPlus style={{ width: 11, height: 11 }} /> Agregar
          </button>
        )}
        {isAdmin && isAddingHere && (
          <button onClick={onCloseForm} style={{ fontSize: 12, color: "#6B7580", background: "none", border: "none", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Cancelar</button>
        )}
      </div>

      {/* Inline add form */}
      {isAddingHere && (
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #ECEEED", background: "#FAFBF9" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", display: "block", marginBottom: 4, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Nombre</label>
              <AutocompleteInput value={nameInput} onChange={v => { onNameChange(v); }} onSelect={onSelectExisting} suggestions={available} placeholder="Juan Pérez" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", display: "block", marginBottom: 4, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>WhatsApp</label>
                <AutocompleteInput value={phoneInput} onChange={v => { onPhoneChange(v); }} onSelect={onSelectExisting} suggestions={available} placeholder="+5491112345678" />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580", display: "block", marginBottom: 4, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Rol <span style={{ fontWeight: 400 }}>(opcional)</span></label>
                <input style={{ ...BASE, fontSize: 12 }} placeholder={isEquipo ? "Capataz..." : "Electricista..."} value={roleInput} onChange={e => onRoleChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter") onAdd(); }} />
              </div>
            </div>
            {selectedExisting && (
              <div style={{ fontSize: 11.5, color: "#2A6FDB", background: "#EBF3FE", borderRadius: 7, padding: "5px 10px", border: "1px solid #BDD6F7", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Del directorio — {selectedExisting.full_name}
              </div>
            )}
            {formError && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#D03A3A", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                <AlertTriangle style={{ width: 11, height: 11 }} />{formError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onAdd} disabled={saving}
                style={{ padding: "7px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, background: "#FF6B35", border: "none", color: "#fff", cursor: "pointer", opacity: saving ? 0.7 : 1, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {saving ? "Agregando..." : `Agregar a ${label}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #ECEEED" }}>
        <div style={{ position: "relative" }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#A0A8B0" }}>
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8.5 8.5L11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            style={{ ...BASE, paddingLeft: 30, fontSize: 12.5, background: "#fff" }}
            placeholder={placeholder}
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => onSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#A0A8B0", padding: 2, display: "flex" }}>
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, minHeight: 80 }}>
        {list.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <p style={{ margin: 0, fontSize: 12.5, color: "#A0A8B0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {search ? "Sin resultados para esa búsqueda." : isEquipo ? "Sin miembros del equipo todavía." : "Sin contratistas asignados."}
            </p>
          </div>
        ) : (
          list.map(m => <MemberCard key={m.responsible_id} m={m} isAdmin={isAdmin} onEdit={onEditMember} onRemove={onRemoveMember} />)
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { obraId: number; onTeamChanged?: () => void; }

export function ObraResponsablesTab({ obraId, onTeamChanged }: Props) {
  // Fase 4: gestionar equipo de responsables de la obra es acción de
  // jefe_obra+ (matriz fase-1 §2.1). `tarea.delete` con obraId responde true
  // solo para JO en esta obra o admin de empresa — mismo criterio.
  const can = useCan();
  const isAdmin = can("tarea.delete", obraId);

  const [team, setTeam] = useState<ObraTeamMember[]>([]);
  const [allResponsibles, setAllResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);

  // form compartido — addingTo dice a qué columna
  const [addingTo, setAddingTo] = useState<"equipo" | "contratista" | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [roleInput, setRoleInput] = useState("");
  const [selectedExisting, setSelectedExisting] = useState<Responsible | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [searchEquipo, setSearchEquipo] = useState("");
  const [searchContratista, setSearchContratista] = useState("");

  const [editingMember, setEditingMember] = useState<ObraTeamMember | null>(null);
  const [removingMember, setRemovingMember] = useState<ObraTeamMember | null>(null);

  useEffect(() => {
    Promise.all([fetchObraTeam(obraId), fetchResponsibles()]).then(([t, all]) => {
      setTeam(t); setAllResponsibles(all); setLoading(false);
    });
  }, [obraId]);

  const available = allResponsibles.filter(r => r.is_active && !team.some(m => m.responsible_id === r.id));

  function openForm(type: "equipo" | "contratista") {
    setAddingTo(type); setNameInput(""); setPhoneInput(""); setRoleInput(""); setSelectedExisting(null); setFormError(null);
  }
  function closeForm() { setAddingTo(null); setFormError(null); }

  function handleSelectExisting(r: Responsible) {
    setSelectedExisting(r); setNameInput(r.full_name); setPhoneInput(r.whatsapp_number); setRoleInput(r.role ?? ""); setFormError(null);
  }

  async function handleAdd() {
    if (!addingTo) return;
    if (!nameInput.trim() || nameInput.trim().length < 2) return setFormError("El nombre es obligatorio.");
    if (!selectedExisting && !phoneInput.trim()) return setFormError("El número de WhatsApp es obligatorio.");
    const phone = normalizePhone(phoneInput);
    if (!selectedExisting && !E164.test(phone)) return setFormError(PHONE_ERROR_HINT);
    setSaving(true); setFormError(null);
    try {
      const payload = selectedExisting
        ? { responsible_id: selectedExisting.id, role: roleInput.trim() || null, member_type: addingTo }
        : { full_name: nameInput.trim(), whatsapp_number: phone, role: roleInput.trim() || null, member_type: addingTo };
      const added = await addObraTeamMember(obraId, payload);
      setTeam(prev => [...prev, added]);
      closeForm();
      onTeamChanged?.();
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setFormError(status === 409 ? "Esta persona ya está en el equipo de la obra." : "Error al agregar. Intentá de nuevo.");
    } finally { setSaving(false); }
  }

  async function handleRemove(m: ObraTeamMember) {
    await removeObraTeamMember(obraId, m.responsible_id);
    setTeam(prev => prev.filter(x => x.responsible_id !== m.responsible_id));
    setRemovingMember(null);
    onTeamChanged?.();
  }

  function matchSearch(m: ObraTeamMember, q: string) {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return m.full_name.toLowerCase().includes(s) || m.whatsapp_number.includes(s) || (m.role ?? "").toLowerCase().includes(s);
  }

  const equipoList = team.filter(m => (m.member_type ?? "equipo") === "equipo").filter(m => matchSearch(m, searchEquipo));
  const contratistaList = team.filter(m => m.member_type === "contratista").filter(m => matchSearch(m, searchContratista));
  const equipoTotal = team.filter(m => (m.member_type ?? "equipo") === "equipo").length;
  const contratistaTotal = team.filter(m => m.member_type === "contratista").length;

  if (loading) return <p style={{ padding: 24, fontSize: 13, color: "#6B7580", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Cargando...</p>;

  return (
    <div style={{ padding: "0 0 24px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Column
          type="equipo" list={equipoList} total={equipoTotal} search={searchEquipo} onSearch={setSearchEquipo}
          isAdmin={isAdmin} isAddingHere={addingTo === "equipo"}
          onOpenForm={() => openForm("equipo")} onCloseForm={closeForm}
          nameInput={nameInput} onNameChange={v => { setNameInput(v); setSelectedExisting(null); }}
          phoneInput={phoneInput} onPhoneChange={v => { setPhoneInput(v); setSelectedExisting(null); }}
          roleInput={roleInput} onRoleChange={setRoleInput}
          selectedExisting={selectedExisting} onSelectExisting={handleSelectExisting}
          available={available} formError={formError} onAdd={handleAdd} saving={saving}
          onEditMember={setEditingMember} onRemoveMember={setRemovingMember}
        />
        <Column
          type="contratista" list={contratistaList} total={contratistaTotal} search={searchContratista} onSearch={setSearchContratista}
          isAdmin={isAdmin} isAddingHere={addingTo === "contratista"}
          onOpenForm={() => openForm("contratista")} onCloseForm={closeForm}
          nameInput={nameInput} onNameChange={v => { setNameInput(v); setSelectedExisting(null); }}
          phoneInput={phoneInput} onPhoneChange={v => { setPhoneInput(v); setSelectedExisting(null); }}
          roleInput={roleInput} onRoleChange={setRoleInput}
          selectedExisting={selectedExisting} onSelectExisting={handleSelectExisting}
          available={available} formError={formError} onAdd={handleAdd} saving={saving}
          onEditMember={setEditingMember} onRemoveMember={setRemovingMember}
        />
      </div>

      {editingMember && (
        <EditMemberModal
          member={editingMember}
          obraId={obraId}
          onSaved={updated => { setTeam(prev => prev.map(m => m.responsible_id === updated.responsible_id ? updated : m)); setEditingMember(null); onTeamChanged?.(); }}
          onClose={() => setEditingMember(null)}
        />
      )}
      {removingMember && (
        <RemoveConfirm
          member={removingMember}
          onConfirm={() => handleRemove(removingMember)}
          onClose={() => setRemovingMember(null)}
        />
      )}
    </div>
  );
}
