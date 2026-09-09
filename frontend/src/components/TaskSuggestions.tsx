import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { fetchTaskSuggestions, type Suggestion } from "../api/suggestions";
import { SuggestionCard } from "./SuggestionCard";

const FONT = "'Plus Jakarta Sans', sans-serif";

/**
 * Propuestas de la IA sobre esta tarea, dentro de la tarea.
 *
 * Es el punto del cambio: antes había que acordarse de que existía la pantalla
 * de bitácora, entrar, encontrar la nota y recién ahí decidir. Acá la propuesta
 * aparece donde el jefe ya está mirando el trabajo que la propuesta modifica.
 *
 * Cada tarjeta trae el origen (quién lo reportó y el resumen de la nota) porque
 * en esta pantalla no hay nada alrededor que lo diga, y sin eso no hay con qué
 * decidir.
 */
export function TaskSuggestions({ taskId, onApplied, onResolved }: {
  taskId: number;
  /** La sugerencia ya modificó la tarea en el servidor: el formulario abierto
   *  quedó desactualizado y hay que refrescar desde afuera. */
  onApplied: () => void;
  /** Se resolvió una sugerencia (aplicada o descartada): bajó el pendiente. */
  onResolved?: () => void;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);

  useEffect(() => {
    let alive = true;
    fetchTaskSuggestions(taskId, "pendiente")
      .then(d => { if (alive) setItems(d); })
      .catch(() => { /* sin sugerencias es un estado normal, no un error a mostrar */ });
    return () => { alive = false; };
  }, [taskId]);

  if (items.length === 0) return null;

  return (
    <div style={{
      fontFamily: FONT, background: "#FFFCF9", border: "1px solid #FDDFC8",
      borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Sparkles style={{ width: 14, height: 14, color: "#E85A26" }} />
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "#E85A26" }}>
          {items.length === 1
            ? "La IA propone un cambio en esta tarea"
            : `La IA propone ${items.length} cambios en esta tarea`}
        </span>
      </div>

      {items.map(s => (
        <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {(s.reporter_name || s.entry_summary) && (
            <div style={{ fontSize: 11.5, color: "#7D7973", lineHeight: 1.45 }}>
              De la nota de voz
              {s.reporter_name ? <> de <strong style={{ color: "#5B6770" }}>{s.reporter_name}</strong></> : ""}
              {s.entry_summary ? <> — {s.entry_summary}</> : ""}
            </div>
          )}
          <SuggestionCard
            s={s}
            onResolved={updated => {
              setItems(prev => prev.filter(x => x.id !== updated.id));
              onResolved?.();
              // Descartar no toca la obra; aplicar sí — y en ese caso lo que
              // muestra el formulario abierto ya no es lo que hay en la base.
              if (updated.applied) onApplied();
            }}
          />
        </div>
      ))}
    </div>
  );
}
