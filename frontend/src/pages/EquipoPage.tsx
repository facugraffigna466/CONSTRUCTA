import { useEffect, useState } from "react";
import { useUser, ROLE_LABELS, ROLE_COLORS } from "../context/UserContext";
import { usePermission } from "../hooks/usePermission";
import { InviteModal } from "../components/InviteModal";
import { fetchMembers, removeMember } from "../api/users";
import type { ApiUser } from "../api/users";

const C = {
  good: "#1F8A5B",
  secondary: "#FF6B35", secondary50: "#FFF1E9",
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", bg: "#F4F5F4", surface: "#fff",
  danger: "#D03A3A",
};

const AVATAR_COLORS = ["#FF6B35", "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E", "#D03A3A", "#2C6571"];

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

export function EquipoPage() {
  const { user } = useUser();
  const canInvite = usePermission("miembro.invite");
  const canRemove = usePermission("miembro.remove");
  const [showInvite, setShowInvite] = useState(false);
  const [members, setMembers]       = useState<ApiUser[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchMembers()
      .then(setMembers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [showInvite]);

  const active = members.filter(m => m.is_active).length;

  return (
    <>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 28, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.025em" }}>
            Gestión de equipo
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: C.text2 }}>
            <b style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: C.text }}>{active}</b>
            {" "}miembro{active !== 1 ? "s" : ""} activo{active !== 1 ? "s" : ""} · todos acceden a todas las obras de la organización
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
                </div>

                <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 99, padding: "2px 9px", background: rc.bg, color: rc.color, border: `1px solid ${rc.border}`, flexShrink: 0 }}>
                  {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}
                </span>

                {canRemove && m.role !== "admin" && !isMe && (
                  <button
                    onClick={async () => {
                      try {
                        await removeMember(m.id);
                        setMembers(p => p.filter(x => x.id !== m.id));
                      } catch { /* silent */ }
                    }}
                    title="Eliminar miembro"
                    style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.text3, flexShrink: 0, transition: ".12s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FCE5E5"; (e.currentTarget as HTMLElement).style.color = "#D03A3A"; (e.currentTarget as HTMLElement).style.borderColor = "#F5BCBC"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.text3; (e.currentTarget as HTMLElement).style.borderColor = C.line; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </>
  );
}
