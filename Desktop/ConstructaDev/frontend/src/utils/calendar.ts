import type { WorkingCalendar } from "../api/calendar";

// bit0 = Monday (JS getDay: Mon=1…Sun=0, but we use Mon=0 as bit0)
function dayBit(d: Date): number {
  const jsDay = d.getDay(); // 0=Sun, 1=Mon…6=Sat
  const bit = jsDay === 0 ? 6 : jsDay - 1; // remap to Mon=0…Sun=6
  return 1 << bit;
}

export function isNonWorkingDay(date: Date, calendar: WorkingCalendar): boolean {
  const iso = date.toISOString().slice(0, 10);

  // Explicit exceptions override the bitmask
  for (const exc of calendar.exceptions) {
    if (exc.date === iso) {
      return !exc.is_working;
    }
  }

  // Fall back to weekly bitmask — non-working if the bit is NOT set
  return !(calendar.working_days & dayBit(date));
}

export function isWithinWorkingHours(dt: Date, calendar: WorkingCalendar): boolean {
  if (isNonWorkingDay(dt, calendar)) return false;
  return calendar.hour_from <= dt.getHours() && dt.getHours() < calendar.hour_to;
}

export function getExceptionLabel(date: Date, calendar: WorkingCalendar): string | null {
  const iso = date.toISOString().slice(0, 10);
  const exc = calendar.exceptions.find((e) => e.date === iso);
  return exc?.label ?? null;
}

// Returns a human-readable list of working day names from bitmask
const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export function workingDayNames(bitmask: number): string[] {
  return DAY_NAMES.filter((_, i) => bitmask & (1 << i));
}

export const DEFAULT_BITMASK = 63; // Lun–Sáb (bits 0–5)
