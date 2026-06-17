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
//   - id = publisher-chosen seal_id bytes; access.move asserts id == report.seal_id.

import { hash } from "./storage";
import { sha256, toBytesUtf8, toBase64, randomBytes } from "./crypto";
import { uploadBlob, readBlob, blobIdToBytes } from "./walrus";
import { sealEncrypt, sealDecrypt, bytesToObjectId } from "./seal-client";
import {
  buildAcceptDelegationJob,
  buildBuyAgentSubscription,
  buildBuyPlatformMembership,
  buildClaimAgentEarnings,
  buildCompleteDelegationJob,
  buildCreateDelegationJob,
  buildFundDelegationJob,
  buildOpenDispute,
  buildPublishPrivateResult,
  buildPublishPublicReport,
  buildPublishEncryptedReport,
  buildRecordPlatformAccessReceipt,
  buildSettleMembershipReport,
  getSuiClient
} from "./sui-client";
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
  txDigest?: string;
}

export interface ChainObjectResult {
  digest: string;
  objectId: string;
}

export interface M3BalanceChange {
  owner?: string;
  coinType: string;
  amount: string;
}

export interface M3Event {
  type: string;
  parsedJson?: unknown;
}

interface WalrusReadbackEvidence {
  walrus_readback_verified: true;
  walrus_readback_bytes: number;
  walrus_readback_hash: string;
}

