import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DebugPage } from "../pages/DebugPage";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <DebugPage />
    </StrictMode>
  );
}
