import { Rocket, X } from "lucide-react";

export interface PlanLimitInfo {
  message: string;
  resource?: string;
  current?: number;
  limit?: number;
  plan?: string;
}

/** Extrae la info de límite de plan de un error HTTP 402, o null si no es 402. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPlanLimitError(err: unknown): PlanLimitInfo | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = (err as any)?.response;
  if (resp?.status !== 402) return null;
  const d = resp.data?.detail;
  if (d && typeof d === "object" && d.message) {
    return { message: d.message, resource: d.resource, current: d.current, limit: d.limit, plan: d.plan };
  }
  return { message: "Alcanzaste el límite de tu plan. Actualizá para continuar." };
}

const PLAN_LABEL: Record<string, string> = {
  basico: "Básico", pro: "Pro", enterprise: "Enterprise",
};

export function UpgradeModal({ info, onClose }: { info: PlanLimitInfo; onClose: () => void }) {
  const nextPlan = info.plan === "basico" ? "Pro" : "Enterprise";
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 95,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(15,22,28,0.55)", backdropFilter: "blur(3px)", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 18, width: "100%", maxWidth: 420,
        boxShadow: "0 32px 64px -16px rgba(15,22,28,0.35)",
        fontFamily: "'Plus Jakarta Sans', sans-serif", overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #FF8856 0%, #E85A26 100%)",
          padding: "22px 24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Rocket style={{ width: 19, height: 19, color: "#fff" }} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16.5, fontWeight: 800, color: "#fff" }}>
                Llegaste al límite de tu plan
              </h2>
              {info.plan && (
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                  Plan actual: {PLAN_LABEL[info.plan] ?? info.plan}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 8, border: "none", flexShrink: 0,
            background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.8)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>

        <div style={{ padding: "20px 24px 8px" }}>
          <p style={{ margin: 0, fontSize: 13.5, color: "#3E4A52", lineHeight: 1.6 }}>
            {info.message}
          </p>
          {info.current != null && info.limit != null && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#6B7580", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{info.resource}</span>
                <span style={{ fontWeight: 700, color: "#D03A3A" }}>{info.current}/{info.limit}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: "#F0F1EF", overflow: "hidden" }}>
                <div style={{ height: "100%", width: "100%", background: "#D03A3A", borderRadius: 99 }} />
              </div>
            </div>
          )}
          <div style={{
            marginTop: 16, padding: "12px 14px", borderRadius: 11,
            background: "#FFF8F3", border: "1px solid #FDDFC8",
            fontSize: 12.5, color: "#9A5D08", lineHeight: 1.5,
          }}>
            El plan <strong>{nextPlan}</strong> desbloquea más obras, usuarios y tareas.
            Escribinos y lo activamos en el día.
          </div>
        </div>

        <div style={{ padding: "16px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{
            padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
            color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer",
          }}>
            Ahora no
          </button>
          <a
            href="mailto:ventas@constructa.app?subject=Quiero%20actualizar%20mi%20plan"
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none",
              padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
              background: "#FF6B35", color: "#fff", border: "none", cursor: "pointer",
              boxShadow: "0 6px 14px -6px rgba(255,107,53,0.5)",
            }}
          >
            <Rocket style={{ width: 13, height: 13 }} />
            Quiero el plan {nextPlan}
          </a>
        </div>
      </div>
    </div>
  );
}
