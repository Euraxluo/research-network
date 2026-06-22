import { useEffect, useMemo, useState } from "react";
import { useWorkbench } from "../lib/store";
import { accessDecision } from "../lib/storage";
import {
  accountItems,
  persistRepoSelection,
  repoItems,
  selectedInstallationIds,
  selectedRepo
} from "../lib/github-scope";
import { ACTORS } from "../lib/store";
import { buildZkLoginSigner } from "../lib/signer";
import type { ActorId, GithubBinding, ResearchReport } from "../lib/types";

/** On mount, try to build a real zkLogin signer from the tab session. If the
 *  ephemeral key + ZK session are present (same-tab Google flow), publish uses
 *  the real Walrus+Seal+Sui path; otherwise it falls back to demo ids. */
function useSignerBootstrap() {
  const setSigner = useWorkbench((s) => s.setSigner);
  const session = useWorkbench((s) => s.session);
  useEffect(() => {
    let cancelled = false;
    if (!session?.address) {
      setSigner(null);
      return;
    }
    buildZkLoginSigner().then((signer) => {
      if (!cancelled) setSigner(signer);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.address, setSigner]);
}

function StatusBanner() {
  const text = useWorkbench((s) => s.statusText);
  const isError = useWorkbench((s) => s.statusError);
  if (!text) return null;
  return (
    <div id="workbench-status" className={"notice " + (isError ? "error" : "success")} aria-live="polite">
      {text}
    </div>
  );
}

function IdentityPanel() {
  const session = useWorkbench((s) => s.session);
  const github = useWorkbench((s) => s.github);
  const demoMode = useWorkbench((s) => s.demoMode);
  const seedDemo = useWorkbench((s) => s.seedDemo);
  if (!session?.address) {
    return (
      <section className="workbench-panel">
        <h2>Identity</h2>
        <p className="muted">No browser session is active.</p>
        <a className="button" href="/login.html">Sign in</a>
        {demoMode ? (
          <button className="button" type="button" data-testid="seed-demo" onClick={seedDemo}>
            Seed local test identity
          </button>
        ) : null}
      </section>
    );
  }
  return (
    <section className="workbench-panel">
      <h2>Identity</h2>
      <dl className="verification">
        <div>
          <dt>zkLogin address</dt>
          <dd>{session.address}</dd>
        </div>
        <div>
          <dt>GitHub</dt>
          <dd>{github?.login || "not connected"}</dd>
        </div>
      </dl>
    </section>
  );
}

function RepoScopePanel() {
  const github = useWorkbench((s) => s.github) as GithubBinding | null;
  const reload = useWorkbench((s) => s.reload);

  const accounts = useMemo(() => accountItems(github), [github]);
  const selectedInstIds = useMemo(() => selectedInstallationIds(github), [github]);
  const selectedInstSet = useMemo(() => {
    const m: Record<string, boolean> = {};
    selectedInstIds.forEach((id) => {
      m[String(id)] = true;
    });
    return m;
  }, [selectedInstIds]);

  const repos = useMemo(() => repoItems(github), [github]);
  const current = useMemo(() => selectedRepo(github), [github]);
  const hasOrgScope = accounts.some(
    (a) => String(a.accountType || "").toLowerCase() === "organization"
  );

  function onAccountToggle(id: string, checked: boolean) {
    if (!github) return;
    const next: GithubBinding = { ...github };
    const items = accountItems(github).filter((a) => a.installed);
    const valid: Record<string, boolean> = {};
    items.forEach((a) => {
      valid[String(a.id)] = true;
    });
    const base = (github.selected_installation_ids || []).map((x) => String(x)).filter((x) => valid[x]);
    const set = new Set(base);
    if (checked) set.add(String(id));
    else set.delete(String(id));
    let arr = Array.from(set);
    if (arr.length === 0) arr = items.map((a) => String(a.id));
    next.selected_installation_ids = arr;
    const repo = selectedRepo(next);
    persistRepoSelection(next, repo);
    reload();
  }

  function onRepoChange(fullName: string) {
    if (!github) return;
    const match = repos.find((r) => r.full_name === fullName) || null;
    persistRepoSelection(github, match);
    reload();
  }

  return (
    <section className="workbench-panel">
      <h2>Repository Scope</h2>
      {accounts.length === 0 ? (
        <p className="muted">No GitHub accounts or organizations are connected.</p>
      ) : (
        <fieldset className="repo-account-scope">
          <legend>GitHub account / organization</legend>
          {accounts.map((a) => {
            const id = String(a.id);
            const label =
              (a.account || "GitHub") +
              (a.accountType ? " · " + a.accountType : "");
            const detail = a.installed
              ? (a.repos?.length || 0) + " authorized repo option(s)"
              : "Not authorized yet";
            return (
              <label className={"repo-account" + (a.installed ? "" : " unavailable")} key={id}>
                <input
                  className="rn-workbench-installation"
                  type="checkbox"
                  value={id}
                  checked={Boolean(selectedInstSet[id] && a.installed)}
                  disabled={!a.installed}
                  onChange={(e) => onAccountToggle(id, e.target.checked)}
                />
                <span>
                  <b>{label}</b>
                  <br />
                  <span className="muted">{detail}</span>
                </span>
              </label>
            );
          })}
          {!hasOrgScope ? (
            <p className="muted repo-account-hint">
              Organization repositories appear after installing or approving the GitHub App in that organization.
            </p>
          ) : null}
        </fieldset>
      )}

      <div id="workbench-repo-wrap">
        {repos.length === 0 ? (
          <p className="muted" data-testid="repo-empty">
            No repositories available for the selected scope.
          </p>
        ) : (
          <>
            <label className="field-label" htmlFor="workbench-repo">Research repo</label>
            <select
              id="workbench-repo"
              className="repo-select"
              data-testid="repo-select"
              value={current?.full_name || ""}
              onChange={(e) => onRepoChange(e.target.value)}
            >
              {repos.map((r) => (
                <option key={r.full_name} value={r.full_name}>
                  {r.full_name + (r.installation_account ? " · " + r.installation_account : "")}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <p className="muted">
        Selected repo: <code data-testid="selected-repo">{current?.full_name || "none"}</code>
      </p>
      <p className="repo-actions">
        <a className="button" href="/login.html">Refresh GitHub repos</a>
        <a className="button" href="/account.html">Add GitHub account/org access</a>
      </p>
    </section>
  );
}

function PublishPanel() {
  const publish = useWorkbench((s) => s.publish);
  const [title, setTitle] = useState("Market structure notes");
  const [visibility, setVisibility] = useState<ResearchReport["visibility"]>("encrypted");
  const [tier, setTier] = useState(1);
  const [preview, setPreview] = useState("Public abstract and preview only.");
  const [plaintext, setPlaintext] = useState("Encrypted analysis visible only after Seal authorization.");

  return (
    <section className="workbench-panel">
      <h2>Publish Research</h2>
      <form
        className="workbench-form"
        onSubmit={(e) => {
          e.preventDefault();
          publish({ title, visibility, tier, preview, plaintext });
        }}
      >
        <label className="field-label">
          Report title
          <input name="title" data-testid="publish-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field-label">
          Visibility
          <select
            name="visibility"
            data-testid="visibility-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as ResearchReport["visibility"])}
          >
            <option value="public">public</option>
            <option value="encrypted">encrypted</option>
          </select>
        </label>
        <label className="field-label">
          Required tier
          <input name="tier" type="number" min={1} max={10} value={tier} onChange={(e) => setTier(Number(e.target.value))} />
        </label>
        <label className="field-label">
          Free preview
          <textarea name="preview" data-testid="publish-preview" value={preview} onChange={(e) => setPreview(e.target.value)} />
        </label>
        <label className="field-label">
          Research body
          <textarea name="plaintext" data-testid="publish-plaintext" value={plaintext} onChange={(e) => setPlaintext(e.target.value)} />
        </label>
        <button className="button" type="submit" data-testid="publish-submit">
          Publish report
        </button>
      </form>
    </section>
  );
}

function ReportCard({ report }: { report: ResearchReport }) {
  const view = useWorkbench((s) => s.view)();
  const state = useWorkbench();
  const actor = useWorkbench((s) => s.activeActor)();
  const decrypt = useWorkbench((s) => s.decryptReport);

  const decision = useMemo(() => accessDecision(view, report, actor), [view, report, actor]);
  const unlocked = Boolean(state.unlocked[actor.address + ":" + report.id]) || report.visibility === "public";
  const accessClass = decision.allowed ? "access-ok" : "access-locked";

  return (
    <article
      className={"workbench-report " + accessClass}
      data-report-id={report.id}
      data-visibility={report.visibility}
    >
      <div className="report-head">
        <strong>{report.title || report.id}</strong>
        <span className="pill">{report.visibility}</span>
      </div>
      <p className="muted">{report.free_preview || report.free_preview_hash || "No public preview."}</p>
      <p className="muted">
        Agent <code>{report.agent}</code>
        {report.source_repo ? <> · Repo <code>{report.source_repo}</code></> : null}
      </p>
      {report.visibility !== "public" ? (
        <dl className="mini-meta">
          <div><dt>Walrus</dt><dd>{report.walrus_blob_id || ""}</dd></div>
          <div><dt>Seal</dt><dd>{report.seal_id || ""}</dd></div>
          <div><dt>Cipher</dt><dd>{report.ciphertext_hash || ""}</dd></div>
        </dl>
      ) : null}
      {unlocked && decision.allowed ? (
        <div className="decrypted" data-testid={"decrypted-" + report.id}>
          {state.plaintexts[report.id] || "Decrypted research payload for " + (report.title || report.id) + "."}
        </div>
      ) : (
        <p className="muted access-state" data-testid="access-state">
          {decision.allowed ? "Ready to decrypt" : "Locked: " + decision.reason}
        </p>
      )}
      {report.visibility !== "public" ? (
        <button
          className="button decrypt-report"
          type="button"
          disabled={!decision.allowed}
          onClick={() => decrypt(report.id)}
        >
          Decrypt report
        </button>
      ) : null}
    </article>
  );
}

function AccessSimulatorPanel() {
  const actor = useWorkbench((s) => s.activeActor)();
  const setActor = useWorkbench((s) => s.setActor);
  const buyMembership = useWorkbench((s) => s.buyMembership);
  const subscribeAgent = useWorkbench((s) => s.subscribeAgent);
  const reports = useWorkbench((s) => s.view().reports);
  const selectedReportId = useWorkbench((s) => s.selected_report_id);
  const agentAddress = useWorkbench((s) => s.session?.address);
  const signerAddress = useWorkbench((s) => s.signer?.address);
  const actors = useMemo(
    () =>
      signerAddress
        ? ACTORS.map((a) => (a.id === "outsider" ? a : { ...a, address: signerAddress }))
        : agentAddress
          ? ACTORS.map((a) => (a.id === "agent" ? { ...a, address: agentAddress } : a))
        : ACTORS,
    [agentAddress, signerAddress]
  );

  return (
    <section className="workbench-panel">
      <h2>Access and subscriptions</h2>
      <label className="field-label" htmlFor="actor-select">Current role</label>
      <select
        id="actor-select"
        className="repo-select"
        data-testid="actor-select"
        value={actor.id}
        onChange={(e) => setActor(e.target.value as ActorId)}
      >
        {actors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label + " · " + a.address}
          </option>
        ))}
      </select>
      <p className="workbench-actions">
        <button className="button" type="button" data-testid="buy-membership" onClick={buyMembership}>
          Buy platform membership
        </button>
        <button className="button" type="button" data-testid="subscribe-agent" onClick={subscribeAgent}>
          Subscribe to agent
        </button>
      </p>
      <p className="muted">
        Selected report: <code>{selectedReportId || "none"}</code>
      </p>
      <div className="workbench-report-list">
        {reports.length === 0 ? <p className="muted">No reports yet.</p> : reports.map((r) => <ReportCard key={r.id} report={r} />)}
      </div>
    </section>
  );
}

function DelegationPanel() {
  const createDelegation = useWorkbench((s) => s.createDelegation);
  const submitPrivateResult = useWorkbench((s) => s.submitPrivateResult);
  const openDispute = useWorkbench((s) => s.openDispute);
  const completeDelegation = useWorkbench((s) => s.completeDelegation);
  const delegations = useWorkbench((s) => s.view().delegations);
  return (
    <section className="workbench-panel">
      <h2>Private Delegation</h2>
      <p className="workbench-actions">
        <button className="button" type="button" data-testid="create-delegation" onClick={createDelegation}>
          Create delegation
        </button>
        <button className="button" type="button" data-testid="submit-private-result" onClick={submitPrivateResult}>
          Submit private result
        </button>
        <button className="button" type="button" data-testid="open-dispute" onClick={openDispute}>
          Open dispute
        </button>
        <button className="button" type="button" data-testid="complete-delegation" onClick={completeDelegation}>
          Complete delegation
        </button>
      </p>
      {delegations.length === 0 ? (
        <p className="muted">No delegation jobs yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Job</th><th>Status</th><th>Buyer</th><th>Agent</th><th>Result</th></tr>
          </thead>
          <tbody>
            {delegations.map((job) => (
              <tr key={job.id}>
                <td>{job.id}</td>
                <td>{job.status}</td>
                <td>{job.buyer}</td>
                <td>{job.agent}</td>
                <td>{job.result_report_id || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReceiptsPanel() {
  const receipts = useWorkbench((s) => s.view().access_receipts);
  const settleLatestMembershipReceipt = useWorkbench((s) => s.settleLatestMembershipReceipt);
  const claimAgentEarnings = useWorkbench((s) => s.claimAgentEarnings);
  return (
    <section className="workbench-panel">
      <h2>Access Receipts</h2>
      <p className="workbench-actions">
        <button className="button" type="button" data-testid="settle-membership-receipt" onClick={settleLatestMembershipReceipt}>
          Settle latest receipt
        </button>
        <button className="button" type="button" data-testid="claim-agent-earnings" onClick={claimAgentEarnings}>
          Claim earnings
        </button>
      </p>
      {receipts.length === 0 ? (
        <p className="muted">No access receipts recorded.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Receipt</th><th>User</th><th>Report</th><th>Type</th><th>Source</th><th>Settlement</th></tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.user}</td>
                <td>{r.report_id}</td>
                <td>{r.access_type}</td>
                <td>{r.source || ""}</td>
                <td>{r.settlement_tx_digest ? "settled" : "pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function WorkbenchPage() {
  useSignerBootstrap();
  const hasSigner = useWorkbench((s) => Boolean(s.signer));
  const demoMode = useWorkbench((s) => s.demoMode);
  return (
    <>
      <StatusBanner />
      {hasSigner ? (
        <p className="notice success" data-testid="m3-active">
          Connected to Sui: publishing, access, and settlement actions use Walrus, Seal, and Sui when your session can sign.
        </p>
      ) : demoMode ? (
        <p className="notice muted" data-testid="m3-demo">
          Demo session: actions use local sample records until this browser tab has a live zkLogin signer.
        </p>
      ) : (
        <p className="notice muted" data-testid="m3-demo">
          Sign in to publish research assets and unlock signer-backed Walrus, Seal, and Sui actions.
        </p>
      )}
      <IdentityPanel />
      <RepoScopePanel />
      <PublishPanel />
      <AccessSimulatorPanel />
      <DelegationPanel />
      <ReceiptsPanel />
    </>
  );
}
