import { useEffect, useRef, useState } from "react";
import { verifyEmail } from "../api/auth";

interface Props {
  token: string;
  onDone: () => void;
}

export function VerifyEmailPage({ token, onDone }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // evita doble llamada en StrictMode
    ran.current = true;
    verifyEmail(token)
      .then(() => setState("ok"))
      .catch((err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "El enlace de verificación es inválido o expiró");
        setState("error");
      });
  }, [token]);

  const ok = state === "ok";

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#F4F5F4", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: 420, textAlign: "center",
        background: "#fff", borderRadius: 18, border: "1px solid #E6E7E5",
        boxShadow: "0 20px 60px -16px rgba(0,0,0,0.12)", padding: "36px 32px",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 48, height: 48, borderRadius: 13, marginBottom: 16,
          background: state === "error"
            ? "linear-gradient(135deg, #F0A0A0 0%, #D03A3A 100%)"
            : "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
        }}>
          {ok ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : state === "error" ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.8s linear infinite" }}><circle cx="12" cy="12" r="9" stroke="#fff" strokeOpacity="0.35" strokeWidth="2.5"/><path d="M21 12a9 9 0 00-9-9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>
          )}
        </div>

        <h1 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.025em" }}>
          {state === "loading" ? "Verificando tu email…" : ok ? "¡Email confirmado!" : "No se pudo verificar"}
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#6B7580" }}>
          {state === "loading" ? "Un momento." : ok ? "Tu cuenta ya está verificada." : error}
        </p>

        {state !== "loading" && (
          <button
            onClick={onDone}
            style={{
              marginTop: 22, height: 44, width: "100%", borderRadius: 11,
              background: "#FF6B35", color: "#fff", border: "none", fontSize: 14.5, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
            }}
          >
            Ir a la app
          </button>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
