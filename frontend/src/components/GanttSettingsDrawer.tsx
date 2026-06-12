import { useEffect, useState } from "react";
import { saveBaseline } from "../api/baseline";
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

const EXCEPTION_CATEGORIES = ["Feriado", "Paro gremial", "Lluvia", "Inspección", "Otro"] as const;
type ExceptionCategory = typeof EXCEPTION_CATEGORIES[number];

const CATEGORY_COLOR: Record<ExceptionCategory, { bg: string; border: string; text: string }> = {
  "Feriado":       { bg: "#FCE5E5", border: "#F5C6C6", text: "#D03A3A" },
  "Paro gremial":  { bg: "#FDF1DE", border: "#F0D5A0", text: "#C97D0E" },
  "Lluvia":        { bg: "#EBF3FF", border: "#BDD4F7", text: "#2563EB" },
  "Inspección":    { bg: "#F0E8FF", border: "#D4B8F5", text: "#7C3AED" },
  "Otro":          { bg: "#F4F5F4", border: "#E0E3E6", text: "#5B6770" },
};

export interface GanttViewOptions {
  view: "semana" | "mes" | "trim";
  showTasksWithoutDates: boolean;
  showProgress: boolean;
  showDependencies: boolean;
  highlightCritical: boolean;
  showBaseline: boolean;
}

interface Props {
  obraId: number;
  isOpen: boolean;
  onClose: () => void;
  viewOptions: GanttViewOptions;
  onViewOptionsChange: (opts: Partial<GanttViewOptions>) => void;
  onBaselineSaved?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      style={{
        width: 32, height: 18, borderRadius: 99, flexShrink: 0,
        background: value ? "#FF6B35" : "#D5D7D3",
        position: "relative", cursor: "pointer", transition: "background 0.15s",
      }}
    >
      <div style={{
        position: "absolute", top: 2,
        left: value ? 16 : 2,
        width: 14, height: 14, borderRadius: 99, background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.18)", transition: "left 0.15s",
      }} />
    </div>
  );
}

