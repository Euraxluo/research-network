import { useEffect } from "react";

// The login page is a React shell that reproduces the exact DOM the existing
// bundle (auth/login.js + zklogin-browser.js + auth/config.js) expects.
// We intentionally DO NOT port the zkLogin crypto into React — those scripts
// already work, are esbuild-bundled, and re-deriving them in M2 is pure risk.
// M3 can revisit once transaction signing lands.
//
// The scripts are emitted to .vercel-shell by buildVercelAuthShell and proxied
// to the prod host in dev (see vite.config.ts server.proxy).
const LOGIN_SCRIPT_SRCS = ["/zklogin-browser.js", "/auth/config.js", "/auth/login.js"];

function useExternalScripts(srcs: string[]) {
  useEffect(() => {
    let cancelled = false;
    async function loadScripts() {
      for (const src of srcs) {
        if (cancelled) return;
        const existing = document.querySelector(`script[data-ext="${src}"]`);
        if (existing) continue;
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = src;
          s.dataset.ext = src;
          s.async = false;
          s.addEventListener("load", () => resolve(), { once: true });
          s.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
          document.body.appendChild(s);
        });
      }
    }
    void loadScripts();
    return () => {
      cancelled = true;
      // Leave the script in place; removing it would break re-mounts in dev.
    };
  }, [srcs]);
}

export function LoginPage() {
  useExternalScripts(LOGIN_SCRIPT_SRCS);

  return (
    <>
      <p>
        <a href="/">← Research Network</a>
      </p>
      <h1>Sign in</h1>
      <p className="muted">
        zkLogin derives your Sui address from a Google sign-in (no wallet/seed). Connect GitHub
        afterwards to pick which research repos to link to your address.
      </p>
      <div className="auth-grid">
        <div className="auth-card">
          <h2>1 · Sui identity · zkLogin</h2>
          <p className="muted">
            Sign in with Google → get a Sui address derived in-browser via @mysten/sui.
          </p>
          <button id="google" className="btn">
            Sign in with Google
          </button>
          <p id="google-status" className="muted"></p>
        </div>
        <div className="auth-card">
          <h2>2 · Connect GitHub</h2>
          <p className="muted">
            Authorize the GitHub App on only the repos you choose. Least-privilege, read-only. Repos
            are bound to your Sui address.
          </p>
          <a id="github" className="btn" href="#">
            Connect GitHub repos
          </a>
          <p id="github-status" className="muted"></p>
        </div>
      </div>
      <div id="session"></div>
    </>
  );
}
