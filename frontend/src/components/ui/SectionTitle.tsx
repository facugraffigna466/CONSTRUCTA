import type { ReactNode } from "react";

interface SectionTitleProps {
  children: ReactNode;
  aside?: ReactNode;
}

export function SectionTitle({ children, aside }: SectionTitleProps) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-3">
        <span className="block w-0.5 h-4 rounded-full bg-constructa-primary flex-shrink-0" />
        <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-constructa-secondaryText">
          {children}
        </h2>
      </div>
      {aside && <div>{aside}</div>}
    </div>
  );
}
