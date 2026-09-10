// Separado de UpgradeModal.tsx: un archivo de componente solo puede exportar
// componentes (Fast Refresh de Vite se rompe si además exporta un tipo/función).

export interface PlanLimitInfo {
  message: string;
  resource?: string;
  current?: number;
  limit?: number;
  plan?: string;
  /** "plan_expired" = el plan venció (hay que RENOVAR el mismo plan, no subir
   * de categoría); "plan_limit_reached" (u otro) = tocó techo del plan (ahí sí
   * tiene sentido ofrecer subir de plan). */
  code?: string;
}

/** Extrae la info de límite de plan de un error HTTP 402, o null si no es 402. */
export function getPlanLimitError(err: unknown): PlanLimitInfo | null {
  const resp = (err as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  if (resp?.status !== 402) return null;
  const d = resp.data?.detail as Record<string, unknown> | undefined;
  if (d && typeof d === "object" && d.message) {
    return {
      message: d.message as string,
      resource: d.resource as string | undefined,
      current: d.current as number | undefined,
      limit: d.limit as number | undefined,
      plan: d.plan as string | undefined,
      code: d.code as string | undefined,
    };
  }
  return { message: "Alcanzaste el límite de tu plan. Actualizá para continuar." };
}