// ---- Signer abstraction. The workbench store injects a real zkLogin signer
//      (ephemeral keypair from zklogin-browser.js) when available. ----
export interface M3Signer {
  address: string;
  signAndExecuteTransaction: (txBytes: Uint8Array) => Promise<{
    digest: string;
    status: string;
    error?: string;
    createdObjectIds: string[];
    createdObjects?: Array<{ objectId: string; objectType?: string }>;
    balanceChanges?: M3BalanceChange[];
    events?: M3Event[];
  }>;
  signPersonalMessage: (msg: Uint8Array) => Promise<string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createdObjectId(
  result: { digest: string; createdObjectIds: string[]; createdObjects?: Array<{ objectId: string; objectType?: string }> },
  typeHint: string,
  packageId: string
): string {
  const typed = result.createdObjects?.find((obj) =>
    moveStructName(obj.objectType) === typeHint &&
    movePackageId(obj.objectType) === normalizePackageId(packageId)
  )?.objectId;
  if (typed) return typed;
  throw new Error(`Sui transaction succeeded but did not return a typed ${typeHint} object from configured package ${packageId}`);
}

function moveStructName(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return type.split("<", 1)[0]?.split("::").pop();
}

function movePackageId(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return normalizePackageId(type.split("::", 1)[0]);
}

function normalizePackageId(packageId: string | undefined): string | undefined {
  return packageId?.trim().toLowerCase();
}

function assertSuiTransactionSuccess(result: { digest: string; status: string; error?: string }): void {
  if (result.status !== "success") {
    const suffix = result.error ? `: ${result.error}` : "";
    throw new Error(`Sui transaction ${result.digest} failed${suffix}`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function verifyWalrusUploadReadback(
  blobId: string,
  expectedBytes: Uint8Array,
  label: string
): Promise<WalrusReadbackEvidence> {
  const readback = await readBlob(blobId);
  if (!readback) {
    throw new Error(`Walrus ${label} blob ${blobId} was not readable after upload`);
  }
  if (!bytesEqual(readback, expectedBytes)) {
    throw new Error(`Walrus ${label} blob ${blobId} readback did not match uploaded bytes`);
  }
  const readbackHash = await sha256(readback);
  return {
    walrus_readback_verified: true,
    walrus_readback_bytes: readback.length,
    walrus_readback_hash: "sha256:" + toBase64(readbackHash)
  };
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
    const walrusReadback = await verifyWalrusUploadReadback(blobId, plaintextBytes, "public report");
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
    assertSuiTransactionSuccess(result);
    const reportObjectId = createdObjectId(result, "ResearchReport", config.packageId);
    return {
      report: {
        id: reportObjectId,
        sui_object_id: reportObjectId,
        tx_digest: result.digest,
        agent: signer.address,
        visibility: "public",
        required_tier: 0,
        walrus_blob_id: blobId,
        ...walrusReadback,
        plaintext_commitment: "sha256:" + toBase64(plaintextCommitment),
        free_preview_hash: "sha256:" + toBase64(freePreviewHash),
        title: input.title,
        free_preview: input.freePreview || "No preview supplied.",
        created_at: nowIso(),
        source_repo: input.sourceRepo
      },
      plaintext: "",
      txDigest: result.digest
    };
  }

  // Encrypted: choose a stable Seal identity before publish, encrypt under it,
  // and store the same seal_id in the real on-chain report. Do not use
  // devInspect-created object ids as pre-reserved ids; normal Sui object ids are
  // only known after the real transaction executes.
  const sealIdBytes = await randomBytes(32);
  const sealIdHex = bytesToObjectId(sealIdBytes);
  const { ciphertext } = await sealEncrypt(plaintextBytes, sealIdHex);
  const ciphertextHash = await sha256(ciphertext);

  // Upload ciphertext to Walrus.
  const { blobId } = await uploadBlob(ciphertext);
  const walrusReadback = await verifyWalrusUploadReadback(blobId, ciphertext, "encrypted report");
  const walrusBlobId = blobIdToBytes(blobId);

  // Publish the real encrypted report with the exact seal_id embedded in the
  // ciphertext. The actual report object id comes only from this real tx.
  const tx = buildPublishEncryptedReport({
    walrusBlobId,
    sealId: sealIdBytes,
    ciphertextHash,
    plaintextCommitment,
    freePreviewHash,
    requiredTier: input.requiredTier,
    packageId: config.packageId
  });
  tx.setSender(signer.address);
  const txBytes = await tx.build({ client: suiClient });
  const result = await signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  const reportObjectId = createdObjectId(result, "ResearchReport", config.packageId);

  return {
    report: {
      id: reportObjectId,
      sui_object_id: reportObjectId,
      tx_digest: result.digest,
      agent: signer.address,
      visibility: input.visibility,
      required_tier: input.requiredTier,
      walrus_blob_id: blobId,
      ...walrusReadback,
      seal_id: sealIdHex,
      ciphertext_hash: "sha256:" + toBase64(ciphertextHash),
      plaintext_commitment: "sha256:" + toBase64(plaintextCommitment),
      title: input.title,
      free_preview: input.freePreview || "No preview supplied.",
      created_at: nowIso(),
      source_repo: input.sourceRepo
    },
    plaintext: input.plaintext || "",
    txDigest: result.digest
  };
}

export async function buyPlatformMembershipOnChain(input: {
  signer: M3Signer;
  tier?: number;
  paymentMist?: string | number | bigint;
  durationMs?: number;
}): Promise<ChainObjectResult> {
  const config = loadM3Config();
  const tx = buildBuyPlatformMembership({
    configObjectId: config.settlementConfigId,
    paymentMist: input.paymentMist ?? config.platformMembershipPriceMist,
    tier: input.tier ?? 1,
    durationMs: input.durationMs ?? config.accessDurationMs,
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return { digest: result.digest, objectId: createdObjectId(result, "PlatformMembershipPass", config.packageId) };
}

export async function buyAgentSubscriptionOnChain(input: {
  signer: M3Signer;
  agent: string;
  tier?: number;
  paymentMist?: string | number | bigint;
  durationMs?: number;
}): Promise<ChainObjectResult> {
  const config = loadM3Config();
  const tx = buildBuyAgentSubscription({
    configObjectId: config.settlementConfigId,
    earningsObjectId: config.agentEarningsId,
    agent: input.agent,
    paymentMist: input.paymentMist ?? config.agentSubscriptionPriceMist,
    tier: input.tier ?? 1,
    durationMs: input.durationMs ?? config.accessDurationMs,
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return { digest: result.digest, objectId: createdObjectId(result, "AgentSubscriptionPass", config.packageId) };
}

export async function createDelegationJobOnChain(input: {
  signer: M3Signer;
  agent: string;
  question: string;
  sourceArtifact: string;
  budgetMist?: string | number | bigint;
  deadlineMs?: number;
}): Promise<ChainObjectResult> {
  const config = loadM3Config();
  const tx = buildCreateDelegationJob({
    agent: input.agent,
    questionHash: await sha256(toBytesUtf8(input.question)),
    sourceArtifactHash: await sha256(toBytesUtf8(input.sourceArtifact)),
    budgetMist: input.budgetMist ?? config.delegationBudgetMist,
    deadlineMs: input.deadlineMs ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return { digest: result.digest, objectId: createdObjectId(result, "DelegationJob", config.packageId) };
}

export async function acceptDelegationJobOnChain(input: { signer: M3Signer; jobObjectId: string }): Promise<string> {
  const config = loadM3Config();
  const tx = buildAcceptDelegationJob({ jobObjectId: input.jobObjectId, packageId: config.packageId });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return result.digest;
}

export async function fundDelegationJobOnChain(input: {
  signer: M3Signer;
  jobObjectId: string;
  budgetMist?: string | number | bigint;
}): Promise<string> {
  const config = loadM3Config();
  const tx = buildFundDelegationJob({
    jobObjectId: input.jobObjectId,
    budgetMist: input.budgetMist ?? config.delegationBudgetMist,
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return result.digest;
}

export async function completeDelegationJobOnChain(input: { signer: M3Signer; jobObjectId: string }): Promise<string> {
  const config = loadM3Config();
  const tx = buildCompleteDelegationJob({ jobObjectId: input.jobObjectId, packageId: config.packageId });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return result.digest;
}

export async function openDisputeOnChain(input: {
  signer: M3Signer;
  jobObjectId: string;
  arbitrator: string;
  reason: string;
}): Promise<string> {
  const config = loadM3Config();
  const tx = buildOpenDispute({
    jobObjectId: input.jobObjectId,
    arbitrator: input.arbitrator,
    reasonHash: await sha256(toBytesUtf8(input.reason)),
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return result.digest;
}

export async function publishPrivateResultOnChain(input: {
  signer: M3Signer;
  jobObjectId: string;
  title: string;
  freePreview: string;
  plaintext: string;
  sourceRepo: string;
}): Promise<PublishResult> {
  const config = loadM3Config();
  const previewBytes = toBytesUtf8(input.freePreview || input.title);
  const plaintextBytes = toBytesUtf8(input.plaintext || input.freePreview || input.title);
  const plaintextCommitment = await sha256(plaintextBytes);
  const freePreviewHash = await sha256(previewBytes);
  const sealIdBytes = await randomBytes(32);
  const sealIdHex = bytesToObjectId(sealIdBytes);
  const { ciphertext } = await sealEncrypt(plaintextBytes, sealIdHex);
  const ciphertextHash = await sha256(ciphertext);
  const { blobId } = await uploadBlob(ciphertext);
  const walrusReadback = await verifyWalrusUploadReadback(blobId, ciphertext, "private delegation result");
  const tx = buildPublishPrivateResult({
    jobObjectId: input.jobObjectId,
    walrusBlobId: blobIdToBytes(blobId),
    sealId: sealIdBytes,
    ciphertextHash,
    plaintextCommitment,
    freePreviewHash,
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  const reportObjectId = createdObjectId(result, "ResearchReport", config.packageId);
  return {
    report: {
      id: reportObjectId,
      sui_object_id: reportObjectId,
      tx_digest: result.digest,
      agent: input.signer.address,
      visibility: "private_delegation",
      required_tier: 0,
      walrus_blob_id: blobId,
      ...walrusReadback,
      seal_id: sealIdHex,
      ciphertext_hash: "sha256:" + toBase64(ciphertextHash),
      plaintext_commitment: "sha256:" + toBase64(plaintextCommitment),
      free_preview_hash: "sha256:" + toBase64(freePreviewHash),
      delegation_job_id: input.jobObjectId,
      title: input.title,
      free_preview: input.freePreview || "Private delegation result metadata only.",
      created_at: nowIso(),
      source_repo: input.sourceRepo
    },
    plaintext: input.plaintext,
    txDigest: result.digest
  };
}

export async function recordPlatformAccessReceiptOnChain(input: {
  signer: M3Signer;
  passObjectId: string;
  reportObjectId: string;
  periodId: number;
}): Promise<ChainObjectResult> {
  const config = loadM3Config();
  const tx = buildRecordPlatformAccessReceipt({
    registryObjectId: config.membershipReceiptRegistryId,
    passObjectId: input.passObjectId,
    reportObjectId: input.reportObjectId,
    periodId: input.periodId,
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return { digest: result.digest, objectId: createdObjectId(result, "AccessReceipt", config.packageId) };
}

export async function settleMembershipReportOnChain(input: {
  signer: M3Signer;
  receiptObjectId: string;
  amountMist?: string | number | bigint;
  reportCount?: number;
}): Promise<string> {
  const config = loadM3Config();
  const tx = buildSettleMembershipReport({
    earningsObjectId: config.agentEarningsId,
    receiptObjectId: input.receiptObjectId,
    amountMist: input.amountMist ?? config.membershipSettlementShareMist,
    reportCount: input.reportCount ?? 1,
    packageId: config.packageId
  });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return result.digest;
}

export async function claimAgentEarningsOnChain(input: { signer: M3Signer }): Promise<string> {
  const config = loadM3Config();
  const tx = buildClaimAgentEarnings({ earningsObjectId: config.agentEarningsId, packageId: config.packageId });
  tx.setSender(input.signer.address);
  const txBytes = await tx.build({ client: getSuiClient() });
  const result = await input.signer.signAndExecuteTransaction(txBytes);
  assertSuiTransactionSuccess(result);
  return result.digest;
}

/** Decrypt a report: fetch ciphertext from Walrus (via aggregator) then Seal
 *  -decrypt with the seal_approve PTB. Returns the plaintext or null if denied. */
export async function decryptReport(
  report: ResearchReport,
  moduleFn: Parameters<typeof sealDecrypt>[0]["moduleFn"],
  signer: M3Signer,
  passObjectId?: string,
  delegationJobId?: string
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
    delegationJobId,
    expectedSealId: report.seal_id,
    signerAddress: signer.address,
    signPersonalMessage: signer.signPersonalMessage
  });
  return plaintext ? new TextDecoder().decode(plaintext) : null;
}
