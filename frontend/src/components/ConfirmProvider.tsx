import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useDialog } from "../hooks/useDialog";

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface AlertOpts {
  title: string;
  message?: string;
  okLabel?: string;
}

interface ConfirmApi {
  /** Diálogo de confirmación estilado. Resuelve true si el usuario confirma. */
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  /** Aviso estilado de un solo botón (reemplaza `alert()`). */
  alert: (opts: AlertOpts) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmApi>({
  confirm: async () => false,
  alert: async () => {},
});

export const useConfirm = () => useContext(ConfirmContext);

type Pending =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ kind: "confirm", opts, resolve })),
    [],
  );
  const alert = useCallback(
    (opts: AlertOpts) => new Promise<void>((resolve) => setPending({ kind: "alert", opts, resolve })),
    [],
  );

  function settle(value: boolean) {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(value);
    else pending.resolve();
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      {pending && <Dialog pending={pending} onClose={() => settle(false)} onConfirm={() => settle(true)} />}
    </ConfirmContext.Provider>
  );
}

function Dialog({ pending, onClose, onConfirm }: { pending: Pending; onClose: () => void; onConfirm: () => void }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const isConfirm = pending.kind === "confirm";
  const opts = pending.opts;
  const danger = pending.kind === "confirm" && pending.opts.danger;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,22,28,0.45)", backdropFilter: "blur(3px)", padding: 16,
      }}
    >
      <div
        ref={ref}
        role={isConfirm ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={opts.title}
        style={{
          background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420,
          boxShadow: "0 24px 64px -12px rgba(0,0,0,0.30)", border: "1px solid #E6E7E5",
          padding: "24px 24px 20px", fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1A2329" }}>{opts.title}</h2>
        {opts.message && (
          <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "#5B6770", whiteSpace: "pre-line" }}>
            {opts.message}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          {isConfirm && (
            <button
              onClick={onClose}
              style={{
                padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
                border: "1px solid #E6E7E5", background: "#fff", color: "#5B6770", cursor: "pointer",
              }}
            >
              {(pending.opts.cancelLabel) || "Cancelar"}
            </button>
          )}
          <button
            onClick={onConfirm}
            style={{
              padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
              color: "#fff",
              background: danger ? "#D03A3A" : "#FF6B35",
              boxShadow: danger
                ? "0 6px 14px -6px rgba(208,58,58,0.5)"
                : "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px -6px rgba(255,107,53,0.5)",
            }}
          >
            {isConfirm ? (pending.opts.confirmLabel || "Confirmar") : ((pending.opts as AlertOpts).okLabel || "Entendido")}
          </button>
        </div>
      </div>
    </div>
  );
}
