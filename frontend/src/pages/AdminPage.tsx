import { useEffect, useState } from "react";
import { Building2, Crown, RefreshCw, Users, Zap } from "lucide-react";
import { fetchPlanUsage } from "../api/admin";
import type { PlanUsage } from "../types";

const C = {
  good: "#1F8A5B", good50: "#E4F3EC",
  warn: "#C97D0E", warn50: "#FDF1DE",
  danger: "#D03A3A", danger50: "#FCE5E5",
  secondary: "#FF6B35", secondary50: "#FFF1E9",
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", bg: "#F4F5F4", surface: "#fff",
};

function UsageBar({ label, icon, current, limit }: {
  label: string;
  icon: React.ReactNode;
  current: number;
  limit: number | null;
}) {
  const pct = limit ? Math.min((current / limit) * 100, 100) : 0;
  const isNear   = limit !== null && current / limit >= 0.8;
  const isAt     = limit !== null && current >= limit;
  const barColor = isAt ? C.danger : isNear ? C.warn : C.good;

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: isAt ? C.danger50 : isNear ? C.warn50 : C.good50, color: isAt ? C.danger : isNear ? C.warn : C.good, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {icon}
          </div>
          <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14, color: C.text }}>{label}</span>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: isAt ? C.danger : C.text }}>
          {current}
          {limit !== null ? <span style={{ color: C.text3, fontWeight: 400 }}> / {limit}</span> : <span style={{ fontSize: 11, color: C.text3, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 400 }}> ilimitado</span>}
        </span>
      </div>
      {limit !== null && (
        <>
          <div style={{ height: 8, borderRadius: 99, background: C.bg, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: barColor, transition: "width .4s" }} />
          </div>
          {isAt && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: C.danger, fontWeight: 500 }}>
              Límite alcanzado — necesitás mejorar tu plan para agregar más.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function AdminPage() {
  const [usage, setUsage]     = useState<PlanUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const u = await fetchPlanUsage();
      setUsage(u);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const plan = usage?.tenant.plan;
  const planLabel = plan ? plan.name.charAt(0).toUpperCase() + plan.name.slice(1) : "Sin plan";

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 28, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.025em" }}>
            Panel Admin
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: C.text2 }}>Métricas del tenant y gestión del plan</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.surface, color: C.text2, fontSize: 13, cursor: "pointer" }}
        >
          <RefreshCw size={14} style={{ animation: loading ? "spin .8s linear infinite" : "none" }} />
          Actualizar
        </button>
      </div>

      {loading && !usage && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: C.text3, fontSize: 14 }}>
          Cargando métricas…
        </div>
      )}

      {error && (
        <div style={{ padding: "16px 18px", borderRadius: 12, background: C.danger50, color: C.danger, fontSize: 13 }}>
          Error al cargar métricas. Verificá que el servidor esté corriendo.
        </div>
      )}

      {usage && (
        <>
          {/* Plan card */}
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "20px 22px", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: C.secondary50, color: C.secondary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Crown size={18} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 16, color: C.text }}>{usage.tenant.name}</span>
                  <span style={{ padding: "2px 10px", borderRadius: 99, background: C.secondary, color: "#fff", fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>{planLabel}</span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.text2 }}>
                  {plan?.price_monthly
                    ? `$${plan.price_monthly}/mes`
                    : plan?.name === "enterprise"
                    ? "Plan Enterprise — precio a consultar"
                    : "Plan sin precio definido"}
                </p>
              </div>
            </div>

            {usage.tenant.active_until && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: C.warn50, fontSize: 12.5, color: C.warn, fontWeight: 500 }}>
                Activo hasta: {new Date(usage.tenant.active_until).toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" })}
              </div>
            )}
          </div>

          {/* Usage bars */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <UsageBar label="Obras" icon={<Building2 size={14} />} current={usage.obras_count} limit={usage.obras_limit} />
            <UsageBar label="Usuarios" icon={<Users size={14} />} current={usage.users_count} limit={usage.users_limit} />
          </div>

          <UsageBar
            label="Tareas totales en el sistema"
            icon={<Zap size={14} />}
            current={usage.tasks_count}
            limit={usage.tasks_per_obra_limit}
          />

          {/* Upgrade CTA */}
          {(usage.obras_limit !== null || usage.users_limit !== null) && (
            <div style={{ marginTop: 20, padding: "18px 20px", borderRadius: 14, background: "linear-gradient(135deg, #FFF8F5 0%, #FFF1E9 100%)", border: `1px solid rgba(255,107,53,0.2)` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <p style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, color: C.text }}>¿Necesitás más capacidad?</p>
                  <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.text2 }}>El plan Pro tiene 20 obras, 30 usuarios y tareas ilimitadas.</p>
                </div>
                <a
                  href="mailto:hola@constructa.app?subject=Quiero mejorar mi plan"
                  style={{ flexShrink: 0, padding: "9px 18px", borderRadius: 9, background: C.secondary, color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", boxShadow: "0 4px 10px -4px rgba(255,107,53,0.5)" }}
                >
                  Contactar
                </a>
              </div>
            </div>
          )}
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
