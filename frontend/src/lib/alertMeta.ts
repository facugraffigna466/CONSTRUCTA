import {
  AlertTriangle, Boxes, CalendarClock, CalendarX, Clock, Flag, Gauge,
  MessageCircle, OctagonAlert, Package, PackageX, Repeat, Route, TrendingDown, UserX,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import type { Alert, AlertSeverity, AlertType } from "../types";

/**
 * Fuente única de verdad para cómo se ve y cómo se llama cada alerta.
 *
 * Antes cada componente (AlertasTab, AlertBell, CriticalAlertToast) tenía su
 * propio `Record<AlertType, …>` con colores y etiquetas repetidos. Con 6 tipos se
 * podía convivir; con 17 (los 11 de docs/propuesta-reglas-riesgo.md) cualquier
 * agregado obligaba a tocar tres archivos y era cuestión de tiempo que se
 * desincronizaran.
 */

export interface Palette {
  /** Barra de acento a la izquierda de la fila. */
  bar: string;
  bg: string;
  color: string;
  border: string;
}

/** El color lo manda la SEVERIDAD, no el tipo.
 *
 * Con 17 tipos, una paleta por tipo son 17 colores sin jerarquía entre sí: el
 * lector no puede saber de un vistazo qué mirar primero. La severidad sí ordena,
 * y es justamente el dato que las reglas nuevas calculan. */
export const SEVERITY_PALETTE: Record<AlertSeverity, Palette> = {
  critica: { bar: "#D03A3A", bg: "#FCE5E5", color: "#D03A3A", border: "#F0B0B0" },
  alta:    { bar: "#E76A2D", bg: "#FFF1E9", color: "#C4551C", border: "#FDBFA0" },
  media:   { bar: "#E89B14", bg: "#FDF1DE", color: "#C97D0E", border: "#F0D5A0" },
  baja:    { bar: "#2A6FDB", bg: "#E5EEFB", color: "#2A6FDB", border: "#B8CCF5" },
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

/** De mayor a menor. Sirve para ordenar y para comparar umbrales. */
export const SEVERITY_ORDER: AlertSeverity[] = ["critica", "alta", "media", "baja"];

type IconComponent = ComponentType<{ size?: number; style?: CSSProperties }>;

export const ALERT_LABEL: Record<AlertType, string> = {
  task_blocked: "Tarea bloqueada",
  delay_risk: "Riesgo de demora",
  task_overdue: "Tarea vencida",
  no_response: "Sin respuesta",
  reschedule_requested: "Reprogramación solicitada",
  order_received: "Pedido recibido",
  critical_task_delayed: "Ruta crítica",
  float_shrinking: "Holgura en baja",
  baseline_deviation: "Desvío de línea base",
  material_pending_too_long: "Material sin pedir",
  order_sent_no_confirmation: "Pedido sin confirmar",
  material_blocking_task: "Material faltante",
  progress_stalled: "Avance estancado",
  deadline_conflicts_holiday: "Vence en día no laborable",
  recurring_blocker: "Bloqueo recurrente",
  chronic_no_response: "Responsable sin respuesta",
  milestone_at_risk: "Hito en riesgo",
};

export const ALERT_ICON: Record<AlertType, IconComponent> = {
  task_blocked: OctagonAlert,
  delay_risk: AlertTriangle,
  task_overdue: Clock,
  no_response: MessageCircle,
  reschedule_requested: CalendarClock,
  order_received: Package,
  critical_task_delayed: Route,
  float_shrinking: TrendingDown,
  baseline_deviation: Gauge,
  material_pending_too_long: Boxes,
  order_sent_no_confirmation: PackageX,
  material_blocking_task: Boxes,
  progress_stalled: Gauge,
  deadline_conflicts_holiday: CalendarX,
  recurring_blocker: Repeat,
  chronic_no_response: UserX,
  milestone_at_risk: Flag,
};

/** Severidad de una alerta, tolerante con datos viejos.
 *
 * Las alertas creadas antes de la migración 0062 llegan sin `severity` (o con un
 * valor que el front todavía no conoce): se las trata como "media" en vez de
 * romper el render. */
export function severityOf(alert: Pick<Alert, "severity">): AlertSeverity {
  return alert.severity in SEVERITY_PALETTE ? alert.severity : "media";
}

export function paletteOf(alert: Pick<Alert, "severity">): Palette {
  return SEVERITY_PALETTE[severityOf(alert)];
}

export function labelOf(alert: Pick<Alert, "type" | "message">): string {
  // delay_risk agrupa cinco sub-condiciones bajo un mismo tipo, así que se
  // desambigua por el mensaje: es lo único que las distingue. Las reglas nuevas
  // no necesitan esto — cada una tiene su propio tipo.
  if (alert.type === "delay_risk") {
    const msg = alert.message.toLowerCase();
    if (msg.includes("responsable")) return "Sin responsable";
    if (msg.includes("vencida")) return "Tarea vencida";
    return "Riesgo de demora";
  }
  return ALERT_LABEL[alert.type] ?? "Alerta";
}

export function iconOf(alert: Pick<Alert, "type">): IconComponent {
  return ALERT_ICON[alert.type] ?? AlertTriangle;
}
