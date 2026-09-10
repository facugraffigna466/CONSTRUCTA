import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MonthlyInsightsAccordion } from "./MonthlyInsightsAccordion";
import type { MonthlyInsights } from "../types";

vi.mock("../api/monthlyInsights", () => ({
  fetchMonthlyInsights: vi.fn(),
}));

import { fetchMonthlyInsights } from "../api/monthlyInsights";

const NOTE =
  "Correlación temporal, NO causalidad: dice que después de mencionar X hubo un " +
  "retraso dentro de la ventana, no que X lo haya causado.";

function insights(over: Partial<MonthlyInsights> = {}): MonthlyInsights {
  return {
    available: true,
    period: "2026-08",
    computed_at: "2026-09-01T02:35:00Z",
    risk_concentration: null,
    estimation_accuracy: null,
    top_deviations: null,
    bitacora_themes: {
      note: NOTE,
      categories: [
        // >= 3 menciones: se muestra la tasa (I-15).
        { category: "falta_material", mentions: 6, mentions_followed_by_delay: 3, correlation_rate: 0.5 },
        // < 3 menciones: la tasa sería 100% sobre nada, va el conteo crudo.
        { category: "clima", mentions: 2, mentions_followed_by_delay: 2, correlation_rate: 1 },
      ],
    },
    alert_reaction: null,
    ...over,
  };
}

async function montar(data: MonthlyInsights | null) {
  vi.mocked(fetchMonthlyInsights).mockResolvedValue(data as MonthlyInsights);
  render(<MonthlyInsightsAccordion obraId={1} />);
  // El acordeón arranca colapsado en localStorage limpio; se expande al click.
  const toggle = await screen.findByRole("button");
  toggle.click();
}

beforeEach(() => {
  localStorage.clear();
});

describe("I-15 — temas recurrentes de bitácora", () => {
  it("muestra la advertencia que declara el backend, no una escrita a mano", async () => {
    await montar(insights());
    // El texto sale de `bitacora_themes.note`: si se hardcodea en el componente,
    // queda viejo el día que cambie la ventana de correlación o el matcheo.
    expect(await screen.findByText(NOTE)).toBeTruthy();
  });

  it("muestra el porcentaje solo con 3 menciones o más", async () => {
    await montar(insights());

    expect(await screen.findByText("50% con retraso después")).toBeTruthy();
    // Con 2 menciones el porcentaje sería 100% y no significa nada.
    expect(screen.getByText("2 menciones, 2 con retraso después")).toBeTruthy();
    expect(screen.queryByText("100% con retraso después")).toBeNull();
  });

  it("no renderiza la sección cuando ninguna bitácora matcheó categoría", async () => {
    await montar(insights({ bitacora_themes: { note: NOTE, categories: [] } }));

    expect(screen.queryByText("Problemas recurrentes en bitácora")).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
