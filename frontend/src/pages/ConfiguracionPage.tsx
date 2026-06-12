import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { usePermission } from "../hooks/usePermission";
import {
  Bell,
  Building2,
  Calendar,
  Crown,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Server,
  Trash2,
  Truck,
  Users,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import socket from "../lib/socket";
import {
  fetchSettings,
  fetchSystemHealth,
  patchSettings,
  simulateOverdue,
  testWhatsApp,
  type SystemHealth,
  type SystemSettings,
} from "../api/settings";
import { fetchObras } from "../api/obras";
import {
  fetchCalendar,
  updateCalendar,
  addException,
  deleteException,
  loadHolidays,
  type WorkingCalendar,
  type CalendarException,
} from "../api/calendar";
import { fetchPlanUsage } from "../api/admin";
import {
  fetchSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from "../api/suppliers";
import type { Obra, PlanUsage, Supplier } from "../types";
import { Button } from "../components/ui/Button";

// ─── Shared style tokens ──────────────────────────────────────────────────────

const C = {
  good: "#1F8A5B", good50: "#E4F3EC", goodBorder: "#BFE3CE",
  warn: "#C97D0E", warn50: "#FDF1DE",
  danger: "#D03A3A", danger50: "#FCE5E5",
  info: "#2A6FDB", info50: "#E5EEFB",
  secondary: "#FF6B35", secondary50: "#FFF1E9",
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", lineStrong: "#D5D7D3",
  bg: "#F4F5F4", surface: "#fff",
  primary: "#2F3A40",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Switch({ checked, onChange, disabled = false }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        position: "relative", width: 38, height: 22, borderRadius: 99,
        background: checked ? C.good : "#D5D7D3",
        border: "none", cursor: disabled ? "default" : "pointer",
        transition: ".18s", flexShrink: 0, opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 18 : 2,
        width: 18, height: 18, borderRadius: 99, background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04)",
        transition: ".18s", display: "block",
      }} />
    </button>
  );
}

function Card({ children, style, id }: { children: React.ReactNode; style?: CSSProperties; id?: string }) {
  return (
    <div id={id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "20px 22px", ...style }}>
      {children}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange, disabled = false, icon, iconStyle, first = false }: {
  label: string; description?: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
  icon?: React.ReactNode; iconStyle?: CSSProperties; first?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderTop: first ? "none" : `1px solid ${C.line}`, paddingTop: first ? 0 : 14 }}>
      {icon && (
        <div style={{ width: 32, height: 32, borderRadius: 9, background: "#F4F5F4", color: C.text2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...iconStyle }}>
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 style={{ margin: "0 0 3px", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14, color: C.text, letterSpacing: "-0.01em" }}>{label}</h4>
        {description && <p style={{ margin: 0, fontSize: 12.5, color: C.text2, lineHeight: 1.45 }}>{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function AutoRow({ label, kbd, checked, onChange, disabled = false, icon, first = false }: {
  label: string; kbd: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
  icon: React.ReactNode; first?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: first ? "none" : `1px solid ${C.line}`, paddingTop: first ? 2 : 11 }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: checked ? C.secondary50 : "#F4F5F4", color: checked ? C.secondary : C.text2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <h4 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 13.5, color: C.text }}>{label}</h4>
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, padding: "2px 7px", borderRadius: 5, background: "#F4F5F4", color: C.text2, border: `1px solid ${C.line}` }}>{kbd}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function FieldRow({ label, value, onChange, type = "text", placeholder, icon, hint, required }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; icon?: React.ReactNode; hint?: string; required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: C.text2, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
        {label} {required && <span style={{ color: C.secondary }}>*</span>}
      </label>
      <div style={{ position: "relative" }}>
        {icon && (
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.text3, pointerEvents: "none", display: "flex" }}>
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            height: 38, padding: `0 12px`, paddingLeft: icon ? 34 : 12,
            border: `1px solid ${focused ? C.secondary : C.line}`,
            boxShadow: focused ? "0 0 0 4px rgba(255,107,53,0.10)" : "none",
            background: C.surface, borderRadius: 9, color: C.text,
            fontSize: 13.5, width: "100%", outline: "none", transition: ".15s",
          }}
        />
      </div>
      {hint && <div style={{ fontSize: 11.5, color: C.text3 }}>{hint}</div>}
    </div>
  );
}

function SelectRow({ label, value, onChange, children }: {
  label: string; value: number | string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: C.text2, textTransform: "uppercase" }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          height: 38, padding: "0 34px 0 12px", border: `1px solid ${C.line}`,
          background: C.surface, borderRadius: 9, color: C.text, fontSize: 13.5,
          width: "100%", outline: "none", appearance: "none", WebkitAppearance: "none",
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none'><path d='M4 6l4 4 4-4' stroke='%238E97A0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
          backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
          cursor: "pointer",
        }}
      >
        {children}
      </select>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: SystemSettings = {
  chatbot_enabled: true,
  send_hour_from: 8,
  send_hour_to: 20,
  max_response_hours: 24,
  auto_reminders: true,
  reminder_3days: true,
  reminder_1day: true,
  alert_overdue: true,
  alert_no_response: true,
  retry_failed: true,
  notify_task_overdue: true,
  notify_task_blocked: true,
  notify_no_response: true,
  notify_rescheduled: true,
  company_name: null,
  main_responsible: null,
  company_email: null,
  company_phone: null,
};

type StatusLevel = "ok" | "warning" | "error";

const STATUS_COLORS: Record<StatusLevel, { border: string; iconBg: string; iconColor: string; checkBg: string; checkGlow: string }> = {
  ok:      { border: C.good,   iconBg: C.good50,   iconColor: C.good,   checkBg: C.good,   checkGlow: C.good50 },
  warning: { border: C.warn,   iconBg: C.warn50,   iconColor: C.warn,   checkBg: C.warn,   checkGlow: C.warn50 },
  error:   { border: C.danger, iconBg: C.danger50, iconColor: C.danger, checkBg: C.danger, checkGlow: C.danger50 },
};


