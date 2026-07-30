import { useCallback, useEffect, useState } from "react";
import { clearToken, getToken, setToken } from "./lib/tokenStorage";
import { fetchObra } from "./api/obras";
import { fetchBitacoraPendingCount } from "./api/bitacora";
import { AppLayout } from "./components/layout/AppLayout";
import { ActivityToast } from "./components/ActivityToast";
import { ObraSetupWizard } from "./components/ObraSetupWizard";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { BitacoraPage } from "./pages/BitacoraPage";
import { AdminPage } from "./pages/AdminPage";
import { ConfiguracionPage } from "./pages/ConfiguracionPage";
import { EquipoPage } from "./pages/EquipoPage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingModal, isOnboardingDone } from "./components/OnboardingModal";
import { ObraDetailPage } from "./pages/ObraDetailPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { Spinner } from "./components/Spinner";
import { useUser } from "./context/UserContext";
import { useActivityFeed } from "./hooks/useActivityFeed";
import type { Alert, Obra, ObraTab, Page } from "./types";
import type { AlertFocusField } from "./pages/ObraDetailPage";

// Extract invite token from URL if present: /invite/{token}
function getInviteToken(): string | null {
  const match = window.location.pathname.match(/^\/invite\/(.+)$/);
  return match ? match[1] : null;
}

// Extract reset token from URL if present: /reset-password/{token}
function getResetToken(): string | null {
  const match = window.location.pathname.match(/^\/reset-password\/(.+)$/);
  return match ? match[1] : null;
}

// Extract email-verification token from URL if present: /verify-email/{token}
function getVerifyToken(): string | null {
  const match = window.location.pathname.match(/^\/verify-email\/(.+)$/);
  return match ? match[1] : null;
}

function AccessDenied() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 12, color: "#5B6770" }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
      </svg>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#1A2329" }}>Acceso restringido</p>
      <p style={{ margin: 0, fontSize: 13 }}>Solo los administradores pueden ver esta sección.</p>
    </div>
  );
}

