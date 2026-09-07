import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AlertasTab } from "./AlertasTab";
import type { Alert, Task } from "../types";

function alerta(over: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    obra_id: 1,
    task_id: 10,
    type: "critical_task_delayed",
    severity: "critica",
    message: "La tarea «Encofrado» está en la ruta crítica.",
    is_read: false,
    created_at: "2026-09-04T10:00:00Z",
    ...over,
  };
}

const TAREA = { id: 10, title: "Encofrado" } as Task;

function montar(alerts: Alert[], props: Partial<Parameters<typeof AlertasTab>[0]> = {}) {
  const onMarkRead = vi.fn();
  const onMarkAllRead = vi.fn();
  const onViewTask = vi.fn();
  render(
    <AlertasTab
      alerts={alerts}
      tasks={[TAREA]}
      onMarkRead={onMarkRead}
      onMarkAllRead={onMarkAllRead}
      onViewTask={onViewTask}
      {...props}
    />,
  );
  return { onMarkRead, onMarkAllRead, onViewTask };
}

describe("filtros", () => {
  it("arranca en No leídas y oculta las ya leídas", () => {
    montar([
      alerta({ id: 1, message: "pendiente" }),
      alerta({ id: 2, message: "resuelta", is_read: true }),
    ]);

    expect(screen.getByText("pendiente")).toBeTruthy();
    expect(screen.queryByText("resuelta")).toBeNull();
  });

  it("Todas muestra las dos", () => {
    montar([
      alerta({ id: 1, message: "pendiente" }),
      alerta({ id: 2, message: "resuelta", is_read: true }),
    ]);

    fireEvent.click(screen.getByText("Todas"));

    expect(screen.getByText("pendiente")).toBeTruthy();
    expect(screen.getByText("resuelta")).toBeTruthy();
  });

  it("avisa cuando no queda nada pendiente", () => {
    montar([alerta({ is_read: true })]);
    expect(screen.getByText("No hay alertas pendientes")).toBeTruthy();
    expect(screen.getByText("Estás al día.")).toBeTruthy();
  });

  it("distingue la obra sin alertas de la obra al día", () => {
    montar([]);
    expect(screen.getByText("No hay alertas para esta obra")).toBeTruthy();
  });
});

describe("severidad", () => {
  it("marca con chip solo crítica y alta", () => {
    // Marcarlas todas equivale a no marcar ninguna: lo que se busca es saber
    // qué mirar primero.
    montar([
      alerta({ id: 1, severity: "critica", message: "a" }),
      alerta({ id: 2, severity: "alta", message: "b" }),
      alerta({ id: 3, severity: "media", message: "c" }),
      alerta({ id: 4, severity: "baja", message: "d" }),
    ]);

    expect(screen.getByText("Crítica")).toBeTruthy();
    expect(screen.getByText("Alta")).toBeTruthy();
    expect(screen.queryByText("Media")).toBeNull();
    expect(screen.queryByText("Baja")).toBeNull();
  });

  it("no muestra el chip en una alerta ya leída", () => {
    montar([alerta({ severity: "critica", is_read: true })]);
    fireEvent.click(screen.getByText("Todas"));

    expect(screen.queryByText("Crítica")).toBeNull();
  });
});

describe("etiquetas", () => {
  it("usa el nombre propio de cada tipo", () => {
    montar([
      alerta({ id: 1, type: "baseline_deviation", message: "a" }),
      alerta({ id: 2, type: "material_pending_too_long", message: "b" }),
    ]);

    expect(screen.getByText("Desvío de línea base")).toBeTruthy();
    expect(screen.getByText("Material sin pedir")).toBeTruthy();
  });

  it("desambigua delay_risk por su mensaje", () => {
    montar([
      alerta({ id: 1, type: "delay_risk", severity: "media",
               message: "La tarea «Encofrado» no tiene responsable asignado." }),
      alerta({ id: 2, type: "delay_risk", severity: "media", task_id: null,
               message: "El 40% de las tareas activas de la obra están vencidas." }),
    ]);

    expect(screen.getByText("Sin responsable")).toBeTruthy();
    // La de obra no habla de una tarea puntual, aunque diga "vencidas".
    expect(screen.getByText("Riesgo de demora")).toBeTruthy();
  });
});

describe("acciones", () => {
  it("permite ir a la tarea de la alerta", () => {
    const { onViewTask } = montar([alerta()]);

    fireEvent.click(screen.getByText("Ver tarea"));

    expect(onViewTask).toHaveBeenCalledWith(10);
  });

  it("avisa cuando la tarea ya no existe, en vez de ofrecer ir a la nada", () => {
    const { onViewTask } = montar([alerta({ task_id: 999 })]);

    expect(screen.getByText("Tarea eliminada")).toBeTruthy();
    expect(screen.queryByText("Ver tarea")).toBeNull();
    expect(onViewTask).not.toHaveBeenCalled();
  });

  it("no ofrece ir a la tarea desde una alerta de obra", () => {
    montar([alerta({ task_id: null })]);
    expect(screen.queryByText("Ver tarea")).toBeNull();
    expect(screen.queryByText("Tarea eliminada")).toBeNull();
  });

  it("marca una alerta como leída", () => {
    const { onMarkRead } = montar([alerta({ id: 42 })]);

    fireEvent.click(screen.getByTitle("Marcar como leída"));

    expect(onMarkRead).toHaveBeenCalledWith(42);
  });

  it("marca todas como leídas", () => {
    const { onMarkAllRead } = montar([alerta()]);

    fireEvent.click(screen.getByText("Marcar todas como leídas"));

    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("esconde el botón de marcar todas si no hay ninguna pendiente", () => {
    montar([alerta({ is_read: true })]);
    expect(screen.queryByText("Marcar todas como leídas")).toBeNull();
  });
});
