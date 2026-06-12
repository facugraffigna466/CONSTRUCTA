import { useState } from "react";
import { Check, ChevronDown, Image as ImageIcon, UserRound, Users, ClipboardList, CalendarDays } from "lucide-react";
import type { Obra, Responsible, Task, ObraTab } from "../types";

interface Props {
  obra: Obra;
  tasks: Task[];
  responsibles: Responsible[];
  onNavigate: (tab: ObraTab) => void;
}

interface Item {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  Icon: React.ComponentType<{ style?: React.CSSProperties }>;
  target: ObraTab;
}

export function ObraCompletenessChecklist({ obra, tasks, responsibles, onNavigate }: Props) {
  const storageKey = `completeness_collapsed_${obra.id}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });

  const tasksWithDates = tasks.filter(t => t.start_date || t.due_date).length;
  const datesOk = tasks.length > 0 && tasksWithDates / tasks.length >= 0.8;

  const items: Item[] = [
    {
      key: "imagen", label: "Imagen de la obra",
      hint: "Una foto ayuda a identificarla en el portfolio",
      done: !!obra.image_url, Icon: ImageIcon, target: "resumen",
    },
    {
      key: "comitente", label: "Datos del comitente",
      hint: "Nombre y contacto del cliente de la obra",
      done: !!obra.client_name, Icon: UserRound, target: "resumen",
    },
    {
      key: "responsables", label: "Responsables asignados",
      hint: "El equipo que va a reportar avances por WhatsApp",
      done: responsibles.length > 0, Icon: Users, target: "responsables",
    },
    {
      key: "tareas", label: "Tareas cargadas",
      hint: "El plan de trabajo de la obra",
      done: tasks.length > 0, Icon: ClipboardList, target: "tareas",
    },
    {
      key: "fechas", label: "Fechas en las tareas",
      hint: "Con fechas, el Gantt y las alertas cobran vida",
      done: datesOk, Icon: CalendarDays, target: "tareas",
    },
  ];

  const doneCount = items.filter(i => i.done).length;
  const score = Math.round((doneCount / items.length) * 100);

  // Obra suficientemente completa → no molestar
  if (score >= 80) return null;

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <div style={{
      background: "linear-gradient(135deg, #FFF8F3 0%, #FFF3EA 100%)",
      border: "1px solid #FDDFC8",
      borderRadius: 14,
      marginBottom: 18,
      overflow: "hidden",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {/* Header */}
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px", background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        {/* Anillo de progreso */}
        <div style={{ position: "relative", width: 34, height: 34, flexShrink: 0 }}>
          <svg width="34" height="34" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="14" fill="none" stroke="#FBE3D2" strokeWidth="4" />
            <circle
              cx="17" cy="17" r="14" fill="none" stroke="#FF6B35" strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${(score / 100) * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
              transform="rotate(-90 17 17)"
            />
          </svg>
          <span style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#E85A26",
          }}>
            {score}%
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#1A2329" }}>
            Completá la configuración de tu obra
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9A5D08" }}>
            {doneCount} de {items.length} pasos listos — una obra completa genera mejores alertas y reportes
          </p>
        </div>

        <ChevronDown style={{
          width: 16, height: 16, color: "#C97D0E", flexShrink: 0,
          transform: collapsed ? "rotate(-90deg)" : "none",
          transition: "transform 0.15s",
        }} />
      </button>

      {/* Items */}
      {!collapsed && (
        <div style={{ padding: "2px 14px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => !item.done && onNavigate(item.target)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 10px", borderRadius: 9,
                background: item.done ? "transparent" : "rgba(255,255,255,0.7)",
                border: item.done ? "1px solid transparent" : "1px solid #FBE3D2",
                cursor: item.done ? "default" : "pointer",
                textAlign: "left",
                transition: "border-color 0.12s, background 0.12s",
              }}
              onMouseEnter={e => { if (!item.done) { e.currentTarget.style.borderColor = "#FF6B35"; e.currentTarget.style.background = "#fff"; } }}
              onMouseLeave={e => { if (!item.done) { e.currentTarget.style.borderColor = "#FBE3D2"; e.currentTarget.style.background = "rgba(255,255,255,0.7)"; } }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: 99, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: item.done ? "#1F8A5B" : "#fff",
                border: item.done ? "none" : "1.5px dashed #E8B98F",
              }}>
                {item.done && <Check style={{ width: 11, height: 11, color: "#fff" }} />}
              </span>
              <item.Icon style={{ width: 14, height: 14, color: item.done ? "#94928D" : "#E85A26", flexShrink: 0 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{
                  display: "block", fontSize: 12.5, fontWeight: 600,
                  color: item.done ? "#94928D" : "#1A2329",
                  textDecoration: item.done ? "line-through" : "none",
                }}>
                  {item.label}
                </span>
                {!item.done && (
                  <span style={{ display: "block", fontSize: 11, color: "#6B7580", marginTop: 1 }}>
                    {item.hint}
                  </span>
                )}
              </span>
              {!item.done && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#E85A26", flexShrink: 0 }}>
                  Completar →
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
