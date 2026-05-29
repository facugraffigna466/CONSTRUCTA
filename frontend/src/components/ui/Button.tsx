import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "warning" | "dark" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary:   "bg-constructa-primary hover:bg-orange-600 text-white border-transparent",
  secondary: "bg-white hover:bg-constructa-surface text-constructa-text border-constructa-border",
  danger:    "bg-constructa-danger hover:bg-red-700 text-white border-transparent",
  warning:   "bg-constructa-warning hover:bg-amber-500 text-white border-transparent",
  dark:      "bg-constructa-dark hover:bg-slate-700 text-white border-transparent",
  ghost:     "bg-transparent hover:bg-constructa-surface text-constructa-secondaryText border-transparent",
};

export function Button({
  variant = "primary",
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold",
        "rounded border transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
