import { handleNodeElysiaRequest } from "../../../../src/api/elysia-node.js";
import { researchIndexApi } from "../../../../src/api/index-service.js";

export default async function handler(req: any, res: any) {
  await handleNodeElysiaRequest(researchIndexApi, req, res);
}
