import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";
import "./styles.css";

document.documentElement.dataset.platform = navigator.userAgent.includes("Mac") ? "darwin" : "other";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
