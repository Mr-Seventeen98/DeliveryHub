import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api";

function jwtExpiringIn(seconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("apiRequest token refresh", () => {
  const storage = new Map<string, string>();
  const assign = vi.fn();

  beforeEach(() => {
    storage.clear();
    assign.mockClear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      location: { pathname: "/", assign },
    });
  });

  it("refreshes shortly before expiry and sends the new access token", async () => {
    storage.set("deliveryHub.accessToken", jwtExpiringIn(30));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { accessToken: "new-token" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { value: "ok" } }),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(apiRequest<{ value: string }>("/resource")).resolves.toEqual({
      value: "ok",
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toContain("/auth/refresh");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ credentials: "include" });
    expect(
      (fetch.mock.calls[1]?.[1]?.headers as Headers).get("authorization"),
    ).toBe("Bearer new-token");
  });

  it("shares one refresh request between concurrent API calls", async () => {
    storage.set("deliveryHub.accessToken", jwtExpiringIn(30));
    let releaseRefresh: ((value: Response) => void) | undefined;
    const refreshResponse = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    const fetch = vi.fn((url: string) => {
      if (url.endsWith("/auth/refresh")) return refreshResponse;
      return Promise.resolve(jsonResponse({ success: true, data: "ok" }));
    });
    vi.stubGlobal("fetch", fetch);

    const first = apiRequest<string>("/first");
    const second = apiRequest<string>("/second");
    releaseRefresh?.(
      jsonResponse({ success: true, data: { accessToken: "shared-token" } }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual(["ok", "ok"]);
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/auth/refresh")),
    ).toHaveLength(1);
  });

  it("refreshes and retries once after an unexpected 401", async () => {
    storage.set("deliveryHub.accessToken", jwtExpiringIn(600));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: { message: "expired" } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { accessToken: "retry-token" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: "done" }));
    vi.stubGlobal("fetch", fetch);

    await expect(apiRequest<string>("/resource")).resolves.toBe("done");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      (fetch.mock.calls[2]?.[1]?.headers as Headers).get("authorization"),
    ).toBe("Bearer retry-token");
  });
});
