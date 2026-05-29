const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M4 3h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    title: "Carga de presupuestos",
    desc: "PDF, Excel, Word, imagen o texto pegado. Cualquier formato que mande el proveedor.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "Lectura inteligente con IA",
    desc: "Detecta automáticamente proveedor, rubros, precios, IVA, plazos y condiciones de pago.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="5" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <rect x="11" y="5" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M9 10h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: "Comparación de presupuestos",
    desc: "Tres presupuestos para el mismo rubro → Constructa te muestra cuál conviene según precio, plazo y condiciones.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M10 2l1.8 5.4H18l-4.9 3.6 1.8 5.4L10 13l-4.9 3.4 1.8-5.4L2 7.4h6.2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
    title: "Detección de inconsistencias",
    desc: 'Sin flete, IVA sin aclarar, validez vencida, precio 18% por encima del promedio — la IA lo marca antes de que vos lo notes.',
  },
];

const DOCUMENTS = [
  "Presupuesto formal para cliente",
  "Solicitud de cotización a proveedor",
  "Comparativa de presupuestos",
  "Orden de compra",
  "Informe de adjudicación",
];

const FIELDS = [
  "Proveedor", "Obra relacionada", "Fecha", "Rubros", "Ítems",
  "Cantidades", "Unidades", "Precios unitarios", "Subtotal",
  "IVA", "Total", "Plazo de entrega", "Condiciones de pago", "Validez",
];

export function PresupuestosPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 0 40px" }}>

      {/* Header */}
      <div style={{
        background: "#fff", border: "1px solid #E6E7E5",
        borderRadius: 20, padding: "36px 40px 32px",
        marginBottom: 20, position: "relative", overflow: "hidden",
      }}>
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
              <path d="M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif", letterSpacing: "-0.02em" }}>
                Gestión de Presupuestos
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
              Módulo inteligente de gestión documental de presupuestos. Cargá presupuestos de proveedores, generá los propios desde Constructa y dejá que la IA los estructure, compare y analice automáticamente.
            </p>
          </div>
        </div>
      </div>

      {/* Features grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{
            background: "#fff", border: "1px solid #E6E7E5",
            borderRadius: 14, padding: "20px 22px",
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

      {/* Two columns: fields detected + documents */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

        {/* Fields the AI detects */}
        <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#A0ABB4", textTransform: "uppercase", marginBottom: 14 }}>
            Datos que extrae la IA
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {FIELDS.map(f => (
              <span key={f} style={{
                fontSize: 11.5, padding: "3px 10px", borderRadius: 99,
                background: "#F4F5F4", color: "#4D5760",
                border: "1px solid #E6E7E5",
              }}>{f}</span>
            ))}
          </div>
        </div>

        {/* Documents it generates */}
        <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#A0ABB4", textTransform: "uppercase", marginBottom: 14 }}>
            Documentos que genera
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {DOCUMENTS.map(d => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: "#FF6B35", flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: "#3D4A52" }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
