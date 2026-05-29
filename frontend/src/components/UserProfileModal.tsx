import { useRef, useState } from "react";
import { useUser } from "../context/UserContext";
import { changePassword, updateProfile, uploadAvatar } from "../api/users";

interface Props {
  onClose: () => void;
}

type Tab = "perfil" | "password";

const C = {
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", bg: "#F4F5F4", surface: "#fff",
  orange: "#FF6B35", orange10: "rgba(255,107,53,0.10)",
  good: "#1F8A5B", good50: "#E4F3EC", goodBorder: "#BFE3CE",
  danger: "#D03A3A", danger50: "#FCE5E5",
};

const BASE_INPUT: React.CSSProperties = {
  width: "100%", height: 40, padding: "0 12px", boxSizing: "border-box",
  border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 14,
  color: C.text, background: C.surface, outline: "none", transition: ".15s",
  fontFamily: "'Plus Jakarta Sans', sans-serif",
};

function focusStyle(el: HTMLInputElement | HTMLTextAreaElement) {
  el.style.borderColor = C.orange;
  el.style.boxShadow = `0 0 0 4px ${C.orange10}`;
}
function blurStyle(el: HTMLInputElement | HTMLTextAreaElement, hasError = false) {
  el.style.borderColor = hasError ? C.danger : C.line;
  el.style.boxShadow = "none";
}

