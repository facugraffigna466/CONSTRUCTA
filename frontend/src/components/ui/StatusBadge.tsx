import type { TaskStatus } from "../../types";

interface StatusBadgeProps {
  status: TaskStatus;
}

const config: Record<TaskStatus, { label: string; style: string }> = {
  pendiente:   { label: "Pendiente",    style: "bg-blue-100   text-blue-700   border-blue-200" },
  en_progreso: { label: "En progreso",  style: "bg-amber-100  text-amber-700  border-amber-200" },
  bloqueada:   { label: "Bloqueada",    style: "bg-red-100    text-red-700    border-red-200" },
  completada:  { label: "Completada",   style: "bg-green-100  text-green-700  border-green-200" },
  cancelada:   { label: "Cancelada",    style: "bg-gray-100   text-gray-500   border-gray-200" },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, style } = config[status] ?? config.cancelada;
  return (
    <span
      className={[
        "inline-block rounded px-2 py-0.5 text-xs font-semibold border",
        style,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
