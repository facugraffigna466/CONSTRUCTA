import { apiClient } from "./client";

export async function exportObraExcel(obraId: number, obraName?: string): Promise<void> {
  const response = await apiClient.get(`/exports/obras/${obraId}/excel`, {
    responseType: "blob",
  });

  const url  = URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href  = url;
  link.download = obraName
    ? `${obraName.replace(/[^a-z0-9áéíóúñü\s-]/gi, "").trim()}_tareas.xlsx`
    : `obra_${obraId}_tareas.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadTemplateExcel(): Promise<void> {
  const response = await apiClient.get("/exports/template-excel", {
    responseType: "blob",
  });
  const url  = URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href  = url;
  link.download = "constructa_plantilla_tareas.xlsx";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
