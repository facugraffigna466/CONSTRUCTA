import { useEffect, useState } from "react";
import { acceptInvite, fetchInviteContext, type InviteContext } from "../api/users";
import { setRefreshToken, setToken } from "../lib/tokenStorage";

interface Props {
  token: string;
  onAccepted: () => void;
}

export function AcceptInvitePage({ token, onAccepted }: Props) {
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [focused, setFocused]   = useState<string | null>(null);
  const [context, setContext]         = useState<InviteContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError]     = useState<string | null>(null);

  // Traer el contexto de la invitación (empresa, email, rol) SIN consumir el token,
  // para que la persona vea a qué se está uniendo antes de aceptar.
  useEffect(() => {
    let cancelled = false;
    setContextLoading(true);
    fetchInviteContext(token)
      .then(ctx => { if (!cancelled) setContext(ctx); })
      .catch((err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
        if (!cancelled) setContextError(typeof detail === "string" ? detail : "El link de invitación es inválido o expiró");
      })
      .finally(() => { if (!cancelled) setContextLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const roleLabel = context?.role === "admin" ? "Administrador" : "Colaborador";

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

    if (!fullName.trim()) { setError("Ingresá tu nombre completo"); return; }
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }

    setLoading(true);
    try {
      const tokens = await acceptInvite(token, fullName.trim(), password);
      setToken(tokens.access_token);
      setRefreshToken(tokens.refresh_token);
      onAccepted();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? (detail[0] as { msg?: string })?.msg ?? "Datos inválidos"
          : "El link de invitación es inválido o expiró";
      setError(msg);
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
        {/* Logo / brand */}
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 48, height: 48, borderRadius: 13,
            background: "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
            boxShadow: "0 8px 18px -8px rgba(232,90,38,0.5)",
            marginBottom: 16,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 21V9l9-6 9 6v12H3z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
              <path d="M9 21v-6h6v6" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 style={{
            margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: 22, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.025em",
          }}>
            {contextError ? "Invitación no válida" : "Activá tu cuenta"}
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "#6B7580" }}>
            {contextError
              ? contextError
              : contextLoading
                ? "Verificando invitación…"
                : context?.company_name
                  ? <>Te invitaron a unirte a <strong style={{ color: "#1A2329" }}>{context.company_name}</strong></>
                  : "Completá tus datos para unirte al equipo"}
          </p>
        </div>

        {!contextError && !contextLoading && (
        <>
        {context && (
          <div style={{
            marginBottom: 18, padding: "12px 14px", borderRadius: 10,
            background: "#F7F8F7", border: "1px solid #E6E7E5",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
              <span style={{ color: "#6B7580" }}>Email</span>
              <span style={{ color: "#1A2329", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{context.email}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
              <span style={{ color: "#6B7580" }}>Rol</span>
              <span style={{ color: "#1A2329", fontWeight: 600 }}>{roleLabel}</span>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#5B6770", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Nombre completo
            </label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Juan García"
              autoFocus
              onFocus={() => setFocused("name")}
              onBlur={() => setFocused(null)}
              style={inputStyle("name")}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#5B6770", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              onFocus={() => setFocused("password")}
              onBlur={() => setFocused(null)}
              style={inputStyle("password")}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#5B6770", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Confirmar contraseña
            </label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repetí la contraseña"
              onFocus={() => setFocused("confirm")}
              onBlur={() => setFocused(null)}
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
            type="submit"
            disabled={loading}
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
            {loading ? "Activando…" : "Activar cuenta"}
          </button>
        </form>
        </>
        )}
      </div>
    </div>
  );
}
