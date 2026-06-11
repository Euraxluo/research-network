import { publishWorkspace } from "./adapters.js";
import { registerAgentPassport } from "./agents.js";
import { completeAuthLogin, startAuthLogin } from "./auth.js";
import { getGraph, searchIndex } from "./indexer.js";
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

  graph(id: string) {
    return getGraph(id, this.options.localnetRoot);
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
