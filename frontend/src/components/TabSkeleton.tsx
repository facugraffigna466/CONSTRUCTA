// Skeleton loader para los tabs de la obra — reemplaza al spinner genérico.
// Imita la estructura de una lista de tareas: filas con avatar, texto y pill.

const shimmer: React.CSSProperties = {
  background: "linear-gradient(90deg, #F0EEE9 25%, #F8F6F1 50%, #F0EEE9 75%)",
  backgroundSize: "200% 100%",
  animation: "skeleton-shimmer 1.4s ease-in-out infinite",
  borderRadius: 6,
};

function Bar({ w, h = 12, r = 6 }: { w: number | string; h?: number; r?: number }) {
  return <div style={{ ...shimmer, width: w, height: h, borderRadius: r }} />;
}

export function TabSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, overflow: "hidden" }}>
      <style>{`@keyframes skeleton-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>

      {/* Header */}
      <div style={{ display: "flex", gap: 24, padding: "12px 16px", borderBottom: "1px solid #F2F0EC" }}>
        <Bar w={120} h={10} />
        <Bar w={70} h={10} />
        <Bar w={70} h={10} />
        <Bar w={100} h={10} />
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex", alignItems: "center", gap: 16,
            padding: "14px 16px",
            borderBottom: i < rows - 1 ? "1px solid #F2F0EC" : "none",
            opacity: 1 - i * 0.09,
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            <Bar w={`${62 - (i % 3) * 14}%`} h={13} />
            <Bar w={`${34 - (i % 2) * 10}%`} h={9} />
          </div>
          <Bar w={88} h={22} r={99} />
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Bar w={26} h={26} r={99} />
            <Bar w={72} h={11} />
          </div>
          <Bar w={76} h={11} />
        </div>
      ))}
    </div>
  );
}
