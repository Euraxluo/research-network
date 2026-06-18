import { afterEach, describe, expect, it, vi } from "vitest";
import { readBlob, uploadBlob } from "../web/src/lib/walrus.js";

describe("browser Walrus proxy client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads browser blobs through the same-origin Vercel API", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/walrus-blob?epochs=5");
      expect(init?.method).toBe("PUT");
      expect(init?.body).toBeInstanceOf(Uint8Array);
      return new Response(JSON.stringify({
        newlyCreated: {
          blobObject: {
            blobId: "lWOx6QhPu4LYVBXrf4wkdPtIdpB4OYNW_VpGkBEm1hA",
            id: "0xblob"
          }
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadBlob(new Uint8Array([1, 2, 3]));

    expect(result).toEqual({
      blobId: "lWOx6QhPu4LYVBXrf4wkdPtIdpB4OYNW_VpGkBEm1hA",
      blobObjectId: "0xblob"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads browser blobs through the same-origin Vercel API", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/walrus-blob?blobId=lWOx6QhPu4LYVBXrf4wkdPtIdpB4OYNW_VpGkBEm1hA");
      return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await readBlob("lWOx6QhPu4LYVBXrf4wkdPtIdpB4OYNW_VpGkBEm1hA");

    expect(Array.from(result ?? [])).toEqual([4, 5, 6]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
