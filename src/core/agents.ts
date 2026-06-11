import { type AgentPassport } from "./types.js";
import { objectId, randomToken, shortHash } from "./crypto.js";
import { upsertAgent } from "./local-store.js";

export async function registerAgentPassport(input: {
  name: string;
  ownerAddress?: string;
  github?: string;
  scopes?: string[];
  localnetRoot?: string;
}): Promise<AgentPassport & { api_key: string }> {
  const owner = input.ownerAddress ?? "0x0";
  const id = `agent:${shortHash(`${input.name}:${owner}:${input.github ?? ""}`, 18)}`;
  const agent: AgentPassport = {
    id,
    sui_object_id: objectId("0x", id),
    owner_address: owner,
    name: input.name,
    metadata: {
      github: input.github,
      scopes: input.scopes ?? ["read:assets", "write:workspace", "publish:assets", "install:skills"]
    },
    reputation: 0,
    created_at: new Date().toISOString()
  };
  await upsertAgent(agent, input.localnetRoot);
  return {
    ...agent,
    api_key: randomToken("rat_agent_key")
  };
}
