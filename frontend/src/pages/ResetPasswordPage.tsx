import { useState } from "react";
import { resetPassword } from "../api/auth";
import { setRefreshToken, setToken } from "../lib/tokenStorage";

interface Props {
  token: string;
  onDone: () => void;
}

export function ResetPasswordPage({ token, onDone }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [focused, setFocused]   = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  const inputStyle = (field: string, hasError = false) => ({
    width: "100%", height: 42, padding: "0 14px",
    border: `1.5px solid ${hasError ? "#D03A3A" : focused === field ? "#FF6B35" : "#E6E7E5"}`,
    boxShadow: focused === field && !hasError ? "0 0 0 4px rgba(255,107,53,0.10)" : "none",
    borderRadius: 10, fontSize: 14, color: "#1A2329",
    outline: "none", background: "#fff", transition: ".15s",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }

    setLoading(true);
    try {
      const result = await resetPassword(token, password);
      if (result.requires_tenant_selection) {
        // Caso raro: la identidad pertenece a más de una empresa — la
        // contraseña ya quedó cambiada, pero para elegir empresa hay que
        // pasar por el login normal (que sí sabe mostrar el selector).
        setNeedsLogin(true);
        return;
      }
      setToken(result.access_token);
      setRefreshToken(result.refresh_token);
      onDone();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "El enlace de recuperación es inválido o expiró");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#F4F5F4", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "#fff", borderRadius: 18,
        border: "1px solid #E6E7E5",
        boxShadow: "0 20px 60px -16px rgba(0,0,0,0.12)",
        padding: "36px 32px",
      }}>
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 48, height: 48, borderRadius: 13,
            background: "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
            boxShadow: "0 8px 18px -8px rgba(232,90,38,0.5)", marginBottom: 16,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="11" width="14" height="9" rx="2" stroke="#fff" strokeWidth="1.8"/>
              <path d="M8 11V8a4 4 0 018 0v3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 style={{
            margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: 22, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.025em",
          }}>
            Nueva contraseña
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "#6B7580" }}>
            {needsLogin
              ? "Tu contraseña se actualizó. Iniciá sesión para elegir con qué empresa entrar."
              : "Elegí una contraseña nueva para tu cuenta"}
          </p>
        </div>

        {needsLogin ? (
          <button
            onClick={onDone}
            style={{
              width: "100%", height: 44, borderRadius: 11,
              background: "#FF6B35", color: "#fff", border: "none",
              fontSize: 14.5, fontWeight: 600, cursor: "pointer",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
            }}
          >
            Ir a iniciar sesión
          </button>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#5B6770", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Nueva contraseña
            </label>
            <input
              type="password" value={password} autoFocus
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              onFocus={() => setFocused("password")} onBlur={() => setFocused(null)}
              style={inputStyle("password")}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#5B6770", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Confirmar contraseña
            </label>
            <input
              type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repetí la contraseña"
              onFocus={() => setFocused("confirm")} onBlur={() => setFocused(null)}
              style={inputStyle("confirm", !!confirm && confirm !== password)}
            />
            {confirm && confirm !== password && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#D03A3A" }}>Las contraseñas no coinciden</p>
            )}
          </div>

          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 9,
              background: "#FCE5E5", border: "1px solid #F0B0B0",
              fontSize: 13, color: "#A82B2B", fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              marginTop: 4, height: 44, borderRadius: 11,
              background: loading ? "#FCBA9E" : "#FF6B35",
              color: "#fff", border: "none", fontSize: 14.5, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              boxShadow: loading ? "none" : "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
              transition: "background .15s",
            }}
          >
            {loading ? "Guardando…" : "Guardar contraseña"}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
