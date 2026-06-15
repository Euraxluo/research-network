import { describe, expect, it } from "vitest";
import {
  blobIdDecimalToBase64Url,
  normalizeWalrusSitePathWithRoutes,
  normalizeWalrusSitePath,
  parseWalrusSiteRoutes,
  quiltPatchIdFromParts,
  shouldRedirectWalrusProxyResource,
  walrusAggregatorResourceUrl
} from "../src/core/walrus-sites.js";

describe("Walrus Sites dynamic proxy helpers", () => {
  it("encodes Sui resource blob ids into Walrus quilt patch ids", () => {
    const blobId = "106123929023170791906343488161531147687895707711867468583338852301526046747319";

    expect(blobIdDecimalToBase64Url(blobId)).toBe("tyrysd8b5XVUohCtLU_e_4q8BV99gg5ipAa5reYDoOo");
    expect(quiltPatchIdFromParts(blobId, "0x014c005200")).toBe("tyrysd8b5XVUohCtLU_e_4q8BV99gg5ipAa5reYDoOoBTABSAA");
  });

  it("normalizes Vercel paths to Walrus Site resource candidates", () => {
    expect(normalizeWalrusSitePath("/")).toEqual(["/index.html"]);
    expect(normalizeWalrusSitePath("abs/example")).toEqual(["/abs/example", "/abs/example.html", "/abs/example/index.html"]);
    expect(normalizeWalrusSitePath("/paper/a/main.pdf")).toEqual(["/paper/a/main.pdf"]);
  });

  it("applies ws-resources route fallbacks after direct path candidates", () => {
    const routes = parseWalrusSiteRoutes(JSON.stringify({
      routes: {
        "/app/*": "/app/index.html",
        "/*": "/index.html"
      }
    }));

    expect(routes).toEqual({ "/app/*": "/app/index.html", "/*": "/index.html" });
    expect(normalizeWalrusSitePathWithRoutes("/app/deep/link", routes)).toEqual([
      "/app/deep/link",
      "/app/deep/link.html",
      "/app/deep/link/index.html",
      "/app/index.html",
      "/index.html"
    ]);
    expect(normalizeWalrusSitePathWithRoutes("/unknown", routes)).toEqual([
      "/unknown",
      "/unknown.html",
      "/unknown/index.html",
      "/index.html"
    ]);
  });

  it("builds aggregator URLs for quilt-backed resources", () => {
    const url = walrusAggregatorResourceUrl({
      path: "/paper/example/main.pdf",
      blobId: "106123929023170791906343488161531147687895707711867468583338852301526046747319",
      headers: { "x-wal-quilt-patch-internal-id": "0x014c005200" }
    });

    expect(url).toBe("https://aggregator.walrus-testnet.walrus.space/v1/blobs/by-quilt-patch-id/tyrysd8b5XVUohCtLU_e_4q8BV99gg5ipAa5reYDoOoBTABSAA");
  });

  it("redirects Range and oversized Walrus proxy responses", () => {
    expect(shouldRedirectWalrusProxyResource({ rangeHeader: "bytes=0-99", maxProxyBytes: 4_000_000 })).toBe(true);
    expect(shouldRedirectWalrusProxyResource({ contentLength: 4_000_001, maxProxyBytes: 4_000_000 })).toBe(true);
    expect(shouldRedirectWalrusProxyResource({ contentLength: 3_999_999, maxProxyBytes: 4_000_000 })).toBe(false);
  });
});
