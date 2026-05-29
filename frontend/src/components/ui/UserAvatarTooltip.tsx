import { useState } from "react";
import type { OnlineUser } from "../../hooks/useOnlineUsers";

interface Props {
  user: OnlineUser;
  children: React.ReactNode;
  wrapperStyle?: React.CSSProperties;
}

export function UserAvatarTooltip({ user, children, wrapperStyle }: Props) {
  const [visible, setVisible] = useState(false);

  const displayName = user.name.includes("@")
    ? user.name.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : user.name;

  return (
    <div
      style={{ position: "relative", display: "inline-flex", ...wrapperStyle }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}

      {visible && (
        <>
          {/* Flecha apuntando hacia arriba */}
          <div style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%) rotate(45deg)",
            width: 8, height: 8,
            background: "#3D4A52",
            zIndex: 10000,
            pointerEvents: "none",
            borderTop: "none",
            borderLeft: "none",
          }} />

          {/* Card */}
          <div style={{
            position: "absolute",
            top: "calc(100% + 11px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#3D4A52",
            borderRadius: 99,
            padding: "5px 10px 5px 6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            {/* Avatar pequeño */}
            <div style={{
              width: 20, height: 20, borderRadius: 99,
              background: user.color, color: "#fff",
              fontWeight: 700, fontSize: 8.5,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              flexShrink: 0,
            }}>
              {user.initials}
            </div>

            {/* Nombre */}
            <span style={{
              fontWeight: 600, fontSize: 11.5, color: "#E8EBEC",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}>
              {displayName}
            </span>

            {/* Dot online */}
            <span style={{
              width: 5, height: 5, borderRadius: 99,
              background: "#34D399", flexShrink: 0,
            }} />
          </div>
        </>
      )}
    </div>
  );
}