// ─── Calendar Section ─────────────────────────────────────────────────────────

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function CalendarSection({ canEdit }: { canEdit: boolean }) {
  const [obras, setObras] = useState<Obra[]>([]);
  const [selectedObraId, setSelectedObraId] = useState<number | null>(null);
  const [calendar, setCalendar] = useState<WorkingCalendar | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newExcDate, setNewExcDate] = useState("");
  const [newExcLabel, setNewExcLabel] = useState("");
  const [newExcIsWorking, setNewExcIsWorking] = useState(false);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [holidayMsg, setHolidayMsg] = useState<string | null>(null);
  const [excAdding, setExcAdding] = useState(false);

  useEffect(() => {
    fetchObras().then((list) => {
      setObras(list);
      if (list.length > 0) setSelectedObraId(list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedObraId) return;
    setCalLoading(true);
    setCalendar(null);
    fetchCalendar(selectedObraId)
      .then(setCalendar)
      .catch(() => {})
      .finally(() => setCalLoading(false));
  }, [selectedObraId]);

  async function toggleDay(bit: number) {
    if (!calendar || !selectedObraId || !canEdit) return;
    const next = calendar.working_days ^ (1 << bit);
    setSaving(true);
    try {
      const updated = await updateCalendar(selectedObraId, { working_days: next });
      setCalendar(updated);
    } finally { setSaving(false); }
  }

  async function updateHours(field: "hour_from" | "hour_to", value: number) {
    if (!calendar || !selectedObraId || !canEdit) return;
    setSaving(true);
    try {
      const updated = await updateCalendar(selectedObraId, { [field]: value });
      setCalendar(updated);
    } finally { setSaving(false); }
  }

  async function handleAddException() {
    if (!newExcDate || !selectedObraId) return;
    setExcAdding(true);
    try {
      const exc = await addException(selectedObraId, newExcDate, newExcIsWorking, newExcLabel || null);
      setCalendar((c) => c ? { ...c, exceptions: [...c.exceptions.filter(e => e.date !== exc.date), exc] } : c);
      setNewExcDate(""); setNewExcLabel(""); setNewExcIsWorking(false);
    } finally { setExcAdding(false); }
  }

  async function handleDeleteException(exc: CalendarException) {
    if (!selectedObraId) return;
    await deleteException(selectedObraId, exc.id);
    setCalendar((c) => c ? { ...c, exceptions: c.exceptions.filter(e => e.id !== exc.id) } : c);
  }

  async function handleLoadHolidays() {
    if (!selectedObraId) return;
    setHolidayLoading(true);
    setHolidayMsg(null);
    try {
      const res = await loadHolidays(selectedObraId, 2026);
      setHolidayMsg(`✓ ${res.added} feriados agregados${res.skipped > 0 ? `, ${res.skipped} ya existían` : ""}`);
      const updated = await fetchCalendar(selectedObraId);
      setCalendar(updated);
    } catch { setHolidayMsg("Error al cargar feriados."); }
    finally { setHolidayLoading(false); }
  }

  const sortedExceptions = [...(calendar?.exceptions ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: "#FFF0E8", border: "1px solid #F5D5C0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Calendar size={15} color="#E76A2D" />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.015em" }}>Calendario laboral</h3>
          <p style={{ margin: 0, fontSize: 12, color: C.text2 }}>Días y horarios hábiles por obra — bloquea tareas y mensajes en días no laborables</p>
        </div>
      </div>

      {/* Obra selector */}
      {obras.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <SelectRow label="Obra" value={selectedObraId ?? ""} onChange={(v) => setSelectedObraId(Number(v))}>
            {obras.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </SelectRow>
        </div>
      )}

      {calLoading && <p style={{ fontSize: 13, color: C.text3 }}>Cargando calendario…</p>}

      {calendar && (
        <>
          {/* Days */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text2 }}>Días hábiles</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
              {DAY_LABELS.map((label, i) => {
                const active = !!(calendar.working_days & (1 << i));
                return (
                  <button
                    key={label}
                    onClick={() => toggleDay(i)}
                    disabled={saving || !canEdit}
                    style={{
                      padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                      border: `1.5px solid ${active ? "#FF6B35" : C.line}`,
                      background: active ? "#FFF1E9" : C.surface,
                      color: active ? "#E85A26" : C.text2,
                      cursor: canEdit ? "pointer" : "default",
                      transition: "all 0.12s",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hours */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <SelectRow label="Hora de inicio" value={calendar.hour_from} onChange={(v) => updateHours("hour_from", Number(v))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </SelectRow>
            <SelectRow label="Hora de fin" value={calendar.hour_to} onChange={(v) => updateHours("hour_to", Number(v))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </SelectRow>
          </div>

          {/* Holidays button */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "12px 14px", background: "#F8F9F8", borderRadius: 10, border: `1px solid ${C.line}` }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: C.text }}>Feriados nacionales 2026</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.text2 }}>Carga automáticamente los feriados nacionales argentinos</p>
              {holidayMsg && <p style={{ margin: "4px 0 0", fontSize: 12, color: holidayMsg.startsWith("✓") ? C.good : C.danger, fontWeight: 600 }}>{holidayMsg}</p>}
            </div>
            <button
              onClick={handleLoadHolidays}
              disabled={holidayLoading || !canEdit}
              style={{
                padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.line}`,
                fontSize: 12.5, fontWeight: 600, color: C.text,
                background: C.surface, cursor: canEdit ? "pointer" : "default",
                opacity: holidayLoading ? 0.6 : 1, whiteSpace: "nowrap" as const,
              }}
            >
              {holidayLoading ? "Cargando…" : "Cargar feriados"}
            </button>
          </div>

          {/* Add exception */}
          {canEdit && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text2 }}>Agregar excepción</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "flex-end" }}>
                <input
                  type="date"
                  value={newExcDate}
                  onChange={e => setNewExcDate(e.target.value)}
                  style={{ height: 36, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13, color: C.text, background: C.surface, outline: "none" }}
                />
                <input
                  type="text"
                  value={newExcLabel}
                  onChange={e => setNewExcLabel(e.target.value)}
                  placeholder="Etiqueta (ej: Paro gremial)"
                  style={{ height: 36, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13, color: C.text, background: C.surface, outline: "none", flex: 1, minWidth: 160 }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, height: 36 }}>
                  <input
                    type="checkbox"
                    id="exc-is-working"
                    checked={newExcIsWorking}
                    onChange={e => setNewExcIsWorking(e.target.checked)}
                  />
                  <label htmlFor="exc-is-working" style={{ fontSize: 12.5, color: C.text2, cursor: "pointer", whiteSpace: "nowrap" as const }}>Día laboral especial</label>
                </div>
                <button
                  onClick={handleAddException}
                  disabled={!newExcDate || excAdding}
                  style={{
                    height: 36, padding: "0 14px", borderRadius: 8, border: "none",
                    fontSize: 13, fontWeight: 600, color: "#fff",
                    background: !newExcDate ? C.line : "#FF6B35",
                    cursor: !newExcDate ? "default" : "pointer",
                  }}
                >
                  {excAdding ? "Agregando…" : "Agregar"}
                </button>
              </div>
            </div>
          )}

          {/* Exceptions list */}
          {sortedExceptions.length > 0 && (
            <div>
              <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text2 }}>Excepciones ({sortedExceptions.length})</p>
              <div style={{ borderRadius: 10, border: `1px solid ${C.line}`, overflow: "hidden" }}>
                {sortedExceptions.map((exc, i) => {
                  const [y, m, d] = exc.date.split("-");
                  return (
                    <div key={exc.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 14px",
                      borderBottom: i < sortedExceptions.length - 1 ? `1px solid ${C.line}` : "none",
                      background: i % 2 === 0 ? C.surface : "#FAFAFA",
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
                        background: exc.is_working ? "#E4F3EC" : "#FCE5E5",
                        color: exc.is_working ? "#136E47" : "#D03A3A",
                        flexShrink: 0,
                      }}>
                        {exc.is_working ? "✅ Hábil" : "🚫 No laboral"}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flexShrink: 0 }}>
                        {d}/{m}/{y}
                      </span>
                      <span style={{ fontSize: 12.5, color: C.text2, flex: 1 }}>{exc.label ?? ""}</span>
                      {canEdit && (
                        <button
                          onClick={() => handleDeleteException(exc)}
                          style={{
                            width: 26, height: 26, borderRadius: 6, border: `1px solid ${C.line}`,
                            background: C.surface, color: C.text3, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}
                          title="Eliminar excepción"
                        >
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Plan usage bar ───────────────────────────────────────────────────────────

function PlanUsageBar({ icon, label, current, limit, note }: {
  icon: React.ReactNode;
  label: string;
  current: number;
  limit: number | null;
  note?: string;
}) {
  const pct = limit ? Math.min((current / limit) * 100, 100) : 0;
  const isNearLimit = limit !== null && current / limit >= 0.8;
  const isAtLimit   = limit !== null && current >= limit;
  const barColor = isAtLimit ? C.danger : isNearLimit ? C.warn : C.good;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500, color: C.text }}>
          <span style={{ color: C.text2 }}>{icon}</span>
          {label}
          {note && <span style={{ fontSize: 11, color: C.text3 }}>({note})</span>}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: isAtLimit ? C.danger : C.text2 }}>
          {current}{limit !== null ? ` / ${limit}` : ""}
          {limit === null && <span style={{ fontWeight: 400, color: C.text3 }}> ilimitado</span>}
        </span>
      </div>
      {limit !== null && (
        <div style={{ height: 6, borderRadius: 99, background: C.bg, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: barColor, transition: "width .3s" }} />
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────




export function ConfiguracionPage() {
  const canEdit   = usePermission("configuracion.edit");
  const [form, setForm]               = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [health, setHealth]           = useState<SystemHealth | null>(null);
  const [wsConnected, setWsConnected] = useState(socket.connected);
  const [lastSync, setLastSync]       = useState<Date | null>(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saveOk, setSaveOk]           = useState(false);
  const [dirty, setDirty]             = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const savedFormRef = useRef<SystemSettings>(DEFAULT_SETTINGS);

  const [testPhone, setTestPhone]     = useState("");
  const [testResult, setTestResult]   = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [simResult, setSimResult]     = useState<string | null>(null);
  const [simLoading, setSimLoading]   = useState(false);

  const [planUsage, setPlanUsage]     = useState<PlanUsage | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // ── Proveedores ──────────────────────────────────────────────────────────────
  const [suppliers, setSuppliers]           = useState<Supplier[]>([]);
  const [suppLoading, setSuppLoading]       = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier]   = useState<Supplier | null>(null);
  const [suppForm, setSuppForm]             = useState({ name: "", email: "", phone: "", category: "", notes: "" });
  const [suppSaving, setSuppSaving]         = useState(false);
  const [suppError, setSuppError]           = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    setSuppLoading(true);
    fetchSuppliers()
      .then(setSuppliers)
      .catch(() => {})
      .finally(() => setSuppLoading(false));
  }, [canEdit]);

  function openNewSupplier() {
    setEditingSupplier(null);
    setSuppForm({ name: "", email: "", phone: "", category: "", notes: "" });
    setSuppError(null);
    setShowSupplierForm(true);
  }

  function openEditSupplier(s: Supplier) {
    setEditingSupplier(s);
    setSuppForm({ name: s.name, email: s.email ?? "", phone: s.phone ?? "", category: s.category ?? "", notes: s.notes ?? "" });
    setSuppError(null);
    setShowSupplierForm(true);
  }

  async function handleSaveSupplier() {
    if (!suppForm.name.trim()) { setSuppError("El nombre es obligatorio."); return; }
    setSuppSaving(true);
    setSuppError(null);
    try {
      if (editingSupplier) {
        const updated = await updateSupplier(editingSupplier.id, {
          name: suppForm.name.trim(),
          email: suppForm.email.trim() || null,
          phone: suppForm.phone.trim() || null,
          category: suppForm.category.trim() || null,
          notes: suppForm.notes.trim() || null,
        });
        setSuppliers(prev => prev.map(s => s.id === updated.id ? updated : s));
      } else {
        const created = await createSupplier({
          name: suppForm.name.trim(),
          email: suppForm.email.trim() || null,
          phone: suppForm.phone.trim() || null,
          category: suppForm.category.trim() || null,
          notes: suppForm.notes.trim() || null,
        });
        setSuppliers(prev => [...prev, created]);
      }
      setShowSupplierForm(false);
    } catch { setSuppError("No se pudo guardar. Intentá nuevamente."); }
    finally { setSuppSaving(false); }
  }

  async function handleDeleteSupplier(id: number) {
    await deleteSupplier(id);
    setSuppliers(prev => prev.filter(s => s.id !== id));
  }

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const h = await fetchSystemHealth();
      setHealth(h);
      setLastSync(new Date());
    } catch { /* silent */ } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [s] = await Promise.all([fetchSettings(), loadHealth()]);
        setForm(s);
        savedFormRef.current = s;
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    })();
  }, [loadHealth]);

  useEffect(() => {
    if (!canEdit) return;
    fetchPlanUsage().then(setPlanUsage).catch(() => {});
  }, [canEdit]);

  useEffect(() => {
    function onConnect()    { setWsConnected(true);  setLastSync(new Date()); }
    function onDisconnect() { setWsConnected(false); }
    socket.on("connect",    onConnect);
    socket.on("disconnect", onDisconnect);
    if (!socket.connected) socket.connect(); else setWsConnected(true);
    return () => { socket.off("connect", onConnect); socket.off("disconnect", onDisconnect); };
  }, []);

  function set<K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaveOk(false);
  }

  function handleDiscard() {
    setForm(savedFormRef.current);
    setDirty(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await patchSettings(form);
      setForm(saved);
      savedFormRef.current = saved;
      setDirty(false);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }

  async function handleTestWhatsApp() {
    if (!testPhone.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await testWhatsApp(testPhone.trim());
      setTestResult(res.success ? "Mensaje enviado correctamente." : (res.detail ?? "Error al enviar."));
    } catch {
      setTestResult("Error al conectar con el servidor.");
    } finally {
      setTestLoading(false);
    }
  }

  async function handleSimulateOverdue() {
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await simulateOverdue();
      setSimResult(res.alerts_created > 0
        ? `Se crearon ${res.alerts_created} alerta${res.alerts_created > 1 ? "s" : ""} de tareas vencidas.`
        : "No hay tareas vencidas en este momento.");
    } catch {
      setSimResult("Error al ejecutar la simulación.");
    } finally {
      setSimLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "96px 0", color: C.text3, fontSize: 14 }}>
        Cargando configuración…
      </div>
    );
  }

  // ── Derived status levels ──────────────────────────────────────────────────
  const wsLevel: StatusLevel      = wsConnected ? "ok" : "error";
  const backendLevel: StatusLevel = health?.backend ? "ok" : "error";
  const dbLevel: StatusLevel      = health?.database ? "ok" : "error";
  const waLevel: StatusLevel      = health?.whatsapp_configured ? "ok" : "warning";
  const allOk = wsLevel === "ok" && backendLevel === "ok" && dbLevel === "ok";

  const btnGhost: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "9px 14px", borderRadius: 10,
    fontSize: 13, fontWeight: 500, cursor: "pointer",
    background: C.surface, border: `1px solid ${C.line}`, color: C.text,
    transition: ".15s",
  };
  const btnPrimary: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "9px 14px", borderRadius: 10,
    fontSize: 13, fontWeight: 500, cursor: "pointer",
    background: C.secondary, color: "#fff", border: "none",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.55)",
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes ping-green {
          0%  { box-shadow: 0 0 0 0 rgba(31,138,91,0.45); }
          70% { box-shadow: 0 0 0 8px rgba(31,138,91,0); }
          100%{ box-shadow: 0 0 0 0 rgba(31,138,91,0); }
        }
        @keyframes ping-orange {
          0%  { box-shadow: 0 0 0 0 rgba(255,107,53,0.6); }
          70% { box-shadow: 0 0 0 8px rgba(255,107,53,0); }
          100%{ box-shadow: 0 0 0 0 rgba(255,107,53,0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 28, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.025em" }}>
            Configuración
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, fontSize: 13.5, color: C.text2 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 99, flexShrink: 0,
              background: allOk ? C.good : C.warn,
              boxShadow: allOk ? `0 0 0 3px rgba(31,138,91,0.18)` : `0 0 0 3px rgba(201,125,14,0.18)`,
            }} />
            <span>
              {allOk ? "Todos los servicios operativos" : "Algunos servicios necesitan atención"}
              {lastSync && (
                <> · última verificación <b style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: C.text }}>
                  {lastSync.toLocaleTimeString("es-AR")}
                </b></>
              )}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={loadHealth} disabled={healthLoading} style={{ ...btnGhost, opacity: healthLoading ? 0.6 : 1 }}>
            <RefreshCw size={13} style={{ animation: healthLoading ? "spin 1s linear infinite" : "none" }} />
            Verificar ahora
          </button>
          <button onClick={handleSave} disabled={saving || !dirty || !canEdit} style={{ ...btnPrimary, opacity: saving || !dirty || !canEdit ? 0.6 : 1 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 3.5C3 2.9 3.4 2.5 4 2.5h7l2 2v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-9z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9h6v4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/></svg>
            {saving ? "Guardando…" : saveOk ? "¡Guardado!" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {/* ── Índice de secciones (sticky) ── */}
      <nav
        aria-label="Secciones de configuración"
        style={{
          position: "sticky", top: 56, zIndex: 20,
          display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center",
          overflowX: "auto", scrollbarWidth: "none",
          padding: "10px 0 12px", marginBottom: 18,
          background: C.bg, borderBottom: `1px solid ${C.line}`,
        }}
      >
        {([
          { id: "cfg-estado", label: "Estado" },
          { id: "cfg-datos", label: "Datos generales" },
          { id: "cfg-whatsapp", label: "WhatsApp" },
          { id: "cfg-auto", label: "Automatizaciones" },
          { id: "cfg-tiempo", label: "Tiempo real" },
          { id: "cfg-testing", label: "Testing" },
          ...(canEdit && planUsage ? [{ id: "cfg-plan", label: "Tu plan" }] : []),
          ...(canEdit ? [{ id: "cfg-proveedores", label: "Proveedores" }] : []),
          { id: "cfg-calendario", label: "Calendario" },
        ]).map(s => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.lineStrong; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.text2; e.currentTarget.style.borderColor = C.line; }}
            style={{
              border: `1px solid ${C.line}`, background: C.surface, color: C.text2,
              borderRadius: 99, padding: "5px 12px", fontSize: 12.5, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif",
              flexShrink: 0, whiteSpace: "nowrap",
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

          {/* ═══ ESTADO DEL SISTEMA ═══ */}
          <div id="cfg-estado" style={{ scrollMarginTop: 112, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                  border: "1px solid #F5D5C0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Server size={15} color="#E76A2D" />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.015em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Estado del sistema
                </span>
                <span style={{ fontSize: 12, color: C.text3, marginLeft: 4 }}>
                  {lastSync ? <>Última verificación · <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.text2 }}>{lastSync.toLocaleTimeString("es-AR")}</span></> : "Sin verificar"}
                </span>
              </div>
              <button
                onClick={loadHealth}
                disabled={healthLoading}
                style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface, color: C.text2, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <RefreshCw size={13} style={{ animation: healthLoading ? "spin 1s linear infinite" : "none" }} />
              </button>
            </div>
            <div style={{ padding: "16px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {[
              { icon: <Server size={15} />, label: "Backend",        meta: `API online`,            footer: ["latencia", health?.backend ? "OK" : "—"],    level: backendLevel },
              { icon: <Wifi size={15} />,   label: "WebSocket",      meta: wsConnected ? "Canal en vivo conectado" : "Desconectado", footer: ["estado", wsConnected ? "activo" : "inactivo"], level: wsLevel },
              { icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="4" rx="5.2" ry="1.8" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2.8 4v8c0 1 2.3 1.8 5.2 1.8s5.2-.8 5.2-1.8V4M2.8 8c0 1 2.3 1.8 5.2 1.8s5.2-.8 5.2-1.8" stroke="currentColor" strokeWidth="1.4" fill="none"/></svg>, label: "Base de datos", meta: "PostgreSQL online",    footer: ["estado", health?.database ? "online" : "error"], level: dbLevel },
              { icon: <MessageCircle size={15} />, label: "WhatsApp", meta: health?.whatsapp_number ?? "Sin configurar", footer: ["número", health?.whatsapp_configured ? "activo" : "—"], level: waLevel },
            ].map(({ icon, label, meta, footer, level }) => {
              const sc = STATUS_COLORS[level];
              return (
                <div key={label} style={{
                  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
                  padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
                  position: "relative", overflow: "hidden",
                }}>
                  <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: sc.border }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: sc.iconBg, color: sc.iconColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {icon}
                    </span>
                    <span style={{ width: 20, height: 20, borderRadius: 99, background: sc.checkBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 0 3px ${sc.checkGlow}` }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14.5, color: C.text }}>{label}</div>
                    <div style={{ fontSize: 11.5, color: C.text2, marginTop: 1, fontFamily: label === "WhatsApp" ? "'JetBrains Mono', monospace" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, fontSize: 10.5, color: C.text3, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
                    <span>{footer[0]}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.text2 }}>{footer[1]}</span>
                  </div>
                </div>
              );
            })}
          </div>
            </div>
          </div>

{/* ═══ DATOS GENERALES ═══ */}
          <div id="cfg-datos" style={{ scrollMarginTop: 112, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                  border: "1px solid #F5D5C0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Building2 size={15} color="#E76A2D" />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.015em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Datos generales
                </span>
                <span style={{ fontSize: 12, color: C.text3, marginLeft: 4 }}>Información de la empresa en avisos y reportes</span>
              </div>
            </div>
            <div style={{ padding: "20px 22px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px" }}>
                <FieldRow
                  label="Nombre de la empresa" required
                  value={form.company_name ?? ""}
                  onChange={v => set("company_name", v || null)}
                  placeholder="Constructora XYZ"
                  icon={<Building2 size={14} />}
                />
                <FieldRow
                  label="Responsable principal" required
                  value={form.main_responsible ?? ""}
                  onChange={v => set("main_responsible", v || null)}
                  placeholder="Juan García"
                  icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M3 13.5c.6-2.3 2.6-3.8 5-3.8s4.4 1.5 5 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
                />
                <FieldRow
                  label="Email de contacto"
                  value={form.company_email ?? ""}
                  onChange={v => set("company_email", v || null)}
                  type="email"
                  placeholder="contacto@empresa.com"
                  icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="9" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2.5 5.5L8 9l5.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
                  hint="Usado para reportes semanales y alertas críticas."
                />
                <FieldRow
                  label="Teléfono"
                  value={form.company_phone ?? ""}
                  onChange={v => set("company_phone", v || null)}
                  placeholder="+54 9 11 1234-5678"
                  icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4c0-.8.6-1.5 1.4-1.5h1.4c.6 0 1.1.4 1.3 1l.4 1.5c.1.5-.1 1-.5 1.3l-.7.5c.9 1.8 2.4 3.3 4.2 4.2l.5-.7c.3-.4.8-.6 1.3-.5l1.5.4c.6.2 1 .7 1 1.3v1.4c0 .8-.7 1.4-1.5 1.4C7 13.3 2.7 9 3 4z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/></svg>}
                />
              </div>
            </div>
          </div>

          {/* ═══ CHATBOT WHATSAPP ═══ */}
          <div id="cfg-whatsapp" style={{ scrollMarginTop: 112, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                  border: "1px solid #F5D5C0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <MessageCircle size={15} color="#E76A2D" />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.015em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Chatbot WhatsApp
                </span>
                <span style={{ fontSize: 12, color: C.text3, marginLeft: 4 }}>Procesamiento automático de mensajes</span>
              </div>
            </div>
            <div style={{ padding: "20px 22px" }}>
              {/* WhatsApp banner */}
              {health?.whatsapp_configured ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "linear-gradient(180deg, #ECF7F1, #E4F3EC)",
                  border: `1px solid ${C.goodBorder}`,
                  borderRadius: 11, padding: "12px 14px", marginBottom: 18,
                }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "#fff", color: C.good, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 0 1px ${C.goodBorder}`, flexShrink: 0 }}>
                    <MessageCircle size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#0E5A37", fontWeight: 500 }}>
                      Número conectado
                      {health.whatsapp_number && (
                        <b style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#0E5A37", background: "#fff", padding: "1px 7px", borderRadius: 5, marginLeft: 6, boxShadow: `0 0 0 1px ${C.goodBorder}` }}>
                          {health.whatsapp_number}
                        </b>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.good, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: C.good, flexShrink: 0, animation: "ping-green 1.8s ease-out infinite" }} />
                      Recibiendo y enviando mensajes correctamente
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button style={{ padding: "6px 11px", fontSize: 12, borderRadius: 8, background: "#fff", border: `1px solid ${C.goodBorder}`, color: "#0E5A37", cursor: "pointer" }}>Reconectar</button>
                    <button style={{ padding: "6px 11px", fontSize: 12, borderRadius: 8, background: "#fff", border: `1px solid ${C.goodBorder}`, color: "#0E5A37", cursor: "pointer" }}>Ver registros</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.warn50, border: `1px solid #F0D5A0`, borderRadius: 11, padding: "12px 14px", marginBottom: 18 }}>
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: C.warn, flexShrink: 0 }}><path d="M8 2.5L14 13H2L8 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/><path d="M8 6.5V9.5M8 11.4v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  <span style={{ fontSize: 12.5, color: "#9A5D08", fontWeight: 500 }}>WhatsApp no configurado. Completá las variables TWILIO_* en el servidor.</span>
                </div>
              )}

              <ToggleRow first
                label="Chatbot habilitado"
                description="Activa o desactiva el procesamiento de mensajes entrantes desde WhatsApp."
                checked={form.chatbot_enabled}
                onChange={v => set("chatbot_enabled", v)}
                icon={<MessageCircle size={15} />}
              />
              <ToggleRow
                label="Recordatorios automáticos"
                description="Envía recordatorios proactivos a los responsables antes del vencimiento de sus tareas."
                checked={form.auto_reminders}
                onChange={v => set("auto_reminders", v)}
                disabled={!form.chatbot_enabled}
                icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
              />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, paddingTop: 16, marginTop: 8, borderTop: `1px solid ${C.line}` }}>
                <SelectRow label="Horario desde" value={form.send_hour_from} onChange={v => set("send_hour_from", Number(v))}>
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
                </SelectRow>
                <SelectRow label="Horario hasta" value={form.send_hour_to} onChange={v => set("send_hour_to", Number(v))}>
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
                </SelectRow>
                <SelectRow label="Tiempo máx. sin respuesta" value={form.max_response_hours} onChange={v => set("max_response_hours", Number(v))}>
                  {[6, 12, 24, 48, 72].map(h => <option key={h} value={h}>{h} horas</option>)}
                </SelectRow>
              </div>
            </div>
          </div>

          {/* ═══ AUTOMATIZACIONES + ALERTAS (2-col) ═══ */}
          <div id="cfg-auto" style={{ scrollMarginTop: 112, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 28 }}>

            {/* Automatizaciones */}
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                    border: "1px solid #F5D5C0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Zap size={15} color="#E76A2D" />
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.015em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    Automatizaciones
                  </span>
                </div>
              </div>
              <div style={{ padding: "8px 22px 4px" }}>
                <AutoRow first label="Recordatorio 3 días antes" kbd="+3d"
                  checked={form.reminder_3days} onChange={v => set("reminder_3days", v)}
                  disabled={!form.auto_reminders}
                  icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
                />
                <AutoRow label="Recordatorio 1 día antes" kbd="+1d"
                  checked={form.reminder_1day} onChange={v => set("reminder_1day", v)}
                  disabled={!form.auto_reminders}
                  icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
                />
                <AutoRow label="Alertar tareas vencidas" kbd="−0d"
                  checked={form.alert_overdue} onChange={v => set("alert_overdue", v)}
                  icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2.5L14 13H2L8 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/><path d="M8 6.5V9.5M8 11.4v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>}
                />
                <AutoRow label="Alertar sin respuesta" kbd="24h"
                  checked={form.alert_no_response} onChange={v => set("alert_no_response", v)}
                  icon={<Bell size={13} />}
                />
                <AutoRow label="Reintentar envío fallido" kbd="×3"
                  checked={form.retry_failed} onChange={v => set("retry_failed", v)}
                  icon={<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 11-1.5-3.5L13 6M13 3v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
                />
              </div>
            </div>

            {/* Alertas */}
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                    border: "1px solid #F5D5C0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Bell size={15} color="#E76A2D" />
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.015em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    Configuración de alertas
                  </span>
                </div>
              </div>
              <div style={{ padding: "8px 22px 4px" }}>
                <ToggleRow first
                  label="Tarea vencida"
                  description="Mostrar alerta cuando una tarea pasa su fecha límite."
                  checked={form.notify_task_overdue} onChange={v => set("notify_task_overdue", v)}
                  icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2.5L14 13H2L8 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/><path d="M8 6.5V9.5M8 11.4v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>}
                  iconStyle={{ background: C.danger50, color: C.danger }}
                />
                <ToggleRow
                  label="Tarea demorada / bloqueada"
                  description="Mostrar alerta cuando se marca una tarea como demorada o bloqueada."
                  checked={form.notify_task_blocked} onChange={v => set("notify_task_blocked", v)}
                  icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
                  iconStyle={{ background: C.warn50, color: C.warn }}
                />
                <ToggleRow
                  label="Responsable sin respuesta"
                  description="Mostrar alerta si no hay respuesta tras el tiempo máximo configurado."
                  checked={form.notify_no_response} onChange={v => set("notify_no_response", v)}
                  icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M3 13.5c.6-2.3 2.6-3.8 5-3.8s4.4 1.5 5 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>}
                  iconStyle={{ background: C.info50, color: C.info }}
                />
                <ToggleRow
                  label="Fecha reprogramada"
                  description="Mostrar alerta cuando se reprograma una tarea vía WhatsApp."
                  checked={form.notify_rescheduled} onChange={v => set("notify_rescheduled", v)}
                  icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M5.5 2v3M10.5 2v3M2.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>}
                  iconStyle={{ background: C.secondary50, color: C.secondary }}
                />
              </div>
            </div>
          </div>

          {/* ═══ TIEMPO REAL ═══ */}
          <div id="cfg-tiempo" style={{ scrollMarginTop: 112, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
                  border: "1px solid #F5D5C0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Wifi size={15} color="#E76A2D" />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.015em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Tiempo real
                </span>
                <span style={{ fontSize: 12, color: C.text3, marginLeft: 4 }}>Sincronización en vivo</span>
              </div>
            </div>
            <div style={{ padding: "0 22px" }}>
            {[
              {
                icon: <Wifi size={16} />, iconStyle: { background: C.info50, color: C.info },
                title: "Estado WebSocket", sub: "Canal de actualización en tiempo real con el servidor.",
                status: wsConnected ? "Conectado" : "Desconectado", statusOk: wsConnected,
              },
              {
                icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6h6m4 4H7M9 4l-4 2 4 2M7 12l4-2-4-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
                iconStyle: { background: C.secondary50, color: C.secondary },
                title: "Actualización automática", sub: "El panel se actualiza cuando el chatbot modifica una tarea.",
                status: wsConnected ? "Habilitada" : "Inactiva", statusOk: wsConnected,
              },
            ].map(({ icon, iconStyle, title, sub, status, statusOk }, i) => (
              <div key={title} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...iconStyle }}>
                  {icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ margin: "0 0 2px", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14, color: C.text }}>{title}</h4>
                  <p style={{ margin: 0, fontSize: 12.5, color: C.text2 }}>{sub}</p>
                </div>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "5px 11px", borderRadius: 99, fontSize: 12, fontWeight: 600,
                  background: statusOk ? C.good50 : "#F4F5F4",
                  color: statusOk ? "#0E5A37" : C.text2,
                  border: `1px solid ${statusOk ? C.goodBorder : C.line}`,
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: statusOk ? C.good : C.text3, flexShrink: 0, animation: statusOk ? "ping-green 1.8s ease-out infinite" : "none" }} />
                  {status}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: "#F4F5F4", color: C.text2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: "0 0 2px", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14, color: C.text }}>Última sincronización</h4>
                <p style={{ margin: 0, fontSize: 12.5, color: C.text2 }}>Momento de la última lectura recibida desde el servidor.</p>
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: C.text, fontWeight: 500 }}>
                {lastSync ? lastSync.toLocaleTimeString("es-AR") : "—"}
              </span>
            </div>
            </div>
          </div>

          {/* ═══ HERRAMIENTAS DE TESTING ═══ */}
          <div id="cfg-testing" style={{ scrollMarginTop: 112, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>

            {/* Test WhatsApp */}
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: C.secondary50, color: C.secondary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Send size={14} />
                </div>
                <p style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14, color: C.text }}>Probar mensaje WhatsApp</p>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.text2 }}>
                Envía un mensaje de prueba al número indicado para verificar la integración con Twilio.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="tel"
                  value={testPhone}
                  onChange={e => { setTestPhone(e.target.value); setTestResult(null); }}
                  placeholder="+54 9 11 1234-5678"
                  style={{ flex: 1, minWidth: 0, height: 36, padding: "0 12px", border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 13, color: C.text, outline: "none", background: C.surface }}
                />
                <Button variant="primary" onClick={handleTestWhatsApp} disabled={testLoading || !testPhone.trim()} className="text-xs px-3 py-1.5 flex-shrink-0">
                  {testLoading ? "Enviando…" : "Enviar"}
                </Button>
              </div>
              {testResult && (
                <p style={{ margin: "8px 0 0", fontSize: 12, fontWeight: 500, color: testResult.includes("correctamente") ? C.good : C.danger }}>
                  {testResult}
                </p>
              )}
            </Card>

            {/* Simulate overdue */}
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: C.warn50, color: C.warn, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bell size={14} />
                </div>
                <p style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14, color: C.text }}>Simular tarea vencida</p>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 12.5, color: C.text2 }}>
                Fuerza la generación de alertas para todas las tareas que ya superaron su fecha de vencimiento.
              </p>
              <Button variant="warning" onClick={handleSimulateOverdue} disabled={simLoading} className="text-xs px-3 py-1.5 w-full">
                {simLoading ? "Procesando…" : "Ejecutar simulación"}
              </Button>
              {simResult && (
                <p style={{ margin: "8px 0 0", fontSize: 12, fontWeight: 500, color: C.text2 }}>{simResult}</p>
              )}
            </Card>
          </div>

          {/* ═══ TU PLAN ═══ */}
          {canEdit && planUsage && (
            <Card id="cfg-plan" style={{ marginTop: 8, scrollMarginTop: 112 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: "#FFF1E9", color: C.secondary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Crown size={15} />
                  </div>
                  <div>
                    <p style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, color: C.text }}>
                      Tu plan
                      <span style={{ marginLeft: 8, padding: "2px 9px", borderRadius: 99, background: C.secondary, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
                        {planUsage.tenant.plan?.name ?? "Sin plan"}
                      </span>
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: C.text2 }}>{planUsage.tenant.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  style={{ padding: "7px 14px", borderRadius: 9, background: C.secondary, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 10px -4px rgba(255,107,53,0.5)" }}
                >
                  Mejorar plan
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <PlanUsageBar
                  icon={<Building2 size={13} />}
                  label="Obras"
                  current={planUsage.obras_count}
                  limit={planUsage.obras_limit}
                />
                <PlanUsageBar
                  icon={<Users size={13} />}
                  label="Usuarios"
                  current={planUsage.users_count}
                  limit={planUsage.users_limit}
                />
                <PlanUsageBar
                  icon={<Zap size={13} />}
                  label="Tareas (por obra)"
                  current={planUsage.tasks_count}
                  limit={planUsage.tasks_per_obra_limit}
                  note="total de tareas en el sistema"
                />
              </div>
            </Card>
          )}

          {/* ═══ PROVEEDORES ═══ */}
          {canEdit && (
            <Card id="cfg-proveedores" style={{ marginTop: 8, scrollMarginTop: 112 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: "#FFF1E9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Truck size={16} style={{ color: C.secondary }} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>Proveedores</h3>
                    <p style={{ margin: 0, fontSize: 12, color: C.text2 }}>{suppliers.length} proveedor{suppliers.length !== 1 ? "es" : ""} registrado{suppliers.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <button
                  onClick={openNewSupplier}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600,
                    background: C.secondary, color: "#fff", border: "none", cursor: "pointer",
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}
                >
                  <Plus size={13} /> Agregar
                </button>
              </div>

              {suppLoading ? (
                <div style={{ textAlign: "center", padding: "20px 0", color: C.text3 }}>Cargando...</div>
              ) : suppliers.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.text3 }}>
                  <Truck size={28} style={{ opacity: 0.3, display: "block", margin: "0 auto 8px" }} />
                  <p style={{ margin: 0, fontSize: 13 }}>No hay proveedores registrados.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {suppliers.map((s, i) => (
                    <div key={s.id} style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "11px 0",
                      borderTop: i === 0 ? "none" : `1px solid ${C.line}`,
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: C.bg, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 700, color: C.text2,
                      }}>
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: C.text }}>{s.name}</p>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {s.category && <span style={{ fontSize: 11.5, color: C.text2 }}>{s.category}</span>}
                          {s.phone && <span style={{ fontSize: 11.5, color: C.text3 }}>{s.phone}</span>}
                          {s.email && <span style={{ fontSize: 11.5, color: C.text3 }}>{s.email}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => openEditSupplier(s)}
                          style={{ width: 30, height: 30, border: `1px solid ${C.line}`, borderRadius: 8, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.text2 }}
                          title="Editar"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteSupplier(s.id)}
                          style={{ width: 30, height: 30, border: `1px solid ${C.line}`, borderRadius: 8, background: C.surface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.text3 }}
                          title="Desactivar"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Supplier form modal ── */}
              {showSupplierForm && (
                <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.45)", backdropFilter: "blur(3px)" }}>
                  <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, padding: 28, boxShadow: "0 24px 48px -12px rgba(0,0,0,0.25)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
                        {editingSupplier ? "Editar proveedor" : "Nuevo proveedor"}
                      </h3>
                      <button onClick={() => setShowSupplierForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: C.text3, padding: 4 }}>
                        <X size={18} />
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {[
                        { key: "name", label: "Nombre *", placeholder: "Ej: Materiales del Sur" },
                        { key: "category", label: "Rubro", placeholder: "Ej: Hormigón, Electricidad" },
                        { key: "phone", label: "Teléfono", placeholder: "+54 9 11 1234-5678" },
                        { key: "email", label: "Email", placeholder: "contacto@proveedor.com" },
                        { key: "notes", label: "Notas", placeholder: "Información adicional..." },
                      ].map(({ key, label, placeholder }) => (
                        <div key={key}>
                          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text2, marginBottom: 5 }}>
                            {label}
                          </label>
                          <input
                            value={suppForm[key as keyof typeof suppForm]}
                            onChange={e => setSuppForm(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={placeholder}
                            style={{
                              width: "100%", boxSizing: "border-box", padding: "9px 12px",
                              fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif",
                              color: C.text, background: "#fff", border: `1px solid ${C.line}`,
                              borderRadius: 9, outline: "none",
                            }}
                            onFocus={e => { e.currentTarget.style.borderColor = C.secondary; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(255,107,53,0.10)"; }}
                            onBlur={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.boxShadow = "none"; }}
                          />
                        </div>
                      ))}
                    </div>
                    {suppError && (
                      <p style={{ marginTop: 10, fontSize: 12, color: C.danger }}>{suppError}</p>
                    )}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                      <button
                        onClick={() => setShowSupplierForm(false)}
                        style={{ padding: "8px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: "#fff", color: C.text2, fontSize: 13, cursor: "pointer" }}
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleSaveSupplier}
                        disabled={suppSaving}
                        style={{ padding: "8px 18px", borderRadius: 9, background: C.secondary, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: suppSaving ? 0.7 : 1 }}
                      >
                        {suppSaving ? "Guardando…" : editingSupplier ? "Guardar cambios" : "Crear proveedor"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ═══ CALENDARIO LABORAL ═══ */}
          <Card id="cfg-calendario" style={{ marginTop: 8, scrollMarginTop: 112 }}>
            <CalendarSection canEdit={canEdit} />
          </Card>

          {/* ═══ UPGRADE MODAL ═══ */}
          {showUpgradeModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
              onClick={() => setShowUpgradeModal(false)}>
              <div style={{ background: C.surface, borderRadius: 18, padding: "32px 28px", maxWidth: 500, width: "100%", boxShadow: "0 24px 56px -16px rgba(0,0,0,0.35)" }}
                onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FFF1E9", color: C.secondary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Crown size={20} />
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 700, color: C.text }}>Mejorar tu plan</h2>
                    <p style={{ margin: "2px 0 0", fontSize: 13, color: C.text2 }}>Desbloqueá más capacidad para tu empresa</p>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                  {[
                    { name: "Pro", price: "$99/mes", obras: "20 obras", users: "30 usuarios", tasks: "Tareas ilimitadas", highlight: true },
                    { name: "Enterprise", price: "A consultar", obras: "Obras ilimitadas", users: "Usuarios ilimitados", tasks: "Todo ilimitado", highlight: false },
                  ].map(p => (
                    <div key={p.name} style={{ border: `2px solid ${p.highlight ? C.secondary : C.line}`, borderRadius: 12, padding: "14px 16px", background: p.highlight ? "#FFF8F5" : C.surface }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 15, color: C.text }}>{p.name}</span>
                        <span style={{ fontWeight: 700, fontSize: 15, color: p.highlight ? C.secondary : C.text }}>{p.price}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[p.obras, p.users, p.tasks].map(f => (
                          <span key={f} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 99, background: p.highlight ? C.secondary50 : C.bg, color: p.highlight ? C.secondary : C.text2, fontWeight: 500 }}>{f}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setShowUpgradeModal(false)} style={{ padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.text2, fontSize: 13, cursor: "pointer" }}>
                    Ahora no
                  </button>
                  <a href="mailto:hola@constructa.app?subject=Quiero mejorar mi plan" style={{ padding: "9px 18px", borderRadius: 9, background: C.secondary, color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                    Contactar para upgrade
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ═══ SAVE BAR ═══ */}
          {dirty && canEdit && (
            <div style={{
              position: "sticky", bottom: 18, zIndex: 4, marginTop: 24,
              background: C.primary, color: "#fff", borderRadius: 14,
              padding: "11px 14px 11px 18px",
              display: "flex", alignItems: "center", gap: 14,
              boxShadow: "0 12px 28px -10px rgba(24,34,42,0.35)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: C.secondary, flexShrink: 0, animation: "ping-orange 1.6s ease-out infinite" }} />
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                <b style={{ color: "#fff" }}>Tenés cambios sin guardar</b>
                <span style={{ color: "#9BA3AB", fontWeight: 400, marginLeft: 6 }}>Campos de configuración modificados</span>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button onClick={handleDiscard} style={{ padding: "6px 11px", fontSize: 12, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "#fff", cursor: "pointer" }}>
                  Descartar
                </button>
                <button onClick={handleSave} disabled={saving} style={{ padding: "6px 11px", fontSize: 12, borderRadius: 8, background: C.secondary, border: "none", color: "#fff", cursor: "pointer", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 10px -4px rgba(255,107,53,0.55)", opacity: saving ? 0.7 : 1 }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ display: "inline", verticalAlign: "-1px", marginRight: 5 }}><path d="M3 3.5C3 2.9 3.4 2.5 4 2.5h7l2 2v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-9z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9h6v4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/></svg>
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>
          )}
    </>
  );
}
