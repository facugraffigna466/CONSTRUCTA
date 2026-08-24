import { useEffect, useMemo, useState } from "react";
import { useUser, ROLE_LABELS, ROLE_COLORS } from "../context/UserContext";
import { usePermission } from "../hooks/usePermission";
import { InviteModal } from "../components/InviteModal";
import { MemberObraRolesModal } from "../components/MemberObraRolesModal";
import { fetchMembers, removeMember, updateMemberRole } from "../api/users";
import type { ApiUser, ObraUserRoleType } from "../api/users";
import { fetchObras } from "../api/obras";
import type { Obra } from "../types";

const C = {
  good: "#1F8A5B",
  secondary: "#FF6B35", secondary50: "#FFF1E9",
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", bg: "#F4F5F4", surface: "#fff",
  danger: "#D03A3A",
};

const AVATAR_COLORS = ["#FF6B35", "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E", "#D03A3A", "#2C6571"];

const OBRA_ROLE_LABELS: Record<ObraUserRoleType, string> = {
  jefe_obra: "Jefe",
  colaborador: "Colab.",
  solo_lectura: "Lectura",
};

const OBRA_ROLE_COLORS: Record<ObraUserRoleType, { bg: string; color: string; border: string }> = {
  jefe_obra:    { bg: "#FFF1E9", color: "#C45215", border: "#F7C9A3" },
  colaborador:  { bg: "#E4F3EC", color: "#1F8A5B", border: "#BFE3CE" },
  solo_lectura: { bg: "#EEF2F6", color: "#5B6770", border: "#D8DDE3" },
};

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

export function EquipoPage() {
  const { user } = useUser();
  const canInvite = usePermission("miembro.invite");
  const canRemove = usePermission("miembro.remove");
  const [showInvite, setShowInvite] = useState(false);
  const [members, setMembers]       = useState<ApiUser[]>([]);
  const [obras, setObras]           = useState<Obra[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [editingRolesFor, setEditingRolesFor] = useState<ApiUser | null>(null);

  function apiError(e: unknown, fallback: string): string {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === "string" ? detail : fallback;
  }

  async function reload() {
    setLoading(true);
    try {
      const [m, o] = await Promise.all([fetchMembers(), fetchObras()]);
      setMembers(m); setObras(o);
    } catch {
      // silencioso: se muestra el estado vacío
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [showInvite]);

  const active = members.filter(m => m.is_active).length;

  return (
    <>
      {/* Page header — el copy viejo ("todos acceden a todas las obras") era
          mentira post Fase 2/3: ahora cada miembro tiene asignaciones por-obra
          explícitas, salvo el admin de empresa que sigue siendo superset. */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 28, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.025em" }}>
            Gestión de equipo
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: C.text2 }}>
            <b style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: C.text }}>{active}</b>
            {" "}miembro{active !== 1 ? "s" : ""} activo{active !== 1 ? "s" : ""} · el acceso a cada obra se configura por miembro
          </p>
        </div>
        {canInvite && (
          <button
            onClick={() => setShowInvite(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 16px", borderRadius: 10,
              background: C.secondary, color: "#fff", border: "none",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.55)",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M1.5 13c0-2.485 2.015-4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M11 9v4M9 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Invitar miembro
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          background: "#FCE5E5", border: "1px solid #F0B0B0", borderRadius: 10,
          padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#A82B2B", fontWeight: 500,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A82B2B", fontSize: 16, lineHeight: 1, padding: 0 }} title="Cerrar">×</button>
        </div>
      )}

      {/* Members table */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: C.text3, fontSize: 13 }}>
            Cargando miembros…
          </div>
        ) : members.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: C.text3, fontSize: 13 }}>
            Sin miembros aún. Invitá a alguien para comenzar.
          </div>
        ) : (
          members.map((m, i) => {
            const rc = ROLE_COLORS[m.role as keyof typeof ROLE_COLORS] ?? ROLE_COLORS.collaborator;
            const isMe = m.id === user.id;
            const color = AVATAR_COLORS[m.id % AVATAR_COLORS.length];
            return (
              <div
                key={m.id}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 22px",
                  borderTop: i > 0 ? `1px solid ${C.line}` : "none",
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 99,
                  background: color, color: "#fff",
                  fontWeight: 700, fontSize: 13,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'Plus Jakarta Sans', sans-serif", flexShrink: 0,
                }}>
                  {getInitials(m.full_name || m.email)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.full_name || m.email}
                    </span>
                    {isMe && (
                      <span style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 99, background: C.bg, color: C.text3, border: `1px solid ${C.line}`, flexShrink: 0 }}>Tú</span>
                    )}
                    {!m.is_active && (
                      <span style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 99, background: "#FDF1DE", color: "#C97D0E", border: "1px solid #F0D5A0", flexShrink: 0 }}>Pendiente</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: C.text3 }}>{m.email}</div>
                  <ObraRolesLine member={m} onEdit={canRemove ? () => setEditingRolesFor(m) : undefined} />
                </div>

                {canRemove && !isMe ? (
                  <select
                    value={m.role}
                    onChange={async (e) => {
                      const newRole = e.target.value as "admin" | "collaborator";
                      const prevRole = m.role;
                      setError(null);
                      // optimista
                      setMembers(p => p.map(x => x.id === m.id ? { ...x, role: newRole } : x));
                      try {
                        const updated = await updateMemberRole(m.id, newRole);
                        setMembers(p => p.map(x => x.id === m.id ? { ...x, role: updated.role } : x));
                      } catch (err) {
                        // revertir + avisar
                        setMembers(p => p.map(x => x.id === m.id ? { ...x, role: prevRole } : x));
                        setError(apiError(err, "No se pudo cambiar el rol del miembro."));
                      }
                    }}
                    style={{
                      fontSize: 11, fontWeight: 600, borderRadius: 99, padding: "2px 9px",
                      background: rc.bg, color: rc.color, border: `1px solid ${rc.border}`,
                      flexShrink: 0, cursor: "pointer", appearance: "none", paddingRight: 16,
                    }}
                  >
                    <option value="admin">{ROLE_LABELS.admin}</option>
                    <option value="collaborator">{ROLE_LABELS.collaborator}</option>
                  </select>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 99, padding: "2px 9px", background: rc.bg, color: rc.color, border: `1px solid ${rc.border}`, flexShrink: 0 }}>
                    {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}
                  </span>
                )}

                {canRemove && m.role !== "admin" && !isMe && (
                  confirmRemoveId === m.id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 11.5, color: C.text2 }}>¿Quitar?</span>
                      <button
                        onClick={async () => {
                          setError(null);
                          try {
                            await removeMember(m.id);
                            setMembers(p => p.filter(x => x.id !== m.id));
                          } catch (err) {
                            setError(apiError(err, "No se pudo quitar al miembro."));
                          } finally {
                            setConfirmRemoveId(null);
                          }
                        }}
                        style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 7, border: "none", background: "#D03A3A", color: "#fff", cursor: "pointer" }}
                      >Sí</button>
                      <button
                        onClick={() => setConfirmRemoveId(null)}
                        style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 7, border: `1px solid ${C.line}`, background: "#fff", color: C.text2, cursor: "pointer" }}
                      >No</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setError(null); setConfirmRemoveId(m.id); }}
                      title="Quitar miembro"
                      style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.text3, flexShrink: 0, transition: ".12s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FCE5E5"; (e.currentTarget as HTMLElement).style.color = "#D03A3A"; (e.currentTarget as HTMLElement).style.borderColor = "#F5BCBC"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.text3; (e.currentTarget as HTMLElement).style.borderColor = C.line; }}
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      </svg>
                    </button>
                  )
                )}
              </div>
            );
          })
        )}
      </div>

      {showInvite && (
        <InviteModal
          obras={obras}
          onClose={() => setShowInvite(false)}
        />
      )}
      {editingRolesFor && (
        <MemberObraRolesModal
          member={editingRolesFor}
          obras={obras}
          onClose={() => setEditingRolesFor(null)}
          onSaved={() => reload()}
        />
      )}
    </>
  );
}

