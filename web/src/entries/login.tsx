import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LoginPage } from "../pages/LoginPage";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <LoginPage />
    </StrictMode>
  );
}
