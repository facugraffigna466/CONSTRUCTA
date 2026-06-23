import { apiClient } from "./client";

export interface ImportDepLink {
  row: number;
  dependency_type: string;
  lag_days: number;
}

export interface ImportPreviewRow {
  row_index: number;
  title: string;
  start_date: string | null;
  due_date: string | null;
  responsible_name: string | null;
  depends_on_row: number | null;
  dependency_links?: ImportDepLink[] | null;
  parent_row?: number | null;
  is_milestone?: boolean;
  warning: string | null;
  error: string | null;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  column_map: Record<string, string>;
  headers?: string[];
  total_rows: number;
  warnings: number;
  errors: number;
  source?: string;
}

export interface ImportConfirmResult {
  created: number;
  skipped: number;
  errors: string[];
}

export async function previewImport(file: File, columnMap?: Record<string, string>): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  if (columnMap) form.append("column_map", JSON.stringify(columnMap));
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

export interface AiMappingUsage {
  used: number;
  limit: number | null;
  plan: string;
}

export interface AiMappingResult {
  mapping: Record<string, string | null>;
  headers: string[];
  source: "ai" | "cache" | "alias";
  usage: AiMappingUsage;
}

export async function detectMapping(file: File): Promise<AiMappingResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<AiMappingResult>("/imports/detect-mapping", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
