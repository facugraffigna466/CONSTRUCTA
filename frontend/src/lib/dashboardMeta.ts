/**
 * Umbrales de color del SPI — docs/features/dashboard-indicadores-obra.md, I-03.
 * Los mismos umbrales que usan las reglas de riesgo, para que el panel y las
 * alertas no se contradigan.
 */
export function spiColor(spi: number | null, confidence: "high" | "low" | null): string {
  if (spi === null || confidence === "low") return "#5B6770"; // sin color de alarma: no significa nada todavía
  if (spi >= 0.95) return "#1F8A5B";
  if (spi >= 0.85) return "#D97706";
  return "#D03A3A";
}

export function spiLabel(spi: number | null, confidence: "high" | "low" | null): string {
  if (spi === null || confidence === "low") return "Sin datos suficientes";
  if (spi >= 0.95) return "En fecha";
  if (spi >= 0.85) return "Atención";
  return "Atrasado";
}

const FORECAST_REASON_LABEL: Record<string, string> = {
  no_tasks: "Todavía no hay tareas cargadas.",
  no_dates: "Cargá fechas en las tareas para ver el fin proyectado.",
  spi_unreliable: "Todavía no hay avance suficiente para proyectar una fecha.",
};

export function forecastReasonLabel(reason: string | null): string {
  return (reason && FORECAST_REASON_LABEL[reason]) || "No disponible.";
}
