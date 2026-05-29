import { useState, useRef, type ReactNode, type ChangeEvent, type KeyboardEvent } from "react";
import {
  X, Plus, Trash2, Pencil, AlertTriangle, CheckCircle2,
  ChevronLeft, ChevronRight, Loader2, Upload, ImageOff, Building2,
} from "lucide-react";
import { uploadImage } from "../api/upload";
import { createObra } from "../api/obras";
import { createResponsible } from "../api/responsibles";
import { createTask } from "../api/tasks";
import type { Obra } from "../types";

// ─── Local draft types ────────────────────────────────────────────────────────

interface ObraFormData {
  name: string; location: string; description: string;
  image_url: string; start_date: string; expected_end_date: string;
}
interface DraftResponsible {
  _key: string; full_name: string; whatsapp_number: string; role: string;
}
interface DraftTask {
  _key: string; title: string; description: string;
  responsible_key: string; start_date: string; due_date: string;
}
type RespForm = { full_name: string; whatsapp_number: string; role: string };
type TaskForm = { title: string; description: string; responsible_key: string; start_date: string; due_date: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const E164 = /^\+\d{7,15}$/;
let _seq = 0;
const uid = () => String(++_seq);

const STEPS = ["Datos básicos", "Responsables", "Tareas", "Confirmación"];
const STEP_ICONS = [
  <svg key="1" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 13.5V6l5-3.5 5 3.5v7.5h-10z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M6 13.5V10h3v3.5" stroke="currentColor" strokeWidth="1.4"/></svg>,
  <svg key="2" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2.5 13.5c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>,
  <svg key="3" width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  <svg key="4" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
];

function formatDate(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

const AVATAR_COLORS = ["#E76A2D", "#3A6BD9", "#1F9A5A", "#9A4DC9", "#D03A3A", "#E89B14"];
function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ─── Design helpers ────────────────────────────────────────────────────────────

const BASE_INPUT: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "9px 12px", fontSize: 13,
  fontFamily: "'Plus Jakarta Sans', sans-serif",
  color: "#1A2329", background: "#fff",
  border: "1px solid #E6E7E5", borderRadius: 10, outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

function iStyle(err = false): React.CSSProperties {
  return { ...BASE_INPUT, borderColor: err ? "#D03A3A" : "#E6E7E5", boxShadow: err ? "0 0 0 3px rgba(208,58,58,0.08)" : "none" };
}

function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>, err = false) {
  if (err) return;
  e.currentTarget.style.borderColor = "#FF6B35";
  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(255,107,53,0.10)";
}
function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>, err = false) {
  e.currentTarget.style.borderColor = err ? "#D03A3A" : "#E6E7E5";
  e.currentTarget.style.boxShadow = err ? "0 0 0 3px rgba(208,58,58,0.08)" : "none";
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────

function FieldLabel({ children, optional }: { children: ReactNode; optional?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {children}
      </span>
      {optional && <span style={{ fontSize: 10.5, color: "#ADAAA4", fontWeight: 400 }}>(opcional)</span>}
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p style={{ margin: "5px 0 0", fontSize: 11.5, color: "#D03A3A", display: "flex", alignItems: "center", gap: 5, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <AlertTriangle style={{ width: 11, height: 11 }} />{msg}
    </p>
  );
}

function InlineError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#FCE5E5", border: "1px solid #F0B0B0", borderRadius: 10, padding: "9px 12px" }}>
      <AlertTriangle style={{ width: 12, height: 12, color: "#D03A3A", flexShrink: 0, marginTop: 1 }} />
      <p style={{ margin: 0, fontSize: 12, color: "#D03A3A", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{msg}</p>
    </div>
  );
}

function PrimaryBtn({ children, onClick, disabled, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600,
        background: disabled ? "#F0A882" : "#FF6B35", color: "#fff",
        border: "none", cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        transition: "background 0.15s",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "#E85A26"; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = "#FF6B35"; }}
    >
      {children}
    </button>
  );
}

function SecondaryBtn({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
        background: "#fff", color: "#5B6770",
        border: "1px solid #E6E7E5", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = "#D5D7D3"; e.currentTarget.style.color = "#1A2329"; } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.borderColor = "#E6E7E5"; e.currentTarget.style.color = "#5B6770"; } }}
    >
      {children}
    </button>
  );
}

