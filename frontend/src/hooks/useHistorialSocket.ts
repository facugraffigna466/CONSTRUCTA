import { useEffect } from "react";
import socket from "../lib/socket";
import type { HistorialEvento } from "../types";

// docs/auditoria/07-historial.md, hallazgo 7.6/8.5: el tab Historial se
// cargaba una sola vez al montar la obra — si un responsable actualizaba una
// tarea por WhatsApp mientras el jefe de obra tenía el tab abierto, no lo
// veía hasta recargar. Mismo patrón que useAlertSocket/useTaskSocket.
export function useHistorialSocket(
  obraId: number,
  onHistorialCreated: (event: HistorialEvento) => void,
) {
  useEffect(() => {
    function handleHistorialCreated(payload: HistorialEvento) {
      if (payload.obra_id !== obraId) return;
      onHistorialCreated(payload);
    }

    socket.on("historial_created", handleHistorialCreated);
    return () => { socket.off("historial_created", handleHistorialCreated); };
  }, [obraId, onHistorialCreated]);
}
