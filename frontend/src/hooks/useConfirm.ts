import { useContext } from "react";
import { ConfirmContext, type ConfirmApi } from "../components/confirmContextObject";

// Separado de ConfirmProvider.tsx: un archivo que exporta un componente
// (ConfirmProvider) solo puede exportar componentes — Fast Refresh de Vite
// se rompe si además exporta un hook.
export function useConfirm(): ConfirmApi {
  return useContext(ConfirmContext);
}