function SmallIconBtn({ children, onClick, title, danger }: { children: ReactNode; onClick: () => void; title?: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 30, height: 30, borderRadius: 8, border: "none",
        background: "transparent", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#8E97A0", transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = danger ? "#FCE5E5" : "#EAF1FB";
        e.currentTarget.style.color = danger ? "#D03A3A" : "#2A6FDB";
      }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
    >
      {children}
    </button>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 28 }}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={n} style={{ display: "flex", alignItems: "flex-start", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 99,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700,
                background: active ? "#FF6B35" : done ? "#1F8A5B" : "#F0F1EF",
                color: (active || done) ? "#fff" : "#8E97A0",
                border: `2px solid ${active ? "#FF6B35" : done ? "#1F8A5B" : "#E6E7E5"}`,
                boxShadow: active ? "0 4px 10px -4px rgba(255,107,53,0.5)" : "none",
                transition: "all 0.2s",
              }}>
                {done
                  ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{n}</span>
                }
              </div>
              <span style={{
                marginTop: 6, fontSize: 10.5, fontWeight: active ? 700 : 500,
                color: active ? "#FF6B35" : done ? "#1F8A5B" : "#8E97A0",
                textAlign: "center", lineHeight: 1.2, padding: "0 4px",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                whiteSpace: "nowrap",
              }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, marginTop: 14, marginLeft: 6, marginRight: 6,
                background: done ? "#1F8A5B" : "#E6E7E5",
                borderRadius: 99, transition: "background 0.3s",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1 — Datos básicos ───────────────────────────────────────────────────

function Step1({ data, onChange, errors }: { data: ObraFormData; onChange: (d: ObraFormData) => void; errors: Record<string, string> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(data.image_url || null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imgLoadError, setImgLoadError] = useState(false);

  function set(field: keyof ObraFormData) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...data, [field]: e.target.value });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setUploadError("Solo se aceptan imágenes (JPG, PNG, WebP)."); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError("La imagen no puede superar 5 MB."); return; }
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl); setImgLoadError(false); setUploadError(null); setUploading(true);
    try {
      const url = await uploadImage(file);
      onChange({ ...data, image_url: url });
    } catch {
      setUploadError("Error al subir la imagen. Intentá de nuevo.");
      setPreview(null); onChange({ ...data, image_url: "" });
    } finally { setUploading(false); }
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function clearImage() {
    setPreview(null); setUploadError(null); onChange({ ...data, image_url: "" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <FieldLabel>Nombre de la obra</FieldLabel>
        <input style={iStyle(!!errors.name)} placeholder="Ej: Edificio Palermo III"
          value={data.name} onChange={set("name")} maxLength={255} autoFocus
          onFocus={e => onFocus(e, !!errors.name)} onBlur={e => onBlur(e, !!errors.name)} />
        <FieldError msg={errors.name} />
      </div>

      <div>
        <FieldLabel>Ubicación</FieldLabel>
        <input style={iStyle(!!errors.location)} placeholder="Ej: Av. Santa Fe 1500, CABA"
          value={data.location} onChange={set("location")} maxLength={255}
          onFocus={e => onFocus(e, !!errors.location)} onBlur={e => onBlur(e, !!errors.location)} />
        <FieldError msg={errors.location} />
      </div>

      <div>
        <FieldLabel optional>Descripción</FieldLabel>
        <textarea style={{ ...iStyle(), resize: "none" } as React.CSSProperties}
          placeholder="Descripción breve del proyecto..." rows={2}
          value={data.description} onChange={set("description")}
          onFocus={onFocus} onBlur={onBlur} />
      </div>

      {/* Image upload */}
      <div>
        <FieldLabel optional>Foto de la obra</FieldLabel>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }} onChange={handleInputChange} />

        {preview && !imgLoadError ? (
          <div style={{ position: "relative", height: 140, borderRadius: 12, overflow: "hidden", border: "1px solid #E6E7E5" }}>
            <img src={preview} alt="Preview" onError={() => setImgLoadError(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {uploading ? (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.50)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Loader2 style={{ width: 18, height: 18, color: "#fff", animation: "spin 1s linear infinite" }} />
                <span style={{ color: "#fff", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>Subiendo...</span>
              </div>
            ) : (
              <div className="img-hover-overlay" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(0,0,0,0)", transition: "background 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.30)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0)")}>
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 }}>
                  Cambiar
                </button>
                <button type="button" onClick={clearImage}
                  style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(0,0,0,0.6)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => e.key === "Enter" && fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            style={{
              height: 130, borderRadius: 12, border: "1.5px dashed #C7CAC6",
              cursor: "pointer", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 10,
              background: "#F9FAF8", transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#FF6B35"; (e.currentTarget as HTMLElement).style.background = "rgba(255,107,53,0.03)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#C7CAC6"; (e.currentTarget as HTMLElement).style.background = "#F9FAF8"; }}
          >
            {imgLoadError
              ? <ImageOff style={{ width: 22, height: 22, color: "#C7CAC6" }} />
              : <Upload style={{ width: 22, height: 22, color: "#ADAAA4" }} />
            }
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Hacé click o arrastrá una foto</p>
              <p style={{ margin: "3px 0 0", fontSize: 10.5, color: "#ADAAA4", fontFamily: "'JetBrains Mono', monospace" }}>JPG · PNG · WebP — máx. 5 MB</p>
            </div>
          </div>
        )}
        {uploadError && <FieldError msg={uploadError} />}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <FieldLabel optional>Fecha de inicio</FieldLabel>
          <input type="date" style={iStyle()} value={data.start_date} onChange={set("start_date")}
            onFocus={onFocus} onBlur={onBlur} />
        </div>
        <div>
          <FieldLabel optional>Fecha estimada de fin</FieldLabel>
          <input type="date" style={iStyle(!!errors.expected_end_date)} value={data.expected_end_date} onChange={set("expected_end_date")}
            onFocus={e => onFocus(e, !!errors.expected_end_date)} onBlur={e => onBlur(e, !!errors.expected_end_date)} />
          <FieldError msg={errors.expected_end_date} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 2 — Responsables ────────────────────────────────────────────────────

function Step2({ responsibles, form, onFormChange, error, onAdd, onRemove, onEdit }: {
  responsibles: DraftResponsible[]; form: RespForm; onFormChange: (f: RespForm) => void;
  error: string | null; onAdd: () => void; onRemove: (k: string) => void; onEdit: (k: string) => void;
}) {
  function set(field: keyof RespForm) {
    return (e: ChangeEvent<HTMLInputElement>) => onFormChange({ ...form, [field]: e.target.value });
  }
  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); onAdd(); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Agregá las personas responsables. Podés omitir este paso y agregarlos después.
      </p>

      {/* Add form */}
      <div style={{ background: "#F9FAF8", border: "1px solid #E6E7E5", borderRadius: 12, padding: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <FieldLabel>Nombre</FieldLabel>
            <input style={iStyle()} placeholder="Juan Pérez" value={form.full_name}
              onChange={set("full_name")} onKeyDown={handleKey} maxLength={255}
              onFocus={onFocus} onBlur={onBlur} />
          </div>
          <div>
            <FieldLabel>WhatsApp</FieldLabel>
            <input style={iStyle()} placeholder="+5491112345678" value={form.whatsapp_number}
              onChange={set("whatsapp_number")} onKeyDown={handleKey}
              onFocus={onFocus} onBlur={onBlur} />
          </div>
          <div>
            <FieldLabel optional>Rol</FieldLabel>
            <input style={iStyle()} placeholder="Capataz, Electricista..." value={form.role}
              onChange={set("role")} onKeyDown={handleKey} maxLength={100}
              onFocus={onFocus} onBlur={onBlur} />
          </div>
        </div>
        {error && <div style={{ marginBottom: 10 }}><InlineError msg={error} /></div>}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <PrimaryBtn onClick={onAdd}>
            <Plus style={{ width: 13, height: 13 }} />
            Agregar responsable
          </PrimaryBtn>
        </div>
      </div>

      {/* List */}
      <div style={{ minHeight: 200, maxHeight: 200, overflowY: "auto" }}>
        {responsibles.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif", marginBottom: 2 }}>
              {responsibles.length} responsable{responsibles.length !== 1 ? "s" : ""} agregado{responsibles.length !== 1 ? "s" : ""}
            </span>
            {responsibles.map(r => {
              const color = avatarColor(r.full_name);
              return (
                <div key={r._key} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, padding: "10px 14px" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 99, background: color, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    {getInitials(r.full_name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.full_name}</p>
                    <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "#8E97A0", fontFamily: "'JetBrains Mono', monospace" }}>{r.whatsapp_number}</p>
                  </div>
                  {r.role && (
                    <span style={{ fontSize: 11, color: "#5B6770", background: "#F0F1EF", padding: "3px 8px", borderRadius: 99, border: "1px solid #E6E7E5", whiteSpace: "nowrap", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      {r.role}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 2 }}>
                    <SmallIconBtn onClick={() => onEdit(r._key)} title="Editar"><Pencil style={{ width: 12, height: 12 }} /></SmallIconBtn>
                    <SmallIconBtn onClick={() => onRemove(r._key)} title="Quitar" danger><Trash2 style={{ width: 12, height: 12 }} /></SmallIconBtn>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <p style={{ fontSize: 12.5, color: "#8E97A0", textAlign: "center", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Sin responsables todavía — podés continuar y agregarlos después.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 3 — Tareas ──────────────────────────────────────────────────────────

function Step3({ tasks, responsibles, form, onFormChange, error, onAdd, onRemove, onEdit }: {
  tasks: DraftTask[]; responsibles: DraftResponsible[]; form: TaskForm;
  onFormChange: (f: TaskForm) => void; error: string | null;
  onAdd: () => void; onRemove: (k: string) => void; onEdit: (k: string) => void;
}) {
  function set(field: keyof TaskForm) {
    return (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onFormChange({ ...form, [field]: e.target.value });
  }
  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); onAdd(); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Definí las tareas iniciales. Podés asignar responsables después desde el detalle de la obra.
      </p>

      {/* Add form */}
      <div style={{ background: "#F9FAF8", border: "1px solid #E6E7E5", borderRadius: 12, padding: "16px" }}>
        <div style={{ marginBottom: 10 }}>
          <FieldLabel>Título de la tarea</FieldLabel>
          <input style={iStyle()} placeholder="Ej: Excavación y nivelación del terreno"
            value={form.title} onChange={set("title")} onKeyDown={handleKey} maxLength={255}
            onFocus={onFocus} onBlur={onBlur} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <FieldLabel optional>Responsable</FieldLabel>
            <select style={{ ...iStyle(), cursor: "pointer", appearance: "none" } as React.CSSProperties}
              value={form.responsible_key} onChange={set("responsible_key")}
              onFocus={onFocus} onBlur={onBlur}>
              <option value="">Sin responsable</option>
              {responsibles.map(r => <option key={r._key} value={r._key}>{r.full_name}{r.role ? ` · ${r.role}` : ""}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel optional>Fecha inicio</FieldLabel>
            <input type="date" style={iStyle()} value={form.start_date} onChange={set("start_date")}
              onFocus={onFocus} onBlur={onBlur} />
          </div>
          <div>
            <FieldLabel optional>Fecha vencimiento</FieldLabel>
            <input type="date" style={iStyle()} value={form.due_date} onChange={set("due_date")}
              onFocus={onFocus} onBlur={onBlur} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <FieldLabel optional>Descripción</FieldLabel>
          <textarea style={{ ...iStyle(), resize: "none" } as React.CSSProperties}
            placeholder="Descripción adicional..." rows={2}
            value={form.description} onChange={set("description")}
            onFocus={onFocus} onBlur={onBlur} />
        </div>
        {error && <div style={{ marginBottom: 10 }}><InlineError msg={error} /></div>}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <PrimaryBtn onClick={onAdd}>
            <Plus style={{ width: 13, height: 13 }} />
            Agregar tarea
          </PrimaryBtn>
        </div>
      </div>

      {/* List */}
      <div style={{ minHeight: 200, maxHeight: 200, overflowY: "auto" }}>
        {tasks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif", marginBottom: 2 }}>
              {tasks.length} tarea{tasks.length !== 1 ? "s" : ""} agregada{tasks.length !== 1 ? "s" : ""}
            </span>
            {tasks.map((t, i) => {
              const resp = responsibles.find(r => r._key === t.responsible_key);
              return (
                <div key={t._key} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, padding: "10px 14px" }}>
                  <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "#ADAAA4", marginTop: 2, minWidth: 18, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{t.title}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                      {resp ? (
                        <span style={{ fontSize: 11.5, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{resp.full_name}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#C97D0E", fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                          <AlertTriangle style={{ width: 10, height: 10 }} />Sin responsable
                        </span>
                      )}
                      {(t.start_date || t.due_date) && (
                        <span style={{ fontSize: 11, color: "#8E97A0", fontFamily: "'JetBrains Mono', monospace" }}>
                          {t.start_date && t.due_date ? `${formatDate(t.start_date)} → ${formatDate(t.due_date)}` : t.due_date ? `vence ${formatDate(t.due_date)}` : `inicio ${formatDate(t.start_date)}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2 }}>
                    <SmallIconBtn onClick={() => onEdit(t._key)} title="Editar"><Pencil style={{ width: 12, height: 12 }} /></SmallIconBtn>
                    <SmallIconBtn onClick={() => onRemove(t._key)} title="Quitar" danger><Trash2 style={{ width: 12, height: 12 }} /></SmallIconBtn>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <p style={{ fontSize: 12.5, color: "#8E97A0", textAlign: "center", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Sin tareas todavía — podés continuar y agregarlas desde la obra.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 4 — Confirmación ────────────────────────────────────────────────────

function Step4({ obraData, responsibles, tasks, tasksWithoutResp, error }: {
  obraData: ObraFormData; responsibles: DraftResponsible[]; tasks: DraftTask[];
  tasksWithoutResp: number; error: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Revisá el resumen antes de crear la obra.
      </p>

      {/* Summary card */}
      <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderLeft: "4px solid #FF6B35", borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Obra</span>
          <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.015em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{obraData.name}</p>
          {obraData.location && <p style={{ margin: "3px 0 0", fontSize: 13, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{obraData.location}</p>}
          {obraData.description && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{obraData.description}</p>}
        </div>

        {(obraData.start_date || obraData.expected_end_date) && (
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Período</span>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#1A2329", fontFamily: "'JetBrains Mono', monospace" }}>
              {formatDate(obraData.start_date)} → {formatDate(obraData.expected_end_date)}
            </p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", paddingTop: 14, borderTop: "1px solid #F0F1EF", gap: 0 }}>
          {[
            { value: responsibles.length, label: "Responsables", color: "#1A2329" },
            { value: tasks.length, label: "Tareas", color: "#1A2329" },
            { value: tasksWithoutResp, label: "Sin responsable", color: tasksWithoutResp > 0 ? "#C97D0E" : "#1F8A5B" },
          ].map(({ value, label, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color, fontFamily: "'Plus Jakarta Sans', sans-serif", letterSpacing: "-0.025em" }}>{value}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {tasksWithoutResp > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#FDF1DE", border: "1px solid #E89B14", borderRadius: 10, padding: "10px 14px" }}>
          <AlertTriangle style={{ width: 13, height: 13, color: "#C97D0E", flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12, color: "#8B5E0A", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            <strong>{tasksWithoutResp} tarea{tasksWithoutResp > 1 ? "s" : ""} sin responsable.</strong>{" "}
            Podés asignarlos después desde el detalle de la obra.
          </p>
        </div>
      )}

      {error && <InlineError msg={error} />}
    </div>
  );
}

// ─── Success view ─────────────────────────────────────────────────────────────

function SuccessView({ obra, onNavigate }: { obra: Obra; onNavigate: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "32px 0", gap: 20 }}>
      <div style={{ width: 64, height: 64, borderRadius: 99, background: "#E4F3EC", border: "2px solid #A8DFC5", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CheckCircle2 style={{ width: 30, height: 30, color: "#1F8A5B" }} />
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1F8A5B", fontFamily: "'Plus Jakarta Sans', sans-serif", marginBottom: 6 }}>
          Obra creada exitosamente
        </p>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.02em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{obra.name}</h3>
        {obra.location && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#5B6770", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{obra.location}</p>}
      </div>
      <PrimaryBtn onClick={onNavigate}>
        Ir a la obra
        <ChevronRight style={{ width: 14, height: 14 }} />
      </PrimaryBtn>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ObraSetupWizardProps {
  onClose: () => void;
  onCreated: (obra: Obra) => void;
}

export function ObraSetupWizard({ onClose, onCreated }: ObraSetupWizardProps) {
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const [createdObra, setCreatedObra] = useState<Obra | null>(null);

  const [obraData, setObraData] = useState<ObraFormData>({ name: "", location: "", description: "", image_url: "", start_date: "", expected_end_date: "" });
  const [step1Errors, setStep1Errors] = useState<Record<string, string>>({});

  const [responsibles, setResponsibles] = useState<DraftResponsible[]>([]);
  const [respForm, setRespForm] = useState<RespForm>({ full_name: "", whatsapp_number: "", role: "" });
  const [respError, setRespError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [taskForm, setTaskForm] = useState<TaskForm>({ title: "", description: "", responsible_key: "", start_date: "", due_date: "" });
  const [taskError, setTaskError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validateStep1() {
    const errs: Record<string, string> = {};
    if (!obraData.name.trim() || obraData.name.trim().length < 2) errs.name = "El nombre es obligatorio (mínimo 2 caracteres).";
    if (!obraData.location.trim()) errs.location = "La ubicación es obligatoria.";
    if (obraData.start_date && obraData.expected_end_date && obraData.expected_end_date < obraData.start_date)
      errs.expected_end_date = "La fecha de fin debe ser posterior a la de inicio.";
    setStep1Errors(errs);
    return Object.keys(errs).length === 0;
  }

  function goNext() { if (step === 1 && !validateStep1()) return; setStep(s => s + 1); }
  function goBack() { setStep(s => s - 1); }

  function addResponsible() {
    const { full_name, whatsapp_number, role } = respForm;
    if (!full_name.trim() || full_name.trim().length < 2) return setRespError("El nombre es obligatorio (mínimo 2 caracteres).");
    if (!whatsapp_number.trim()) return setRespError("El número de WhatsApp es obligatorio.");
    if (!E164.test(whatsapp_number.trim())) return setRespError("Formato inválido — usá E.164: +5491112345678");
    if (responsibles.some(r => r.whatsapp_number === whatsapp_number.trim())) return setRespError("Ya existe un responsable con ese número.");
    setResponsibles(prev => [...prev, { _key: uid(), full_name: full_name.trim(), whatsapp_number: whatsapp_number.trim(), role: role.trim() }]);
    setRespForm({ full_name: "", whatsapp_number: "", role: "" });
    setRespError(null);
  }

  function removeResponsible(k: string) {
    setResponsibles(prev => prev.filter(r => r._key !== k));
    setTasks(prev => prev.map(t => t.responsible_key === k ? { ...t, responsible_key: "" } : t));
  }

  function editResponsible(k: string) {
    const r = responsibles.find(r => r._key === k);
    if (!r) return;
    setRespForm({ full_name: r.full_name, whatsapp_number: r.whatsapp_number, role: r.role });
    removeResponsible(k); setRespError(null);
  }

  function addTask() {
    const { title, description, responsible_key, start_date, due_date } = taskForm;
    if (!title.trim() || title.trim().length < 2) return setTaskError("El título es obligatorio (mínimo 2 caracteres).");
    if (start_date && due_date && due_date < start_date) return setTaskError("La fecha de vencimiento debe ser posterior a la de inicio.");
    setTasks(prev => [...prev, { _key: uid(), title: title.trim(), description: description.trim(), responsible_key, start_date, due_date }]);
    setTaskForm({ title: "", description: "", responsible_key: "", start_date: "", due_date: "" });
    setTaskError(null);
  }

  function removeTask(k: string) { setTasks(prev => prev.filter(t => t._key !== k)); }

  function editTask(k: string) {
    const t = tasks.find(t => t._key === k);
    if (!t) return;
    setTaskForm({ title: t.title, description: t.description, responsible_key: t.responsible_key, start_date: t.start_date, due_date: t.due_date });
    removeTask(k); setTaskError(null);
  }

  async function handleSubmit() {
    setSubmitting(true); setSubmitError(null);
    try {
      const obra = await createObra({
        name: obraData.name.trim(), location: obraData.location.trim() || null,
        description: obraData.description.trim() || null, image_url: obraData.image_url.trim() || null,
        start_date: obraData.start_date || null, expected_end_date: obraData.expected_end_date || null,
      });
      const keyToId = new Map<string, number>();
      for (const r of responsibles) {
        const created = await createResponsible({ full_name: r.full_name, whatsapp_number: r.whatsapp_number, role: r.role || null });
        keyToId.set(r._key, created.id);
      }
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        await createTask({ obra_id: obra.id, title: t.title, description: t.description || null, responsible_id: t.responsible_key ? (keyToId.get(t.responsible_key) ?? null) : null, start_date: t.start_date || null, due_date: t.due_date || null, order_index: i });
      }
      setCreatedObra(obra); setDone(true);
    } catch {
      setSubmitError("Error al crear la obra. Verificá los datos e intentá nuevamente.");
    } finally { setSubmitting(false); }
  }

  const tasksWithoutResp = tasks.filter(t => !t.responsible_key).length;

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,22,28,0.55)", backdropFilter: "blur(4px)",
        padding: 16,
      }}
    >
      <div style={{
        background: "#fff", width: "100%", maxWidth: 680,
        borderRadius: 18, display: "flex", flexDirection: "column",
        height: "90vh", overflow: "hidden",
        boxShadow: "0 40px 80px -20px rgba(15,22,28,0.35), 0 8px 24px -8px rgba(15,22,28,0.10)",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}>

        {/* ── Header ── */}
        <div style={{
          background: "linear-gradient(135deg, #1B2A34 0%, #243642 100%)",
          padding: "20px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0,
              background: "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 12px -4px rgba(232,90,38,0.55)",
            }}>
              {done
                ? <CheckCircle2 style={{ width: 17, height: 17, color: "#fff" }} />
                : STEP_ICONS[step - 1]
              }
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
                {done ? "Obra creada" : `Paso ${step} de 4`}
              </p>
              <h2 style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.015em", lineHeight: 1.2 }}>
                {done ? "¡Listo!" : STEPS[step - 1]}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 9, border: "none",
              background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.55)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s, color 0.15s", flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.10)"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
          >
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        {/* ── Content ── */}
        <div style={{ padding: "24px 28px", flex: 1, overflowY: "auto" }}>
          {!done && <StepBar current={step} />}
          {!done && step === 1 && <Step1 data={obraData} onChange={setObraData} errors={step1Errors} />}
          {!done && step === 2 && <Step2 responsibles={responsibles} form={respForm} onFormChange={setRespForm} error={respError} onAdd={addResponsible} onRemove={removeResponsible} onEdit={editResponsible} />}
          {!done && step === 3 && <Step3 tasks={tasks} responsibles={responsibles} form={taskForm} onFormChange={setTaskForm} error={taskError} onAdd={addTask} onRemove={removeTask} onEdit={editTask} />}
          {!done && step === 4 && <Step4 obraData={obraData} responsibles={responsibles} tasks={tasks} tasksWithoutResp={tasksWithoutResp} error={submitError} />}
          {done && createdObra && <SuccessView obra={createdObra} onNavigate={() => onCreated(createdObra)} />}
        </div>

        {/* ── Footer ── */}
        {!done && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 24px 18px",
            borderTop: "1px solid #F0F1EF",
            flexShrink: 0, background: "#fff",
          }}>
            <div>
              {step > 1 && (
                <SecondaryBtn onClick={goBack} disabled={step === 4 && submitting}>
                  <ChevronLeft style={{ width: 14, height: 14 }} />
                  Anterior
                </SecondaryBtn>
              )}
            </div>

            {step < 4 ? (
              <PrimaryBtn onClick={goNext}>
                {step === 3 ? "Revisar y confirmar" : "Siguiente"}
                <ChevronRight style={{ width: 14, height: 14 }} />
              </PrimaryBtn>
            ) : (
              <PrimaryBtn onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
                    Creando obra...
                  </>
                ) : (
                  <>
                    <Building2 style={{ width: 13, height: 13 }} />
                    Crear obra y comenzar seguimiento
                  </>
                )}
              </PrimaryBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
