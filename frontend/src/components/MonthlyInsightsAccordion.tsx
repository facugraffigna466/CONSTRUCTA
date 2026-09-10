import { useEffect, useState } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { fetchMonthlyInsights } from "../api/monthlyInsights";
import type { MonthlyInsights } from "../types";

// I-12/I-13 — lo que ya calcula obra_stats_service.py mensualmente pero hoy
// solo alimenta el informe HTML interno. Colapsado por defecto (mismo patrón
// que ObraCompletenessChecklist): es material de reunión, no de control
// diario. El ranking por responsable (D-01) solo llega si el backend decidió
// mandarlo — acá no se vuelve a chequear rol, ya viene filtrado.

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${MESES[parseInt(m, 10) - 1]} ${y}`;
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
              {byTask && byTask.ranking.length > 0 && (
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
            </>
          )}
        </div>
      )}
    </section>
  );
}
