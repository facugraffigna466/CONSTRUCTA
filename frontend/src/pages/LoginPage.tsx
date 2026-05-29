import React, { useState, useEffect } from "react";
import { login } from "../api/auth";
import { setToken } from "../lib/tokenStorage";
import { EnvelopeIcon, LockClosedIcon, EyeIcon, EyeSlashIcon, ArrowRightIcon } from "@heroicons/react/24/outline";

interface LoginPageProps {
  onLogin: () => void;
}


export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const token = await login(email, password);
      setToken(token);
      onLogin();
    } catch {
      setError("Credenciales inválidas. Verificá tu email y contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full">

      {/* ── Left panel — hero ─────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[58%] xl:w-[55%] flex-shrink-0 relative overflow-hidden">

        {/* Video de fondo */}
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src="/hero-video.mp4"
          autoPlay
          muted
          loop
          playsInline
        />

        {/* Vignette superior sutil */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent" />

        {/* Contenido anclado al pie — panel de vidrio */}
        <div
          className="relative z-10 mt-auto w-full px-10 pt-16 pb-12"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 50%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 18%)",
            maskImage: "linear-gradient(to bottom, transparent 0%, black 18%)",
            opacity: ready ? 1 : 0,
            transform: ready ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.7s ease 0.2s, transform 0.7s ease 0.2s",
          }}
        >
          {/* Eyebrow */}
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-constructa-primary mb-4 block"
            style={{
              opacity: ready ? 1 : 0,
              transform: ready ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 0.5s ease 0.25s, transform 0.5s ease 0.25s",
            }}
          >
            Sistema v.2026
          </span>

          {/* Headline */}
          <h2
            className="font-display text-4xl xl:text-5xl font-extrabold text-white leading-[1.1] tracking-tight mb-8"
            style={{
              opacity: ready ? 1 : 0,
              transform: ready ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.55s ease 0.38s, transform 0.55s ease 0.38s",
            }}
          >
            Gestioná obras<br />
            con <span className="text-constructa-primary">precisión.</span>
          </h2>

          {/* Stat pills de vidrio */}
          <div className="flex items-stretch gap-3">
            <div
              className="flex-1 rounded-xl border border-white/[0.15] bg-white/[0.10] px-5 py-4"
              style={{
                opacity: ready ? 1 : 0,
                transform: ready ? "translateY(0)" : "translateY(12px)",
                transition: "opacity 0.5s ease 0.52s, transform 0.5s ease 0.52s",
              }}
            >
              <div className="font-display text-2xl font-extrabold text-constructa-primary leading-none mb-1.5">85%</div>
              <div className="font-sans text-xs text-white/70 leading-snug">
                de obras mejoran su puntualidad
              </div>
            </div>
            <div
              className="flex-1 rounded-xl border border-white/[0.15] bg-white/[0.10] px-5 py-4"
              style={{
                opacity: ready ? 1 : 0,
                transform: ready ? "translateY(0)" : "translateY(12px)",
                transition: "opacity 0.5s ease 0.64s, transform 0.5s ease 0.64s",
              }}
            >
              <div className="font-display text-2xl font-extrabold text-constructa-primary leading-none mb-1.5">3x</div>
              <div className="font-sans text-xs text-white/70 leading-snug">
                más eficiencia en trazabilidad de tareas
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Right panel — form ─────────────────────────────── */}
      <div
        className="flex-1 flex items-center justify-center px-8 py-12 bg-constructa-bg"
        style={{
          opacity: ready ? 1 : 0,
          transform: ready ? "translateX(0)" : "translateX(16px)",
          transition: "opacity 0.55s ease 0.05s, transform 0.55s ease 0.05s",
        }}
      >
        <div className="w-full max-w-[420px]">

          {/* Card blanca */}
          <div className="bg-white rounded-2xl shadow-card-md border border-constructa-surface px-8 py-8 transition-all duration-300 ease-out hover:scale-[1.018] hover:shadow-xl">

          {/* Logo — único, dentro de la card */}
          <div className="flex items-center gap-3 mb-7">
            <img src="/logo.png" alt="Constructa" className="w-8 h-8 rounded object-cover flex-shrink-0" />
            <span className="font-display font-bold text-constructa-text tracking-tight">CONSTRUCTA</span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="font-display text-2xl xl:text-3xl font-bold text-constructa-text tracking-tight mb-1.5">
              Accedé al sistema
            </h2>
            <p className="text-sm text-constructa-secondaryText">
              Ingresá tus credenciales para continuar.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <div>
              <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-constructa-secondaryText mb-2">
                Email
              </label>
              <div className={`relative flex items-center bg-white border rounded-lg focus-within:ring-2 transition-all duration-200 ${
                error
                  ? "border-red-400 focus-within:border-red-400 focus-within:ring-red-200"
                  : "border-constructa-border focus-within:border-constructa-primary focus-within:ring-constructa-primary/15"
              }`}>
                <EnvelopeIcon className="absolute left-3.5 w-4 h-4 text-constructa-border flex-shrink-0" />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder="manager@constructa.com"
                  className="w-full pl-10 pr-4 py-3 bg-transparent text-sm text-constructa-text placeholder-constructa-border focus:outline-none"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-constructa-secondaryText mb-2">
                Contraseña
              </label>
              <div className={`relative flex items-center bg-white border rounded-lg focus-within:ring-2 transition-all duration-200 ${
                error
                  ? "border-red-400 focus-within:border-red-400 focus-within:ring-red-200"
                  : "border-constructa-border focus-within:border-constructa-primary focus-within:ring-constructa-primary/15"
              }`}>
                <LockClosedIcon className="absolute left-3.5 w-4 h-4 text-constructa-border flex-shrink-0" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full pl-10 pr-12 py-3 bg-transparent text-sm text-constructa-text placeholder-constructa-border focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 text-constructa-border hover:text-constructa-secondaryText transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "#FEF2F2", border: "1px solid #FECACA",
                borderRadius: 10, padding: "12px 14px",
                animation: "shake 0.35s ease",
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "#DC2626", flexShrink: 0 }}>
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span style={{ fontSize: 13, color: "#B91C1C", fontWeight: 500 }}>{error}</span>
              </div>
            )}

            {/* Submit */}
            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-constructa-primary hover:bg-orange-600 active:scale-[0.99] text-white font-display font-bold py-3.5 rounded-lg transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 text-sm uppercase tracking-widest"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Ingresando...
                  </span>
                ) : (
                  <>
                    Ingresar
                    <ArrowRightIcon className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          </div>{/* /card blanca */}

          {/* Footer — fuera de la card */}
          <div className="mt-6 flex items-center justify-between">
            <span className="font-mono text-[10px] text-constructa-border uppercase tracking-widest">CONSTRUCTA</span>
            <span className="font-mono text-[10px] text-constructa-border uppercase tracking-widest">Tesis 2026</span>
          </div>

        </div>
      </div>
    </div>
  );
}
