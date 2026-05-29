import { useCallback, useEffect, useState } from "react";
import { PlusIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { GooeyInput } from "@/components/ui/gooey-input";
import { fetchObras } from "../api/obras";
import { fetchMembers, type ApiUser } from "../api/users";
import { userAvatarColor } from "../context/UserContext";
import { Spinner } from "../components/Spinner";
import { usePermission } from "../hooks/usePermission";
import type { Obra, ObraStatus } from "../types";

// ─── Design tokens ────────────────────────────────────────────────────────────

const HERO_GRADIENTS = [
  "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
  "linear-gradient(135deg, #3D8BFF 0%, #2A6FDB 100%)",
  "linear-gradient(135deg, #2AC58A 0%, #1F8A5B 100%)",
  "linear-gradient(135deg, #B07CF7 0%, #7848D3 100%)",
  "linear-gradient(135deg, #4A5862 0%, #2F3A40 100%)",
  "linear-gradient(135deg, #E8B14A 0%, #C97D0E 100%)",
  "linear-gradient(135deg, #5DA8B5 0%, #2C6571 100%)",
];

const STATUS_PILL: Record<ObraStatus, { dot: string; label: string; textColor: string }> = {
  planificada: { dot: "#2A6FDB", label: "Planificada",  textColor: "#1D539E" },
  en_progreso: { dot: "#1F8A5B", label: "En progreso",  textColor: "#136E47" },
  pausada:     { dot: "#C97D0E", label: "Pausada",      textColor: "#8B5306" },
  completada:  { dot: "#787777", label: "Completada",   textColor: "#5B6770" },
  cancelada:   { dot: "#787777", label: "Cancelada",    textColor: "#5B6770" },
};

const PROGRESS_COLOR: Record<ObraStatus, string> = {
  planificada: "#2A6FDB",
  en_progreso: "#FF6B35",
  pausada:     "#C97D0E",
  completada:  "#1F8A5B",
  cancelada:   "#B0B4B0",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null;
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
}

function heroGradient(id: number): string {
  return HERO_GRADIENTS[id % HERO_GRADIENTS.length];
}

// ─── Obra card ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

function ObraCard({ obra, onSelect, isPinned, onTogglePin, members }: { obra: Obra; onSelect: () => void; isPinned: boolean; onTogglePin: () => void; members: Map<number, ApiUser> }) {
  const [imgError, setImgError] = useState(false);
  const pill      = STATUS_PILL[obra.status];
  const pct       = obra.total_tasks === 0 ? 0 : Math.round((obra.completed_tasks / obra.total_tasks) * 100);
  const barColor  = PROGRESS_COLOR[obra.status];
  const days      = daysRemaining(obra.expected_end_date);
  const nameAbbr  = obra.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const hasImg    = !!obra.image_url && !imgError;

  const creator         = obra.manager_id != null ? members.get(obra.manager_id) : undefined;
  const creatorName     = creator?.full_name || creator?.email || "?";
  const creatorInitials = getInitials(creatorName);
  const creatorColor    = obra.manager_id != null ? userAvatarColor(obra.manager_id) : "#8E97A0";

  return (
    <article
      onClick={onSelect}
      style={{
        background: "#fff",
        border: "1px solid #E6E7E5",
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "transform 0.18s, box-shadow 0.18s, border-color 0.18s",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 18px 36px -22px rgba(24,34,42,0.25), 0 4px 8px -4px rgba(24,34,42,0.06)";
        (e.currentTarget as HTMLElement).style.borderColor = "#D5D7D3";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = "none";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.borderColor = "#E6E7E5";
      }}
    >
      {/* Hero */}
      <div style={{ height: 120, position: "relative", overflow: "hidden", background: hasImg ? "#E9ECEF" : heroGradient(obra.id) }}>
        {hasImg ? (
          <img
            src={obra.image_url!}
            alt={obra.name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <>
            {/* Dot pattern */}
            <div style={{
              position: "absolute", inset: 0,
              backgroundImage: "radial-gradient(circle at 18% 30%, rgba(255,255,255,0.18) 1px, transparent 2px), radial-gradient(circle at 70% 75%, rgba(255,255,255,0.12) 1px, transparent 2px)",
              backgroundSize: "42px 42px, 28px 28px",
              opacity: 0.55,
            }} />
            {/* Grid pattern */}
            <div style={{
              position: "absolute", inset: 0,
              backgroundImage: "linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              WebkitMaskImage: "linear-gradient(135deg, transparent 30%, #000 90%)",
            }} />
            {/* Name mark */}
            <div style={{ position: "absolute", left: 18, bottom: 14, color: "rgba(255,255,255,0.95)", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em", lineHeight: 1 }}>
              <span style={{ display: "block", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, fontSize: 10.5, letterSpacing: "0.12em", opacity: 0.7, marginBottom: 6 }}>
                #{String(obra.id).padStart(3, "0")}
              </span>
              {nameAbbr}
            </div>
          </>
        )}

        {/* Pin button — top left */}
        <button
          onClick={e => { e.stopPropagation(); onTogglePin(); }}
          title={isPinned ? "Desfijar de la barra" : "Fijar en la barra lateral"}
          style={{
            position: "absolute", top: 10, left: 10,
            width: 28, height: 28, borderRadius: 99,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "none", cursor: "pointer",
            background: isPinned ? "#FF6B35" : "rgba(0,0,0,0.30)",
            color: "#fff",
            backdropFilter: "blur(4px)",
            transition: "background 0.15s, transform 0.15s",
            transform: isPinned ? "rotate(-30deg)" : "none",
          }}
          onMouseEnter={e => { if (!isPinned) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.50)"; }}
          onMouseLeave={e => { if (!isPinned) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.30)"; }}
        >
          <MapPinIcon style={{ width: 12, height: 12 }} />
        </button>

        {/* Status pill */}
        <div style={{
          position: "absolute", top: 14, right: 14,
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px 4px 9px", borderRadius: 99,
          fontSize: 11, fontWeight: 600,
          background: "rgba(255,255,255,0.92)",
          color: pill.textColor,
          backdropFilter: "blur(4px)",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: pill.dot, boxShadow: `0 0 0 3px ${pill.dot}30`, flexShrink: 0 }} />
          {pill.label}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 18px 14px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 16.5, color: "#1A2329", letterSpacing: "-0.015em", lineHeight: 1.25 }}>
          {obra.name}
        </div>

        {obra.location && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#5B6770" }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 2.5a3.8 3.8 0 013.8 3.8c0 2.8-3.8 7.2-3.8 7.2S4.2 9.1 4.2 6.3A3.8 3.8 0 018 2.5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
              <circle cx="8" cy="6.3" r="1.3" stroke="currentColor" strokeWidth="1.4" fill="none"/>
            </svg>
            {obra.location}
          </div>
        )}

        {/* Progress */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "auto", paddingTop: 8 }}>
          <div style={{ flex: 1, height: 6, background: "#F0F1EF", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 99, background: barColor, width: `${pct}%`, transition: "width 0.6s" }} />
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#5B6770", minWidth: 36, textAlign: "right" }}>
            {pct}%
          </span>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 14px", borderTop: "1px solid #E6E7E5", marginTop: "auto" }}>
        {/* Creator avatar */}
        <div style={{ display: "flex", alignItems: "center" }} title={creatorName}>
          <div style={{ width: 24, height: 24, borderRadius: 99, background: creatorColor, color: "#fff", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", boxShadow: "0 1px 2px rgba(0,0,0,0.08)", letterSpacing: "0.02em" }}>
            {creatorInitials}
          </div>
        </div>

        {/* Days / date */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#5B6770" }}>
          {days !== null ? (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                <path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
              </svg>
              {days > 0 ? `${days} días restantes` : days === 0 ? "Vence hoy" : `${Math.abs(days)} días vencida`}
            </>
          ) : obra.start_date ? (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                <path d="M5.5 2v3M10.5 2v3M2.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              inicio {new Date(obra.start_date).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
            </>
          ) : null}
        </div>

        {/* Menu dots */}
        <button
          onClick={e => e.stopPropagation()}
          style={{ width: 26, height: 26, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#8E97A0", background: "none", border: "none", cursor: "pointer" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#F4F5F4")}
          onMouseLeave={e => (e.currentTarget.style.background = "none")}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="8" r="1.2" fill="currentColor"/>
            <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
            <circle cx="12" cy="8" r="1.2" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </article>
  );
}

// ─── Filter options ───────────────────────────────────────────────────────────

type ObraFilter = "todas" | ObraStatus;
const FILTER_OPTIONS: { id: ObraFilter; label: string }[] = [
  { id: "todas",       label: "Todas"        },
  { id: "en_progreso", label: "Activas"      },
  { id: "planificada", label: "Planificadas" },
  { id: "pausada",     label: "Pausadas"     },
  { id: "completada",  label: "Completadas"  },
];

// ─── KPI card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  delta: React.ReactNode;
  sparkColor: string;
  sparkPath: string;
}

function KpiCard({ label, value, icon, iconBg, iconColor, delta, sparkColor, sparkPath }: KpiCardProps) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ECEEED", borderRadius: 16, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A0ABB4" }}>{label}</span>
        <div style={{ width: 32, height: 32, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: iconBg, color: iconColor }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 32, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", color: "#1A2329" }}>
        {String(value).padStart(2, "0")}
      </div>
      <div style={{ fontSize: 11.5, color: "#5B6770", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        {delta}
      </div>
      {/* Sparkline */}
      <svg style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 36, opacity: 0.4 }} viewBox="0 0 200 40" preserveAspectRatio="none">
        <path d={sparkPath} stroke={sparkColor} strokeWidth="1.8" fill="none"/>
      </svg>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PortfolioPageProps {
  onSelectObra: (obra: Obra) => void;
  onNewObra: () => void;
  pinnedObras: Obra[];
  onTogglePin: (obra: Obra) => void;
}

export function PortfolioPage({ onSelectObra, onNewObra, pinnedObras, onTogglePin }: PortfolioPageProps) {
  const canCreateObra = usePermission("obra.create");
  const [obras,      setObras]      = useState<Obra[]>([]);
  const [members,    setMembers]    = useState<Map<number, ApiUser>>(new Map());
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<ObraFilter>("todas");
  const [search,     setSearch]     = useState("");

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const obrasData = await fetchObras();
      setObras(obrasData);
    } catch {
      setError("No se pudieron cargar las obras. Verificá que el backend esté corriendo.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    try {
      const membersData = await fetchMembers();
      setMembers(new Map(membersData.map(u => [u.id, u])));
    } catch {
      // Silently ignored — collaborators don't have access to member list
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const pinnedIds = new Set(pinnedObras.map(o => o.id));
  const byStatus = (s: ObraStatus) => obras.filter(o => o.status === s).length;

  const q = search.trim().toLowerCase();
  const filteredObras = obras.filter(o => {
    if (filter !== "todas" && o.status !== filter) return false;
    if (!q) return true;
    return (
      o.name.toLowerCase().includes(q) ||
      (o.location ?? "").toLowerCase().includes(q) ||
      (o.description ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>

      {/* ── Page header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: "-0.025em", color: "#1A2329", lineHeight: 1 }}>
            Mis obras
          </h1>
          {!loading && (
            <div style={{ marginTop: 6, fontSize: 13, color: "#5B6770" }}>
              Vista general de proyectos ·{" "}
              <strong style={{ color: "#1A2329", fontWeight: 600 }}>{byStatus("en_progreso")} activas</strong>
              {" "}· actualizado hace un momento
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Search */}
          <GooeyInput
            placeholder="Buscar obras…"
            value={search}
            onValueChange={setSearch}
            collapsedWidth={120}
            expandedWidth={220}
            expandedOffset={48}
          />

          {/* Nueva obra */}
          {canCreateObra && (
            <button
              onClick={onNewObra}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, background: "#FF6B35", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer", boxShadow: "0 1px 0 rgba(255,255,255,0.18) inset, 0 6px 14px -6px rgba(255,107,53,0.55)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#E85A26")}
              onMouseLeave={e => (e.currentTarget.style.background = "#FF6B35")}
            >
              <PlusIcon style={{ width: 13, height: 13 }} />
              Nueva obra
            </button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ fontSize: 13, color: "#C0392B", background: "#FDF0F0", border: "1px solid rgba(192,57,43,0.25)", borderRadius: 10, padding: "10px 16px", marginBottom: 20 }}>
          {error}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* ── KPI Strip ── */}
          {obras.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
              <KpiCard
                label="Total obras"
                value={obras.length}
                icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 13.5V6l5-3.5 5 3.5v7.5h-10z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M6 13.5V10h3v3.5M5 7.5h5" stroke="currentColor" strokeWidth="1.4"/></svg>}
                iconBg="#FFF1E9" iconColor="#FF6B35"
                delta={<><svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ color: "#1F8A5B" }}><path d="M2 11l4-4 3 3 5-6M14 4h-3M14 4v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg><strong style={{ color: "#1F8A5B" }}>+{obras.length}</strong> registradas</>}
                sparkColor="#FF6B35"
                sparkPath="M0 30 L25 28 L50 24 L75 26 L100 18 L125 20 L150 12 L175 14 L200 8"
              />
              <KpiCard
                label="En progreso"
                value={byStatus("en_progreso")}
                icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
                iconBg="#E5EEFB" iconColor="#2A6FDB"
                delta={<>avance medio <strong style={{ color: "#2A6FDB" }}>50%</strong></>}
                sparkColor="#2A6FDB"
                sparkPath="M0 26 L25 24 L50 28 L75 20 L100 22 L125 14 L150 18 L175 10 L200 12"
              />
              <KpiCard
                label="Planificadas"
                value={byStatus("planificada")}
                icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M5.5 2v3M10.5 2v3M2.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>}
                iconBg="#FDF1DE" iconColor="#C97D0E"
                delta={<>próximo inicio pendiente</>}
                sparkColor="#C97D0E"
                sparkPath="M0 20 L25 22 L50 18 L75 20 L100 24 L125 22 L150 26 L175 24 L200 28"
              />
              <KpiCard
                label="Completadas"
                value={byStatus("completada")}
                icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 11l4-4 3 3 5-6M14 4h-3M14 4v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
                iconBg="#E4F3EC" iconColor="#1F8A5B"
                delta={<><strong>+{byStatus("completada")}</strong> entregadas</>}
                sparkColor="#1F8A5B"
                sparkPath="M0 32 L25 30 L50 28 L75 24 L100 20 L125 18 L150 12 L175 10 L200 6"
              />
            </div>
          )}

          {obras.length === 0 ? (
            /* ── Empty state ── */
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 16, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "#FFF1E9", display: "flex", alignItems: "center", justifyContent: "center", color: "#FF6B35" }}>
                <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M2.5 13.5V6l5-3.5 5 3.5v7.5h-10z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M6 13.5V10h3v3.5M5 7.5h5" stroke="currentColor" strokeWidth="1.4"/></svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 15, color: "#1A2329" }}>Sin obras registradas</p>
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#8E97A0" }}>Creá tu primera obra para comenzar el seguimiento.</p>
              </div>
              {canCreateObra && (
                <button
                  onClick={onNewObra}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, background: "#FF6B35", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer", boxShadow: "0 6px 14px -6px rgba(255,107,53,0.55)" }}
                >
                  <PlusIcon style={{ width: 13, height: 13 }} />
                  Crear primera obra
                </button>
              )}
            </div>
          ) : (
            <>
              {/* ── Toolbar ── */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                {/* Filter tabs */}
                <div style={{ display: "inline-flex", gap: 2, background: "#fff", border: "1px solid #E6E7E5", padding: 4, borderRadius: 11 }}>
                  {FILTER_OPTIONS.map(({ id, label }) => {
                    const count = id === "todas" ? obras.length : obras.filter(o => o.status === id).length;
                    const isActive = filter === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setFilter(id)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: isActive ? "#fff" : "#5B6770",
                          background: isActive ? "#2F3A40" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 7,
                          transition: "background 0.15s, color 0.15s",
                        }}
                      >
                        {label}
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10.5,
                          padding: "1px 6px",
                          borderRadius: 99,
                          background: isActive ? "rgba(255,255,255,0.16)" : "#F0F1EF",
                          color: isActive ? "#fff" : "#8E97A0",
                        }}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Card grid ── */}
              {filteredObras.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "48px 0", background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, color: "#8E97A0", fontSize: 13 }}>
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  {q ? `Sin resultados para "${search}"` : "No hay obras con este filtro."}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
                  {filteredObras.map(obra => (
                    <ObraCard
                      key={obra.id}
                      obra={obra}
                      onSelect={() => onSelectObra(obra)}
                      isPinned={pinnedIds.has(obra.id)}
                      onTogglePin={() => onTogglePin(obra)}
                      members={members}
                    />
                  ))}

                  {/* "Nueva obra" ghost card */}
                  {filter === "todas" && canCreateObra && (
                    <article
                      onClick={onNewObra}
                      style={{
                        border: "1.5px dashed #C7CAC6",
                        background: "transparent",
                        borderRadius: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 280,
                        cursor: "pointer",
                        textAlign: "center",
                        color: "#5B6770",
                        transition: "border-color 0.18s, background 0.18s, color 0.18s",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "#FF6B35";
                        (e.currentTarget as HTMLElement).style.background = "rgba(255,107,53,0.03)";
                        (e.currentTarget as HTMLElement).style.color = "#FF6B35";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = "#C7CAC6";
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "#5B6770";
                      }}
                    >
                      <div>
                        <div style={{ width: 44, height: 44, borderRadius: 99, background: "rgba(255,107,53,0.10)", color: "#FF6B35", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                          <PlusIcon style={{ width: 18, height: 18 }} />
                        </div>
                        <h4 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 15, margin: "0 0 4px", color: "#1A2329" }}>Crear nueva obra</h4>
                        <p style={{ margin: 0, fontSize: 12, color: "#8E97A0", maxWidth: 200 }}>Empezá un proyecto desde cero.</p>
                      </div>
                    </article>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
