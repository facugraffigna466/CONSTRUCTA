import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: number;
  accent?: "default" | "primary" | "info" | "danger" | "success" | "warning";
  icon?: ReactNode;
  helperText?: string;
  accentLine?: boolean;
}

const accentConfig = {
  default: {
    value: "text-constructa-text",
    line:  "border-l-constructa-text/30",
    icon:  "text-constructa-text",
  },
  primary: {
    value: "text-constructa-primary",
    line:  "border-l-constructa-primary",
    icon:  "text-constructa-primary",
  },
  info: {
    value: "text-constructa-info",
    line:  "border-l-constructa-info",
    icon:  "text-constructa-info",
  },
  danger: {
    value: "text-constructa-danger",
    line:  "border-l-constructa-danger",
    icon:  "text-constructa-danger",
  },
  success: {
    value: "text-constructa-success",
    line:  "border-l-constructa-success",
    icon:  "text-constructa-success",
  },
  warning: {
    value: "text-constructa-warning",
    line:  "border-l-constructa-warning",
    icon:  "text-constructa-warning",
  },
};

export function StatCard({
  label,
  value,
  accent = "default",
  icon,
  helperText,
  accentLine = false,
}: StatCardProps) {
  const cfg = accentConfig[accent];
  return (
    <div
      className={[
        "bg-white border border-constructa-border rounded-lg px-6 py-5 relative overflow-hidden",
        accentLine ? `border-l-[3px] ${cfg.line}` : "",
      ].filter(Boolean).join(" ")}
    >
      {/* Ghost icon watermark */}
      {icon && (
        <div className={`absolute right-5 top-1/2 -translate-y-1/2 w-14 h-14 flex items-center justify-center ${cfg.icon} opacity-[0.07] pointer-events-none`}>
          <div className="scale-[2]">{icon}</div>
        </div>
      )}

      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-constructa-secondaryText mb-3">
        {label}
      </p>
      <p className={`text-6xl font-black font-display leading-none tracking-tight ${cfg.value}`}>
        {value}
      </p>
      {helperText && (
        <p className="text-[11px] text-constructa-border mt-2 font-mono">{helperText}</p>
      )}
    </div>
  );
}
