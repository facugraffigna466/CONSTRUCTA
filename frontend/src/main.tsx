import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { UserProvider } from "./context/UserContext.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ConfirmProvider } from "./components/ConfirmProvider.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <UserProvider>
        <ErrorBoundary>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ErrorBoundary>
      </UserProvider>
    </ErrorBoundary>
  </StrictMode>
);
