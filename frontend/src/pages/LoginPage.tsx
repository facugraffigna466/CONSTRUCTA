import React, { useState, useEffect } from "react";
import { login, register, requestPasswordReset, selectTenant } from "../api/auth";
import type { TenantSelectionRequired } from "../api/auth";
import { setRefreshToken, setToken } from "../lib/tokenStorage";
import { EnvelopeIcon, LockClosedIcon, EyeIcon, EyeSlashIcon, ArrowRightIcon, UserIcon, BuildingOffice2Icon } from "@heroicons/react/24/outline";
import { MessageCircle, BarChart2, Bell, FileUp } from "lucide-react";

interface LoginPageProps {
  onLogin: () => void;
}


export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [forgotSent, setForgotSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Login resolvió más de una empresa para este email — hay que elegir antes
  // de entrar (misma persona, dos empresas, Fase 4).
  const [tenantChoice, setTenantChoice] = useState<TenantSelectionRequired | null>(null);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  function switchMode(m: "login" | "register" | "forgot") {
    setMode(m);
    setError(null);
    setForgotSent(false);
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "forgot") {
        await requestPasswordReset(email);
        setForgotSent(true);
        return;
      }
      if (mode === "register") {
        if (fullName.trim().length < 2) {
          setError("Ingresá tu nombre completo.");
          return;
        }
        try {
          await register({
            email,
            password,
            full_name: fullName.trim(),
            company_name: companyName.trim() || undefined,
          });
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          setError(
            status === 409
              ? "Ya existe una cuenta con ese email. Probá ingresando."
              : status === 422
                ? "Revisá los datos: la contraseña debe tener al menos 8 caracteres."
                : "No se pudo crear la cuenta. Intentá nuevamente.",
          );
          return;
        }
      }
      const result = await login(email, password);
      if (result.requires_tenant_selection) {
        setTenantChoice(result);
        return;
      }
      setToken(result.access_token);
      setRefreshToken(result.refresh_token);
      onLogin();
    } catch {
      setError(
        mode === "register"
          ? "La cuenta se creó pero no pudimos iniciar sesión. Probá ingresando."
          : "Credenciales inválidas. Verificá tu email y contraseña.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectTenant(tenantId: number) {
    if (!tenantChoice) return;
    setSelecting(true);
    setError(null);
    try {
      const tokens = await selectTenant(tenantChoice.pre_auth_token, tenantId);
      setToken(tokens.access_token);
      setRefreshToken(tokens.refresh_token);
      onLogin();
    } catch {
      setError("No se pudo entrar a esa empresa. Probá iniciar sesión de nuevo.");
      setTenantChoice(null);
    } finally {
      setSelecting(false);
    }
  }

  if (tenantChoice) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-constructa-bg px-8 py-12">
        <div className="w-full max-w-[420px]">
          <div className="bg-white rounded-2xl shadow-card-md border border-constructa-surface px-8 py-8">
            <div className="flex items-center gap-3 mb-7">
              <img src="/logo.png" alt="Constructa" className="w-8 h-8 rounded object-cover flex-shrink-0" />
              <span className="font-display font-bold text-constructa-text tracking-tight">CONSTRUCTA</span>
            </div>
            <div className="mb-6">
              <h2 className="font-display text-2xl font-bold text-constructa-text tracking-tight mb-1.5">
                Elegí con qué empresa entrar
              </h2>
              <p className="text-sm text-constructa-secondaryText">
                Tu cuenta pertenece a más de una empresa en Constructa.
              </p>
            </div>
            <div className="space-y-2">
              {tenantChoice.tenants.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={selecting}
                  onClick={() => handleSelectTenant(t.id)}
                  className="w-full flex items-center gap-3 text-left px-4 py-3 rounded-lg border border-constructa-border hover:border-constructa-primary hover:bg-constructa-primary/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span
                    className="w-8 h-8 rounded-md flex-shrink-0 flex items-center justify-center text-white font-bold text-xs"
                    style={{ background: "linear-gradient(135deg, #FF8856, #FF6B35)" }}
                  >
                    {t.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-constructa-text">{t.name}</span>
                  <ArrowRightIcon className="w-4 h-4 text-constructa-border ml-auto flex-shrink-0" />
                </button>
              ))}
            </div>
            {error && (
              <div className="mt-4" style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "#FEF2F2", border: "1px solid #FECACA",
                borderRadius: 10, padding: "12px 14px",
              }}>
                <span style={{ fontSize: 13, color: "#B91C1C", fontWeight: 500 }}>{error}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => { setTenantChoice(null); setError(null); }}
              className="mt-5 text-center w-full text-xs text-constructa-primary font-semibold hover:underline"
            >
              Volver a ingresar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full">

      {/* ── Left panel — hero ─────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[58%] xl:w-[55%] flex-shrink-0 relative overflow-hidden">

        {/* Video de fondo */}
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src="/6033941-uhd_2560_1440_30fps.mp4"
          autoPlay
          muted
          loop
          playsInline
        />

        {/* Vignette superior sutil */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent" />

        {/* Contenido anclado al pie */}
        <div
          className="relative z-10 mt-auto w-full px-10 pt-8 pb-10"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 18%)",
            maskImage: "linear-gradient(to bottom, transparent 0%, black 18%)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
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
            className="font-display text-4xl xl:text-5xl font-extrabold text-white leading-[1.1] tracking-tight mb-5"
            style={{
              opacity: ready ? 1 : 0,
              transform: ready ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.55s ease 0.38s, transform 0.55s ease 0.38s",
            }}
          >
            Gestioná obras<br />
            con <span className="text-constructa-primary">precisión.</span>
          </h2>

          {/* Features */}
          <div
            style={{
              opacity: ready ? 1 : 0,
              transform: ready ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 0.5s ease 0.52s, transform 0.5s ease 0.52s",
              borderTop: "1px solid rgba(255,255,255,0.15)",
              paddingTop: 20,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {[
              { Icon: MessageCircle, text: "Avances por WhatsApp, sin instalar nada" },
              { Icon: BarChart2,     text: "Gantt con ruta crítica y cascada" },
              { Icon: Bell,          text: "Alertas de demoras y tareas bloqueadas" },
              { Icon: FileUp,        text: "Importá desde Excel o MS Project" },
            ].map(({ Icon, text }, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: "rgba(255,107,53,0.18)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={14} color="#FF6B35" />
                </span>
                <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.78)", lineHeight: 1.35, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {text}
                </span>
              </div>
            ))}
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
              {mode === "login" ? "Accedé al sistema" : mode === "forgot" ? "Recuperá tu contraseña" : "Creá tu cuenta"}
            </h2>
            <p className="text-sm text-constructa-secondaryText">
              {mode === "login"
                ? "Ingresá tus credenciales para continuar."
                : mode === "forgot"
                  ? "Ingresá tu email y te enviamos un enlace para elegir una nueva."
                  : "Tu empresa, tus obras, tu equipo — en 30 segundos."}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Nombre + Empresa — solo registro */}
            {mode === "register" && (
              <>
                <div>
                  <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-constructa-secondaryText mb-2">
                    Tu nombre
                  </label>
                  <div className="relative flex items-center bg-white border rounded-lg focus-within:ring-2 transition-all duration-200 border-constructa-border focus-within:border-constructa-primary focus-within:ring-constructa-primary/15">
                    <UserIcon className="absolute left-3.5 w-4 h-4 text-constructa-border flex-shrink-0" />
                    <input
                      type="text"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => { setFullName(e.target.value); setError(null); }}
                      placeholder="Raúl Méndez"
                      className="w-full pl-10 pr-4 py-3 bg-transparent text-sm text-constructa-text placeholder-constructa-border focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-constructa-secondaryText mb-2">
                    Empresa / Estudio <span className="normal-case tracking-normal">(opcional)</span>
                  </label>
                  <div className="relative flex items-center bg-white border rounded-lg focus-within:ring-2 transition-all duration-200 border-constructa-border focus-within:border-constructa-primary focus-within:ring-constructa-primary/15">
                    <BuildingOffice2Icon className="absolute left-3.5 w-4 h-4 text-constructa-border flex-shrink-0" />
                    <input
                      type="text"
                      autoComplete="organization"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Constructora del Sur"
                      className="w-full pl-10 pr-4 py-3 bg-transparent text-sm text-constructa-text placeholder-constructa-border focus:outline-none"
                    />
                  </div>
                </div>
              </>
            )}

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

            {/* Password — oculto en modo "olvidé mi contraseña" */}
            {mode !== "forgot" && (
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
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={mode === "register" ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "Mínimo 8 caracteres" : "••••••••••"}
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
            )}

            {/* Éxito del envío de recuperación */}
            {mode === "forgot" && forgotSent && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "#E4F3EC", border: "1px solid #BFE3CE",
                borderRadius: 10, padding: "12px 14px",
              }}>
                <span style={{ fontSize: 13, color: "#136E47", fontWeight: 500 }}>
                  Si el email existe, te enviamos un enlace para recuperar tu contraseña. Revisá tu correo.
                </span>
              </div>
            )}

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
                    {mode === "register" ? "Creando cuenta..." : mode === "forgot" ? "Enviando..." : "Ingresando..."}
                  </span>
                ) : (
                  <>
                    {mode === "register" ? "Crear cuenta y empezar" : mode === "forgot" ? "Enviar enlace" : "Ingresar"}
                    <ArrowRightIcon className="w-4 h-4" />
                  </>
                )}
              </button>
              {mode === "login" ? (
                <>
                  <p className="text-center text-xs text-constructa-secondaryText mt-3 mb-0">
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-constructa-primary font-semibold hover:underline"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </p>
                  <p className="text-center text-xs text-constructa-secondaryText mt-2 mb-0">
                    ¿Primera vez en CONSTRUCTA?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("register")}
                      className="text-constructa-primary font-semibold hover:underline"
                    >
                      Creá la cuenta de tu empresa
                    </button>
                  </p>
                </>
              ) : mode === "forgot" ? (
                <p className="text-center text-xs text-constructa-secondaryText mt-3 mb-0">
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="text-constructa-primary font-semibold hover:underline"
                  >
                    Volver a ingresar
                  </button>
                </p>
              ) : (
                <p className="text-center text-xs text-constructa-secondaryText mt-3 mb-0">
                  ¿Ya tenés cuenta?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="text-constructa-primary font-semibold hover:underline"
                  >
                    Ingresá
                  </button>
                </p>
              )}
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
