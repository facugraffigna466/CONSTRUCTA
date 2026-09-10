import { useContext } from "react";
import { UserContext } from "../context/userContextObject";

// Separado de context/UserContext.tsx: un archivo que exporta un componente
// (UserProvider) solo puede exportar componentes — Fast Refresh de Vite se
// rompe si además exporta un hook.
export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
