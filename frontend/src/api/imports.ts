import { apiClient } from "./client";

export interface ImportPreviewRow {
  row_index: number;
  title: string;
  start_date: string | null;
  due_date: string | null;
  responsible_name: string | null;
  depends_on_row: number | null;
  warning: string | null;
  error: string | null;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  column_map: Record<string, string>;
  total_rows: number;
  warnings: number;
  errors: number;
}

export interface ImportConfirmResult {
  created: number;
  skipped: number;
  errors: string[];
}

export async function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ImportPreview>("/imports/project-excel", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function confirmImport(obraId: number, rows: ImportPreviewRow[]): Promise<ImportConfirmResult> {
  const { data } = await apiClient.post<ImportConfirmResult>("/imports/project-excel/confirm", {
    obra_id: obraId,
    rows,
  });
  return data;
}