function SectionHeader({
  title, icon, open, onToggle,
}: {
  title: string; icon: React.ReactNode; open: boolean; onToggle: () => void;
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
        style={{ color: "#6B7580", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
      >
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GanttSettingsDrawer({ obraId, isOpen, onClose, viewOptions, onViewOptionsChange, onBaselineSaved }: Props) {
  const [calendar, setCalendar]       = useState<WorkingCalendar | null>(null);
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [baselineSavedAt, setBaselineSavedAt] = useState<string | null>(null);
  const [holidayMsg, setHolidayMsg]   = useState<string | null>(null);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());

  // exception form
  const [excDate, setExcDate]             = useState("");
  const [excLabel, setExcLabel]           = useState("");
  const [excCategory, setExcCategory]     = useState<ExceptionCategory>("Feriado");
  const [excIsWorking, setExcIsWorking]   = useState(false);
  const [excAdding, setExcAdding]         = useState(false);

  // section open state
  const [openVista, setOpenVista] = useState(true);
  const [openDays, setOpenDays]   = useState(true);
  const [openExc, setOpenExc]     = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchCalendar(obraId).then(setCalendar).finally(() => setLoading(false));
  }, [isOpen, obraId]);

  async function toggleDay(bit: number) {
    if (!calendar) return;
    setSaving(true);
    try {
      const updated = await updateCalendar(obraId, { working_days: calendar.working_days ^ (1 << bit) });
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
      const label = excLabel || excCategory;
      const exc = await addException(obraId, excDate, excIsWorking, label);
      setCalendar(c => c ? { ...c, exceptions: [...c.exceptions.filter(e => e.date !== exc.date), exc] } : c);
      setExcDate(""); setExcLabel("");
    } finally { setExcAdding(false); }
  }

  async function handleDeleteException(exc: CalendarException) {
    await deleteException(obraId, exc.id);
    setCalendar(c => c ? { ...c, exceptions: c.exceptions.filter(e => e.id !== exc.id) } : c);
  }

  async function handleLoadHolidays() {
    setHolidayMsg(null);
    const res = await loadHolidays(obraId, holidayYear);
    const updated = await fetchCalendar(obraId);
    setCalendar(updated);
    setHolidayMsg(`${res.added} feriados agregados, ${res.skipped} ya existían`);
    setTimeout(() => setHolidayMsg(null), 4000);
  }

  function getCategoryFromLabel(label: string | null): ExceptionCategory {
    if (!label) return "Otro";
    return (EXCEPTION_CATEGORIES as readonly string[]).includes(label)
      ? label as ExceptionCategory
      : "Otro";
  }

  const sortedExc = [...(calendar?.exceptions ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const yearOptions = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];

  const ICONS = {
    vista: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
        <path d="M1.5 6h13M6 1.5v13" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
    calendar: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
        <path d="M5 1.5v2M11 1.5v2M1.5 6h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    warning: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M8 2L14 14H2L8 2Z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/>
        <path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  };

  return (
    <>
      {isOpen && (
        <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(26,35,41,0.06)" }} />
      )}
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: 300,
        background: "#fff", borderLeft: "1px solid #E6E7E5", zIndex: 11,
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
          padding: "13px 16px 12px", borderBottom: "1px solid #F0F1EF",
          background: "#FAFAFA", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="#E76A2D" strokeWidth="1.4" fill="none"/>
              <path d="M13.3 7.1l-.8-.5a5 5 0 000-1.2l.8-.5a1 1 0 00.3-1.3l-.8-1.4a1 1 0 00-1.3-.3l-.8.5a5 5 0 00-1-.6V1a1 1 0 00-1-1H7.3a1 1 0 00-1 1v.8a5 5 0 00-1 .6l-.8-.5a1 1 0 00-1.3.3L2.4 3.6a1 1 0 00.3 1.3l.8.5a5 5 0 000 1.2l-.8.5a1 1 0 00-.3 1.3l.8 1.4a1 1 0 001.3.3l.8-.5a5 5 0 001 .6V11a1 1 0 001 1h1.4a1 1 0 001-1v-.8a5 5 0 001-.6l.8.5a1 1 0 001.3-.3l.8-1.4a1 1 0 00-.3-1.3z" stroke="#E76A2D" strokeWidth="1.3" fill="none"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>
              Configuración del Gantt
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7580" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {loading && <div style={{ padding: 20, fontSize: 13, color: "#6B7580", textAlign: "center" }}>Cargando…</div>}

        {!loading && (
          <>
            {/* ── Sección 1: Vista ── */}
            <div style={{ borderBottom: "1px solid #F0F1EF" }}>
              <SectionHeader title="Vista" icon={ICONS.vista} open={openVista} onToggle={() => setOpenVista(v => !v)} />
              {openVista && (
                <div style={{ padding: "4px 16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

                  {/* Escala */}
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: "#6B7580", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>Escala</div>
                    <div style={{ display: "flex", background: "#F4F1EB", borderRadius: 7, padding: 2, border: "1px solid #ECE7DD" }}>
                      {(["semana", "mes", "trim"] as const).map((v, i) => {
                        const lbl = ["Semana", "Mes", "Trimestre"][i];
                        const active = viewOptions.view === v;
                        return (
                          <button key={v} onClick={() => onViewOptionsChange({ view: v })} style={{
                            flex: 1, background: active ? "#fff" : "transparent", border: "none", cursor: "pointer",
                            padding: "5px 0", fontSize: 11.5, fontWeight: 500,
                            color: active ? "#1B1B1A" : "#6B6A66", borderRadius: 5,
                            boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                          }}>{lbl}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Toggles */}
                  {([
                    ["showTasksWithoutDates", "Mostrar tareas sin fecha"],
                    ["showProgress",          "Mostrar avance en barras"],
                    ["showDependencies",      "Mostrar flechas de dependencias"],
                    ["highlightCritical",     "Resaltar ruta crítica"],
                    ["showBaseline",          "Mostrar línea base"],
                  ] as const).map(([key, label]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <Toggle
                        value={viewOptions[key]}
                        onChange={() => onViewOptionsChange({ [key]: !viewOptions[key] })}
                      />
                      <span style={{ fontSize: 12.5, color: "#1A2329" }}>{label}</span>
                    </label>
                  ))}

                  {/* Save baseline button */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
                    <button
                      onClick={async () => {
                        setSavingBaseline(true);
                        try {
                          const res = await saveBaseline(obraId);
                          setBaselineSavedAt(res.saved_at);
                          onViewOptionsChange({ showBaseline: true });
                          onBaselineSaved?.();
                        } finally {
                          setSavingBaseline(false);
                        }
                      }}
                      disabled={savingBaseline}
                      style={{
                        padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: savingBaseline ? "#F4F5F4" : "#1B2A34", color: savingBaseline ? "#ADAAA4" : "#fff",
                        border: "none", cursor: savingBaseline ? "not-allowed" : "pointer",
                        transition: "background 0.15s",
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      {savingBaseline ? "Guardando…" : "Guardar línea base"}
                    </button>
                    {baselineSavedAt && (
                      <span style={{ fontSize: 11, color: "#6B7580" }}>
                        Guardada: {new Date(baselineSavedAt).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Sección 2: Días laborables ── */}
            <div style={{ borderBottom: "1px solid #F0F1EF" }}>
              <SectionHeader title="Días laborables" icon={ICONS.calendar} open={openDays} onToggle={() => setOpenDays(v => !v)} />
              {openDays && calendar && (
                <div style={{ padding: "4px 16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {DAY_LABELS.map((label, i) => {
                      const active = !!(calendar.working_days & (1 << i));
                      return (
                        <button key={i} onClick={() => toggleDay(i)} disabled={saving} style={{
                          flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 10.5, fontWeight: 600,
                          background: active ? "#FF6B35" : "#F4F5F4",
                          color: active ? "#fff" : "#8E97A0",
                          border: active ? "1px solid #FF6B35" : "1px solid #E6E7E5",
                          cursor: saving ? "not-allowed" : "pointer",
                          transition: "all 0.12s",
                        }}>{label}</button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#5B6770", flexShrink: 0 }}>Horario</span>
                    {(["hour_from", "hour_to"] as const).map((field, i) => (
                      <>
                        {i === 1 && <span style={{ fontSize: 12, color: "#6B7580" }}>–</span>}
                        <select
                          key={field}
                          value={calendar[field]}
                          onChange={e => changeHour(field, Number(e.target.value))}
                          style={{ flex: 1, padding: "5px 6px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329", background: "#fff" }}
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                          ))}
                        </select>
                      </>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Sección 3: Excepciones ── */}
            <div>
              <SectionHeader title="Excepciones" icon={ICONS.warning} open={openExc} onToggle={() => setOpenExc(v => !v)} />
              {openExc && (
                <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

                  {/* Load holidays */}
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select
                      value={holidayYear}
                      onChange={e => setHolidayYear(Number(e.target.value))}
                      style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329", background: "#fff" }}
                    >
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button
                      onClick={handleLoadHolidays}
                      style={{
                        flex: 1, padding: "7px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: "#FFF6F1", color: "#E76A2D", border: "1px solid #FFD4B8", cursor: "pointer",
                      }}
                    >
                      Cargar feriados
                    </button>
                  </div>
                  {holidayMsg && <span style={{ fontSize: 11, color: "#1F8A5B" }}>{holidayMsg}</span>}

                  {/* Exception list */}
                  {sortedExc.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                      {sortedExc.map(exc => {
                        const cat = getCategoryFromLabel(exc.label);
                        const colors = exc.is_working
                          ? { bg: "#E4F3EC", border: "#BFE3CE", text: "#1F8A5B" }
                          : CATEGORY_COLOR[cat];
                        return (
                          <div key={exc.id} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "5px 8px", borderRadius: 7,
                            background: colors.bg, border: `1px solid ${colors.border}`,
                          }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: colors.text, flexShrink: 0 }}>
                              {exc.is_working ? "✅" : "🚫"}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#5B6770", flexShrink: 0 }}>
                              {fmtDateLabel(exc.date)}
                            </span>
                            <span style={{ flex: 1, fontSize: 11.5, color: colors.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                        );
                      })}
                    </div>
                  )}

                  {/* Add exception form */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 8, background: "#FAFAFA", border: "1px solid #F0F1EF" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#6B7580", letterSpacing: "0.06em", textTransform: "uppercase" }}>Agregar excepción</div>
                    <input
                      type="date" value={excDate} onChange={e => setExcDate(e.target.value)}
                      style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329" }}
                    />
                    <select
                      value={excCategory} onChange={e => setExcCategory(e.target.value as ExceptionCategory)}
                      style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329", background: "#fff" }}
                    >
                      {EXCEPTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                      type="text" placeholder="Etiqueta personalizada (opcional)"
                      value={excLabel} onChange={e => setExcLabel(e.target.value)}
                      style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, color: "#1A2329" }}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#5B6770" }}>
                      <input type="checkbox" checked={excIsWorking} onChange={e => setExcIsWorking(e.target.checked)} style={{ accentColor: "#FF6B35" }} />
                      Día laborable especial (ej: recupero)
                    </label>
                    <button
                      onClick={handleAddException} disabled={!excDate || excAdding}
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
