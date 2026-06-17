import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const M4_SCRIPTS = [
  "scripts/m4-publish-check.ts",
  "scripts/m4-encrypted-check.ts"
];

describe("M4 smoke scripts", () => {
  it("do not infer report ids from positional or substring created-object matches", async () => {
    for (const filePath of M4_SCRIPTS) {
      const source = await readFile(filePath, "utf8");

      expect(source).not.toContain("created[0]");
      expect(source).not.toContain(".includes(\"ResearchReport\")");
      expect(source).not.toContain(".includes('ResearchReport')");
      expect(source).toContain("createdObjectId");
      expect(source).toContain("movePackageId");
    }
  });
});
