import { apiClient as axios } from "./client";

export interface CalendarException {
  id: number;
  calendar_id: number;
  date: string; // ISO YYYY-MM-DD
  is_working: boolean;
  label: string | null;
}

export interface WorkingCalendar {
  id: number;
  obra_id: number;
  working_days: number; // bitmask: bit0=Mon…bit6=Sun
  hour_from: number;
  hour_to: number;
  created_at: string;
  updated_at: string;
  exceptions: CalendarException[];
}

export interface WorkingCalendarUpdate {
  working_days?: number;
  hour_from?: number;
  hour_to?: number;
}

export async function fetchCalendar(obraId: number): Promise<WorkingCalendar> {
  const res = await axios.get<WorkingCalendar>(`/obras/${obraId}/calendar`);
  return res.data;
}

export async function updateCalendar(obraId: number, data: WorkingCalendarUpdate): Promise<WorkingCalendar> {
  const res = await axios.put<WorkingCalendar>(`/obras/${obraId}/calendar`, data);
  return res.data;
}

export async function addException(
  obraId: number,
  date: string,
  isWorking: boolean,
  label: string | null
): Promise<CalendarException> {
  const res = await axios.post<CalendarException>(`/obras/${obraId}/calendar/exceptions`, {
    date,
    is_working: isWorking,
    label,
  });
  return res.data;
}

export async function deleteException(obraId: number, exceptionId: number): Promise<void> {
  await axios.delete(`/obras/${obraId}/calendar/exceptions/${exceptionId}`);
}

export async function loadHolidays(obraId: number, year: number): Promise<{ loaded: number; added: number; skipped: number }> {
  const res = await axios.post<{ loaded: number; added: number; skipped: number }>(
    `/obras/${obraId}/calendar/load-holidays?year=${year}`
  );
  return res.data;
}
