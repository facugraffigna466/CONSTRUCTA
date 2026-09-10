import { createContext } from "react";
import type { UserContextValue } from "./UserContext";

// Separado de UserContext.tsx: un archivo que exporta un componente
// (UserProvider) solo puede exportar componentes — Fast Refresh de Vite se
// rompe si además exporta el objeto de contexto. Los tipos (UserRole,
// UserContextValue) no rompen la regla y se quedan en UserContext.tsx.
export const UserContext = createContext<UserContextValue | null>(null);
