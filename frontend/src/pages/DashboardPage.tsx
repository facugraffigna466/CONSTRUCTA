import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchAlerts, markAlertRead } from "../api/alerts";
import { fetchHistorial } from "../api/historial";
import { fetchTasksByObra } from "../api/tasks";
import { AlertsPanel } from "../components/AlertsPanel";
import { HistorialPanel } from "../components/HistorialPanel";
import { Spinner } from "../components/Spinner";
import { StatCard } from "../components/StatCard";
import { TaskTable } from "../components/TaskTable";
import { Card } from "../components/ui/Card";
import { SectionTitle } from "../components/ui/SectionTitle";
import type { Alert, HistorialEvento, Task } from "../types";

interface DashboardPageProps {
  obraId: number;
}

export function DashboardPage({ obraId }: DashboardPageProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allAlerts, setAllAlerts] = useState<Alert[]>([]);
  const [historial, setHistorial] = useState<HistorialEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [tasksData, alertsData, historialData] = await Promise.all([
          fetchTasksByObra(obraId),
          fetchAlerts(),
          fetchHistorial(obraId),
        ]);
        setTasks(tasksData);
        setAllAlerts(alertsData);
        setHistorial(historialData);
      } catch {
        setError(
          "No se pudo conectar con el servidor. Verificá que el backend esté corriendo."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [obraId]
  );

  // Reload when the selected obra changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleMarkRead(alertId: number) {
    try {
      const updated = await markAlertRead(alertId);
      setAllAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch {
      // silent fail
    }
  }

  // Only show alerts that belong to this obra
  const alerts = allAlerts.filter((a) => a.obra_id === obraId);

  const total = tasks.length;
  const byStatus = (s: string) => tasks.filter((t) => t.status === s).length;
  const unreadAlerts = alerts.filter((a) => !a.is_read).length;

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-constructa-danger/30 text-constructa-danger text-sm rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Summary cards */}
          <section>
            <SectionTitle
              aside={
                <button
                  onClick={() => loadData(true)}
                  disabled={refreshing}
                  title="Actualizar datos"
                  className="p-1.5 rounded text-constructa-secondaryText hover:text-constructa-text hover:bg-constructa-surface disabled:opacity-40 transition-colors"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </button>
              }
            >
              Resumen
            </SectionTitle>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
              <StatCard label="Total"           value={total} />
              <StatCard label="Pendientes"      value={byStatus("pendiente")}   accent="warning" />
              <StatCard label="En progreso"     value={byStatus("en_progreso")} accent="primary" />
              <StatCard label="Bloqueadas"      value={byStatus("bloqueada")}   accent="danger" />
              <StatCard label="Completadas"     value={byStatus("completada")}  accent="success" />
              <StatCard label="Alertas activas" value={unreadAlerts}            accent="info" />
            </div>
          </section>

          {/* Tasks + Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2">
              <SectionTitle>Tareas</SectionTitle>
              <Card padding="none" className="overflow-hidden">
                <TaskTable tasks={tasks} />
              </Card>
            </section>

            <section>
              <SectionTitle
                aside={
                  unreadAlerts > 0 ? (
                    <span className="text-xs font-semibold text-constructa-danger">
                      {unreadAlerts} sin leer
                    </span>
                  ) : undefined
                }
              >
                Alertas
              </SectionTitle>
              <Card padding="sm">
                <AlertsPanel alerts={alerts} onMarkRead={handleMarkRead} />
              </Card>
            </section>
          </div>

          {/* Historial */}
          <section>
            <SectionTitle
              aside={
                <span className="text-xs text-constructa-secondaryText">
                  {historial.length} eventos
                </span>
              }
            >
              Actividad reciente
            </SectionTitle>
            <Card padding="md">
              <HistorialPanel events={historial} />
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
