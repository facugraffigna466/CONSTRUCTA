import { Sparkles } from "lucide-react";

/**
 * Marca que una tarea tiene propuestas de la IA sin revisar.
 *
 * Sin esto, la tarjeta que vive dentro de la tarea solo se encuentra si ya
 * sabías que estaba: en una obra con decenas de tareas habría que abrirlas una
 * por una. El marcador es lo que convierte la funcionalidad en algo
 * descubrible desde la lista.
 *
 * Con `onClick` es un botón real que lleva directo a las sugerencias (abre la
 * tarea y hace scroll a esa sección) — antes solo tenía un `title` nativo del
 * navegador, que en la práctica nadie encuentra ni deja ver de qué se trata.
 * Sin `onClick` cae al `<span>` de solo-tooltip (compatibilidad hacia atrás
 * para el llamador que todavía no lo cablea).
 */
export function SuggestionMarker({ count, onClick }: { count: number; onClick?: () => void }) {
  if (count <= 0) return null;
  const label = count === 1
    ? "La IA propone un cambio en esta tarea — ver sugerencia"
    : `La IA propone ${count} cambios en esta tarea — ver sugerencias`;
  const style: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
    padding: count > 1 ? "1px 6px 1px 4px" : 2,
    borderRadius: 99,
    background: "#FFF0E8",
    border: "1px solid #FDDFC8",
    color: "#E85A26",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1,
  };
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={label}
        aria-label={label}
        style={{ ...style, cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#FFE3D2"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#FFF0E8"; }}
      >
        <Sparkles style={{ width: 10, height: 10 }} />
        {count > 1 && count}
      </button>
    );
  }
  return (
    <span title={label} aria-label={label} style={style}>
      <Sparkles style={{ width: 10, height: 10 }} />
      {count > 1 && count}
    </span>
  );
}
