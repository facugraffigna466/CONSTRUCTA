import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAlertSocket } from "./useAlertSocket";
import type { AlertsResolvedPayload } from "./useGlobalAlerts";
import type { Alert } from "../types";

const handlers = new Map<string, (payload: unknown) => void>();

vi.mock("../lib/socket", () => ({
  default: {
    on: (evento: string, fn: (payload: unknown) => void) => { handlers.set(evento, fn); },
    off: (evento: string) => { handlers.delete(evento); },
  },
}));

function emitir(evento: string, payload: unknown) {
  const fn = handlers.get(evento);
  if (!fn) throw new Error(`nadie escucha "${evento}"`);
  act(() => { fn(payload); });
}

const OBRA = 7;

function entrante(obraId: number, id = 1) {
  return {
    id, obraId, taskId: 10, type: "critical_task_delayed",
    severity: "critica", message: "algo", is_read: false,
    created_at: "2026-09-04T10:00:00Z",
  };
}

beforeEach(() => handlers.clear());

describe("altas", () => {
  it("avisa de la alerta de su obra", () => {
    const creadas: Alert[] = [];
    renderHook(() => useAlertSocket(OBRA, a => { creadas.push(a); }));

    emitir("alert_created", entrante(OBRA));

    expect(creadas).toHaveLength(1);
    expect(creadas[0].severity).toBe("critica");
  });

  it("ignora la alerta de otra obra", () => {
    const creadas: Alert[] = [];
    renderHook(() => useAlertSocket(OBRA, a => { creadas.push(a); }));

    emitir("alert_created", entrante(OBRA + 1));

    expect(creadas).toHaveLength(0);
  });

  it("completa la severidad si el backend no la manda", () => {
    const creadas: Alert[] = [];
    renderHook(() => useAlertSocket(OBRA, a => { creadas.push(a); }));

    const sinSeveridad = { ...entrante(OBRA) } as Record<string, unknown>;
    delete sinSeveridad.severity;
    emitir("alert_created", sinSeveridad);

    expect(creadas[0].severity).toBe("media");
  });
});

describe("resoluciones", () => {
  it("las propaga — el tab de la obra no las escuchaba y quedaban pendientes hasta recargar", () => {
    const resueltas: AlertsResolvedPayload[] = [];
    renderHook(() => useAlertSocket(OBRA, () => {}, p => { resueltas.push(p); }));

    emitir("alerts_resolved", { taskId: null, obraId: OBRA, alertIds: [1, 2] });

    expect(resueltas).toHaveLength(1);
    expect(resueltas[0].alertIds).toEqual([1, 2]);
  });

  it("ignora las de otra obra", () => {
    const resueltas: AlertsResolvedPayload[] = [];
    renderHook(() => useAlertSocket(OBRA, () => {}, p => { resueltas.push(p); }));

    emitir("alerts_resolved", { taskId: null, obraId: OBRA + 1, alertIds: [1] });

    expect(resueltas).toHaveLength(0);
  });

  it("no explota si nadie pasó el callback", () => {
    renderHook(() => useAlertSocket(OBRA, () => {}));

    expect(() => emitir("alerts_resolved", { taskId: 1, obraId: OBRA })).not.toThrow();
  });
});

describe("ciclo de vida", () => {
  it("se desuscribe de los dos eventos al desmontar", () => {
    const { unmount } = renderHook(() => useAlertSocket(OBRA, () => {}, () => {}));
    expect(handlers.has("alert_created")).toBe(true);
    expect(handlers.has("alerts_resolved")).toBe(true);

    unmount();

    expect(handlers.has("alert_created")).toBe(false);
    expect(handlers.has("alerts_resolved")).toBe(false);
  });
});
