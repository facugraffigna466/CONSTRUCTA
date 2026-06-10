import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchResponsibles } from "../api/responsibles";
import {
  addObraTeamMember,
  fetchObraTeam,
  removeObraTeamMember,
  updateObraTeamMemberRole,
} from "../api/obraTeam";
import type { ObraTeamMember, Responsible } from "../types";
import { useCan } from "../hooks/usePermission";
import { AlertTriangle, Pencil, Trash2, UserPlus } from "lucide-react";

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
            <div style={{ fontSize: 11, color: "#8E97A0", fontFamily: "'JetBrains Mono', monospace" }}>{r.whatsapp_number}{r.role ? ` · ${r.role}` : ""}</div>
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
  const [role, setRole] = useState(member.role ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || name.trim().length < 2) return setError("El nombre es obligatorio (mínimo 2 caracteres).");
    setSaving(true); setError(null);
    try {
      // Update name in global directory
      await updateResponsible(member.responsible_id, { full_name: name.trim(), role: role.trim() || null });
      // Update role in this obra
      const updated = await updateObraTeamMemberRole(obraId, member.responsible_id, role.trim() || null);
      onSaved({ ...updated, full_name: name.trim() });
    } catch { setError("Error al guardar. Intentá de nuevo."); }
    finally { setSaving(false); }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.45)", backdropFilter: "blur(3px)" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 440, boxShadow: "0 24px 60px -16px rgba(0,0,0,0.3)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1A2329" }}>Editar responsable</h3>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#F4F5F4", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#8E97A0" }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8E97A0", display: "block", marginBottom: 6 }}>Nombre</label>
            <input style={BASE} autoFocus placeholder="Juan Pérez" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8E97A0", display: "block", marginBottom: 6 }}>WhatsApp <span style={{ fontWeight: 400, textTransform: "none" }}>(no editable — clave del chatbot)</span></label>
            <input style={{ ...BASE, background: "#F9FAF8", color: "#8E97A0" }} value={member.whatsapp_number} readOnly />
          </div>
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8E97A0", display: "block", marginBottom: 6 }}>Rol en esta obra <span style={{ fontWeight: 400 }}>(opcional)</span></label>
            <input style={BASE} placeholder="Capataz, Electricista, Director..." value={role} onChange={e => setRole(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
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

// ── Main component ────────────────────────────────────────────────────────────

interface Props { obraId: number; }

export function ObraResponsablesTab({ obraId }: Props) {
  const can = useCan();
  const isAdmin = can("configuracion.edit");

  const [team, setTeam] = useState<ObraTeamMember[]>([]);
  const [allResponsibles, setAllResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(true);

  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [roleInput, setRoleInput] = useState("");
  const [selectedExisting, setSelectedExisting] = useState<Responsible | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingMember, setEditingMember] = useState<ObraTeamMember | null>(null);
  const [removingMember, setRemovingMember] = useState<ObraTeamMember | null>(null);

  useEffect(() => {
    Promise.all([fetchObraTeam(obraId), fetchResponsibles()]).then(([t, all]) => {
      setTeam(t);
      setAllResponsibles(all);
      setLoading(false);
    });
  }, [obraId]);

  // Responsibles del directorio que aún no están en el equipo de esta obra
  const available = allResponsibles.filter(r => r.is_active && !team.some(m => m.responsible_id === r.id));

  function handleSelectExisting(r: Responsible) {
    setSelectedExisting(r);
    setNameInput(r.full_name);
    setPhoneInput(r.whatsapp_number);
    setRoleInput(r.role ?? "");
    setFormError(null);
  }

  function clearForm() {
    setNameInput(""); setPhoneInput(""); setRoleInput(""); setSelectedExisting(null); setFormError(null);
  }

  async function handleAdd() {
    if (!nameInput.trim() || nameInput.trim().length < 2) return setFormError("El nombre es obligatorio.");
    if (!selectedExisting && !phoneInput.trim()) return setFormError("El número de WhatsApp es obligatorio.");
    if (!selectedExisting && !E164.test(phoneInput.trim())) return setFormError("Formato inválido — usá E.164: +5491112345678");

    setSaving(true); setFormError(null);
    try {
      const payload = selectedExisting
        ? { responsible_id: selectedExisting.id, role: roleInput.trim() || null }
        : { full_name: nameInput.trim(), whatsapp_number: phoneInput.trim(), role: roleInput.trim() || null };

      const added = await addObraTeamMember(obraId, payload);
      setTeam(prev => [...prev, added]);
      clearForm();
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) setFormError("Esta persona ya está en el equipo de la obra.");
      else setFormError("Error al agregar. Intentá de nuevo.");
    } finally { setSaving(false); }
  }

  async function handleRemove(m: ObraTeamMember) {
    await removeObraTeamMember(obraId, m.responsible_id);
    setTeam(prev => prev.filter(x => x.responsible_id !== m.responsible_id));
    setRemovingMember(null);
  }

  if (loading) return <p style={{ padding: 24, fontSize: 13, color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Cargando...</p>;

  return (
    <div style={{ padding: "0 0 24px" }}>

      {/* ── Formulario agregar (solo admin) ── */}
      {isAdmin && (
        <div style={{ background: "#F9FAF8", border: "1px solid #E6E7E5", borderRadius: 14, padding: 18, marginBottom: 20 }}>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Escribí el nombre o teléfono — si ya existe en el directorio te lo sugerimos automáticamente:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8E97A0", display: "block", marginBottom: 5, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Nombre</label>
              <AutocompleteInput value={nameInput} onChange={v => { setNameInput(v); setSelectedExisting(null); }} onSelect={handleSelectExisting} suggestions={available} placeholder="Juan Pérez" />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8E97A0", display: "block", marginBottom: 5, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>WhatsApp</label>
              <AutocompleteInput value={phoneInput} onChange={v => { setPhoneInput(v); setSelectedExisting(null); }} onSelect={handleSelectExisting} suggestions={available} placeholder="+5491112345678" />
            </div>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8E97A0", display: "block", marginBottom: 5, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Rol en esta obra <span style={{ fontWeight: 400 }}>(opcional)</span></label>
              <input style={BASE} placeholder="Capataz, Electricista..." value={roleInput} onChange={e => setRoleInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAdd(); }} />
            </div>
          </div>

          {selectedExisting && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "7px 12px", background: "#EBF3FE", borderRadius: 8, border: "1px solid #BDD6F7" }}>
              <span style={{ fontSize: 12, color: "#2A6FDB", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>✓ Usando responsable existente del directorio</span>
              <button onClick={clearForm} style={{ marginLeft: "auto", fontSize: 11, color: "#2A6FDB", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Limpiar</button>
            </div>
          )}

          {formError && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 12, color: "#D03A3A", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <AlertTriangle style={{ width: 12, height: 12 }} />{formError}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {(nameInput || phoneInput) && (
              <button onClick={clearForm} style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Limpiar</button>
            )}
            <button onClick={handleAdd} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, background: "#FF6B35", border: "none", color: "#fff", cursor: "pointer", opacity: saving ? 0.7 : 1, fontFamily: "'Plus Jakarta Sans', sans-serif", boxShadow: "0 4px 10px -4px rgba(255,107,53,0.45)" }}>
              <UserPlus style={{ width: 13, height: 13 }} />
              {saving ? "Agregando..." : "Agregar al equipo"}
            </button>
          </div>
        </div>
      )}

      {/* ── Lista del equipo ── */}
      {team.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Sin responsables en esta obra todavía.{isAdmin && " Agregá el primer miembro del equipo."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8E97A0", marginBottom: 4, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {team.length} persona{team.length !== 1 ? "s" : ""} en esta obra
          </span>
          {team.map(m => {
            const color = avatarColor(m.full_name);
            return (
              <div key={m.responsible_id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, padding: "10px 14px", opacity: m.is_active ? 1 : 0.5 }}>
                <div style={{ width: 36, height: 36, borderRadius: 99, background: color, color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {getInitials(m.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{m.full_name}</span>
                    {m.role && (
                      <span style={{ fontSize: 11, color: "#5B6770", background: "#F0F1EF", border: "1px solid #E6E7E5", borderRadius: 99, padding: "2px 8px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{m.role}</span>
                    )}
                    {!m.is_active && (
                      <span style={{ fontSize: 11, color: "#D03A3A", background: "#FCE5E5", border: "1px solid #F0B0B0", borderRadius: 99, padding: "2px 8px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Inactivo</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11.5, color: "#8E97A0", fontFamily: "'JetBrains Mono', monospace" }}>{m.whatsapp_number}</span>
                </div>
                {isAdmin && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setEditingMember(m)} title="Editar"
                      style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#8E97A0" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#EAF1FB"; e.currentTarget.style.color = "#2A6FDB"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}>
                      <Pencil style={{ width: 13, height: 13 }} />
                    </button>
                    <button onClick={() => setRemovingMember(m)} title="Quitar de la obra"
                      style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#8E97A0" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#FCE5E5"; e.currentTarget.style.color = "#D03A3A"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}>
                      <Trash2 style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editingMember && (
        <EditMemberModal
          member={editingMember}
          obraId={obraId}
          onSaved={updated => { setTeam(prev => prev.map(m => m.responsible_id === updated.responsible_id ? updated : m)); setEditingMember(null); }}
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
