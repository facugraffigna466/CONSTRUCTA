import { useState } from "react";
import { Building2, Users, ClipboardList, ArrowRight, X } from "lucide-react";

const STORAGE_KEY = "onboarding_done";

export function isOnboardingDone(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return true; }
}

function markDone() {
  try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* ignore */ }
}

const STEPS = [
  {
    Icon: Building2,
    color: "#FF6B35", bg: "#FFF0E8",
    title: "1. Creá tu obra",
    body: "Todo arranca con una obra: nombre, ubicación, fechas y el comitente. Desde el Portfolio, botón \"Nueva obra\" — el asistente te guía en 4 pasos.",
  },
  {
    Icon: Users,
    color: "#2A6FDB", bg: "#EBF3FF",
    title: "2. Sumá a los responsables",
    body: "Cargá a las personas de tu equipo con su WhatsApp. Ellos van a reportar avances desde su teléfono de siempre, sin instalar nada.",
  },
  {
    Icon: ClipboardList,
    color: "#1F8A5B", bg: "#E4F3EC",
    title: "3. Cargá las tareas con fechas",
    body: "Creá el plan de trabajo (o importalo desde Excel / MS Project). Con fechas y responsables asignados, el Gantt, las alertas y el chatbot hacen el resto.",
  },
];

export function OnboardingModal({ onClose, onCreateObra }: { onClose: () => void; onCreateObra?: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function finish() {
    markDone();
    onClose();
  }

  function finishAndCreate() {
    markDone();
    onClose();
    onCreateObra?.();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 90,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(15,22,28,0.55)", backdropFilter: "blur(4px)", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 20, width: "100%", maxWidth: 460,
        boxShadow: "0 32px 64px -16px rgba(15,22,28,0.35)",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #1B2A34 0%, #243642 100%)",
          padding: "22px 26px",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}>
          <div>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#FF8856" }}>
              Bienvenido a CONSTRUCTA
            </p>
            <h2 style={{ margin: "4px 0 0", fontSize: 19, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
              El plan conecta con el campo
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
              Seguís planificando igual que antes. Tu equipo reporta por WhatsApp y todo queda registrado.
            </p>
          </div>
          <button
            onClick={finish}
            title="Saltar"
            style={{
              width: 30, height: 30, borderRadius: 8, border: "none", flexShrink: 0,
              background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.55)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        {/* Step body */}
        <div style={{ padding: "26px 26px 8px", minHeight: 150 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 13, background: current.bg,
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
          }}>
            <current.Icon style={{ width: 21, height: 21, color: current.color }} />
          </div>
          <h3 style={{ margin: "0 0 6px", fontSize: 16.5, fontWeight: 700, color: "#1A2329" }}>
            {current.title}
          </h3>
          <p style={{ margin: 0, fontSize: 13.5, color: "#5B6770", lineHeight: 1.6 }}>
            {current.body}
          </p>
        </div>

        {/* Footer */}
        <div style={{ padding: "18px 26px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Dots */}
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((_, i) => (
              <span key={i} style={{
                width: i === step ? 18 : 7, height: 7, borderRadius: 99,
                background: i === step ? "#FF6B35" : "#E8E5DF",
                transition: "all 0.2s",
              }} />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={finish}
              style={{
                padding: "9px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                color: "#8E97A0", background: "transparent", border: "none", cursor: "pointer",
              }}
            >
              Saltar
            </button>
            <button
              onClick={() => (isLast ? finishAndCreate() : setStep(s => s + 1))}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: "#FF6B35", color: "#fff", border: "none", cursor: "pointer",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
              }}
            >
              {isLast ? "Crear mi primera obra" : "Siguiente"}
              {!isLast && <ArrowRight style={{ width: 13, height: 13 }} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
