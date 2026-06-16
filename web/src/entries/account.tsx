import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountPage } from "../pages/AccountPage";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <AccountPage />
    </StrictMode>
  );
}
