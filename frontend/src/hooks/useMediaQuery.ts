import { useEffect, useState } from "react";

/** Hook reactivo para media queries — base del soporte mobile con inline styles. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** <768px: teléfono — layouts colapsan a una columna / cards. */
export const useIsMobile = () => useMediaQuery("(max-width: 767px)");

/** <1024px: tablet o menos — sidebar pasa a drawer overlay. */
export const useIsCompact = () => useMediaQuery("(max-width: 1023px)");
