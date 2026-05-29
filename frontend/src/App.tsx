import { useCallback, useState } from "react";
import { clearToken, getToken, setToken } from "./lib/tokenStorage";
import { AppLayout } from "./components/layout/AppLayout";
import { ActivityToast } from "./components/ActivityToast";
import { ObraSetupWizard } from "./components/ObraSetupWizard";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { BitacoraPage } from "./pages/BitacoraPage";
import { PresupuestosPage } from "./pages/PresupuestosPage";
import { ConfiguracionPage } from "./pages/ConfiguracionPage";
import { EquipoPage } from "./pages/EquipoPage";
import { LoginPage } from "./pages/LoginPage";
import { ObraDetailPage } from "./pages/ObraDetailPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { Spinner } from "./components/Spinner";
import { useUser } from "./context/UserContext";
import { useActivityFeed } from "./hooks/useActivityFeed";
import type { Obra, ObraTab, Page } from "./types";

// Extract invite token from URL if present: /invite/{token}
function getInviteToken(): string | null {
  const match = window.location.pathname.match(/^\/invite\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const { user, loading: userLoading, refetch: refetchUser } = useUser();
  const [, latestActivity]              = useActivityFeed(user?.id);
  const [authed, setAuthed]             = useState(() => !!getToken());
  const [activePage, setActivePage]     = useState<Page>("panel");
  const [selectedObra, setSelectedObra] = useState<Obra | null>(null);
  const [activeTab, setActiveTab]       = useState<ObraTab>("resumen");
  const [obraCounts, setObraCounts]     = useState({ tasks: 0, alerts: 0, responsibles: 0 });
  const [showWizard, setShowWizard]     = useState(false);
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

  const inviteToken                     = getInviteToken();

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
    setActiveTab("resumen");
    setObraCounts({ tasks: 0, alerts: 0, responsibles: 0 });
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
    pageSubtitle = "Próximamente";
  } else if (activePage === "presupuestos") {
    pageTitle = "Gestión de Presupuestos";
    pageSubtitle = "Próximamente";
  } else {
    pageTitle = "Configuración";
    pageSubtitle = "Ajustes del sistema";
  }

  function renderPage() {
    if (activePage === "panel") {
      return selectedObra ? (
        <ObraDetailPage obra={selectedObra} activeTab={activeTab} onTabChange={handleTabChange} onCounts={handleObraCounts} />
      ) : (
        <PortfolioPage
          onSelectObra={handleSelectObra}
          onNewObra={() => setShowWizard(true)}
          pinnedObras={pinnedObras}
          onTogglePin={handleTogglePin}
        />
      );
    }
    if (activePage === "equipo") return <EquipoPage />;
    if (activePage === "bitacora") return <BitacoraPage />;
    if (activePage === "presupuestos") return <PresupuestosPage />;
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
        pinnedObras={pinnedObras}
        currentUser={user}
        selectedObra={selectedObra}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        obraCounts={obraCounts}
      >
        {renderPage()}
      </AppLayout>

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