function App() {
  const { user, role, loading: userLoading, refetch: refetchUser } = useUser();
  const [, latestActivity]              = useActivityFeed(user?.id);
  const [authed, setAuthed]             = useState(() => !!getToken());
  const [activePage, setActivePage]     = useState<Page>("panel");
  const [selectedObra, setSelectedObra] = useState<Obra | null>(null);
  const [activeTab, setActiveTab]       = useState<ObraTab>("resumen");
  const [obraCounts, setObraCounts]     = useState({ tasks: 0, alerts: 0, responsibles: 0 });
  const [bitacoraPending, setBitacoraPending] = useState(0);
  const [showWizard, setShowWizard]     = useState(false);
  const [focusAlert, setFocusAlert]     = useState<{ taskId: number; field: AlertFocusField } | null>(null);
  const [pinnedObras, setPinnedObras]   = useState<Obra[]>(() => {
    try { return JSON.parse(localStorage.getItem("pinned_obras") || "[]"); }
    catch { return []; }
  });

  const handleObraCounts = useCallback((counts: { tasks: number; alerts: number; responsibles: number }) => {
    setObraCounts(counts);
  }, []);

  const handleTabChange = useCallback((tab: ObraTab) => {
    setActiveTab(tab);
    setActivePage("panel");
  }, []);

  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (authed && !userLoading && !isOnboardingDone()) setShowOnboarding(true);
  }, [authed, userLoading]);

  // Badge de sugerencias de bitácora sin revisar — por obra (es un módulo de la obra).
  // Se refresca al cambiar de obra y al navegar (p.ej. al volver de la Bitácora tras aplicar/descartar).
  useEffect(() => {
    if (!authed || userLoading || !selectedObra) { setBitacoraPending(0); return; }
    fetchBitacoraPendingCount(selectedObra.id).then(setBitacoraPending).catch(() => { /* ignore */ });
  }, [authed, userLoading, selectedObra, activePage]);

  const inviteToken                     = getInviteToken();
  const resetToken                      = getResetToken();
  const verifyToken                     = getVerifyToken();

  // Email-verification flow — intercept before anything else
  if (verifyToken) {
    return (
      <VerifyEmailPage
        token={verifyToken}
        onDone={() => { window.location.href = "/"; }}
      />
    );
  }

  // Reset-password flow — intercept before anything else
  if (resetToken) {
    return (
      <ResetPasswordPage
        token={resetToken}
        onDone={(accessToken) => {
          setToken(accessToken);
          window.location.href = "/"; // limpia la URL /reset-password/... y entra a la app
        }}
      />
    );
  }

  // Invite flow — intercept before anything else
  if (inviteToken) {
    return (
      <AcceptInvitePage
        token={inviteToken}
        onAccepted={(accessToken) => {
          setToken(accessToken);
          window.location.href = "/"; // clean the /invite/... URL and enter the app
        }}
      />
    );
  }

  if (!authed) {
    return <LoginPage onLogin={() => { setAuthed(true); refetchUser(); }} />;
  }

  if (userLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F5F4" }}>
        <Spinner />
      </div>
    );
  }

  function handleNavigate(page: Page) {
    setActivePage(page);
    if (page === "panel") setSelectedObra(null);
  }

  function handleSelectObra(obra: Obra) {
    setSelectedObra(obra);
    setActivePage("panel");
    // Al entrar a una obra desde el panel, siempre abrir en el Resumen (página principal).
    setActiveTab("resumen");
    setObraCounts({ tasks: 0, alerts: 0, responsibles: 0 });
    setFocusAlert(null); // reset manual navigation
  }

  async function handleAlertClick(alert: Alert) {
    if (!alert.obra_id) return;
    const fieldMap: Record<string, AlertFocusField> = {
      task_blocked:         "taskStatus",
      task_overdue:         "due",
      delay_risk:           "responsible",
      no_response:          "responsible",
      reschedule_requested: "due",
    };
    try {
      const obra = await fetchObra(alert.obra_id);
      handleSelectObra(obra); // llama setFocusAlert(null) internamente
      // setFocusAlert después — gana en el batch de React porque va último
      if (alert.task_id) {
        setFocusAlert({ taskId: alert.task_id, field: fieldMap[alert.type] ?? "responsible" });
      }
    } catch { /* silently ignore if obra was deleted */ }
  }

  function handleObraCreated(obra: Obra) {
    setShowWizard(false);
    setSelectedObra(obra);
    setActivePage("panel");
  }

  function handleTogglePin(obra: Obra) {
    setPinnedObras(prev => {
      const next = prev.some(o => o.id === obra.id)
        ? prev.filter(o => o.id !== obra.id)
        : [...prev, obra];
      localStorage.setItem("pinned_obras", JSON.stringify(next));
      return next;
    });
  }

  let pageTitle: string;
  let pageSubtitle: string | undefined;

  if (activePage === "panel") {
    if (selectedObra) {
      pageTitle = selectedObra.name;
      pageSubtitle = selectedObra.location ?? undefined;
    } else {
      pageTitle = "Panel";
      pageSubtitle = "Vista general de obras";
    }
  } else if (activePage === "equipo") {
    pageTitle = "Gestión de equipo";
    pageSubtitle = "Miembros de la organización";
  } else if (activePage === "bitacora") {
    pageTitle = "Bitácora de Obra";
    pageSubtitle = "Audios y notas con IA";
  } else if (activePage === "admin") {
    pageTitle = "Panel Admin";
    pageSubtitle = "Métricas del tenant y plan";
  } else {
    pageTitle = "Configuración";
    pageSubtitle = "Ajustes del sistema";
  }

  function renderPage() {
    if (activePage === "panel") {
      return selectedObra ? (
        <ObraDetailPage obra={selectedObra} activeTab={activeTab} onTabChange={handleTabChange} onCounts={handleObraCounts} focusAlert={focusAlert} />
      ) : (
        <PortfolioPage
          onSelectObra={handleSelectObra}
          onNewObra={() => setShowWizard(true)}
          pinnedObras={pinnedObras}
          onTogglePin={handleTogglePin}
        />
      );
    }
    if (activePage === "equipo") {
      if (role !== "admin") return <AccessDenied />;
      return <EquipoPage />;
    }
    if (activePage === "admin") {
      if (role !== "admin") return <AccessDenied />;
      return <AdminPage />;
    }
    if (activePage === "bitacora") return <BitacoraPage obra={selectedObra ?? null} />;
    if (role !== "admin") return <AccessDenied />;
    return <ConfiguracionPage />;
  }

  return (
    <>
      <AppLayout
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        activePage={activePage}
        onNavigate={handleNavigate}
        onLogout={() => { clearToken(); setAuthed(false); }}
        onAlertClick={handleAlertClick}
        pinnedObras={pinnedObras}
        onSelectObra={handleSelectObra}
        currentUser={user}
        selectedObra={selectedObra}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        obraCounts={obraCounts}
        bitacoraPending={bitacoraPending}
      >
        {renderPage()}
      </AppLayout>

      {showOnboarding && <OnboardingModal onClose={() => setShowOnboarding(false)} onCreateObra={() => setShowWizard(true)} />}

      {showWizard && (
        <ObraSetupWizard
          onClose={() => setShowWizard(false)}
          onCreated={handleObraCreated}
        />
      )}

      <ActivityToast event={latestActivity} />
    </>
  );
}

export default App;
