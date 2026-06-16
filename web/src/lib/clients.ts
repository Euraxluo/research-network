// Client interface layer.
// - M2 demo path (synthetic hash ids, localStorage) is kept as the offline/local
//   fallback so the workbench works without a wallet or network.
// - M3 real path: Walrus upload + Seal encrypt/decrypt + Sui publish, used when a
//   signer is available. The React components call the same functions; which path
//   runs is chosen by whether a signer is supplied.
//
// M3 references (SUI_Seal_SKILL.md + SUI_Walrus_SKILL.md):
//   - Walrus upload: WalrusClient.writeBlob (register/upload/certify) -> blob id.
//   - Seal encrypt on publish: SealClient.encrypt({ threshold, packageId, id, data }).
//   - Seal decrypt on read: build seal_approve PTB -> SealClient.decrypt.
//   - id = report object id bytes (M3-0 decision; access.move asserts this).
//   - Package 0x97ea53... (Seal-conformant, published by M3-0).

import { hash } from "./storage";
import { sha256, toBytesUtf8, toBase64 } from "./crypto";
import { uploadBlob, readBlob, blobIdToBytes } from "./walrus";
import { sealEncrypt, sealDecrypt, objectIdToBytes, bytesToObjectId } from "./seal-client";
import { buildPublishPublicReport, buildPublishEncryptedReport, getSuiClient } from "./sui-client";
import { loadM3Config } from "./config";
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
  plaintext: string;
}

// ---- Signer abstraction. The workbench store injects a real zkLogin signer
//      (ephemeral keypair from zklogin-browser.js) when available. ----
export interface M3Signer {
  address: string;
  signAndExecuteTransaction: (txBytes: Uint8Array) => Promise<{ digest: string; createdObjectIds: string[] }>;
  signPersonalMessage: (msg: Uint8Array) => Promise<string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============ M2 demo path (offline fallback) ============

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

export interface SealCheckInput {
  decision: AccessDecision;
  report: ResearchReport;
  actor: Actor;
}
export function sealAllowsDemo(input: SealCheckInput): boolean {
  return input.decision.allowed;
}

// ============ M3 real path (Walrus + Seal + Sui) ============

/** Publish a report for real: encrypt (if non-public) -> upload to Walrus ->
 *  build + sign + execute the publish_*_report tx on Sui. Falls back to demo
 *  when no signer is supplied (offline/local preview). */
export async function publishReport(
  input: PublishReportInput,
  signer?: M3Signer
): Promise<PublishResult> {
  if (!signer) return publishReportDemo(input);

  const config = loadM3Config();
  const previewBytes = toBytesUtf8(input.freePreview || input.title);
  const plaintextBytes = toBytesUtf8(input.plaintext || input.freePreview || input.title);
  const plaintextCommitment = await sha256(plaintextBytes);
  const freePreviewHash = await sha256(previewBytes);
  const suiClient = getSuiClient();

  if (input.visibility === "public") {
    // Public: upload plaintext to Walrus, publish on-chain, no Seal.
    const { blobId } = await uploadBlob(plaintextBytes);
    const walrusBlobId = blobIdToBytes(blobId);
    const tx = buildPublishPublicReport({
      walrusBlobId,
      plaintextCommitment,
      freePreviewHash,
      packageId: config.packageId
    });
    tx.setSender(signer.address);
    const txBytes = await tx.build({ client: suiClient });
    const result = await signer.signAndExecuteTransaction(txBytes);
    const reportObjectId = result.createdObjectIds[0] || ("0x" + hash(input.title + Date.now()));
    return {
      report: {
        id: reportObjectId,
        sui_object_id: reportObjectId,
        agent: signer.address,
        visibility: "public",
        required_tier: 0,
        walrus_blob_id: blobId,
        plaintext_commitment: "sha256:" + toBase64(plaintextCommitment),
        free_preview_hash: "sha256:" + toBase64(freePreviewHash),
        title: input.title,
        free_preview: input.freePreview || "No preview supplied.",
        created_at: nowIso(),
        source_repo: input.sourceRepo
      },
      plaintext: ""
    };
  }

  // Encrypted: Seal-encrypt plaintext under id = report-object-id.
  // The report object id isn't known until publish, so we dry-run a placeholder
  // publish to reserve the object id, encrypt under that id, then publish for real.
  const placeholderTx = buildPublishEncryptedReport({
    walrusBlobId: plaintextCommitment,
    sealId: plaintextCommitment,
    ciphertextHash: plaintextCommitment,
    plaintextCommitment,
    freePreviewHash,
    requiredTier: input.requiredTier,
    packageId: config.packageId
  });
  placeholderTx.setSender(signer.address);
  const dryRun = await suiClient.devInspectTransactionBlock({
    sender: signer.address,
    transactionBlock: placeholderTx
  });
  const reportObjectId =
    (dryRun.effects?.created?.[0]?.reference?.objectId as string) || "0x" + hash(input.title + Date.now());

  // Seal-encrypt under id = report object id (hex string form for the SDK).
  const sealIdHex = reportObjectId;
  const { ciphertext } = await sealEncrypt(plaintextBytes, sealIdHex);
  const ciphertextHash = await sha256(ciphertext);

  // Upload ciphertext to Walrus.
  const { blobId } = await uploadBlob(ciphertext);
  const walrusBlobId = blobIdToBytes(blobId);
  const sealId = objectIdToBytes(reportObjectId);

  // Publish the real encrypted report with the reserved seal_id.
  const tx = buildPublishEncryptedReport({
    walrusBlobId,
    sealId,
    ciphertextHash,
    plaintextCommitment,
    freePreviewHash,
    requiredTier: input.requiredTier,
    packageId: config.packageId
  });
  tx.setSender(signer.address);
  const txBytes = await tx.build({ client: suiClient });
  await signer.signAndExecuteTransaction(txBytes);

  return {
    report: {
      id: reportObjectId,
      sui_object_id: reportObjectId,
      agent: signer.address,
      visibility: input.visibility,
      required_tier: input.requiredTier,
      walrus_blob_id: blobId,
      seal_id: reportObjectId,
      ciphertext_hash: "sha256:" + toBase64(ciphertextHash),
      plaintext_commitment: "sha256:" + toBase64(plaintextCommitment),
      title: input.title,
      free_preview: input.freePreview || "No preview supplied.",
      created_at: nowIso(),
      source_repo: input.sourceRepo
    },
    plaintext: input.plaintext || ""
  };
}

/** Decrypt a report: fetch ciphertext from Walrus (via aggregator) then Seal
 *  -decrypt with the seal_approve PTB. Returns the plaintext or null if denied. */
export async function decryptReport(
  report: ResearchReport,
  moduleFn: Parameters<typeof sealDecrypt>[0]["moduleFn"],
  signer: M3Signer,
  passObjectId?: string
): Promise<string | null> {
  if (!report.walrus_blob_id) return null;
  const ciphertext = await readBlob(report.walrus_blob_id);
  if (!ciphertext) return null;
  const reportObjectId = report.sui_object_id || report.id;
  const plaintext = await sealDecrypt({
    ciphertext,
    reportObjectId,
    moduleFn,
    passObjectId,
    signerAddress: signer.address,
    signPersonalMessage: signer.signPersonalMessage
  });
  return plaintext ? new TextDecoder().decode(plaintext) : null;
}
