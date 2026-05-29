import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#F4F5F4", padding: 24,
        }}>
          <div style={{
            maxWidth: 600, width: "100%", background: "#fff",
            borderRadius: 14, border: "1px solid #F0B0B0",
            boxShadow: "0 8px 24px -8px rgba(208,58,58,0.15)",
            padding: 28,
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: "#D03A3A", textTransform: "uppercase", marginBottom: 12 }}>
              Error de render
            </div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 16, color: "#1A2329", margin: "0 0 12px" }}>
              {this.state.error.name}: {this.state.error.message}
            </h2>
            <pre style={{
              fontSize: 11, background: "#FCE5E5", borderRadius: 8, padding: 14,
              overflow: "auto", color: "#A82B2B", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16, padding: "9px 18px", borderRadius: 9,
                background: "#FF6B35", color: "#fff", border: "none",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              Recargar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
