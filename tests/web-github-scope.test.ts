import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";
import { persistRepoSelection, repoItems } from "../web/src/lib/github-scope.js";
import type { GithubBinding } from "../web/src/lib/types.js";

describe("GitHub repo scope helpers", () => {
  beforeEach(() => {
    const dom = new JSDOM("", { url: "http://127.0.0.1/workbench.html" });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: dom.window.localStorage
    });
  });

  it("rotates server attestation when selecting a repo from another installation", () => {
    const binding: GithubBinding = {
      sui_address: "0xabc",
      login: "alice",
      installation_id: 101,
      account: "alice",
      account_type: "User",
      selected_installation_ids: [101, 202],
      selected_repo: "alice/paper-a",
      repos: ["alice/paper-a"],
      installations: [
        { id: 101, account: "alice", accountType: "User", repos: ["alice/paper-a"] },
        { id: 202, account: "lab", accountType: "Organization", repos: ["lab/paper-b"] }
      ],
      binding_attestation: "token-101",
      binding_attestation_payload: { sub: "0xabc", installation_id: 101 },
      binding_attestations: {
        "101": {
          binding_attestation: "token-101",
          binding_attestation_payload: { sub: "0xabc", installation_id: 101 }
        },
        "202": {
          binding_attestation: "token-202",
          binding_attestation_payload: { sub: "0xabc", installation_id: 202 }
        }
      }
    };

    const repo = repoItems(binding).find((item: ReturnType<typeof repoItems>[number]) => item.full_name === "lab/paper-b") ?? null;
    const next = persistRepoSelection(binding, repo);

    expect(next?.installation_id).toBe(202);
    expect(next?.account).toBe("lab");
    expect(next?.account_type).toBe("Organization");
    expect(next?.repos).toEqual(["lab/paper-b"]);
    expect(next?.binding_attestation).toBe("token-202");
    expect(next?.binding_attestation_payload).toMatchObject({ installation_id: 202 });
    expect(JSON.parse(localStorage.getItem("rn_github") || "{}")).toMatchObject({
      selected_repo: "lab/paper-b",
      installation_id: 202,
      binding_attestation: "token-202",
      binding_attestation_payload: { installation_id: 202 }
    });
  });
});
