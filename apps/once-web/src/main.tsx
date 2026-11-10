import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "../styles.css";
import "../assets/ux/workspace.css";
import "../assets/ux/product-ui.css";
import "./react.css";
import "./font-faces.css";
import "./design-system.css";
import "./once.css";
import "./typography.css";
import { TooltipProvider } from "./components/ui/tooltip";
import { queryClient } from "./lib/api";
import { AppProvider } from "./app/AppProvider";
import { App, ErrorBoundary } from "./app/App";
const root = document.getElementById("app");
if (!root) throw new Error("ONCE root element missing");
// Keep existing bookmarked hash routes working while OAuth callbacks and reset fragments use real paths.
if (location.hash.startsWith("#/")) {
  const route = location.hash.slice(1);
  history.replaceState(null, "", route);
}
root.removeAttribute("aria-busy");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TooltipProvider delayDuration={350}>
            <AppProvider><App /></AppProvider>
          </TooltipProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