export function UserProfileModal({ onClose }: Props) {
  const { user, refetch } = useUser();
  const [tab, setTab] = useState<Tab>("perfil");

  // ── Perfil tab ──────────────────────────────────────────────────────────────
  const [name, setName]           = useState(user.name);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar_url ?? null);
  const [avatarFile, setAvatarFile]       = useState<File | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileOk, setProfileOk]         = useState(false);
  const [profileError, setProfileError]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Password tab ────────────────────────────────────────────────────────────
  const [currentPwd, setCurrentPwd]   = useState("");
  const [newPwd, setNewPwd]           = useState("");
  const [confirmPwd, setConfirmPwd]   = useState("");
  const [savingPwd, setSavingPwd]     = useState(false);
  const [pwdOk, setPwdOk]             = useState(false);
  const [pwdError, setPwdError]       = useState<string | null>(null);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  function removeAvatar() {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSaveProfile() {
    if (!name.trim()) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      let avatar_url = user.avatar_url ?? null;
      if (avatarFile) avatar_url = await uploadAvatar(avatarFile);
      else if (avatarPreview === null) avatar_url = null;

      await updateProfile({ full_name: name.trim(), avatar_url });
      await refetch();
      setProfileOk(true);
      setTimeout(() => setProfileOk(false), 3000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setProfileError(msg ?? "No se pudo guardar el perfil");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    setPwdError(null);
    if (newPwd !== confirmPwd) { setPwdError("Las contraseñas no coinciden"); return; }
    if (newPwd.length < 8) { setPwdError("La nueva contraseña debe tener al menos 8 caracteres"); return; }
    setSavingPwd(true);
    try {
      await changePassword(currentPwd, newPwd);
      setPwdOk(true);
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      setTimeout(() => setPwdOk(false), 3000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPwdError(msg ?? "No se pudo cambiar la contraseña");
    } finally {
      setSavingPwd(false);
    }
  }

  const profileChanged = name.trim() !== user.name || avatarFile !== null || (avatarPreview === null && !!user.avatar_url);

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(15,20,25,0.45)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div style={{
        background: C.surface, borderRadius: 18, width: "100%", maxWidth: 480,
        maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px -12px rgba(0,0,0,0.30)", border: `1px solid ${C.line}`,
      }}>

        {/* ── Dark header ── */}
        <div style={{
          background: "linear-gradient(135deg, #1B2A34 0%, #243642 100%)",
          padding: "22px 24px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "rgba(255,107,53,0.15)", border: "1px solid rgba(255,107,53,0.30)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="#FF6B35" strokeWidth="1.6"/>
                <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="#FF6B35" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#fff", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Mi perfil
              </div>
              <div style={{ fontSize: 12, color: "#8FA8B5", marginTop: 1 }}>{user.email}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#8FA8B5" }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, flexShrink: 0, padding: "0 24px" }}>
          {(["perfil", "password"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "12px 4px", marginRight: 20, fontSize: 13, fontWeight: 600,
                border: "none", background: "transparent", cursor: "pointer",
                color: tab === t ? C.orange : C.text3,
                borderBottom: tab === t ? `2px solid ${C.orange}` : "2px solid transparent",
                transition: ".15s", fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              {t === "perfil" ? "Datos del perfil" : "Contraseña"}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div style={{ overflowY: "auto", flex: 1, padding: 24 }}>

          {/* ── Tab: Perfil ── */}
          {tab === "perfil" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Avatar */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <div style={{ position: "relative" }}>
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="avatar"
                      style={{ width: 88, height: 88, borderRadius: 99, objectFit: "cover", border: `3px solid ${C.orange}`, boxShadow: "0 4px 16px rgba(255,107,53,0.25)" }}
                    />
                  ) : (
                    <div style={{
                      width: 88, height: 88, borderRadius: 99,
                      background: user.color, color: "#fff",
                      fontWeight: 800, fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                      border: `3px solid ${C.line}`,
                    }}>
                      {user.initials}
                    </div>
                  )}
                  {/* Edit overlay */}
                  <button
                    onClick={() => fileRef.current?.click()}
                    style={{
                      position: "absolute", bottom: 0, right: 0,
                      width: 28, height: 28, borderRadius: 99,
                      background: C.orange, border: "2.5px solid #fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", boxShadow: "0 2px 8px rgba(255,107,53,0.4)",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => fileRef.current?.click()}
                    style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, fontSize: 12.5, fontWeight: 600, color: C.text2, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  >
                    Cambiar foto
                  </button>
                  {avatarPreview && (
                    <button
                      onClick={removeAvatar}
                      style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid #F5BCBC`, background: C.danger50, fontSize: 12.5, fontWeight: 600, color: C.danger, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    >
                      Quitar foto
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={handleAvatarChange} />
                <p style={{ margin: 0, fontSize: 11.5, color: C.text3, textAlign: "center" }}>JPG, PNG o WebP · máx 5 MB</p>
              </div>

              {/* Name */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.text2, marginBottom: 6, letterSpacing: "0.04em" }}>
                  Nombre completo
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={BASE_INPUT}
                  onFocus={e => focusStyle(e.currentTarget)}
                  onBlur={e => blurStyle(e.currentTarget)}
                />
              </div>

              {/* Email (read-only) */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.text2, marginBottom: 6, letterSpacing: "0.04em" }}>
                  Email
                </label>
                <input
                  type="email"
                  value={user.email}
                  readOnly
                  style={{ ...BASE_INPUT, background: C.bg, color: C.text3, cursor: "not-allowed" }}
                />
                <p style={{ margin: "5px 0 0", fontSize: 11.5, color: C.text3 }}>El email no se puede cambiar.</p>
              </div>

              {/* Feedback */}
              {profileOk && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: C.good50, border: `1px solid ${C.goodBorder}`, borderRadius: 10, fontSize: 13, color: C.good, fontWeight: 500 }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Perfil actualizado correctamente.
                </div>
              )}
              {profileError && (
                <p style={{ margin: 0, fontSize: 13, color: C.danger }}>{profileError}</p>
              )}

              {/* Save button */}
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile || !profileChanged}
                style={{
                  height: 42, borderRadius: 10, border: "none",
                  background: profileChanged ? C.orange : C.line,
                  color: profileChanged ? "#fff" : C.text3,
                  fontSize: 14, fontWeight: 700, cursor: profileChanged ? "pointer" : "not-allowed",
                  boxShadow: profileChanged ? "0 4px 14px -4px rgba(255,107,53,0.45)" : "none",
                  transition: ".15s", fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                {savingProfile ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          )}

          {/* ── Tab: Password ── */}
          {tab === "password" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              <div style={{ padding: "12px 14px", background: C.bg, borderRadius: 10, fontSize: 13, color: C.text2, lineHeight: 1.5 }}>
                Por seguridad, necesitás ingresar tu contraseña actual para poder cambiarla.
              </div>

              {[
                { label: "Contraseña actual", value: currentPwd, set: setCurrentPwd },
                { label: "Nueva contraseña", value: newPwd, set: setNewPwd },
                { label: "Confirmar nueva contraseña", value: confirmPwd, set: setConfirmPwd },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.text2, marginBottom: 6, letterSpacing: "0.04em" }}>
                    {label}
                  </label>
                  <input
                    type="password"
                    value={value}
                    onChange={e => set(e.target.value)}
                    style={BASE_INPUT}
                    onFocus={e => focusStyle(e.currentTarget)}
                    onBlur={e => blurStyle(e.currentTarget)}
                  />
                </div>
              ))}

              {/* Strength hint */}
              {newPwd.length > 0 && newPwd.length < 8 && (
                <p style={{ margin: 0, fontSize: 12, color: "#C97D0E" }}>La contraseña debe tener al menos 8 caracteres.</p>
              )}

              {/* Feedback */}
              {pwdOk && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: C.good50, border: `1px solid ${C.goodBorder}`, borderRadius: 10, fontSize: 13, color: C.good, fontWeight: 500 }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Contraseña cambiada correctamente.
                </div>
              )}
              {pwdError && (
                <p style={{ margin: 0, fontSize: 13, color: C.danger }}>{pwdError}</p>
              )}

              <button
                onClick={handleChangePassword}
                disabled={savingPwd || !currentPwd || !newPwd || !confirmPwd}
                style={{
                  height: 42, borderRadius: 10, border: "none",
                  background: (currentPwd && newPwd && confirmPwd) ? C.orange : C.line,
                  color: (currentPwd && newPwd && confirmPwd) ? "#fff" : C.text3,
                  fontSize: 14, fontWeight: 700,
                  cursor: (currentPwd && newPwd && confirmPwd) ? "pointer" : "not-allowed",
                  boxShadow: (currentPwd && newPwd && confirmPwd) ? "0 4px 14px -4px rgba(255,107,53,0.45)" : "none",
                  transition: ".15s", fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                {savingPwd ? "Cambiando…" : "Cambiar contraseña"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
