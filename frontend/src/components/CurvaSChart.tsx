import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { fetchCurvaS } from "../api/curvaS";
import type { CurvaSResponse } from "../types";

// I-05 — curva de avance planificado vs. real. SVG a mano (sin librería, no
// hay ninguna en el repo): dos series (planificado punteado gris, real sólido
// naranja de marca) sobre un viewBox fijo que se estira al ancho de la tarjeta
// (mismo truco que el sparkline de PortfolioPage). `real` es null antes de
// `tracking_since` — el trazo se corta ahí, nunca cae a cero.

const WIDTH = 700;
const HEIGHT = 130;
const TOP = 10;
const BOTTOM = 105;
const COLOR_PLANNED = "#A0ABB4";
const COLOR_REAL = "#FF6B35";

function y(value: number): number {
  return TOP + (100 - value) / 100 * (BOTTOM - TOP);
}

function x(i: number, total: number): number {
  return total <= 1 ? 0 : (i / (total - 1)) * WIDTH;
}

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

interface Segment { x: number; y: number }

function realSegments(points: CurvaSResponse["points"]): Segment[][] {
  const segments: Segment[][] = [];
  let current: Segment[] = [];
  points.forEach((p, i) => {
    if (p.real == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ x: x(i, points.length), y: y(p.real) });
    }
  });
  if (current.length) segments.push(current);
  return segments;
}

export function CurvaSChart({ obraId }: { obraId?: number }) {
  const [data, setData] = useState<CurvaSResponse | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!obraId) return;
    let cancelled = false;
    fetchCurvaS(obraId).then((r) => { if (!cancelled) setData(r); }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [obraId]);

  if (!data || data.points.length < 2) return null;

  const { points } = data;
  const plannedPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i, points.length)} ${y(p.planned)}`).join(" ");
  const segments = realSegments(points);
  const todayIso = new Date().toISOString().slice(0, 10);
  const first = points[0].date, last = points[points.length - 1].date;
  const showToday = todayIso >= first && todayIso <= last;
  const todayX = showToday
    ? WIDTH * (new Date(todayIso).getTime() - new Date(first).getTime()) / Math.max(1, new Date(last).getTime() - new Date(first).getTime())
    : null;

  return (
    <section style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Activity style={{ width: 15, height: 15, color: "#FF6B35" }} />
          <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>Curva de avance</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, color: "#5B6770" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke={COLOR_PLANNED} strokeWidth="2" strokeDasharray="3 2" /></svg>
            Planificado
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke={COLOR_REAL} strokeWidth="2" /></svg>
            Real
          </span>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
          {[0, 50, 100].map((v) => (
            <line key={v} x1={0} y1={y(v)} x2={WIDTH} y2={y(v)} stroke="#F0F1EF" strokeWidth={1} />
          ))}
          {todayX != null && (
            <line x1={todayX} y1={TOP - 4} x2={todayX} y2={BOTTOM} stroke="#C7CCD1" strokeWidth={1} strokeDasharray="3 3" />
          )}
          <path d={plannedPath} fill="none" stroke={COLOR_PLANNED} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
          {segments.map((seg, i) => (
            <polyline
              key={i}
              points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke={COLOR_REAL} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            />
          ))}
          {hovered != null && (
            <line x1={x(hovered, points.length)} y1={TOP - 4} x2={x(hovered, points.length)} y2={BOTTOM} stroke="#D0D3D1" strokeWidth={1} />
          )}
          {points.map((p, i) => (
            <g key={i}>
              {hovered === i && (
                <>
                  <circle cx={x(i, points.length)} cy={y(p.planned)} r={4} fill={COLOR_PLANNED} stroke="#fff" strokeWidth={2} />
                  {p.real != null && <circle cx={x(i, points.length)} cy={y(p.real)} r={4} fill={COLOR_REAL} stroke="#fff" strokeWidth={2} />}
                </>
              )}
              <circle
                cx={x(i, points.length)} cy={HEIGHT / 2} r={14} fill="transparent"
                onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              />
            </g>
          ))}
        </svg>

        {hovered != null && (
          <div style={{
            position: "absolute", top: 0,
            left: `${Math.min(85, Math.max(0, x(hovered, points.length) / WIDTH * 100))}%`,
            background: "#1A2329", color: "#fff", borderRadius: 8, padding: "6px 10px",
            fontSize: 11.5, whiteSpace: "nowrap", pointerEvents: "none", transform: "translateY(-100%)",
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatShortDate(points[hovered].date)}</div>
            <div>Planificado: {Math.round(points[hovered].planned)}%</div>
            <div>Real: {points[hovered].real != null ? `${Math.round(points[hovered].real!)}%` : "sin datos todavía"}</div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#A0ABB4", marginTop: 4 }}>
        <span>{formatShortDate(first)}</span>
        {data.tracking_since === null && (
          <span>El seguimiento real empieza a registrarse a partir de hoy</span>
        )}
        <span>{formatShortDate(last)}</span>
      </div>
    </section>
  );
}
