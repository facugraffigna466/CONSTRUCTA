import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library registra su limpieza automática solo cuando corre con
// `globals: true`. Acá los tests importan lo que usan de 'vitest' (así `tsc -b`
// los tipa sin sumar tipos globales al tsconfig de la app), de modo que el
// cleanup hay que engancharlo a mano: sin esto, cada render se apila en el
// mismo document y las consultas encuentran elementos de tests anteriores.
afterEach(cleanup);
