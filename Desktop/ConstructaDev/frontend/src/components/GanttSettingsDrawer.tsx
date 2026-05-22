import { useEffect, useState } from "react";
import {
  fetchCalendar,
  updateCalendar,
  addException,
  deleteException,
  loadHolidays,
  type WorkingCalendar,
  type CalendarException,
} from "../api/calendar";

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface Props {
  obraId: number;
  isOpen: boolean;
  onClose: () => void;
  // view settings lifted up so Gantt can react
  view: "semana" | "mes" | "trim";
  onViewChange: (v: "semana" | "mes" | "trim") => void;
  showTasksWithoutDates: boolean;
  onToggleTasksWithoutDates: () => void;
}

function SectionHeader({
  title,
  icon,
  open,
  onToggle,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8,
        padding: "11px 16px", background: "none", border: "none",
        borderBottom: open ? "none" : "1px solid #F0F1EF",
        cursor: "pointer", textAlign: "left",
      }}
    >
      <span style={{ color: "#E76A2D", display: "flex", alignItems: "center" }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>{title}</span>
      <svg
        width="12" height="12" viewBox="0 0 12 12" fill="none"
        style={{ color: "#8E97A0", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
      >
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function fmtDateLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function GanttSettingsDrawer({
  obraId,
  isOpen,
  onClose,
  view,
  onViewChange,
  showTasksWithoutDates,
  onToggleTasksWithoutDates,
}: Props) {
  const [calendar, setCalendar] = useState<WorkingCalendar | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [holidayMsg, setHolidayMsg] = useState<string | null>(null);

  // exception form
  const [excDate, setExcDate] = useState("");
  const [excLabel, setExcLabel] = useState("");
  const [excIsWorking, setExcIsWorking] = useState(false);
  const [excAdding, setExcAdding] = useState(false);

  // section open state
  const [openDays, setOpenDays] = useState(true);
  const [openExc, setOpenExc] = useState(true);
  const [openVista, setOpenVista] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchCalendar(obraId)
      .then(setCalendar)
      .finally(() => setLoading(false));
  }, [isOpen, obraId]);

  async function toggleDay(bit: number) {
    if (!calendar) return;
    const next = calendar.working_days ^ (1 << bit);
    setSaving(true);
    try {
      const updated = await updateCalendar(obraId, { working_days: next });
      setCalendar(updated);
    } finally { setSaving(false); }
  }

  async function changeHour(field: "hour_from" | "hour_to", value: number) {
    if (!calendar) return;
    setSaving(true);
    try {
      const updated = await updateCalendar(obraId, { [field]: value });
      setCalendar(updated);
    } finally { setSaving(false); }
  }

  async function handleAddException() {
    if (!excDate) return;
    setExcAdding(true);
    try {
      const exc = await addException(obraId, excDate, excIsWorking, excLabel || null);
      setCalendar(c => c ? { ...c, exceptions: [...c.exceptions.filter(e => e.date !== exc.date), exc] } : c);
      setExcDate(""); setExcLabel(""); setExcIsWorking(false);
    } finally { setExcAdding(false); }
  }

  async function handleDeleteException(exc: CalendarException) {
    await deleteException(obraId, exc.id);
    setCalendar(c => c ? { ...c, exceptions: c.exceptions.filter(e => e.id !== exc.id) } : c);
  }

  async function handleLoadHolidays() {
    setHolidayMsg(null);
    const res = await loadHolidays(obraId, new Date().getFullYear());
    const next = await fetchCalendar(obraId);
    setCalendar(next);
    setHolidayMsg(`${res.added} feriados agregados, ${res.skipped} ya existían`);
    setTimeout(() => setHolidayMsg(null), 4000);
  }

  const sortedExc = [...(calendar?.exceptions ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(26,35,41,0.08)" }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0,
        width: 300,
        background: "#fff",
        borderLeft: "1px solid #E6E7E5",
        zIndex: 11,
        display: "flex", flexDirection: "column",
        transform: isOpen ? "translateX(0)" : "translateX(300px)",
        transition: "transform 0.22s ease",
        boxShadow: isOpen ? "-8px 0 24px -8px rgba(26,35,41,0.12)" : "none",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        overflowY: "auto",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "13px 16px 12px",
          borderBottom: "1px solid #F0F1EF",
          background: "#FAFAFA",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5A6.5 6.5 0 118 14.5 6.5 6.5 0 018 1.5z" stroke="#E76A2D" strokeWidth="1.3" fill="none"/>
              <path d="M8 5v3l2 1.5" stroke="#E76A2D" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>
              Configuración del Gantt
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#8E97A0" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {loading && (
          <div style={{ padding: 20, fontSize: 13, color: "#8E97A0", textAlign: "center" }}>Cargando…</div>
        )}

        {!loading && (
          <>
            {/* ── Sección 1: Vista del Gantt ── */}
            <div style={{ borderBottom: "1px solid #F0F1EF" }}>
              <SectionHeader
                title="Vista"
                open={openVista}
                onToggle={() => setOpenVista(v => !v)}
                icon={
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                    <path d="M1.5 6h13M6 1.5v13" stroke="currentColor" strokeWidth="1.3"/>
                  </svg>
                }
              />
              {openVista && (
                <div style={{ padding: "4px 16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Escala */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#8E97A0", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>Escala</div>
                    <div style={{ display: "flex", background: "#F4F1EB", borderRadius: 7, padding: 2, border: "1px solid #ECE7DD" }}>
                      {(["semana", "mes", "trim"] as const).map((v, i) => {
                        const lbl = ["Semana", "Mes", "Trimestre"][i];
                        const active = view === v;
                        return (
                          <button
                            key={v}
                            onClick={() => onViewChange(v)}
                            style={{
                              flex: 1, background: active ? "#fff" : "transparent",
                              border: "none", cursor: "pointer",
                              padding: "5px 0", fontSize: 11.5, fontWeight: 500,
                              color: active ? "#1B1B1A" : "#6B6A66", borderRadius: 5,
                              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                            }}
                          >{lbl}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Toggle tareas sin fecha */}
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <div
                      onClick={onToggleTasksWithoutDates}
                      style={{
                        width: 32, height: 18, borderRadius: 99,
                        background: showTasksWithoutDates ? "#FF6B35" : "#D5D7D3",
                        position: "relative", cursor: "pointer", transition: "background 0.15s", flexShrink: 0,
                      }}
                    >
                      <div style={{
                        position: "absolute", top: 2, left: showTasksWithoutDates ? 16 : 2,
                        width: 14, height: 14, borderRadius: 99, background: "#fff",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.18)", transition: "left 0.15s",
                      }} />
                    </div>
                    <span style={{ fontSize: 12.5, color: "#1A2329" }}>Mostrar tareas sin fecha</span>
                  </label>
                </div>
              )}
            </div>

            {/* ── Sección 2: Días laborables ── */}
            <div style={{ borderBottom: "1px solid #F0F1EF" }}>
              <SectionHeader
                title="Días laborables"
                open={openDays}
                onToggle={() => setOpenDays(v => !v)}
                icon={
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                    <path d="M5 1.5v2M11 1.5v2M1.5 6h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                }
              />
              {openDays && calendar && (
                <div style={{ padding: "4px 16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Day checkboxes */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {DAY_LABELS.map((label, i) => {
                      const active = !!(calendar.working_days & (1 << i));
                      return (
                        <button
                          key={i}
                          onClick={() => toggleDay(i)}
                          disabled={saving}
                          style={{
                            flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 10.5, fontWeight: 600,
                            background: active ? "#FF6B35" : "#F4F5F4",
                            color: active ? "#fff" : "#8E97A0",
                            border: active ? "1px solid #FF6B35" : "1px solid #E6E7E5",
                            cursor: saving ? "not-allowed" : "pointer",
                            transition: "all 0.12s",
                          }}
                        >{label}</button>
                      );
                    })}
                  </div>

                  {/* Hours */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#5B6770", flexShrink: 0 }}>Horario</span>
                    <select
                      value={calendar.hour_from}
                      onChange={e => changeHour("hour_from", Number(e.target.value))}
                      style={{ flex: 1, padding: "5px 6px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329", background: "#fff" }}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 12, color: "#8E97A0" }}>–</span>
                    <select
                      value={calendar.hour_to}
                      onChange={e => changeHour("hour_to", Number(e.target.value))}
                      style={{ flex: 1, padding: "5px 6px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329", background: "#fff" }}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* ── Sección 3: Excepciones ── */}
            <div>
              <SectionHeader
                title="Excepciones"
                open={openExc}
                onToggle={() => setOpenExc(v => !v)}
                icon={
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2L14 14H2L8 2Z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/>
                    <path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                }
              />
              {openExc && (
                <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

                  {/* Load holidays button */}
                  <button
                    onClick={handleLoadHolidays}
                    style={{
                      padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: "#FFF6F1", color: "#E76A2D",
                      border: "1px solid #FFD4B8", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8h10M8 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Cargar feriados {new Date().getFullYear()}
                  </button>
                  {holidayMsg && (
                    <span style={{ fontSize: 11, color: "#1F8A5B" }}>{holidayMsg}</span>
                  )}

                  {/* Exception list */}
                  {sortedExc.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                      {sortedExc.map(exc => (
                        <div
                          key={exc.id}
                          style={{
                            display: "flex", alignItems: "center", gap: 7,
                            padding: "6px 8px", borderRadius: 7,
                            background: exc.is_working ? "#E4F3EC" : "#FFF0F0",
                            border: `1px solid ${exc.is_working ? "#BFE3CE" : "#F5C6C6"}`,
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 700, color: exc.is_working ? "#1F8A5B" : "#D03A3A", flexShrink: 0 }}>
                            {exc.is_working ? "✅" : "🚫"}
                          </span>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5B6770", flexShrink: 0 }}>
                            {fmtDateLabel(exc.date)}
                          </span>
                          <span style={{ flex: 1, fontSize: 11.5, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {exc.label ?? "—"}
                          </span>
                          <button
                            onClick={() => handleDeleteException(exc)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#C4C9C6", padding: 2, display: "flex", flexShrink: 0 }}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add exception form */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px", borderRadius: 8, background: "#FAFAFA", border: "1px solid #F0F1EF" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8E97A0", letterSpacing: "0.06em", textTransform: "uppercase" }}>Agregar excepción</div>
                    <input
                      type="date"
                      value={excDate}
                      onChange={e => setExcDate(e.target.value)}
                      style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329" }}
                    />
                    <input
                      type="text"
                      placeholder="Etiqueta (ej: Paro gremial)"
                      value={excLabel}
                      onChange={e => setExcLabel(e.target.value)}
                      style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329" }}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#5B6770" }}>
                      <input
                        type="checkbox"
                        checked={excIsWorking}
                        onChange={e => setExcIsWorking(e.target.checked)}
                        style={{ accentColor: "#FF6B35" }}
                      />
                      Día laborable especial
                    </label>
                    <button
                      onClick={handleAddException}
                      disabled={!excDate || excAdding}
                      style={{
                        padding: "7px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: !excDate ? "#F4F5F4" : "#FF6B35",
                        color: !excDate ? "#A0A8AD" : "#fff",
                        border: "none", cursor: !excDate ? "not-allowed" : "pointer",
                      }}
                    >
                      {excAdding ? "Agregando…" : "Agregar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
