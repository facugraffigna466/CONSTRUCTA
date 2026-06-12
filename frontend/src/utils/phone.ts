// Normalización de teléfonos a E.164 pensada para Argentina.
// La gente escribe "2494 555888", "0249 4555888", "11 15 5123-4567" — acá lo
// convertimos a +549... antes de validar, en vez de rebotar con jerga técnica.

export const E164 = /^\+[1-9]\d{9,14}$/;

export function normalizePhone(raw: string): string {
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (!s) return s;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) return s;
  if (!/^\d+$/.test(s)) return s; // tiene letras u otros símbolos: que falle la validación
  if (s.startsWith("54")) return "+" + s;
  if (s.startsWith("0")) s = s.slice(1); // "0249..." → "249..."
  // celular escrito como "área + 15 + número" (12 dígitos): sacar el 15
  if (s.length === 12) {
    for (const i of [2, 3, 4]) {
      if (s.slice(i, i + 2) === "15") {
        const candidate = s.slice(0, i) + s.slice(i + 2);
        if (candidate.length === 10) { s = candidate; break; }
      }
    }
  }
  return "+549" + s;
}

export function isValidPhone(raw: string): boolean {
  return E164.test(normalizePhone(raw));
}

export const PHONE_ERROR_HINT =
  "Revisá el número: código de área sin 0 y sin 15. Ej: 2494 555888 (se guarda como +5492494555888)";
