import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ServiceWorkerUpdate } from "./components/ServiceWorkerUpdate";
import "./styles/app.css";
import "./styles/marketing.css";

// Non-user-facing deployment marker for fresh-build verification.
if (import.meta.env.VITE_BUILD_ID) document.documentElement.dataset.buildId = import.meta.env.VITE_BUILD_ID;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    {import.meta.env.PROD && <ServiceWorkerUpdate />}
  </StrictMode>,
);
