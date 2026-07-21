import { describe, expect, it, vi } from "vitest";
import type { ExternalHttpClient } from "../external-http.client";
import { GitLabClient } from "./gitlab.client";

describe("GitLabClient", () => {
  it("uses the private token header and normalized API URL", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: { id: 1, username: "root", name: "Root" },
    });
    const client = new GitLabClient({
      request,
    } as unknown as ExternalHttpClient);

    await expect(
      client.testConnection({
        apiUrl: "https://gitlab.example/api/v4/",
        token: "secret",
        verifySsl: true,
      }),
    ).resolves.toMatchObject({ username: "root" });
    expect(request).toHaveBeenCalledWith(
      "https://gitlab.example/api/v4/user",
      expect.objectContaining({ headers: { "PRIVATE-TOKEN": "secret" } }),
    );
  });

  it("requests a deterministic page of membership projects", async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, body: [] });
    const client = new GitLabClient({
      request,
    } as unknown as ExternalHttpClient);

    await client.listProjectsPage(
      {
        apiUrl: "https://gitlab.example/api/v4",
        token: "secret",
        verifySsl: true,
      },
      2,
      50,
    );

    expect(request).toHaveBeenCalledWith(
      "https://gitlab.example/api/v4/projects?membership=true&order_by=id&sort=asc&page=2&per_page=50",
      expect.objectContaining({ headers: { "PRIVATE-TOKEN": "secret" } }),
    );
  });

  it("reads repository branches and a recursive tree for a selected ref", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: [{ name: "main", default: true }],
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: [
          {
            id: "blob-1",
            name: "Dockerfile",
            type: "blob",
            path: "frontend/Dockerfile",
          },
        ],
      });
    const client = new GitLabClient({
      request,
    } as unknown as ExternalHttpClient);
    const config = {
      apiUrl: "https://gitlab.example/api/v4/",
      token: "secret",
      verifySsl: true,
    };

    await client.listBranchesPage(config, 42, 1);
    await client.listRepositoryTreePage(config, 42, "feature/demo", 1);

    expect(request.mock.calls[0]?.[0]).toBe(
      "https://gitlab.example/api/v4/projects/42/repository/branches?page=1&per_page=100",
    );
    expect(request.mock.calls[1]?.[0]).toContain(
      "/projects/42/repository/tree?recursive=true&ref=feature%2Fdemo&page=1&per_page=100",
    );
  });

  it("reports a deleted repository ref as not found instead of bad gateway", async () => {
    const client = new GitLabClient({
      request: vi.fn().mockResolvedValue({ statusCode: 404, body: {} }),
    } as unknown as ExternalHttpClient);

    await expect(
      client.listRepositoryTreePage(
        {
          apiUrl: "https://gitlab.example/api/v4",
          token: "secret",
          verifySsl: true,
        },
        42,
        "master",
        1,
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: {
        code: "GITLAB_REF_NOT_FOUND",
        details: { ref: "master" },
      },
    });
  });

  it("reads a repository Compose file as raw text", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: "services:\n  web:\n    image: nginx\n",
    });
    const client = new GitLabClient({
      request,
    } as unknown as ExternalHttpClient);

    await expect(
      client.getRepositoryFileRaw(
        {
          apiUrl: "https://gitlab.example/api/v4/",
          token: "secret",
          verifySsl: true,
        },
        42,
        "release/uat",
        "deploy/compose.yml",
      ),
    ).resolves.toContain("services:");
    expect(request.mock.calls[0]?.[0]).toBe(
      "https://gitlab.example/api/v4/projects/42/repository/files/deploy%2Fcompose.yml/raw?ref=release%2Fuat",
    );
  });
});
