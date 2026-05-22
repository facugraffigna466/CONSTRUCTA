import {
  Squares2X2Icon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  UserPlusIcon,
  BellIcon,
  ClockIcon,
  UsersIcon,
  Cog6ToothIcon,
  ChatBubbleLeftEllipsisIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  ArrowRightStartOnRectangleIcon,
} from "@heroicons/react/24/outline";
import type { Obra, ObraStatus, ObraTab, Page } from "../../types";

const HERO_DOT_COLORS = ["#FF8856","#3D8BFF","#2AC58A","#B07CF7","#8FA8B5","#E8B14A","#5DA8B5"];
const STATUS_PCT: Record<ObraStatus, number> = {
  planificada: 5, en_progreso: 50, pausada: 30, completada: 100, cancelada: 0,
};

const ICON_SIZE = { width: 15, height: 15 };

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
  pinnedObras?: Obra[];
  selectedObra?: Obra | null;
  activeTab?: ObraTab;
  onTabChange?: (tab: ObraTab) => void;
  obraCounts?: { tasks: number; alerts: number; responsibles: number };
  currentUser?: { name: string; initials: string; color: string; roleLabel: string };
  collapsed?: boolean;
  onToggle?: () => void;
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  label,
  icon,
  active = false,
  disabled = false,
  count,
  countOrange,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  count?: number;
  countOrange?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "7px 10px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        border: "none",
        transition: "background 0.12s, color 0.12s",
        background: active
          ? "linear-gradient(180deg, rgba(255,107,53,0.18), rgba(255,107,53,0.08))"
          : "transparent",
        boxShadow: active ? "inset 0 0 0 1px rgba(255,107,53,0.25)" : "none",
        color: active ? "#fff" : disabled ? "rgba(207,212,215,0.35)" : "#CFD4D7",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => {
        if (!active && !disabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={e => {
        if (!active && !disabled) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <span style={{ width: 16, display: "inline-flex", justifyContent: "center", color: active ? "#FF6B35" : "inherit", opacity: active ? 1 : 0.65, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {count !== undefined && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10.5,
          padding: "1px 6px",
          borderRadius: 99,
          background: countOrange ? "#FF6B35" : "rgba(255,255,255,0.08)",
          color: countOrange ? "#fff" : "#CFD4D7",
          flexShrink: 0,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar({ activePage, onNavigate, onLogout, pinnedObras = [], selectedObra, activeTab, onTabChange, obraCounts, currentUser, collapsed = false, onToggle }: SidebarProps) {
  return (
    <>
    <aside style={{
      position: "fixed",
      left: 0,
      top: 0,
      height: "100vh",
      width: 260,
      background: "#2F3A40",
      display: "flex",
      flexDirection: "column",
      padding: "14px 12px 12px",
      zIndex: 50,
      overflowY: "auto",
      transform: collapsed ? "translateX(-260px)" : "translateX(0)",
      transition: "transform 0.25s ease",
    }}>

      {/* ── Brand ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 14px" }}>
        <img
          src="/logo.png"
          alt="Constructa"
          style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, objectFit: "cover" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, color: "#fff", letterSpacing: "0.04em" }}>
            CONSTRUCTA
          </div>
          <div style={{ fontSize: 11, color: "#8C969C", marginTop: 1 }}>Gestión de obras</div>
        </div>
        <button
          onClick={onToggle}
          title="Cerrar menú"
          style={{
            width: 24, height: 24, borderRadius: 6, flexShrink: 0,
            background: "transparent", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#6B767E", padding: 0, transition: "color 0.15s, background 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#CFD4D7"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#6B767E"; }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* ── Workspace switcher ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 10, padding: "8px 10px",
        margin: "0 2px 14px", cursor: "pointer",
        transition: "background 0.15s",
      }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
        onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
      >
        <div style={{
          width: 24, height: 24, borderRadius: 6, flexShrink: 0,
          background: "linear-gradient(135deg, #FF8856, #FF6B35)",
          color: "#fff", fontWeight: 700, fontSize: 11,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}>EV</div>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ color: "#fff", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Estudio Velar</div>
          <div style={{ fontSize: 10.5, color: "#8C969C", letterSpacing: "0.04em" }}>Workspace</div>
        </div>
        <ChevronDownIcon style={{ width: 12, height: 12, color: "#6B767E", flexShrink: 0 }} />
      </div>

      {/* ── WORKSPACE section ── */}
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", color: "#6B767E", textTransform: "uppercase", padding: "8px 10px 6px" }}>
        Workspace
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <NavItem
          label="Panel"
          active={activePage === "panel" && !selectedObra}
          onClick={() => onNavigate("panel")}
          icon={<Squares2X2Icon style={ICON_SIZE} />}
        />

        {selectedObra && onTabChange && (
          <>
            {/* obra context header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 10px 4px",
              marginTop: 4,
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: 99,
                background: HERO_DOT_COLORS[selectedObra.id % HERO_DOT_COLORS.length],
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 11, fontWeight: 600, color: "#8C969C",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                flex: 1,
              }}>
                {selectedObra.name}
              </span>
            </div>

            <NavItem
              label="Resumen"
              active={activePage === "panel" && activeTab === "resumen"}
              onClick={() => onTabChange("resumen")}
              icon={<ChartBarIcon style={ICON_SIZE} />}
            />
            <NavItem
              label="Tareas"
              active={activePage === "panel" && activeTab === "tareas"}
              count={obraCounts?.tasks}
              onClick={() => onTabChange("tareas")}
              icon={<ClipboardDocumentListIcon style={ICON_SIZE} />}
            />
            <NavItem
              label="Responsables"
              active={activePage === "panel" && activeTab === "responsables"}
              count={obraCounts?.responsibles}
              onClick={() => onTabChange("responsables")}
              icon={<UserPlusIcon style={ICON_SIZE} />}
            />
            <NavItem
              label="Alertas"
              active={activePage === "panel" && activeTab === "alertas"}
              count={obraCounts?.alerts}
              countOrange={(obraCounts?.alerts ?? 0) > 0}
              onClick={() => onTabChange("alertas")}
              icon={<BellIcon style={ICON_SIZE} />}
            />
            <NavItem
              label="Historial"
              active={activePage === "panel" && activeTab === "historial"}
              onClick={() => onTabChange("historial")}
              icon={<ClockIcon style={ICON_SIZE} />}
            />
          </>
        )}
      </nav>

      {/* ── ORGANIZACIÓN section ── */}
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", color: "#6B767E", textTransform: "uppercase", padding: "14px 10px 6px" }}>
        Organización
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <NavItem
          label="Gestión de equipo"
          active={activePage === "equipo"}
          onClick={() => onNavigate("equipo")}
          icon={<UsersIcon style={ICON_SIZE} />}
        />
      </nav>

      {/* ── CUENTA section ── */}
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", color: "#6B767E", textTransform: "uppercase", padding: "14px 10px 6px" }}>
        Cuenta
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <NavItem
          label="Configuración"
          active={activePage === "configuracion"}
          onClick={() => onNavigate("configuracion")}
          icon={<Cog6ToothIcon style={ICON_SIZE} />}
        />
      </nav>

      {/* ── PRÓXIMAMENTE section — solo con obra seleccionada ── */}
      {selectedObra && (
        <>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", color: "#6B767E", textTransform: "uppercase", padding: "14px 10px 6px" }}>
            Próximamente
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {(["bitacora", "presupuestos"] as const).map((page) => {
              const meta = {
                bitacora:     { label: "Bitácora de Obra", icon: <ChatBubbleLeftEllipsisIcon style={ICON_SIZE} /> },
                presupuestos: { label: "Presupuestos",     icon: <DocumentTextIcon style={ICON_SIZE} /> },
              }[page];
              const isActive = activePage === page;
              return (
                <button
                  key={page}
                  onClick={() => onNavigate(page)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 11,
                    padding: "7px 10px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                    textAlign: "left", cursor: "pointer", border: "none",
                    transition: "background 0.12s",
                    background: isActive ? "linear-gradient(180deg, rgba(255,107,53,0.18), rgba(255,107,53,0.08))" : "transparent",
                    boxShadow: isActive ? "inset 0 0 0 1px rgba(255,107,53,0.25)" : "none",
                    color: isActive ? "#fff" : "#CFD4D7",
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span style={{ width: 16, display: "inline-flex", justifyContent: "center", color: isActive ? "#FF6B35" : "inherit", opacity: isActive ? 1 : 0.65, flexShrink: 0 }}>
                    {meta.icon}
                  </span>
                  <span style={{ flex: 1 }}>{meta.label}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "rgba(255,107,53,0.18)", color: "#FF6B35", letterSpacing: "0.04em", flexShrink: 0 }}>
                    PRONTO
                  </span>
                </button>
              );
            })}
          </nav>
        </>
      )}

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── Fijadas ── */}
      {pinnedObras.length > 0 && (
        <div style={{
          margin: "0 2px 10px",
          padding: 10,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 11,
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", color: "#6B767E", textTransform: "uppercase", marginBottom: 8 }}>
            Fijadas
          </div>
          {pinnedObras.map(obra => (
            <div
              key={obra.id}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", fontSize: 12, color: "#CFD4D7", borderRadius: 6, cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ width: 7, height: 7, borderRadius: 99, background: HERO_DOT_COLORS[obra.id % HERO_DOT_COLORS.length], flexShrink: 0 }} />
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{obra.name}</span>
              <span style={{ fontSize: 10.5, color: "#8C969C", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{STATUS_PCT[obra.status]}%</span>
            </div>
          ))}
        </div>
      )}

      {/* ── User + logout ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: 8, borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 99, flexShrink: 0,
          background: currentUser?.color ?? "#8E97A0",
          color: "#fff", fontWeight: 700, fontSize: 11,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}>{currentUser?.initials ?? "?"}</div>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser?.name || "Usuario"}</div>
          <div style={{ fontSize: 10.5, color: "#8C969C" }}>{currentUser?.roleLabel ?? "—"}</div>
        </div>
        <button
          onClick={onLogout}
          title="Cerrar sesión"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6B767E", padding: 4, display: "flex", alignItems: "center" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#CFD4D7")}
          onMouseLeave={e => (e.currentTarget.style.color = "#6B767E")}
        >
          <ArrowRightStartOnRectangleIcon style={{ width: 15, height: 15 }} />
        </button>
      </div>
    </aside>
    </>
  );
}
