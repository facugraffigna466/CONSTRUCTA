import { useEffect, useState } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { fetchMonthlyInsights } from "../api/monthlyInsights";
import { ALERT_LABEL } from "../lib/alertMeta";
import type { AlertType, MonthlyInsights } from "../types";

// I-12 a I-16 — lo que ya calcula obra_stats_service.py mensualmente pero hoy
// solo alimenta el informe HTML interno. Colapsado por defecto (mismo patrón
// que ObraCompletenessChecklist): es material de reunión, no de control
// diario. El ranking por responsable (D-01) solo llega si el backend decidió
// mandarlo — acá no se vuelve a chequear rol, ya viene filtrado.
// D-04: top_deviations trae el paquete de evidencia crudo (responsible_id,
// historial con payloads, triggered_by). Acá se muestra un resumen curado:
// `responsible_id` no se lee a propósito —es evidencia de una tarea, no un
// señalamiento de persona— y el resto queda afuera por ruido, no por
// privacidad (`triggered_by` es el canal: user | chatbot | system).

const CATEGORY_LABEL: Record<string, string> = {
  falta_material: "Falta de material",
  clima: "Clima",
  ausencia_personal: "Ausencia de personal",
  proveedor: "Proveedores",
  problema_tecnico: "Problema técnico",
  equipos_maquinaria: "Equipos y maquinaria",
  seguridad: "Seguridad",
};

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${MESES[parseInt(m, 10) - 1]} ${y}`;
}

function formatHours(hours: number): string {
  return hours >= 48 ? `${Math.round(hours / 24)} días` : `${Math.round(hours)} h`;
}

export function MonthlyInsightsAccordion({ obraId }: { obraId?: number }) {
  const storageKey = `monthly_insights_collapsed_${obraId}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) !== "0"; } catch { return true; }
  });
  const [data, setData] = useState<MonthlyInsights | null>(null);

  useEffect(() => {
    if (!obraId) return;
    let cancelled = false;
    fetchMonthlyInsights(obraId).then((r) => { if (!cancelled) setData(r); }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [obraId]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  if (!data) return null;

  const byTask = data.risk_concentration?.by_task;
  const byResponsible = data.risk_concentration?.by_responsible;
  const disciplinas = data.estimation_accuracy?.by_discipline ?? [];
  const deviationItems = data.top_deviations?.items ?? [];
  const temas = data.bitacora_themes?.categories ?? [];
  const maxMentions = Math.max(1, ...temas.map((t) => t.mentions));
  const reaccion = data.alert_reaction?.by_type ?? [];
  const unresolvedByType = data.alert_reaction?.alerts_unresolved_by_type ?? {};

  return (
    <section style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden" }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "14px 20px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <ClipboardList style={{ width: 15, height: 15, color: "#FF6B35" }} />
        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>
          Análisis del período
        </span>
        {data.available && data.period && (
          <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 99, background: "#F0F1EF", color: "#5B6770", fontFamily: "'JetBrains Mono', monospace" }}>
            {formatPeriod(data.period)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ChevronDown style={{ width: 16, height: 16, color: "#A0ABB4", transform: collapsed ? "none" : "rotate(180deg)", transition: "transform 0.15s" }} />
      </button>

      {!collapsed && (
        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
          {!data.available ? (
            <div style={{ fontSize: 13, color: "#6B7580" }}>Disponible a partir del cierre del próximo mes.</div>
          ) : (
            <>
              {deviationItems.length > 0 ? (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A0ABB4", marginBottom: 8 }}>
                    Tareas con mayor desvío
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {deviationItems.map((item) => {
                      const days = item.task.deviation_days;
                      const mentions = item.bitacora_mentions.slice(0, 3);
                      // Tareas dependientes que SE reprogramaron por una cascada real, no
                      // solo las que dependen estructuralmente de esta (direct_dependent_count
                      // cuenta el grafo, no si la cascada disparó).
                      const pushed = item.cascade_impact.tasks_pushed_by_cascade.length;
                      return (
                        <div key={item.task.task_id} style={{ border: "1px solid #EEEFED", borderRadius: 10, padding: "10px 12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.task.title}
                            </span>
                            <span style={{ color: days > 0 ? "#D03A3A" : "#1F8A5B", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                              {days > 0 ? "+" : ""}{days}d
                            </span>
                          </div>
                          {(mentions.length > 0 || pushed > 0 || item.alerts.length > 0) && (
                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              {mentions.map((m) => (
                                <span
                                  key={m.bitacora_id}
                                  title={m.summary ?? undefined}
                                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "#F0F1EF", color: "#5B6770" }}
                                >
                                  {m.categories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}
                                </span>
                              ))}
                              {item.alerts.length > 0 && (
                                <span style={{ fontSize: 11, color: "#A0ABB4" }}>
                                  {item.alerts.length} alerta{item.alerts.length === 1 ? "" : "s"}
                                </span>
                              )}
                              {pushed > 0 && (
                                <span style={{ fontSize: 11, color: "#A0ABB4" }}>→ empujó {pushed} tarea{pushed === 1 ? "" : "s"}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : byTask && byTask.ranking.length > 0 && (
                // Fallback para snapshots calculados antes de I-14 (metrics sin
                // top_deviations). Se puede borrar cuando ya no queden snapshots
                // viejos sin recalcular — no hay forma de saberlo desde acá.
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A0ABB4", marginBottom: 8 }}>
                    Tareas con mayor desvío
                  </div>
                  <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                    {byTask.ranking.slice(0, 5).map((t) => (
                      <li key={t.task_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#1A2329" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 12 }}>{t.title}</span>
                        <span style={{ color: "#D03A3A", fontWeight: 600, flexShrink: 0 }}>+{t.delay_days}d</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {byResponsible && byResponsible.ranking.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A0ABB4", marginBottom: 8 }}>
                    Por responsable
                  </div>
                  <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                    {byResponsible.ranking.slice(0, 5).map((r) => (
                      <li key={r.responsible_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#1A2329" }}>
                        <span>{r.name ?? "Sin nombre"}</span>
                        <span style={{ color: "#D03A3A", fontWeight: 600 }}>+{r.delay_days}d en {r.task_count} tarea{r.task_count === 1 ? "" : "s"}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {temas.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A0ABB4", marginBottom: 8 }}>
                    Problemas recurrentes en bitácora
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {temas.map((t) => {
                      const barPct = (t.mentions / maxMentions) * 100;
                      const delayPct = (t.mentions_followed_by_delay / maxMentions) * 100;
                      const mentionWord = t.mentions === 1 ? "mención" : "menciones";
                      const rateLabel = t.mentions >= 3
                        ? `${Math.round(t.correlation_rate * 100)}% con retraso después`
                        : `${t.mentions} ${mentionWord}, ${t.mentions_followed_by_delay} con retraso después`;
                      return (
                        <div key={t.category}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#1A2329", marginBottom: 3 }}>
                            <span>{CATEGORY_LABEL[t.category] ?? t.category}</span>
                            <span style={{ color: "#5B6770" }}>{rateLabel}</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 99, background: "#F0F1EF", overflow: "hidden", position: "relative" }}>
                            <span style={{ display: "block", height: "100%", width: `${barPct}%`, background: "#FDBFA0" }} />
                            <span style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${delayPct}%`, background: "#D03A3A" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* La advertencia sale de `bitacora_themes.note`, que el propio motor
                      declara junto al dato (I-15). Escribirla acá a mano la dejaría vieja
                      el día que cambie la ventana de correlación o el método de matcheo. */}
                  <div style={{ fontSize: 11, color: "#A0ABB4", marginTop: 6 }}>
                    {data.bitacora_themes?.note}
                  </div>
                </div>
              )}

              {disciplinas.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A0ABB4", marginBottom: 8 }}>
                    Precisión de estimación por disciplina
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {disciplinas.map((d) => {
                      const pct = Math.min(100, Math.abs(d.avg_deviation_percent));
                      return (
                        <div key={d.discipline}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#1A2329", marginBottom: 3 }}>
                            <span>{d.discipline}</span>
                            <span style={{ fontWeight: 600, color: d.avg_deviation_percent > 0 ? "#D03A3A" : "#1F8A5B" }}>
                              {d.avg_deviation_percent > 0 ? "+" : ""}{Math.round(d.avg_deviation_percent)}%
                            </span>
                          </div>
                          <div style={{ height: 5, borderRadius: 99, background: "#F0F1EF", overflow: "hidden" }}>
                            <span style={{ display: "block", height: "100%", width: `${pct}%`, background: d.avg_deviation_percent > 0 ? "#D03A3A" : "#1F8A5B" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {reaccion.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#A0ABB4", marginBottom: 8 }}>
                    Velocidad de reacción a alertas
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {reaccion.map((r) => {
                      const unresolved = unresolvedByType[r.type] ?? 0;
                      return (
                        <div key={r.type} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#1A2329" }}>
                          <span>{ALERT_LABEL[r.type as AlertType] ?? r.type}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 600 }}>{formatHours(r.avg_hours)} promedio</span>
                            {unresolved > 0 && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 99, background: "#FCE5E5", color: "#D03A3A" }}>
                                {unresolved} sin resolver
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
