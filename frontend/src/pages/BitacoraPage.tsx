const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M10 2a5 5 0 015 5v3a5 5 0 01-10 0V7a5 5 0 015-5z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M3 11a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M10 18v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: "Recepción de audios",
    desc: "Recibí audios directamente desde WhatsApp, tal como se usan en obra hoy.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M6 8h8M6 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
    title: "Transcripción automática",
    desc: "El audio se convierte a texto al instante, sin intervención manual.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "Procesamiento con IA",
    desc: "La IA identifica los puntos clave de la conversación y los organiza como ítems accionables.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M10 2v4M10 14v4M2 10h4M14 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      </svg>
    ),
    title: "Acciones directas",
    desc: "Desde cada ítem podés crear una tarea, generar una alerta o registrar un evento en el historial.",
  },
];

export function BitacoraPage() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "12px 0 40px" }}>

      {/* Header */}
      <div style={{
        background: "#fff",
        border: "1px solid #E6E7E5",
        borderRadius: 20,
        padding: "36px 40px 32px",
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Background decoration */}
        <div style={{
          position: "absolute", top: -30, right: -30,
          width: 180, height: 180, borderRadius: 99,
          background: "radial-gradient(circle, rgba(255,107,53,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{ display: "flex", alignItems: "flex-start", gap: 18, position: "relative" }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: "linear-gradient(135deg, rgba(255,107,53,0.15), rgba(255,107,53,0.06))",
            border: "1px solid rgba(255,107,53,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#FF6B35",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M3 17V6a1 1 0 011-1h16a1 1 0 011 1v10a1 1 0 01-1 1H7l-4 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
              <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif", letterSpacing: "-0.02em" }}>
                Bitácora de Obra
              </h1>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                padding: "3px 9px", borderRadius: 99,
                background: "rgba(255,107,53,0.1)", color: "#FF6B35",
                border: "1px solid rgba(255,107,53,0.2)",
                textTransform: "uppercase",
              }}>
                Próximamente
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: "#5B6770", lineHeight: 1.6 }}>
              Capturá lo que realmente se habla en obra — a través de audios de WhatsApp — y convertilo en información útil y accionable sin esfuerzo adicional.
            </p>
          </div>
        </div>
      </div>

      {/* Features grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{
            background: "#fff",
            border: "1px solid #E6E7E5",
            borderRadius: 14,
            padding: "20px 22px",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, marginBottom: 12,
              background: "#F4F5F4",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#4D5760",
            }}>
              {f.icon}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1A2329", marginBottom: 5, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {f.title}
            </div>
            <div style={{ fontSize: 12.5, color: "#6B767E", lineHeight: 1.55 }}>
              {f.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Flow diagram */}
      <div style={{
        background: "#fff",
        border: "1px solid #E6E7E5",
        borderRadius: 14,
        padding: "24px 28px",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#A0ABB4", textTransform: "uppercase", marginBottom: 16 }}>
          Flujo del módulo
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", rowGap: 8 }}>
          {[
            { label: "Audio WhatsApp", color: "#25D366" },
            { label: "Transcripción", color: "#3D8BFF" },
            { label: "Análisis IA", color: "#B07CF7" },
            { label: "Ítems clave", color: "#FF6B35" },
            { label: "Tarea / Alerta / Evento", color: "#1F8A5B" },
          ].map((step, i) => (
            <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 0 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "6px 12px", borderRadius: 99,
                background: `${step.color}12`,
                border: `1px solid ${step.color}30`,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: step.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "#3D4A52", whiteSpace: "nowrap" }}>{step.label}</span>
              </div>
              {i < 4 && (
                <svg width="20" height="12" viewBox="0 0 20 12" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M0 6h16M12 2l4 4-4 4" stroke="#C9D0D5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
