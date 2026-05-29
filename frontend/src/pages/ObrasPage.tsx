import { useCallback, useEffect, useState } from "react";
import { MapPin, Calendar, ArrowRight, RefreshCw, Building2 } from "lucide-react";
import { fetchObras } from "../api/obras";
import { SectionTitle } from "../components/ui/SectionTitle";
import { Spinner } from "../components/Spinner";
import type { Obra, ObraStatus } from "../types";

interface ObrasPageProps {
  onSelectObra: (obra: Obra) => void;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ObraStatus, { label: string; style: string }> = {
  planificada: { label: "Planificada", style: "bg-blue-50   text-constructa-info    border-blue-200" },
  en_progreso: { label: "En progreso", style: "bg-orange-50 text-constructa-progress border-orange-200" },
  pausada:     { label: "Pausada",     style: "bg-amber-50  text-constructa-warning  border-amber-200" },
  completada:  { label: "Completada",  style: "bg-green-50  text-constructa-success  border-green-200" },
  cancelada:   { label: "Cancelada",   style: "bg-gray-50   text-constructa-secondaryText border-constructa-border" },
};

function ObraStatusBadge({ status }: { status: ObraStatus }) {
  const { label, style } = STATUS_CONFIG[status];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${style}`}>
      {label}
    </span>
  );
}

// ─── Obra card ────────────────────────────────────────────────────────────────

interface ObraCardProps {
  obra: Obra;
  onSelect: () => void;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const [year, month, day] = d.split("-");
  return `${day}/${month}/${year}`;
}

function ObraCard({ obra, onSelect }: ObraCardProps) {
  return (
    <div className="bg-white border border-constructa-border border-l-4 border-l-constructa-primary rounded shadow-card flex flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-mono text-constructa-border mb-1">#{obra.id}</p>
          <h3 className="text-base font-bold text-constructa-text leading-snug">
            {obra.name}
          </h3>
        </div>
        <ObraStatusBadge status={obra.status} />
      </div>

      {/* Meta */}
      <div className="px-5 pb-4 space-y-1.5 flex-1">
        {obra.location && (
          <div className="flex items-center gap-1.5 text-xs text-constructa-secondaryText">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-constructa-border" />
            <span className="truncate">{obra.location}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-constructa-secondaryText">
          <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-constructa-border" />
          <span>
            {formatDate(obra.start_date)}
            {" → "}
            {formatDate(obra.expected_end_date)}
          </span>
        </div>
        {obra.description && (
          <p className="text-xs text-constructa-secondaryText line-clamp-2 pt-1">
            {obra.description}
          </p>
        )}
      </div>

      {/* Action */}
      <div className="px-5 py-3 border-t border-constructa-surface">
        <button
          onClick={onSelect}
          className="w-full flex items-center justify-center gap-1.5 bg-constructa-primary hover:bg-orange-600 text-white text-xs font-bold uppercase tracking-widest px-4 py-2 rounded transition-colors"
        >
          Ver obra
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ObrasPage({ onSelectObra }: ObrasPageProps) {
  const [obras, setObras] = useState<Obra[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      setObras(await fetchObras());
    } catch {
      setError("No se pudieron cargar las obras. Verificá que el backend esté corriendo.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-6">
      <SectionTitle
        aside={
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Actualizar"
            className="p-1.5 rounded text-constructa-secondaryText hover:text-constructa-text hover:bg-constructa-surface disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        }
      >
        Mis obras
      </SectionTitle>

      {error && (
        <div className="text-sm text-constructa-danger bg-red-50 border border-constructa-danger/30 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : obras.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-constructa-secondaryText gap-3">
          <Building2 className="w-10 h-10 opacity-20" />
          <p className="text-sm font-semibold text-constructa-text">Sin obras registradas</p>
          <p className="text-xs">Creá tu primera obra desde la API.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {obras.map((obra) => (
            <ObraCard key={obra.id} obra={obra} onSelect={() => onSelectObra(obra)} />
          ))}
        </div>
      )}
    </div>
  );
}
