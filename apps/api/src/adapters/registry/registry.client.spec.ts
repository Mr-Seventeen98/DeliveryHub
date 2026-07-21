import { describe, expect, it, vi } from "vitest";
import type { ExternalHttpClient } from "../external-http.client";
import { RegistryClient } from "./registry.client";

describe("RegistryClient", () => {
  it("checks the Docker Registry v2 endpoint", async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, body: {} });
    const client = new RegistryClient({ request } as unknown as ExternalHttpClient);
    await expect(
      client.testConnection({
        registryUrl: "https://ccr.ccs.tencentyun.com/",
        username: "user",
        password: "password",
        verifySsl: true
      })
    ).resolves.toEqual({ reachable: true });
    expect(request).toHaveBeenCalledWith(
      "https://ccr.ccs.tencentyun.com/v2/",
      expect.any(Object)
    );
  });

  it("lists and de-duplicates repository tags", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: { name: "fc17_dev/mobile.video.web", tags: ["latest", "v1", "v1"] },
    });
    const client = new RegistryClient({ request } as unknown as ExternalHttpClient);
    await expect(
      client.listTags(
        {
          registryUrl: "https://ccr.ccs.tencentyun.com",
          username: "user",
          password: "password",
          verifySsl: true,
        },
        "fc17_dev",
        "mobile.video.web",
      ),
    ).resolves.toEqual({
      name: "fc17_dev/mobile.video.web",
      tags: ["v1", "latest"],
    });
    expect(request).toHaveBeenCalledWith(
      "https://ccr.ccs.tencentyun.com/v2/fc17_dev/mobile.video.web/tags/list?n=10000",
      expect.objectContaining({ verifySsl: true }),
    );
  });

  it("follows a Docker Registry bearer-token challenge", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 401,
        body: {},
        headers: {
          "www-authenticate":
            'Bearer realm="https://registry.example/token",service="registry"',
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { token: "registry-token" },
        headers: {},
      })
      .mockResolvedValueOnce({ statusCode: 200, body: {}, headers: {} });
    const client = new RegistryClient({ request } as unknown as ExternalHttpClient);
    await expect(
      client.testConnection({
        registryUrl: "https://registry.example",
        username: "user",
        password: "password",
        verifySsl: true,
      }),
    ).resolves.toEqual({ reachable: true });
    expect(request).toHaveBeenLastCalledWith(
      "https://registry.example/v2/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer registry-token",
        }),
      }),
    );
  });

});
