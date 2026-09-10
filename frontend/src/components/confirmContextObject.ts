import { createContext } from "react";

// Separado de ConfirmProvider.tsx: un archivo que exporta un componente
// (ConfirmProvider) solo puede exportar componentes — Fast Refresh de Vite
// se rompe si además exporta el objeto de contexto.
export interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export interface AlertOpts {
  title: string;
  message?: string;
  okLabel?: string;
}

export interface ConfirmApi {
  /** Diálogo de confirmación estilado. Resuelve true si el usuario confirma. */
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  /** Aviso estilado de un solo botón (reemplaza `alert()`). */
  alert: (opts: AlertOpts) => Promise<void>;
}

export const ConfirmContext = createContext<ConfirmApi>({
  confirm: async () => false,
  alert: async () => {},
});
