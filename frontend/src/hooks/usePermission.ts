import { useUser } from "../context/UserContext";
import type { UserRole } from "../context/UserContext";
import type { CurrentUser, ObraUserRoleType } from "../types";

export type Permission =
  | "obra.create"
  | "obra.edit"
  | "obra.delete"
  | "tarea.create"
  | "tarea.edit"
  | "tarea.delete"
  | "tarea.move"
  | "miembro.invite"
  | "miembro.remove"
  | "configuracion.edit"
  | "documentos.upload"
  | "documentos.delete";

// Matriz global (rol de empresa). Se usa cuando la pregunta es "¿puede X a
// nivel empresa?" — sin `obraId` explícito. Retrocompat con Fase 0.
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    "obra.create", "obra.edit", "obra.delete",
    "tarea.create", "tarea.edit", "tarea.delete", "tarea.move",
    "miembro.invite", "miembro.remove",
    "configuracion.edit",
    "documentos.upload", "documentos.delete",
  ],
  collaborator: [
    "obra.edit",
    "tarea.create", "tarea.edit", "tarea.move",
    "documentos.upload",
  ],
};

// Matriz por-obra (Fase 4). Cuando la pregunta trae `obraId`, el permiso se
// resuelve contra el rol que el user tiene en ESA obra. Deriva de la matriz
// de docs/roles-redesign/fase-1-modelo.md §2.4 aplicada al vocabulario del
// frontend.
//
//  - jefe_obra: control total dentro de la obra (crear/editar/borrar tareas,
//    upload/delete de planos). NO puede tocar datos maestros de la obra ni
//    gestionar users a nivel empresa — eso queda para admin de empresa.
//  - colaborador: día a día (crea/edita tareas y sube planos), no borra ni
//    marca vigente.
//  - solo_lectura: nada de mutación.
const OBRA_ROLE_PERMISSIONS: Record<ObraUserRoleType, Permission[]> = {
  jefe_obra: [
    "tarea.create", "tarea.edit", "tarea.delete", "tarea.move",
    "documentos.upload", "documentos.delete",
  ],
  colaborador: [
    "tarea.create", "tarea.edit", "tarea.move",
    "documentos.upload",
  ],
  solo_lectura: [],
};

// Permisos que solo tienen sentido a nivel empresa (nunca por-obra). Si
// alguien pregunta usePermission("miembro.invite", 42), respondemos por el
// nivel empresa igual — el obraId se ignora para estos.
const COMPANY_LEVEL_PERMISSIONS = new Set<Permission>([
  "obra.create",
  "obra.delete",
  "obra.edit",         // "editar datos maestros de la obra"
  "miembro.invite",
  "miembro.remove",
  "configuracion.edit",
]);

function resolveObraPermission(
  user: CurrentUser,
  permission: Permission,
  obraId: number,
): boolean {
  // Admin de empresa es superset: pasa en cualquier obra.
  if (user.role === "admin") return true;
  // Permisos que no son por-obra: para non-admin siempre false.
  if (COMPANY_LEVEL_PERMISSIONS.has(permission)) return false;
  // Buscar el rol del user en esta obra específica.
  const row = user.obra_roles.find((r) => r.obra_id === obraId);
  if (!row) return false;
  return OBRA_ROLE_PERMISSIONS[row.role].includes(permission);
}

function resolveGlobalPermission(user: CurrentUser, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

export function usePermission(
  permission: Permission,
  obraId?: number | null,
): boolean {
  const { user } = useUser();
  if (obraId != null) {
    return resolveObraPermission(user, permission, obraId);
  }
  return resolveGlobalPermission(user, permission);
}

export function useCan() {
  const { user } = useUser();
  return (permission: Permission, obraId?: number | null): boolean => {
    if (obraId != null) {
      return resolveObraPermission(user, permission, obraId);
    }
    return resolveGlobalPermission(user, permission);
  };
}

/** Rol del usuario en una obra puntual, o null si no está asignado (y no es
 * admin de empresa). Útil para copy tipo "Tu rol acá: Jefe de obra". */
export function useObraRole(obraId: number | null | undefined): ObraUserRoleType | "admin" | null {
  const { user } = useUser();
  if (obraId == null) return null;
  if (user.role === "admin") return "admin";
  const row = user.obra_roles.find((r) => r.obra_id === obraId);
  return row ? row.role : null;
}
