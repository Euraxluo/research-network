import {
  acceptDelegationJob,
  buyPlatformMembership,
  completeDelegationJob,
  createDelegationJob,
  openDispute,
  publishWorkspace,
  recordAccessReceipt,
  settleMembershipPeriod,
  submitPrivateResult,
  subscribeAgent
} from "./adapters.js";
import { registerAgentPassport } from "./agents.js";
import { completeAuthLogin, startAuthLogin } from "./auth.js";
import { getGraph, searchIndex, summarizeAssetEconomics } from "./indexer.js";
import { readAuthState, readIndex } from "./local-store.js";
import { forkWorkspace, initWorkspace, installSkill } from "./workspace.js";

export class ResearchClient {
  constructor(private readonly options: { localnetRoot?: string } = {}) {}

  initWorkspace(options: Parameters<typeof initWorkspace>[0]) {
    return initWorkspace(options);
  }

  validateImport() {
    return true;
  }

  publish(workspace = ".") {
    return publishWorkspace(workspace, this.options.localnetRoot);
  }

  search(input: { query?: string; type?: string }) {
    return searchIndex(input.query ?? "", input.type, this.options.localnetRoot);
  }

  async getAsset(id: string) {
    const index = await readIndex(this.options.localnetRoot);
    return index.assets[id];
  }

  async getSkill(id: string) {
    const index = await readIndex(this.options.localnetRoot);
    return index.skills[id];
  }

  async listReports() {
    const index = await readIndex(this.options.localnetRoot);
    return Object.values(index.reports);
  }

  async getReport(id: string) {
    const index = await readIndex(this.options.localnetRoot);
    return index.reports[id];
  }

  async listAgentChannels() {
    const index = await readIndex(this.options.localnetRoot);
    return Object.values(index.agent_channels);
  }

  async listDelegationJobs() {
    const index = await readIndex(this.options.localnetRoot);
    return Object.values(index.delegations);
  }

  buyPlatformMembership(input: Omit<Parameters<typeof buyPlatformMembership>[0], "localnetRoot">) {
    return buyPlatformMembership({ ...input, localnetRoot: this.options.localnetRoot });
  }

  subscribeAgent(input: Omit<Parameters<typeof subscribeAgent>[0], "localnetRoot">) {
    return subscribeAgent({ ...input, localnetRoot: this.options.localnetRoot });
  }

  createDelegationJob(input: Omit<Parameters<typeof createDelegationJob>[0], "localnetRoot">) {
    return createDelegationJob({ ...input, localnetRoot: this.options.localnetRoot });
  }

  acceptDelegationJob(input: Omit<Parameters<typeof acceptDelegationJob>[0], "localnetRoot">) {
    return acceptDelegationJob({ ...input, localnetRoot: this.options.localnetRoot });
  }

  submitPrivateResult(input: Omit<Parameters<typeof submitPrivateResult>[0], "localnetRoot">) {
    return submitPrivateResult({ ...input, localnetRoot: this.options.localnetRoot });
  }

  completeDelegationJob(input: Omit<Parameters<typeof completeDelegationJob>[0], "localnetRoot">) {
    return completeDelegationJob({ ...input, localnetRoot: this.options.localnetRoot });
  }

  openDispute(input: Omit<Parameters<typeof openDispute>[0], "localnetRoot">) {
    return openDispute({ ...input, localnetRoot: this.options.localnetRoot });
  }

  recordAccessReceipt(input: Omit<Parameters<typeof recordAccessReceipt>[0], "localnetRoot">) {
    return recordAccessReceipt({ ...input, localnetRoot: this.options.localnetRoot });
  }

  settleMembershipPeriod(input: Omit<Parameters<typeof settleMembershipPeriod>[0], "localnetRoot">) {
    return settleMembershipPeriod({ ...input, localnetRoot: this.options.localnetRoot });
  }

  graph(id: string) {
    return getGraph(id, this.options.localnetRoot);
  }

  async listRevenuePools() {
    const index = await readIndex(this.options.localnetRoot);
    return Object.values(index.revenue_pools);
  }

  async getRevenuePool(id: string) {
    const index = await readIndex(this.options.localnetRoot);
    return index.revenue_pools[id];
  }

  async listPayments() {
    const index = await readIndex(this.options.localnetRoot);
    return Object.values(index.payments);
  }

  /** Aggregate Seal Access commerce state for an asset (reflects indexed events). */
  async assetEconomics(assetId: string) {
    const index = await readIndex(this.options.localnetRoot);
    return summarizeAssetEconomics(index, assetId);
  }

  forkAsset(assetId: string, target: string, include?: string[]) {
    return forkWorkspace({ assetId, target, include, localnetRoot: this.options.localnetRoot });
  }

  installSkill(skillId: string, workspace: string, mode: "referenced" | "vendored" = "referenced") {
    return installSkill({ skillId, workspace, mode, localnetRoot: this.options.localnetRoot });
  }

  registerAgent(input: Parameters<typeof registerAgentPassport>[0]) {
    return registerAgentPassport({ ...input, localnetRoot: this.options.localnetRoot });
  }

  startLogin(input: Omit<Parameters<typeof startAuthLogin>[0], "localnetRoot">) {
    return startAuthLogin({ ...input, localnetRoot: this.options.localnetRoot });
  }

  completeLogin(input: Omit<Parameters<typeof completeAuthLogin>[0], "localnetRoot">) {
    return completeAuthLogin({ ...input, localnetRoot: this.options.localnetRoot });
  }

  async getAccount(id: string) {
    const auth = await readAuthState(this.options.localnetRoot);
    return auth.accounts[id];
  }
}
