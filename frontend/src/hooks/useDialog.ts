import { useEffect, useRef } from "react";

/**
 * Accesibilidad para modales/diálogos:
 * - **Esc** cierra (llama `onClose`), salvo `escClose: false`.
 * - **Foco atrapado**: Tab/Shift+Tab cicla solo dentro del diálogo.
 * - **Autofoco** al abrir (primer elemento focusable, o el panel).
 * - **Restaura el foco** al elemento que estaba activo antes de abrir.
 * - **Anidamiento**: una pila global asegura que solo el diálogo de ARRIBA
 *   maneje Esc y atrape el foco (evita que un modal anidado cierre al de abajo).
 *
 * Uso: `const ref = useDialog(onClose)` y en el panel:
 * `ref={ref} role="dialog" aria-modal="true" aria-label="..."` (o aria-labelledby).
 */

// Pila global de diálogos abiertos (el último es el de arriba).
const dialogStack: symbol[] = [];

export function useDialog<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  opts: { escClose?: boolean } = {},
) {
  const { escClose = true } = opts;
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const escRef = useRef(escClose);
  escRef.current = escClose;

  useEffect(() => {
    const id = Symbol("dialog");
    dialogStack.push(id);
    const isTop = () => dialogStack[dialogStack.length - 1] === id;

    const prevFocus = document.activeElement as HTMLElement | null;
    const node = ref.current;

    // El panel debe ser focusable para el autofoco/fallback.
    if (node && !node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");

    const focusables = (): HTMLElement[] =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];

    // Autofoco: primer elemento interactivo, o el panel.
    (focusables()[0] ?? node)?.focus();

    function onKey(e: KeyboardEvent) {
      if (!isTop()) return; // solo el diálogo de arriba responde
      if (e.key === "Escape" && escRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && node) {
        const els = focusables();
        if (els.length === 0) {
          e.preventDefault();
          node.focus();
          return;
        }
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === node)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = dialogStack.indexOf(id);
      if (i !== -1) dialogStack.splice(i, 1);
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
