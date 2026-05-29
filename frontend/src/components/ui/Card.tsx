import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Adds an orange left-border accent */
  accent?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingMap = {
  none: "",
  sm:   "p-3",
  md:   "p-4",
  lg:   "p-6",
};

export function Card({
  children,
  className = "",
  accent = false,
  padding = "md",
}: CardProps) {
  return (
    <div
      className={[
        "bg-white border border-constructa-border rounded shadow-card",
        accent ? "border-l-4 border-l-constructa-primary" : "",
        paddingMap[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
