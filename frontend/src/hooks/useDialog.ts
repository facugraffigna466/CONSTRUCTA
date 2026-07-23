import { useEffect, useRef } from "react";

/**
 * Accesibilidad para modales/diálogos:
 * - **Esc** cierra (llama `onClose`).
 * - **Foco atrapado**: Tab/Shift+Tab cicla solo dentro del diálogo.
 * - **Autofoco** al abrir (primer elemento focusable, o el panel).
 * - **Restaura el foco** al elemento que estaba activo antes de abrir.
 *
 * Uso: `const ref = useDialog(onClose)` y en el panel:
 * `ref={ref} role="dialog" aria-modal="true" aria-label="..."` (o aria-labelledby).
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
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
      if (e.key === "Escape") {
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
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
