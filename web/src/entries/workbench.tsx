import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchPage } from "../pages/WorkbenchPage";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <WorkbenchPage />
    </StrictMode>
  );
}
