import { UserCircleIcon, UserPlusIcon, ArrowRightStartOnRectangleIcon } from "@heroicons/react/24/outline";
import type React from "react";
import type { ReactNode } from "react";
import { useRef, useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { useUser, ROLE_LABELS, ROLE_COLORS } from "../../context/UserContext";
import { useOnlineUsers } from "../../hooks/useOnlineUsers";
import { UserAvatarTooltip } from "../ui/UserAvatarTooltip";
import { InviteModal } from "../InviteModal";
import { UserProfileModal } from "../UserProfileModal";
import type { Obra, ObraTab, Page } from "../../types";

interface AppLayoutProps {
  children: ReactNode;
  pageTitle: string;
  pageSubtitle?: string;
  activePage: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
  pinnedObras?: Obra[];
  currentUser?: { name: string; email: string; initials: string; color: string; avatar_url?: string | null };
  selectedObra?: Obra | null;
  activeTab?: ObraTab;
  onTabChange?: (tab: ObraTab) => void;
  obraCounts?: { tasks: number; alerts: number; responsibles: number };
}

export function AppLayout({
  children,
  pageTitle,
  pageSubtitle,
  activePage,
  onNavigate,
  onLogout,
  pinnedObras = [],
  currentUser,
  selectedObra,
  activeTab,
  onTabChange,
  obraCounts,
}: AppLayoutProps) {
  const { user, role } = useUser();
  const onlineUsers = useOnlineUsers();
  const [dropdownOpen, setDropdownOpen]       = useState(false);
  const [showInvite, setShowInvite]           = useState(false);
  const [showProfile, setShowProfile]         = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const avatarRef   = useRef<HTMLDivElement>(null);

  const displayUser = currentUser ?? user;
  const avatarColor = displayUser.color;
  const userInitials = displayUser.initials;

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        avatarRef.current   && !avatarRef.current.contains(e.target as Node)
      ) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const roleMeta = ROLE_COLORS[role];

  return (
    <div className="min-h-screen bg-constructa-bg">
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        onLogout={onLogout}
        pinnedObras={pinnedObras}
        selectedObra={selectedObra}
        activeTab={activeTab}
        onTabChange={onTabChange}
        obraCounts={obraCounts}
        currentUser={{ name: displayUser.name, initials: displayUser.initials, color: displayUser.color, roleLabel: ROLE_LABELS[role] }}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(v => !v)}
      />

      <div style={{ marginLeft: sidebarCollapsed ? 0 : 260, transition: "margin-left 0.25s ease", display: "flex", flexDirection: "column", minHeight: "100vh" }}>

        {/* ── Top bar ── */}
        <header style={{
          position: "sticky", top: 0, zIndex: 40,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 24, padding: "12px 28px",
          background: "rgba(244,245,244,0.85)",
          backdropFilter: "saturate(140%) blur(10px)",
          WebkitBackdropFilter: "saturate(140%) blur(10px)",
          borderBottom: "1px solid #E6E7E5", flexShrink: 0,
        }}>

          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: "#8E97A0", flexShrink: 0 }}>
              <path d="M2 13.5V7L8 2.5l6 4.5v6.5H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
              <path d="M5.5 13.5V10h5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize: 11.5, color: "#B0B8BF" }}>Constructa</span>
            <span style={{ fontSize: 11.5, color: "#C9D0D5" }}>/</span>
            <span style={{ fontSize: 11.5, color: "#4D5760", fontWeight: 600 }}>{pageTitle}</span>
            {pageSubtitle && (
              <>
                <span style={{ fontSize: 11.5, color: "#C9D0D5" }}>/</span>
                <span style={{ fontSize: 11.5, color: "#8E97A0", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {pageSubtitle}
                </span>
              </>
            )}
          </div>

          {/* Right actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

            {/* Online team avatars */}
            {onlineUsers.length > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#fff", border: "1px solid #E6E7E5",
                borderRadius: 99, padding: "4px 10px 4px 6px",
              }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  {onlineUsers.slice(0, 3).map((u, i) => (
                    <UserAvatarTooltip
                      key={u.id}
                      user={u}
                      wrapperStyle={{ marginLeft: i > 0 ? -7 : 0, zIndex: 3 - i, flexShrink: 0 }}
                    >
                      <div style={{
                        width: 24, height: 24, borderRadius: 99,
                        background: u.color, color: "#fff",
                        fontWeight: 700, fontSize: 9,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        border: "2px solid #fff",
                        cursor: "default",
                        position: "relative",
                      }}>
                        {u.initials}
                        <span style={{
                          position: "absolute", bottom: 0, right: 0,
                          width: 6, height: 6, borderRadius: 99,
                          background: "#1F8A5B",
                          border: "1.5px solid #fff",
                        }} />
                      </div>
                    </UserAvatarTooltip>
                  ))}
                  {onlineUsers.length > 3 && (
                    <div style={{
                      width: 24, height: 24, borderRadius: 99,
                      background: "#F4F5F4", color: "#5B6770",
                      fontWeight: 600, fontSize: 9,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: "2px solid #fff",
                      marginLeft: -7, zIndex: 0, flexShrink: 0,
                    }}>
                      +{onlineUsers.length - 3}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "#8E97A0", fontWeight: 500, whiteSpace: "nowrap" }}>
                  {onlineUsers.length === 1 ? "1 en línea" : `${onlineUsers.length} en línea`}
                </span>
              </div>
            )}

            {/* User avatar + dropdown */}
            <div style={{ position: "relative" }}>
              <div
                ref={avatarRef}
                onClick={() => setDropdownOpen(v => !v)}
                title={`${displayUser.name} · ${ROLE_LABELS[role]}`}
                style={{
                  width: 32, height: 32, borderRadius: 99, flexShrink: 0,
                  background: displayUser.avatar_url ? "transparent" : avatarColor,
                  color: "#fff", fontWeight: 700, fontSize: 11,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  cursor: "pointer", userSelect: "none", overflow: "hidden",
                  boxShadow: dropdownOpen
                    ? "0 0 0 2px #fff, 0 0 0 3px #FF6B35"
                    : "0 0 0 2px #fff, 0 0 0 3px #E6E7E5",
                  transition: "box-shadow 0.15s",
                }}
              >
                {displayUser.avatar_url
                  ? <img src={displayUser.avatar_url} alt={userInitials} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : userInitials
                }
              </div>

              {dropdownOpen && (
                <div
                  ref={dropdownRef}
                  style={{
                    position: "absolute", top: "calc(100% + 8px)", right: 0,
                    width: 252, background: "#fff", borderRadius: 14,
                    border: "1px solid #E6E7E5",
                    boxShadow: "0 8px 32px -8px rgba(0,0,0,0.14)",
                    zIndex: 50, padding: 6,
                  }}
                >
                  {/* User info */}
                  <div style={{ padding: "12px 10px", borderBottom: "1px solid #E6E7E5", marginBottom: 4, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 99, background: displayUser.avatar_url ? "transparent" : avatarColor, color: "#fff", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Plus Jakarta Sans', sans-serif", flexShrink: 0, overflow: "hidden" }}>
                      {displayUser.avatar_url
                        ? <img src={displayUser.avatar_url} alt={userInitials} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : userInitials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {!displayUser.name.includes("@") && (
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: "#1A2329", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {displayUser.name}
                        </div>
                      )}
                      <div style={{ fontWeight: displayUser.name.includes("@") ? 600 : 400, fontSize: displayUser.name.includes("@") ? 13.5 : 11.5, color: displayUser.name.includes("@") ? "#1A2329" : "#8E97A0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {displayUser.email}
                      </div>
                      <span style={{ display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 600, borderRadius: 99, padding: "2px 8px", background: roleMeta.bg, color: roleMeta.color, border: `1px solid ${roleMeta.border}` }}>
                        {ROLE_LABELS[role]}
                      </span>
                    </div>
                  </div>

                  <div style={{ height: 1, background: "#E6E7E5", margin: "4px 0" }} />

                  {/* Mi perfil */}
                  <DropdownItem
                    icon={<UserCircleIcon style={{ width: 14, height: 14 }} />}
                    label="Mi perfil"
                    onClick={() => { setDropdownOpen(false); setShowProfile(true); }}
                  />

                  {/* Invite members */}
                  <DropdownItem
                    icon={<UserPlusIcon style={{ width: 14, height: 14 }} />}
                    label="Invitar miembros"
                    onClick={() => { setDropdownOpen(false); setShowInvite(true); }}
                  />

                  {/* Logout */}
                  <DropdownItem
                    icon={<ArrowRightStartOnRectangleIcon style={{ width: 14, height: 14 }} />}
                    label="Cerrar sesión"
                    danger
                    onClick={() => { setDropdownOpen(false); onLogout(); }}
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-7 overflow-y-auto">
          {children}
        </main>
      </div>

      {showInvite   && <InviteModal       onClose={() => setShowInvite(false)} />}
      {showProfile  && <UserProfileModal  onClose={() => setShowProfile(false)} />}
    </div>
  );
}

function DropdownItem({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 8, cursor: "pointer",
        fontSize: 13.5, fontWeight: 500,
        color: danger && hovered ? "#D03A3A" : danger ? "#5B6770" : "#1A2329",
        background: hovered ? "#F4F5F4" : "transparent",
        border: "none", textAlign: "left", transition: "background 0.1s, color 0.1s",
      }}
    >
      <span style={{ color: danger && hovered ? "#D03A3A" : "#8E97A0", flexShrink: 0, transition: "color 0.1s" }}>
        {icon}
      </span>
      {label}
    </button>
  );
}
