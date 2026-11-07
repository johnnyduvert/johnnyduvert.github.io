import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const recoveredRoute = new URLSearchParams(window.location.search).get("__route");
if (recoveredRoute?.startsWith("/")) window.history.replaceState({}, "", recoveredRoute);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
