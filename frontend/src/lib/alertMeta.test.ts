import { describe, expect, it } from "vitest";

import {
  ALERT_ICON,
  ALERT_LABEL,
  SEVERITY_ORDER,
  SEVERITY_PALETTE,
  labelOf,
  paletteOf,
  severityOf,
} from "./alertMeta";
import type { Alert, AlertType } from "../types";

/** Los 17 tipos que el backend puede emitir (models/alert.py). Escritos a mano
 *  a propósito: si el backend suma uno y nadie toca el frontend, este listado
 *  deja de coincidir con los Record exhaustivos y el test avisa. */
const TIPOS: AlertType[] = [
  "task_blocked", "delay_risk", "task_overdue", "no_response",
  "reschedule_requested", "order_received",
  "critical_task_delayed", "float_shrinking", "baseline_deviation",
  "material_pending_too_long", "order_sent_no_confirmation", "material_blocking_task",
  "progress_stalled", "deadline_conflicts_holiday",
  "recurring_blocker", "chronic_no_response", "milestone_at_risk",
];

function alerta(over: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    obra_id: 1,
    task_id: 1,
    type: "critical_task_delayed",
    severity: "critica",
    message: "La tarea «X» está en la ruta crítica.",
    is_read: false,
    created_at: "2026-09-04T10:00:00Z",
    ...over,
  };
}

describe("catálogo de tipos", () => {
  it("cubre los 17 tipos con etiqueta e ícono", () => {
    expect(Object.keys(ALERT_LABEL).sort()).toEqual([...TIPOS].sort());
    expect(Object.keys(ALERT_ICON).sort()).toEqual([...TIPOS].sort());
  });

  it("no repite etiquetas entre tipos distintos", () => {
    const etiquetas = Object.values(ALERT_LABEL);
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
  });
});

describe("severityOf", () => {
  it("respeta la severidad que manda el backend", () => {
    expect(severityOf(alerta({ severity: "alta" }))).toBe("alta");
  });

  it("cae en media ante una severidad desconocida", () => {
    // Cubre las alertas anteriores a la migración que agregó la columna: llegan
    // sin severidad y no deben romper el render.
    expect(severityOf({ severity: undefined as never })).toBe("media");
    expect(severityOf({ severity: "inventada" as never })).toBe("media");
  });
});

describe("paletteOf", () => {
  it("colorea por severidad y no por tipo", () => {
    // Dos tipos distintos con la misma severidad comparten color: es lo que
    // permite que el lector sepa qué mirar primero.
    const hito = paletteOf(alerta({ type: "milestone_at_risk", severity: "critica" }));
    const ruta = paletteOf(alerta({ type: "critical_task_delayed", severity: "critica" }));
    expect(hito).toEqual(ruta);

    const baja = paletteOf(alerta({ severity: "baja" }));
    expect(baja).not.toEqual(ruta);
  });

  it("define las cuatro severidades", () => {
    expect(Object.keys(SEVERITY_PALETTE).sort()).toEqual([...SEVERITY_ORDER].sort());
  });
});

describe("labelOf", () => {
  it("usa la etiqueta del tipo", () => {
    expect(labelOf(alerta({ type: "recurring_blocker" }))).toBe("Bloqueo recurrente");
  });

  it("desambigua delay_risk por el mensaje", () => {
    // delay_risk agrupa cinco sub-condiciones bajo un mismo tipo; el mensaje es
    // lo único que las distingue.
    const base = { type: "delay_risk" as const };
    expect(labelOf({ ...base, message: "La tarea «X» no tiene responsable asignado." }))
      .toBe("Sin responsable");
    expect(labelOf({ ...base, message: "La tarea «X» está vencida desde el 01/09/2026." }))
      .toBe("Tarea vencida");
    // A nivel obra: contiene "vencidas" pero no habla de ninguna tarea puntual.
    expect(labelOf({ ...base, message: "El 40% de las tareas activas de la obra están vencidas." }))
      .toBe("Riesgo de demora");
    expect(labelOf({ ...base, message: "La obra tiene 3 tareas bloqueadas." }))
      .toBe("Riesgo de demora");
  });

  it("no rompe con un tipo que el frontend todavía no conoce", () => {
    expect(labelOf({ type: "tipo_del_futuro" as AlertType, message: "algo" })).toBe("Alerta");
  });
});
