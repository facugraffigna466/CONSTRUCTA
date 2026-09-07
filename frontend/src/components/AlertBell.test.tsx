import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AlertBell } from "./AlertBell";
import type { Alert } from "../types";

function alerta(over: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    obra_id: 1,
    task_id: 10,
    type: "critical_task_delayed",
    severity: "critica",
    message: "La tarea «Encofrado» está en la ruta crítica.",
    is_read: false,
    created_at: new Date().toISOString(),
    ...over,
  };
}

function abrir() {
  fireEvent.click(screen.getByRole("button"));
}

describe("badge", () => {
  it("muestra la cuenta de no leídas", () => {
    render(<AlertBell alerts={[alerta()]} unreadCount={3} onAlertClick={() => {}} />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("corta en 99+ para no deformar el círculo", () => {
    render(<AlertBell alerts={[]} unreadCount={128} onAlertClick={() => {}} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("no aparece sin alertas pendientes", () => {
    render(<AlertBell alerts={[]} unreadCount={0} onAlertClick={() => {}} />);
    expect(screen.getByRole("button").getAttribute("title")).toBe("Alertas");
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("desplegable", () => {
  it("arranca cerrado y se abre al hacer clic", () => {
    render(<AlertBell alerts={[alerta()]} unreadCount={1} onAlertClick={() => {}} />);
    expect(screen.queryByText("Alertas")).toBeNull();

    abrir();

    expect(screen.getByText("1 sin leer")).toBeTruthy();
  });

  it("lista solo las no leídas", () => {
    render(
      <AlertBell
        alerts={[
          alerta({ id: 1, message: "pendiente" }),
          alerta({ id: 2, message: "ya leída", is_read: true }),
        ]}
        unreadCount={1}
        onAlertClick={() => {}}
      />,
    );
    abrir();

    expect(screen.getByText("pendiente")).toBeTruthy();
    expect(screen.queryByText("ya leída")).toBeNull();
  });

  it("avisa cuando no queda nada pendiente", () => {
    render(
      <AlertBell alerts={[alerta({ is_read: true })]} unreadCount={0} onAlertClick={() => {}} />,
    );
    abrir();

    expect(screen.getByText("Sin alertas pendientes")).toBeTruthy();
  });
});

describe("etiquetas", () => {
  it("nombra cada tipo con su etiqueta de alertMeta", () => {
    // Los 11 tipos nuevos tienen nombre propio: si alguien agrega uno al backend
    // y no lo mapea acá, el usuario vería el identificador crudo.
    render(
      <AlertBell
        alerts={[
          alerta({ id: 1, type: "recurring_blocker", message: "a" }),
          alerta({ id: 2, type: "milestone_at_risk", message: "b" }),
          alerta({ id: 3, type: "deadline_conflicts_holiday", message: "c" }),
        ]}
        unreadCount={3}
        onAlertClick={() => {}}
      />,
    );
    abrir();

    expect(screen.getByText("Bloqueo recurrente")).toBeTruthy();
    expect(screen.getByText("Hito en riesgo")).toBeTruthy();
    expect(screen.getByText("Vence en día no laborable")).toBeTruthy();
  });
});

describe("navegación", () => {
  it("al hacer clic avisa cuál es y cierra el desplegable", () => {
    const onAlertClick = vi.fn();
    render(<AlertBell alerts={[alerta()]} unreadCount={1} onAlertClick={onAlertClick} />);
    abrir();

    fireEvent.click(screen.getByText("La tarea «Encofrado» está en la ruta crítica."));

    expect(onAlertClick).toHaveBeenCalledTimes(1);
    expect(onAlertClick.mock.calls[0][0].id).toBe(1);
    expect(screen.queryByText("1 sin leer")).toBeNull();
  });

  it("no navega si la alerta perdió su obra", () => {
    // obra_id queda en NULL cuando se borra la obra (ondelete SET NULL).
    const onAlertClick = vi.fn();
    render(
      <AlertBell alerts={[alerta({ obra_id: null })]} unreadCount={1} onAlertClick={onAlertClick} />,
    );
    abrir();

    fireEvent.click(screen.getByText("La tarea «Encofrado» está en la ruta crítica."));

    expect(onAlertClick).not.toHaveBeenCalled();
  });
});

describe("agrupado por obra (panel)", () => {
  it("muestra el nombre de la obra de cada alerta", () => {
    render(
      <AlertBell
        alerts={[alerta({ obra_id: 7 })]}
        unreadCount={1}
        onAlertClick={() => {}}
        obraNames={new Map([[7, "Edificio Norte"]])}
        groupByObra
      />,
    );
    abrir();

    expect(screen.getAllByText("Edificio Norte").length).toBeGreaterThan(0);
  });
});
