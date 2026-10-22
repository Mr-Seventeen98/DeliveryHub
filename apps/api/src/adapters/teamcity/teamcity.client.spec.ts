import { describe, expect, it, vi } from "vitest";
import type { ExternalHttpClient } from "../external-http.client";
import { TeamCityClient } from "./teamcity.client";

describe("TeamCityClient", () => {
  // 实际脚本依赖 .git；检查请求契约，防止 TC 默认自动模式在 Agent 缺 Git 时静默回退。
  it("仓库流水线强制 Agent checkout，并归档可补同步的结果", async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, body: "" });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);
    await client.configureRepositoryPipeline(
      {
        baseUrl: "https://teamcity.example",
        token: "fixture",
        verifySsl: true,
      },
      "RepositoryCI",
    );
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/settings/checkoutMode"),
      expect.objectContaining({ method: "PUT", body: "ON_AGENT" }),
    );
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/settings/artifactRules"),
      expect.objectContaining({
        body: expect.stringContaining("result.json => ci"),
      }),
    );
  });
  it("sends bearer authentication and requests JSON", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: { version: "2025.03", buildNumber: "1" },
    });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await client.testConnection({
      baseUrl: "https://teamcity.example/",
      token: "secret",
      verifySsl: true,
    });
    expect(request).toHaveBeenCalledWith(
      "https://teamcity.example/app/rest/server",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret", Accept: "application/json" },
      }),
    );
  });

  it("requests paged VCS Roots with repository properties", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: {
        count: 1,
        "vcs-root": [
          {
            id: "Project_Main",
            name: "Main",
            properties: {
              property: [{ name: "url", value: "git@gitlab.example:a/b.git" }],
            },
          },
        ],
      },
    });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await expect(
      client.listVcsRootsPage(
        {
          baseUrl: "https://teamcity.example/",
          token: "secret",
          verifySsl: true,
        },
        100,
        50,
      ),
    ).resolves.toMatchObject({ items: [{ id: "Project_Main" }] });

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(
        "/app/rest/vcs-roots?locator=count%3A50%2Cstart%3A100",
      ),
      expect.objectContaining({
        headers: { Authorization: "Bearer secret", Accept: "application/json" },
      }),
    );
  });

  it("requests a sanitized Build Configuration overview", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: {
        count: 1,
        buildType: [
          {
            id: "Project_Build",
            name: "Build",
            parameters: { property: [{ name: "env.DOCKER_IMAGE" }] },
          },
        ],
      },
    });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await expect(
      client.listBuildTypesPage(
        {
          baseUrl: "https://teamcity.example",
          token: "secret",
          verifySsl: true,
        },
        0,
      ),
    ).resolves.toMatchObject({ items: [{ id: "Project_Build" }] });

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/app/rest/buildTypes?"),
      expect.objectContaining({
        headers: { Authorization: "Bearer secret", Accept: "application/json" },
      }),
    );
  });

  it("requests TeamCity projects for group selection", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: {
        count: 1,
        project: [{ id: "Company", name: "Company", parentProjectId: "_Root" }],
      },
    });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await expect(
      client.listProjectsPage(
        {
          baseUrl: "https://teamcity.example/",
          token: "secret",
          verifySsl: true,
        },
        0,
      ),
    ).resolves.toMatchObject({ items: [{ id: "Company" }] });
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/app/rest/projects?"),
      expect.objectContaining({
        headers: { Authorization: "Bearer secret", Accept: "application/json" },
      }),
    );
  });

  it("creates a child project below the selected TeamCity group", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: { id: "Delivery_Api", name: "api" },
    });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await client.createProject(
      {
        baseUrl: "https://teamcity.example/",
        token: "secret",
        verifySsl: true,
      },
      { id: "Delivery_Api", name: "api", parentProjectId: "Delivery" },
    );

    expect(request).toHaveBeenCalledWith(
      "https://teamcity.example/app/rest/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          parentProject: { locator: "id:Delivery" },
          name: "api",
          id: "Delivery_Api",
          copyAllAssociatedSettings: true,
        }),
      }),
    );
  });

  it("creates Docker build steps and an optional branch trigger", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: { id: "Delivery_Api_Build", name: "Build and Push Image" },
    });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await client.createBuildType(
      {
        baseUrl: "https://teamcity.example",
        token: "secret",
        verifySsl: true,
      },
      {
        id: "Delivery_Api_Build",
        name: "Build and Push Image",
        projectId: "Delivery_Api",
        parameters: [{ name: "env.DOCKERFILE_PATH", value: "api/Dockerfile" }],
        steps: [
          { id: "build_image", name: "Build image", script: "docker build ." },
        ],
        autoBuildEnabled: true,
        releaseBranch: "main",
      },
    );

    const options = (request.mock.calls[0]?.[1] ?? {}) as { body?: unknown };
    const body = JSON.parse(String(options.body));
    expect(body.steps.step[0]).toMatchObject({
      id: "build_image",
      type: "simpleRunner",
      properties: {
        property: expect.arrayContaining([
          { name: "use.custom.script", value: "true" },
          { name: "script.content", value: "docker build ." },
        ]),
      },
    });
    expect(body.triggers.trigger[0]).toMatchObject({ type: "vcsTrigger" });
    expect(body.triggers.trigger[0].properties.property).toEqual(
      expect.arrayContaining([
        {
          name: "branchFilter",
          value: "-:*\n+:<default>\n+:refs/heads/main",
        },
        {
          name: "perCheckinTriggering",
          value: "true",
        },
        {
          name: "groupCheckinsByCommitter",
          value: "true",
        },
        {
          name: "quietPeriodMode",
          value: "USE_DEFAULT",
        },
      ]),
    );
  });

  it("updates an existing project name and build configuration", async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, body: {} });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);
    const config = {
      baseUrl: "https://teamcity.example",
      token: "secret",
      verifySsl: true,
    };

    await client.updateProjectName(config, "Delivery_Api", "api-new");
    await client.updateBuildParameters(config, "Delivery_Api_Build", [
      { name: "env.DOCKERFILE_PATH", value: "api/Dockerfile.uat" },
    ]);
    await client.updateBuildTriggers(
      config,
      "Delivery_Api_Build",
      true,
      "release",
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://teamcity.example/app/rest/projects/id:Delivery_Api/name",
      expect.objectContaining({
        method: "PUT",
        body: "api-new",
        headers: expect.objectContaining({
          "Content-Type": "text/plain",
          Accept: "text/plain",
        }),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://teamcity.example/app/rest/buildTypes/id:Delivery_Api_Build/parameters",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          property: [
            {
              name: "env.DOCKERFILE_PATH",
              value: "api/Dockerfile.uat",
            },
          ],
        }),
      }),
    );
    const triggerBody = JSON.parse(
      String((request.mock.calls[2]?.[1] as { body?: unknown })?.body),
    );
    expect(triggerBody.trigger[0].properties.property).toContainEqual({
      name: "branchFilter",
      value: "-:*\n+:<default>\n+:refs/heads/release",
    });
    expect(triggerBody.trigger[0].properties.property).toContainEqual({
      name: "perCheckinTriggering",
      value: "true",
    });
  });

  it("keeps TeamCity HTTP details when a write is rejected", async () => {
    const request = vi.fn().mockResolvedValue({
      statusCode: 400,
      body: "Project ID must start with a latin letter",
    });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await expect(
      client.createProject(
        {
          baseUrl: "https://teamcity.example",
          token: "secret",
          verifySsl: true,
        },
        { id: "Invalid", name: "Invalid", parentProjectId: "_Root" },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        details: {
          statusCode: 400,
          response: "Project ID must start with a latin letter",
        },
      }),
    });
  });

  it("updates credentials on an existing VCS Root", async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, body: {} });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await client.updateVcsRoot(
      {
        baseUrl: "https://teamcity.example/",
        token: "teamcity-secret",
        verifySsl: true,
      },
      {
        id: "Delivery_Api_GitLab",
        name: "group/api (main)",
        projectId: "Delivery_Api",
        repositoryUrl: "https://gitlab.example/group/api.git",
        branch: "main",
        authMode: "TEAMCITY_SSH_KEY",
        sshKeyName: "haoyu-gitlab",
      },
    );

    expect(request).toHaveBeenCalledWith(
      "https://teamcity.example/app/rest/vcs-roots/id:Delivery_Api_GitLab/properties",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining(
          '"teamcitySshKey","value":"haoyu-gitlab"',
        ),
      }),
    );
  });

  it("replaces build steps when an existing configuration is reconciled", async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, body: {} });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);

    await client.updateBuildSteps(
      {
        baseUrl: "https://teamcity.example/",
        token: "secret",
        verifySsl: true,
      },
      "Delivery_Api_Build",
      [
        {
          id: "push_image",
          name: "Push image",
          script: "docker login && docker push image",
        },
        {
          id: "repository_report",
          name: "Report and cleanup",
          script: "python3 scripts/ci/pipeline.py --stage report",
          executionMode: "execute_always",
        },
      ],
    );

    expect(request).toHaveBeenCalledWith(
      "https://teamcity.example/app/rest/buildTypes/id:Delivery_Api_Build/steps",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining("docker login && docker push image"),
      }),
    );
    // HTTP 契约使用 runner 参数常量，防止只测试内部 UI 标签而遗漏取消后的清理模式。
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"value":"execute_always"'),
      }),
    );
  });

  it("reads queued build diagnostics and recent builds", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          id: 42,
          state: "queued",
          waitReason: "No compatible agents",
          compatibleAgents: { count: 0, agent: [] },
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: {
          count: 1,
          build: [{ id: 42, state: "queued" }],
        },
      });
    const client = new TeamCityClient({
      request,
    } as unknown as ExternalHttpClient);
    const config = {
      baseUrl: "https://teamcity.example/",
      token: "secret",
      verifySsl: true,
    };

    const build = await client.getBuildById(config, "42");
    const recent = await client.listBuildsByBuildType(
      config,
      "Delivery_Api_Build",
    );

    expect(build).toMatchObject({
      id: 42,
      waitReason: "No compatible agents",
      compatibleAgents: { count: 0 },
    });
    expect(recent).toEqual([{ id: 42, state: "queued" }]);
    expect(request.mock.calls[0]?.[0]).toContain("/app/rest/builds/id:42");
    expect(request.mock.calls[1]?.[0]).toContain(
      "buildType%3A%28id%3ADelivery_Api_Build%29",
    );
  });
});
