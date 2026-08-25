import { useEffect, useMemo, useState } from "react";
import { useUser, ROLE_LABELS, ROLE_COLORS } from "../context/UserContext";
import type { UserRole } from "../context/UserContext";
import { usePermission } from "../hooks/usePermission";
import { useDialog } from "../hooks/useDialog";
import { fetchMembers, inviteMember, removeMember, resendInvite } from "../api/users";
import type { ApiUser, ObraAssignmentInvite, ObraUserRoleType } from "../api/users";
import type { Obra } from "../types";
import { useConfirm } from "./ConfirmProvider";

interface Props {
  onClose: () => void;
  /** Obras del tenant para el selector de asignaciones (Fase 4). Si viene
   *  vacía o ausente, el selector no se muestra — solo se invita con rol
   *  de empresa (comportamiento previo a Fase 4). */
  obras?: Obra[];
}

const OBRA_ROLE_LABELS: Record<ObraUserRoleType, string> = {
  jefe_obra: "Jefe de obra",
  colaborador: "Colaborador",
  solo_lectura: "Solo lectura",
};
const OBRA_ROLE_COLORS: Record<ObraUserRoleType, { bg: string; color: string; border: string }> = {
  jefe_obra:    { bg: "#FFF1E9", color: "#C45215", border: "#F7C9A3" },
  colaborador:  { bg: "#E4F3EC", color: "#1F8A5B", border: "#BFE3CE" },
  solo_lectura: { bg: "#EEF2F6", color: "#5B6770", border: "#D8DDE3" },
};

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin",        label: "Administrador" },
  { value: "collaborator", label: "Colaborador" },
];

const C = {
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", bg: "#F4F5F4", surface: "#fff",
  secondary: "#FF6B35", secondary50: "#FFF1E9",
  good: "#1F8A5B", good50: "#E4F3EC", goodBorder: "#BFE3CE",
  danger: "#D03A3A",
};

const AVATAR_COLORS = ["#FF6B35", "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E", "#D03A3A", "#2C6571"];

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

