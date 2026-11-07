import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { readPreviewToken } from "./preview";
import "./styles.css";

// 404.html sends non-preview visitors to the app root; don't start the app on
// the fallback document while that redirect is in flight.
if (!("cmsFallbackRedirect" in document.documentElement.dataset)) {
  // Preview is detected before any routing, redirects or not-found handling.
  const previewToken = readPreviewToken();
  if (previewToken === null) {
    const recoveredRoute = new URLSearchParams(window.location.search).get("__route");
    if (recoveredRoute?.startsWith("/")) window.history.replaceState({}, "", recoveredRoute);
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App previewToken={previewToken} />
    </StrictMode>,
  );
}
