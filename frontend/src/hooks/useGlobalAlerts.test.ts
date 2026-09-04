import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalAlerts } from "./useGlobalAlerts";
import type { Alert, AlertSeverity } from "../types";

// El socket real abre una conexión; acá se sustituye por un bus en memoria que
// permite disparar los eventos del servidor a mano.
const handlers = new Map<string, (payload: unknown) => void>();

vi.mock("../lib/socket", () => ({
  default: {
    on: (evento: string, fn: (payload: unknown) => void) => { handlers.set(evento, fn); },
    off: (evento: string) => { handlers.delete(evento); },
  },
}));

const fetchAlerts = vi.fn();
vi.mock("../api/alerts", () => ({
  fetchAlerts: (...args: unknown[]) => fetchAlerts(...args),
  markAlertRead: vi.fn(async () => undefined),
}));
vi.mock("../api/obras", () => ({
  fetchObras: vi.fn(async () => [{ id: 1, name: "Edificio Norte" }]),
}));

function emitir(evento: string, payload: unknown) {
  const fn = handlers.get(evento);
  if (!fn) throw new Error(`nadie escucha "${evento}"`);
  act(() => { fn(payload); });
}

function alerta(id: number, over: Partial<Alert> = {}): Alert {
  return {
    id,
    obra_id: 1,
    task_id: 10,
    type: "critical_task_delayed",
    severity: "critica",
    message: `alerta ${id}`,
    is_read: false,
    created_at: "2026-09-04T10:00:00Z",
    ...over,
  };
}

function entrante(id: number, severity: AlertSeverity, taskId: number | null = 10) {
  return {
    id, obraId: 1, taskId, type: "critical_task_delayed",
    severity, message: `alerta ${id}`, is_read: false,
    created_at: "2026-09-04T10:00:00Z",
  };
}

beforeEach(() => {
  handlers.clear();
  fetchAlerts.mockResolvedValue([]);
});

describe("alta de alertas", () => {
  it("suma la alerta que llega por el socket", async () => {
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(handlers.has("alert_created")).toBe(true));

    emitir("alert_created", entrante(1, "media"));

    expect(result.current.alerts).toHaveLength(1);
    expect(result.current.unreadCount).toBe(1);
  });
});

describe("toast", () => {
  it("aparece con severidad crítica y alta", async () => {
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(handlers.has("alert_created")).toBe(true));

    emitir("alert_created", entrante(1, "critica"));
    expect(result.current.toastAlert?.id).toBe(1);

    act(() => result.current.clearToast());
    emitir("alert_created", entrante(2, "alta"));
    expect(result.current.toastAlert?.id).toBe(2);
  });

  it("no aparece con severidad media ni baja", async () => {
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(handlers.has("alert_created")).toBe(true));

    emitir("alert_created", entrante(1, "media"));
    emitir("alert_created", entrante(2, "baja"));

    expect(result.current.toastAlert).toBeNull();
  });

  it("hace cola en vez de pisarse", async () => {
    // Dos críticas seguidas: la segunda espera a que se cierre la primera.
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(handlers.has("alert_created")).toBe(true));

    emitir("alert_created", entrante(1, "critica"));
    emitir("alert_created", entrante(2, "critica"));
    expect(result.current.toastAlert?.id).toBe(1);

    act(() => result.current.clearToast());
    expect(result.current.toastAlert?.id).toBe(2);
  });

  it("trata como media una alerta sin severidad", async () => {
    // Un backend anterior a la columna `severity` no la manda: no debe tostar.
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(handlers.has("alert_created")).toBe(true));

    const sinSeveridad = { ...entrante(1, "critica") } as Record<string, unknown>;
    delete sinSeveridad.severity;
    emitir("alert_created", sinSeveridad);

    expect(result.current.alerts[0].severity).toBe("media");
    expect(result.current.toastAlert).toBeNull();
  });
});

describe("resolución", () => {
  it("marca exactamente los ids que informa el evento", async () => {
    fetchAlerts.mockResolvedValue([alerta(1), alerta(2), alerta(3)]);
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(3));

    emitir("alerts_resolved", { taskId: null, obraId: 1, alertIds: [1, 3] });

    const leidas = result.current.alerts.filter(a => a.is_read).map(a => a.id);
    expect(leidas).toEqual([1, 3]);
    expect(result.current.unreadCount).toBe(1);
  });

  it("no toca las alertas de la misma tarea que siguen vigentes", async () => {
    // El motivo de que el evento lleve ids: resolver por tarea tachaba también
    // los avisos de esa tarea que no se resolvieron.
    fetchAlerts.mockResolvedValue([alerta(1), alerta(2)]);
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(2));

    emitir("alerts_resolved", { taskId: 10, obraId: 1, alertIds: [1] });

    expect(result.current.alerts.find(a => a.id === 2)?.is_read).toBe(false);
  });

  it("resuelve por tarea cuando el emisor no manda ids", async () => {
    // Vía heredada, la que sigue usando TaskService.
    fetchAlerts.mockResolvedValue([alerta(1, { task_id: 10 }), alerta(2, { task_id: 99 })]);
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(2));

    emitir("alerts_resolved", { taskId: 10, obraId: 1 });

    expect(result.current.alerts.find(a => a.id === 1)?.is_read).toBe(true);
    expect(result.current.alerts.find(a => a.id === 2)?.is_read).toBe(false);
  });

  it("resuelve alertas de nivel obra, que no tienen tarea", async () => {
    fetchAlerts.mockResolvedValue([alerta(1, { task_id: null })]);
    const { result } = renderHook(() => useGlobalAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    emitir("alerts_resolved", { taskId: null, obraId: 1, alertIds: [1] });

    expect(result.current.alerts[0].is_read).toBe(true);
  });
});
