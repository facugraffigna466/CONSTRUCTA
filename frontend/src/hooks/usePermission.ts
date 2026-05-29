import { useUser } from "../context/UserContext";
import type { UserRole } from "../context/UserContext";

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
  | "documentos.upload";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    "obra.create", "obra.edit", "obra.delete",
    "tarea.create", "tarea.edit", "tarea.delete", "tarea.move",
    "miembro.invite", "miembro.remove",
    "configuracion.edit",
    "documentos.upload",
  ],
  collaborator: [
    "obra.edit",
    "tarea.create", "tarea.edit", "tarea.move",
    "documentos.upload",
  ],
};

export function usePermission(permission: Permission): boolean {
  const { role } = useUser();
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function useCan() {
  const { role } = useUser();
  const perms = ROLE_PERMISSIONS[role];
  return (permission: Permission) => perms.includes(permission);
}