export function InviteModal({ onClose, obras = [] }: Props) {
  const { user } = useUser();
  const canInvite = usePermission("miembro.invite");
  const canRemove = usePermission("miembro.remove");
  const dialogRef = useDialog(onClose);
  const { alert } = useConfirm();

  const [members, setMembers]     = useState<ApiUser[]>([]);
  const [loadingM, setLoadingM]   = useState(true);
  const [email, setEmail]         = useState("");
  const [role, setRole]           = useState<UserRole>("collaborator");
  const [sending, setSending]     = useState(false);
  const [sent, setSent]           = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [resentId, setResentId]       = useState<number | null>(null);
  // Fase 4: rol por obra (opcional). Vacío = no asigna a esa obra.
  const [obraRoles, setObraRoles] = useState<Record<number, ObraUserRoleType | "">>({});
  const [obrasExpanded, setObrasExpanded] = useState(false);

  const pickedAssignments = useMemo<ObraAssignmentInvite[]>(() => {
    return Object.entries(obraRoles)
      .filter(([, r]) => r !== "")
      .map(([id, r]) => ({ obra_id: Number(id), role: r as ObraUserRoleType }));
  }, [obraRoles]);

  async function loadMembers() {
    try {
      setLoadingM(true);
      setMembers(await fetchMembers());
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const isForbidden = status === 403 && detail !== "Not authenticated";
      if (!isForbidden) {
        setError("No se pudo cargar el equipo. Verificá que el servidor esté corriendo.");
      }
    } finally {
      setLoadingM(false);
    }
  }

  useEffect(() => { loadMembers(); }, []);

  async function handleSend() {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      // Si es admin de empresa, el rol de empresa ya le da acceso a todo —
      // ignoramos las asignaciones por-obra (el backend también). Para
      // collaborator, mandamos las asignaciones seleccionadas.
      const assignments = role === "admin" ? null : pickedAssignments;
      const res = await inviteMember(email.trim(), role, assignments);
      setInviteUrl(res.invite_url);
      setSentEmail(email.trim());
      setSent(true);
      setEmail("");
      setObraRoles({});
      loadMembers();
      setTimeout(() => setSent(false), 6000);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? (detail[0] as { msg?: string })?.msg ?? "Datos inválidos"
          : "No se pudo enviar la invitación";
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  async function handleRemove(memberId: number) {
    try {
      await removeMember(memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      await alert({ title: "No se pudo quitar al miembro", message: msg ?? "Intentá nuevamente." });
    }
  }

  async function handleResend(memberId: number) {
    setResendingId(memberId);
    try {
      await resendInvite(memberId);
      setResentId(memberId);
      setTimeout(() => setResentId(cur => (cur === memberId ? null : cur)), 3000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      await alert({ title: "No se pudo reenviar la invitación", message: msg ?? "Intentá nuevamente." });
    } finally {
      setResendingId(null);
    }
  }

  function handleCopyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(15,20,25,0.45)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Invitar miembros" style={{
        background: C.surface, borderRadius: 16,
        width: "100%", maxWidth: 500,
        maxHeight: "88vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px -12px rgba(0,0,0,0.28)",
        border: `1px solid ${C.line}`,
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 16, color: C.text }}>
              Equipo
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.text3 }}>
              El acceso a cada obra se configura al invitar (o después, desde la lista de equipo).
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.text3 }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", flex: 1 }}>

          {/* Invite form */}
          {canInvite && (
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: C.text3, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>
                Invitar por email
              </div>

              {sent ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: C.good50, border: `1px solid ${C.goodBorder}`, borderRadius: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.good, fontWeight: 600 }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Email enviado a {sentEmail}
                  </div>
                  <div style={{ fontSize: 12, color: "#136E47", lineHeight: 1.4 }}>
                    El invitado recibirá un email con el link para crear su cuenta. El link expira en 72 horas.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(null); }}
                      placeholder="correo@empresa.com"
                      onKeyDown={e => e.key === "Enter" && handleSend()}
                      style={{
                        flex: 1, height: 38, padding: "0 12px",
                        border: `1px solid ${error ? C.danger : C.line}`, borderRadius: 9,
                        fontSize: 13.5, color: C.text, outline: "none",
                        background: C.surface, transition: ".15s",
                      }}
                      onFocus={e => {
                        e.currentTarget.style.borderColor = C.secondary;
                        e.currentTarget.style.boxShadow = "0 0 0 4px rgba(255,107,53,0.10)";
                      }}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = error ? C.danger : C.line;
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    />
                    <select
                      value={role}
                      onChange={e => setRole(e.target.value as UserRole)}
                      style={{
                        width: 136, height: 38, padding: "0 10px",
                        border: `1px solid ${C.line}`, borderRadius: 9,
                        fontSize: 13, color: C.text, background: C.surface,
                        outline: "none", cursor: "pointer",
                        appearance: "none", WebkitAppearance: "none",
                        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none'><path d='M4 6l4 4 4-4' stroke='%238E97A0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
                      }}
                    >
                      {ROLE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleSend}
                      disabled={!email.trim() || sending}
                      style={{
                        height: 38, padding: "0 16px", borderRadius: 9,
                        background: C.secondary, color: "#fff", border: "none",
                        fontWeight: 600, fontSize: 13,
                        cursor: email.trim() && !sending ? "pointer" : "not-allowed",
                        opacity: email.trim() && !sending ? 1 : 0.5,
                        boxShadow: "0 4px 10px -4px rgba(255,107,53,0.45)",
                        transition: ".15s", flexShrink: 0,
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      {sending ? "…" : "Invitar"}
                    </button>
                  </div>
                  {error && (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: C.danger }}>{error}</p>
                  )}

                  {/* Selector de obras (Fase 4). Solo se muestra si el rol de
                      empresa es collaborator (admin ya ve todo) y hay obras
                      cargadas en el prop. Colapsable para no saturar el
                      modal. */}
                  {role === "collaborator" && obras.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => setObrasExpanded((v) => !v)}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          padding: 0, color: C.text2, fontSize: 12.5, fontWeight: 600,
                          display: "inline-flex", alignItems: "center", gap: 6,
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{
                          transform: obrasExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: ".12s",
                        }}>
                          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Asignar a obras
                        {pickedAssignments.length > 0 && (
                          <span style={{
                            fontSize: 10.5, fontWeight: 700, padding: "1px 7px",
                            borderRadius: 99, background: C.secondary50, color: C.secondary,
                            border: `1px solid ${C.secondary}22`,
                          }}>
                            {pickedAssignments.length}
                          </span>
                        )}
                        <span style={{ fontWeight: 500, color: C.text3 }}>
                          (opcional — también se puede asignar después)
                        </span>
                      </button>

                      {obrasExpanded && (
                        <div style={{
                          marginTop: 10, border: `1px solid ${C.line}`, borderRadius: 10,
                          maxHeight: 220, overflowY: "auto", background: C.surface,
                        }}>
                          {obras.map((o, idx) => {
                            const cur = obraRoles[o.id] ?? "";
                            return (
                              <div key={o.id} style={{
                                display: "flex", alignItems: "center", gap: 10,
                                padding: "8px 12px",
                                borderTop: idx > 0 ? `1px solid ${C.line}` : "none",
                              }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {o.name}
                                  </div>
                                  {o.location && (
                                    <div style={{ fontSize: 11, color: C.text3 }}>{o.location}</div>
                                  )}
                                </div>
                                <select
                                  value={cur}
                                  onChange={(e) => setObraRoles((prev) => ({
                                    ...prev, [o.id]: e.target.value as ObraUserRoleType | "",
                                  }))}
                                  style={{
                                    fontSize: 11, fontWeight: 700, padding: "4px 22px 4px 8px",
                                    borderRadius: 99, cursor: "pointer",
                                    background: cur === "" ? "#F4F5F4" : OBRA_ROLE_COLORS[cur].bg,
                                    color: cur === "" ? "#8E97A0" : OBRA_ROLE_COLORS[cur].color,
                                    border: `1px solid ${cur === "" ? "#E6E7E5" : OBRA_ROLE_COLORS[cur].border}`,
                                    appearance: "none",
                                    backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16'><path d='M4 6l4 4 4-4' fill='none' stroke='%23${cur === "" ? "8E97A0" : OBRA_ROLE_COLORS[cur].color.slice(1)}' stroke-width='1.6'/></svg>")`,
                                    backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center",
                                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                                  }}
                                >
                                  <option value="">Sin acceso</option>
                                  <option value="solo_lectura">{OBRA_ROLE_LABELS.solo_lectura}</option>
                                  <option value="colaborador">{OBRA_ROLE_LABELS.colaborador}</option>
                                  <option value="jefe_obra">{OBRA_ROLE_LABELS.jefe_obra}</option>
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Member list */}
          <div style={{ padding: "14px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: C.text3, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
                Miembros actuales
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 99, padding: "1px 7px", background: C.bg, color: C.text3, border: `1px solid ${C.line}` }}>
                {members.length}
              </span>
            </div>

            {loadingM ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: C.text3, fontSize: 13 }}>Cargando…</div>
            ) : error && members.length === 0 ? (
              <div style={{ padding: "12px 0", color: C.danger, fontSize: 13 }}>{error}</div>
            ) : members.length === 0 && !canInvite ? (
              <div style={{ padding: "12px 0", color: C.text3, fontSize: 13 }}>No tenés permiso para ver los miembros.</div>
            ) : (
              members.map((m, i) => {
                const rc = ROLE_COLORS[m.role as keyof typeof ROLE_COLORS] ?? ROLE_COLORS.collaborator;
                const isMe = m.id === user.id;
                const color = AVATAR_COLORS[m.id % AVATAR_COLORS.length];
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.line}` : "none" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 99, background: color, color: "#fff", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Plus Jakarta Sans', sans-serif", flexShrink: 0 }}>
                      {getInitials(m.full_name || m.email)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {m.full_name || m.email}
                        </span>
                        {isMe && (
                          <span style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 99, background: C.bg, color: C.text3, border: `1px solid ${C.line}`, flexShrink: 0 }}>
                            Tú
                          </span>
                        )}
                        {!m.is_active && (
                          <span style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 99, background: "#FDF1DE", color: "#C97D0E", border: "1px solid #F0D5A0", flexShrink: 0 }}>
                            Pendiente
                          </span>
                        )}
                        {!m.is_active && canInvite && (
                          resentId === m.id ? (
                            <span style={{ fontSize: 10, fontWeight: 600, color: C.good, flexShrink: 0 }}>✓ Reenviada</span>
                          ) : (
                            <button
                              onClick={() => handleResend(m.id)}
                              disabled={resendingId === m.id}
                              title="Renueva el link de invitación (72h) y reenvía el email"
                              style={{
                                fontSize: 10, fontWeight: 600, background: "none", border: "none",
                                color: C.secondary, cursor: resendingId === m.id ? "default" : "pointer",
                                padding: 0, flexShrink: 0, opacity: resendingId === m.id ? 0.6 : 1,
                                textDecoration: "underline",
                              }}
                            >
                              {resendingId === m.id ? "Enviando…" : "Reenviar"}
                            </button>
                          )
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 99, padding: "2px 8px", background: rc.bg, color: rc.color, border: `1px solid ${rc.border}`, flexShrink: 0 }}>
                      {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}
                    </span>
                    {canRemove && m.role !== "admin" && !isMe && (
                      <button
                        onClick={() => handleRemove(m.id)}
                        title="Eliminar miembro"
                        style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${C.line}`, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.text3, flexShrink: 0, transition: ".12s" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FCE5E5"; (e.currentTarget as HTMLElement).style.color = C.danger; (e.currentTarget as HTMLElement).style.borderColor = "#F5BCBC"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.text3; (e.currentTarget as HTMLElement).style.borderColor = C.line; }}
                      >
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer: copy invite link (fallback) */}
        {inviteUrl && (
          <div style={{ padding: "12px 22px", borderTop: `1px solid ${C.line}`, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: C.text3, marginBottom: 6, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>
              Link de respaldo
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* No renderizamos el link completo (contiene el token de invitación) —
                  solo el dominio, para no dejarlo expuesto en pantalla/DOM. El botón
                  Copiar sí pone la URL completa en el portapapeles. */}
              <span style={{ fontSize: 11.5, color: C.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, background: C.bg, padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.line}` }}>
                {(() => {
                  try {
                    return `${new URL(inviteUrl).origin}/invite/••••••••••••`;
                  } catch {
                    return "Link de invitación listo para copiar";
                  }
                })()}
              </span>
              <button
                onClick={handleCopyLink}
                style={{
                  flexShrink: 0, height: 30, padding: "0 12px", borderRadius: 7,
                  border: `1px solid ${linkCopied ? C.goodBorder : C.line}`,
                  background: linkCopied ? C.good50 : C.bg,
                  color: linkCopied ? C.good : C.text2,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  transition: ".15s", fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                {linkCopied ? "¡Copiado!" : "Copiar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
