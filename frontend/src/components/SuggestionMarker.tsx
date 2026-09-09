import { Sparkles } from "lucide-react";

/**
 * Marca que una tarea tiene propuestas de la IA sin revisar.
 *
 * Sin esto, la tarjeta que vive dentro de la tarea solo se encuentra si ya
 * sabías que estaba: en una obra con decenas de tareas habría que abrirlas una
 * por una. El marcador es lo que convierte la funcionalidad en algo
 * descubrible desde la lista.
 *
 * No es un botón. La acción —abrir la tarea— ya existe en cada vista (el lápiz
 * en la tabla, el doble clic en la planilla, la barra en el Gantt); agregarle
 * otro objetivo clickeable a la fila competiría con la edición en línea y con
 * el arrastre del Gantt.
 */
export function SuggestionMarker({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count === 1
    ? "La IA propone un cambio en esta tarea, sin revisar"
    : `La IA propone ${count} cambios en esta tarea, sin revisar`;
  return (
    <span
      title={label}
      aria-label={label}
      style={{
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
      }}
    >
      <Sparkles style={{ width: 10, height: 10 }} />
      {count > 1 && count}
    </span>
  );
}
