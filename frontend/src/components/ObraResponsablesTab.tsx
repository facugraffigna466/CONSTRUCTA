import { useState } from "react";
import { Plus, Pencil, UserX, UserCheck, ChevronDown, ChevronRight } from "lucide-react";
import { ResponsibleFormModal } from "./ResponsibleFormModal";
import { ResponsibleDeactivateConfirm } from "./ResponsibleDeactivateConfirm";
import { ResponsibleReactivateConfirm } from "./ResponsibleReactivateConfirm";
import type { Responsible, Task } from "../types";

// ─── Design tokens ─────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#E76A2D", "#3A6BD9", "#1F9A5A", "#9A4DC9", "#D03A3A", "#E89B14", "#0EA5A0"];

function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WorkloadBadge({ count }: { count: number }) {
  if (count === 0)
    return <span style={{ fontSize: 12.5, color: "#94928D" }}>Sin tareas</span>;
  if (count >= 3)
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 9px", borderRadius: 99,
        fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em",
        background: "#FCE5E5", color: "#D03A3A", border: "1px solid #F0B0B0",
      }}>
        Alta carga · {count}
      </span>
    );
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 9px", borderRadius: 99,
      fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em",
      background: "#FDF1DE", color: "#C97D0E", border: "1px solid #F0D5A0",
    }}>
      Con tareas · {count}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ObraResponsablesTabProps {
  responsibles: Responsible[];
  tasks: Task[];
  onRefresh: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ObraResponsablesTab({ responsibles, tasks, onRefresh }: ObraResponsablesTabProps) {
  const [showCreate, setShowCreate]       = useState(false);
  const [toEdit, setToEdit]               = useState<Responsible | null>(null);
  const [toDeactivate, setToDeactivate]   = useState<Responsible | null>(null);
  const [toReactivate, setToReactivate]   = useState<Responsible | null>(null);
  const [showInactive, setShowInactive]   = useState(false);

  const active   = responsibles.filter(r => r.is_active);
  const inactive = responsibles.filter(r => !r.is_active);

  function activeTaskCount(id: number) {
    return tasks.filter(t => t.responsible_id === id && t.status !== "completada" && t.status !== "cancelada").length;
  }
  function totalTaskCount(id: number) {
    return tasks.filter(t => t.responsible_id === id).length;
  }

  function handleSaved()       { setShowCreate(false); setToEdit(null); onRefresh(); }
  function handleDeactivated() { setToDeactivate(null); onRefresh(); }
  function handleReactivated() { setToReactivate(null); onRefresh(); }

  const COLS = "280px 140px 200px 1fr 88px";

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

        {/* ── Responsables activos ── */}
        <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #F0F1EF" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                border: "1px solid #F5D5C0",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="6" cy="5" r="2.5" stroke="#E76A2D" strokeWidth="1.4" fill="none"/>
                  <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="#E76A2D" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                  <path d="M11 3.5c1 .4 1.5 1.2 1.5 2s-.5 1.5-1.5 2M12.5 10.5c1.5.6 2.5 1.8 2 3" stroke="#E76A2D" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.015em" }}>
                Responsables activos
              </span>
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "2px 9px", borderRadius: 99,
                fontSize: 11.5, fontWeight: 600, color: "#5B6770",
                background: "#F0F1EF", border: "1px solid #E6E7E5",
              }}>
                {active.length}
              </span>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "8px 14px", borderRadius: 9,
                fontSize: 13, fontWeight: 600,
                background: "#FF6B35", color: "#fff",
                border: "none", cursor: "pointer",
                boxShadow: "0 4px 12px -4px rgba(255,107,53,0.5)",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#E85A26")}
              onMouseLeave={e => (e.currentTarget.style.background = "#FF6B35")}
            >
              <Plus style={{ width: 13, height: 13 }} />
              Nuevo responsable
            </button>
          </div>

          {active.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", padding: "48px 24px", gap: 10,
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "#F0F1EF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#94928D" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="6" cy="5" r="2.5" fill="none"/>
                  <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" fill="none"/>
                </svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#3E4A52" }}>No hay responsables activos</p>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "#8E97A0" }}>Agregá uno con el botón de arriba.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Column labels */}
              <div style={{
                display: "grid", gridTemplateColumns: COLS,
                padding: "8px 20px", borderBottom: "1px solid #F2F0EC", background: "#fff",
              }}>
                {["Nombre", "Rol", "WhatsApp", "Carga actual", ""].map(label => (
                  <span key={label} style={{
                    fontSize: 10, fontWeight: 600, color: "#ADAAA4",
                    letterSpacing: "0.1em", textTransform: "uppercase" as const,
                  }}>
                    {label}
                  </span>
                ))}
              </div>

              {/* Rows */}
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {active.map((r, idx) => {
                  const color    = avatarColor(r.full_name);
                  const initials = getInitials(r.full_name);
                  const count    = activeTaskCount(r.id);
                  return (
                    <li key={r.id} style={{
                      display: "grid", gridTemplateColumns: COLS,
                      alignItems: "center",
                      padding: "0 20px", minHeight: 60,
                      borderBottom: idx < active.length - 1 ? "1px solid #F2F0EC" : "none",
                    }}>

                      {/* Name + avatar */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 99, flexShrink: 0,
                          background: color, color: "#fff",
                          fontWeight: 700, fontSize: 11,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {initials}
                        </div>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1A2329" }}>
                          {r.full_name}
                        </span>
                      </div>

                      {/* Rol */}
                      <span style={{ fontSize: 12.5, color: r.role ? "#5B6770" : "#C5C3BE", fontStyle: r.role ? "normal" : "italic" }}>
                        {r.role ?? "—"}
                      </span>

                      {/* WhatsApp */}
                      <span style={{ fontSize: 12, color: "#5B6770", fontFamily: "'JetBrains Mono', monospace" }}>
                        {r.whatsapp_number}
                      </span>

                      {/* Workload */}
                      <div>
                        <WorkloadBadge count={count} />
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <button
                          onClick={() => setToEdit(r)}
                          title="Editar responsable"
                          style={{
                            width: 30, height: 30, borderRadius: 8, border: "none",
                            background: "transparent", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#8E97A0", transition: "background 0.15s, color 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#EAF1FB"; e.currentTarget.style.color = "#2A6FDB"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
                        >
                          <Pencil style={{ width: 13, height: 13 }} />
                        </button>
                        <button
                          onClick={() => setToDeactivate(r)}
                          title="Desactivar responsable"
                          style={{
                            width: 30, height: 30, borderRadius: 8, border: "none",
                            background: "transparent", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#8E97A0", transition: "background 0.15s, color 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#FCE5E5"; e.currentTarget.style.color = "#D03A3A"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
                        >
                          <UserX style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* ── Responsables desactivados (collapsible) ── */}
        {inactive.length > 0 && (
          <div>
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 8,
                fontSize: 12.5, fontWeight: 500, color: "#8E97A0",
                background: "transparent", border: "none", cursor: "pointer",
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#F0F1EF"; e.currentTarget.style.color = "#3E4A52"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
            >
              {showInactive
                ? <ChevronDown style={{ width: 14, height: 14 }} />
                : <ChevronRight style={{ width: 14, height: 14 }} />
              }
              Responsables desactivados ({inactive.length})
            </button>

            {showInactive && (
              <div style={{
                marginTop: 8, background: "#FAFAF8",
                border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden",
              }}>
                {/* Column labels */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "280px 140px 200px 1fr 160px",
                  padding: "8px 20px", borderBottom: "1px solid #F2F0EC",
                }}>
                  {["Nombre", "Rol", "WhatsApp", "Tareas", ""].map(label => (
                    <span key={label} style={{
                      fontSize: 10, fontWeight: 600, color: "#ADAAA4",
                      letterSpacing: "0.1em", textTransform: "uppercase" as const,
                    }}>
                      {label}
                    </span>
                  ))}
                </div>

                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {inactive.map((r, idx) => {
                    const color    = avatarColor(r.full_name);
                    const initials = getInitials(r.full_name);
                    const total    = totalTaskCount(r.id);
                    return (
                      <li key={r.id} style={{
                        display: "grid",
                        gridTemplateColumns: "280px 140px 200px 1fr 160px",
                        alignItems: "center",
                        padding: "0 20px", minHeight: 56,
                        borderBottom: idx < inactive.length - 1 ? "1px solid #F2F0EC" : "none",
                        opacity: 0.7,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: 99, flexShrink: 0,
                            background: color, color: "#fff",
                            fontWeight: 700, fontSize: 10,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {initials}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#1A2329", textDecoration: "line-through" }}>
                            {r.full_name}
                          </span>
                        </div>
                        <span style={{ fontSize: 12.5, color: "#5B6770" }}>{r.role ?? "—"}</span>
                        <span style={{ fontSize: 12, color: "#5B6770", fontFamily: "'JetBrains Mono', monospace" }}>{r.whatsapp_number}</span>
                        <span style={{
                          fontSize: 12, fontWeight: 600, color: "#8E97A0",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {total > 0 ? total : "—"}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            onClick={() => setToReactivate(r)}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              padding: "6px 12px", borderRadius: 8,
                              border: "1.5px solid #1F9A5A",
                              fontSize: 12, fontWeight: 600, color: "#1F9A5A",
                              background: "#F0FAF5", cursor: "pointer",
                              transition: "background 0.15s, box-shadow 0.15s",
                              boxShadow: "none",
                              whiteSpace: "nowrap" as const,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#D6F0E4"; e.currentTarget.style.boxShadow = "0 2px 8px -2px rgba(31,154,90,0.25)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#F0FAF5"; e.currentTarget.style.boxShadow = "none"; }}
                          >
                            <UserCheck style={{ width: 13, height: 13 }} />
                            Reactivar
                          </button>
                          <button
                            onClick={() => setToEdit(r)}
                            title="Editar"
                            style={{
                              width: 30, height: 30, borderRadius: 7, border: "none",
                              background: "transparent", cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#8E97A0", transition: "background 0.15s, color 0.15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#EAF1FB"; e.currentTarget.style.color = "#2A6FDB"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
                          >
                            <Pencil style={{ width: 12, height: 12 }} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showCreate && <ResponsibleFormModal mode="create" onClose={() => setShowCreate(false)} onSaved={handleSaved} />}
      {toEdit && <ResponsibleFormModal mode="edit" responsible={toEdit} onClose={() => setToEdit(null)} onSaved={handleSaved} />}
      {toDeactivate && <ResponsibleDeactivateConfirm responsible={toDeactivate} obraTasks={tasks} onClose={() => setToDeactivate(null)} onDeactivated={handleDeactivated} />}
      {toReactivate && <ResponsibleReactivateConfirm responsible={toReactivate} onClose={() => setToReactivate(null)} onReactivated={handleReactivated} />}
    </>
  );
}