// ── Sub-componente: chips de obras asignadas + botón lápiz ───────────────────
function ObraRolesLine({ member, onEdit }: { member: ApiUser; onEdit?: () => void }) {
  const isAdmin = member.role === "admin";
  const roles = member.obra_roles;
  const wrap = useMemo(() => roles.slice(0, 4), [roles]);
  const overflow = roles.length - wrap.length;

  return (
    <div style={{
      marginTop: 6, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
    }}>
      {isAdmin ? (
        <span style={{ fontSize: 11.5, color: C.text3, fontStyle: "italic" }}>
          Acceso total a todas las obras
        </span>
      ) : roles.length === 0 ? (
        <span style={{ fontSize: 11.5, color: C.text3 }}>
          Sin obras asignadas
        </span>
      ) : (
        <>
          {wrap.map((r) => {
            const c = OBRA_ROLE_COLORS[r.role];
            return (
              <span key={r.obra_id} style={{
                fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                background: c.bg, color: c.color, border: `1px solid ${c.border}`,
                maxWidth: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
              title={`${r.obra_name} · ${OBRA_ROLE_LABELS[r.role]}`}
              >
                {r.obra_name} · {OBRA_ROLE_LABELS[r.role]}
              </span>
            );
          })}
          {overflow > 0 && (
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: C.bg, color: C.text3, border: `1px solid ${C.line}` }}>
              +{overflow} más
            </span>
          )}
        </>
      )}
      {onEdit && !isAdmin && (
        <button
          onClick={onEdit}
          title="Editar asignaciones de obra"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: C.secondary, fontSize: 11.5, fontWeight: 600, padding: "0 4px",
          }}
        >
          {roles.length === 0 ? "Asignar…" : "Editar"}
        </button>
      )}
    </div>
  );
}
