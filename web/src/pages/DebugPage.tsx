import { useState } from "react";
import { buildAcceptanceSessionExport } from "../lib/acceptance-session";
import { readSession } from "../lib/storage";

type DebugTab = "acceptance";

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function DebugPage() {
  const [tab, setTab] = useState<DebugTab>("acceptance");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [revealedPayload, setRevealedPayload] = useState<string>("");
  const session = readSession();

  function exportAcceptanceSession(role: "buyer" | "agent") {
    try {
      const payload = buildAcceptanceSessionExport();
      const filename = `acceptance-${role}.json`;
      downloadJson(filename, payload);
      setStatus({
        text: `Downloaded ${filename}. Keep it under .research-network/secrets/ for capped acceptance only.`
      });
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true
      });
    }
  }

  async function copyAcceptanceSession(role: "buyer" | "agent") {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard write is unavailable in this browser.");
      }
      const payload = buildAcceptanceSessionExport();
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2) + "\n");
      setStatus({
        text: `Copied acceptance-${role}.json payload. Store it under .research-network/secrets/ and clear the clipboard after use.`
      });
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true
      });
    }
  }

  function revealAcceptanceSession(role: "buyer" | "agent") {
    try {
      const payload = buildAcceptanceSessionExport();
      setRevealedPayload(JSON.stringify(payload, null, 2) + "\n");
      setStatus({
        text: `Revealed acceptance-${role}.json payload in this page. Save it under .research-network/secrets/ and clear it after use.`
      });
    } catch (error) {
      setRevealedPayload("");
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true
      });
    }
  }

  function clearRevealedPayload() {
    setRevealedPayload("");
    setStatus({ text: "Cleared revealed acceptance session payload." });
  }

  function startAcceptanceLogin(role: "buyer" | "agent") {
    sessionStorage.setItem("rn_acceptance_debug_role", role);
    location.href = "/login.html";
  }

  return (
    <>
      <p>
        <a href="/">← Research Network</a>
      </p>
      <h1>Debug</h1>
      <p className="muted">
        Engineering-only tools for testnet/mainnet readiness. This route is intentionally not part of the normal product
        account flow.
      </p>

      <div role="tablist" aria-label="Debug tools" className="repo-actions">
        <button
          className="button"
          type="button"
          role="tab"
          aria-selected={tab === "acceptance"}
          data-testid="debug-tab-acceptance"
          onClick={() => setTab("acceptance")}
        >
          Acceptance
        </button>
      </div>

      {tab === "acceptance" ? (
        <section aria-labelledby="debug-acceptance-heading">
          <h2 id="debug-acceptance-heading">Acceptance session</h2>
          {session?.address ? (
            <dl className="verification">
              <div>
                <dt>zkLogin address</dt>
                <dd>{session.address}</dd>
              </div>
              {session.email ? (
                <div>
                  <dt>Email</dt>
                  <dd>{session.email}</dd>
                </div>
              ) : null}
              <div>
                <dt>Provider</dt>
                <dd>{session.iss || session.provider || "google"}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">No zkLogin browser session is active.</p>
          )}
          <p className="muted">
            Export only from the browser tab that completed Google zkLogin. Files contain sensitive zkLogin material and
            must never be committed.
          </p>
          <p className="repo-actions">
            <button
              className="button"
              type="button"
              data-testid="debug-export-acceptance-buyer"
              onClick={() => exportAcceptanceSession("buyer")}
            >
              Export buyer session
            </button>
            <button
              className="button"
              type="button"
              data-testid="debug-export-acceptance-agent"
              onClick={() => exportAcceptanceSession("agent")}
            >
              Export agent session
            </button>
            <button
              className="button"
              type="button"
              data-testid="debug-copy-acceptance-buyer"
              onClick={() => void copyAcceptanceSession("buyer")}
            >
              Copy buyer session
            </button>
            <button
              className="button"
              type="button"
              data-testid="debug-copy-acceptance-agent"
              onClick={() => void copyAcceptanceSession("agent")}
            >
              Copy agent session
            </button>
            <button
              className="button"
              type="button"
              data-testid="debug-reveal-acceptance-buyer"
              onClick={() => revealAcceptanceSession("buyer")}
            >
              Reveal buyer session
            </button>
            <button
              className="button"
              type="button"
              data-testid="debug-reveal-acceptance-agent"
              onClick={() => revealAcceptanceSession("agent")}
            >
              Reveal agent session
            </button>
            <button
              className="button secondary"
              type="button"
              data-testid="debug-clear-acceptance-session"
              onClick={clearRevealedPayload}
            >
              Clear revealed session
            </button>
            <button
              className="button"
              type="button"
              data-testid="debug-start-acceptance-buyer-login"
              onClick={() => startAcceptanceLogin("buyer")}
            >
              Start buyer acceptance login
            </button>
            <button
              className="button"
              type="button"
              data-testid="debug-start-acceptance-agent-login"
              onClick={() => startAcceptanceLogin("agent")}
            >
              Start agent acceptance login
            </button>
          </p>
          {revealedPayload ? (
            <textarea
              aria-label="Revealed acceptance session JSON"
              data-testid="debug-acceptance-session-payload"
              readOnly
              rows={12}
              spellCheck={false}
              value={revealedPayload}
              style={{ width: "100%", fontFamily: "var(--mono)", fontSize: "12px" }}
            />
          ) : null}
          {status ? (
            <p
              id="debug-acceptance-session-export-status"
              className={status.error ? "error" : "muted"}
              data-testid="debug-acceptance-session-export-status"
            >
              {status.text}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
