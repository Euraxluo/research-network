// Client interface layer. M2 ships a localStorage/demo implementation that mirrors
// the original workbench behavior. M3 will swap the implementation for real
// Walrus upload + Seal encrypt/decrypt + Sui browser signing WITHOUT changing
// the call sites in the React components.
//
// M3 implementation reference (from SUI_Seal_SKILL.md + SUI_Walrus_SKILL.md):
//   - Walrus upload: @mysten/walrus writeFilesFlow (register/upload/certify steps)
//     or writeBlob; aggregator GET /v1/blobs/<id> for reads.
//   - Seal: client.seal.encrypt({ threshold, packageId, id, data }) on publish;
//     SessionKey + seal_approve PTB + client.seal.decrypt on read.
//   - Sui signing: Transaction + zkLogin signer; real packageId + shared object ids
//     (SettlementConfig / AgentEarnings / MembershipReceiptRegistry).
//   - NOTE: access.move seal_approve_* signatures are WRONG for Seal (need
//     id: vector<u8> first param + abort). Must be fixed + package upgraded
//     before M3 Seal decrypt can work.

import { hash } from "./storage";
import type { AccessDecision, Actor, ResearchReport, Visibility } from "./types";

export interface PublishReportInput {
  title: string;
  visibility: Visibility;
  requiredTier: number;
  freePreview: string;
  plaintext: string;
  agent: string;
  sourceRepo: string;
}

export interface PublishResult {
  report: ResearchReport;
  plaintext: string; // stored locally for demo decrypt; M3 keeps key in Seal only
}

// ----- M2 demo implementation (synthetic ids via hash) -----

function nowIso(): string {
  return new Date().toISOString();
}

export function publishReportDemo(input: PublishReportInput): PublishResult {
  const stamp = Date.now();
  const id = "report:ui:" + hash(input.agent + ":" + input.title + ":" + stamp);
  const report: ResearchReport = {
    id,
    sui_object_id: "0x" + hash(id + ":object"),
    agent: input.agent,
    visibility: input.visibility,
    required_tier: input.visibility === "public" ? 0 : input.requiredTier,
    walrus_blob_id:
      input.visibility === "public" ? "walrus:public:" + hash(id) : "walrus:ciphertext:" + hash(id),
    seal_id: input.visibility === "public" ? undefined : "seal:" + hash(id + ":seal"),
    ciphertext_hash:
      input.visibility === "public"
        ? undefined
        : "sha256:cipher:" + hash(input.plaintext || input.freePreview || input.title),
    plaintext_commitment:
      input.visibility === "public"
        ? "sha256:plain:" + hash(input.freePreview || input.title)
        : "sha256:plain:" + hash(input.plaintext || input.freePreview || input.title),
    title: input.title,
    free_preview: input.freePreview || "No preview supplied.",
    created_at: nowIso(),
    source_repo: input.sourceRepo
  };
  const plaintext =
    input.visibility === "public"
      ? ""
      : input.plaintext || "Encrypted research body for " + input.title + ".";
  return { report, plaintext };
}

export interface DelegationResultInput {
  jobId: string;
  agent: string;
}

export function submitPrivateResultDemo(input: DelegationResultInput): {
  report: ResearchReport;
  plaintext: string;
} {
  const reportId = "report:private:" + hash(input.jobId + ":" + Date.now());
  const title = "Private result for " + input.jobId;
  const report: ResearchReport = {
    id: reportId,
    sui_object_id: "0x" + hash(reportId + ":object"),
    agent: input.agent,
    visibility: "private_delegation",
    required_tier: 0,
    walrus_blob_id: "walrus:private:" + hash(reportId),
    seal_id: "seal:" + hash(reportId + ":seal"),
    ciphertext_hash: "sha256:cipher:" + hash(reportId),
    plaintext_commitment: "sha256:plain:" + hash(reportId),
    free_preview_hash: "sha256:preview:" + hash(reportId),
    delegation_job_id: input.jobId,
    title,
    free_preview: "Private delegation result metadata only.",
    created_at: nowIso()
  };
  return { report, plaintext: "Private delegation research result. Buyer and agent can decrypt by default." };
}

// Returns whether Seal access is granted for the actor. M3 will perform a real
// seal_approve dry-run + key fetch; M2 just reuses the access-decision logic.
export interface SealCheckInput {
  decision: AccessDecision;
  report: ResearchReport;
  actor: Actor;
}

export function sealAllowsDemo(input: SealCheckInput): boolean {
  return input.decision.allowed;
}
