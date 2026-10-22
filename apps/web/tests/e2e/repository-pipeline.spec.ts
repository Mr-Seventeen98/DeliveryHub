/** 验证用户可观察的模式选择、确认内容和部分推送提示；API 全部为受控替身，不创建真实 CI。 */
import { expect, test, type Page } from "@playwright/test";

const definition = {
  components: ["api", "worker", "migration", "web", "visualization"].map(
    (code) => ({
      code,
      name: code,
      dockerfile: `deploy/${code}.Dockerfile`,
      context: `contexts/${code}`,
      imageRepository: `integrated-platform-${code}`,
    }),
  ),
};
const project = {
  id: "project",
  name: "IntegratedPlatform",
  path: "integratedplatform",
  pathWithNamespace: "operation_platform/integratedplatform",
  namespaceName: "operation_platform",
  webUrl: "https://gitlab.example.test/project",
  defaultBranch: "main",
  visibility: "private",
  archived: false,
  importStatus: "NOT_IMPORTED",
  lastActivityAt: null,
  gitLabInstance: { id: "gitlab", name: "fixture" },
  teamCityVcsRoots: [],
};
const teamcity = {
  id: "tc",
  name: "Fixture TC",
  baseUrl: "https://tc.example.test",
  parentProjectId: "Root",
  verifySsl: true,
  enabled: true,
};

async function fixture(page: Page, builds: unknown[] = []) {
  const submissions: Record<string, unknown>[] = [];
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  await page.addInitScript(
    (token) => localStorage.setItem("deliveryHub.accessToken", token),
    `fixture.${payload}.fixture`,
  );
  await page.route("http://127.0.0.1:5818/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let data: unknown = [];
    if (path === "/integrations/gitlab") data = [];
    else if (path === "/gitlab-projects")
      data = { items: [project], total: 1, page: 1, pageSize: 100 };
    else if (path === "/integrations/teamcity") data = [teamcity];
    else if (path === "/integrations/registries")
      data = [
        {
          id: "registry",
          name: "Fixture TCR",
          registryUrl: "https://registry.example.test",
          namespace: "ci",
          enabled: true,
        },
      ];
    else if (path === "/ci-configurations/gitlab-project/project")
      data = { configured: false, configuration: null };
    else if (path.endsWith("/branches"))
      data = { items: [{ name: "main", default: true, protected: true }] };
    else if (path.endsWith("/dockerfiles"))
      data = {
        items: definition.components.map((item) => ({
          id: item.code,
          name: item.dockerfile,
          path: item.dockerfile,
        })),
      };
    else if (path.endsWith("/repository-scan"))
      data = {
        ref: "main",
        featureFiles: [],
        componentSuggestions: [],
        pipeline: { sha256: "a".repeat(64), definition },
      };
    else if (path === "/integrations/teamcity/tc/projects")
      data = { parentProjectId: "Root", items: [] };
    else if (path === "/ci-configurations" && request.method() === "POST") {
      submissions.push(request.postDataJSON());
      data = { jobId: "fixture-job", status: "queued" };
    } else if (path === "/ci-configurations/jobs/fixture-job")
      data = {
        status: "completed",
        progressPercent: 100,
        result: {
          applicationId: "app",
          createdResources: 2,
          reusedResources: 0,
          teamCityGroup: {
            id: "CI",
            name: "CI",
            url: "https://tc.example.test/CI",
          },
          components: [],
        },
      };
    else if (path === "/builds")
      data = { items: builds, total: builds.length, page: 1, pageSize: 20 };
    else if (path === "/applications") data = [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:5817",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "authorization,content-type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: JSON.stringify({ success: true, data }),
    });
  });
  return submissions;
}

test("五组件导入、只读清单、单流水线确认及提交，不调用部署 API", async ({
  page,
}, info) => {
  const submissions = await fixture(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") requests.push(request.url());
  });
  await page.goto("/gitlab");
  await page
    .locator("summary")
    .filter({ hasText: "operation_platform" })
    .click();
  await page
    .getByRole("button", { name: "一键添加 CI/CD", exact: true })
    .click();
  const mode = page.getByLabel("构建方式", { exact: true });
  await expect(
    mode.locator('option[value="REPOSITORY_PIPELINE"]'),
  ).toBeEnabled();
  await mode.selectOption("REPOSITORY_PIPELINE");
  await page.getByLabel("TCR 连接", { exact: true }).selectOption("registry");
  await expect(
    page.getByRole("button", { name: "添加 Dockerfile", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".component-drafts fieldset")).toHaveCount(5);
  await expect(page.getByLabel("构建上下文").first()).toHaveAttribute(
    "readonly",
    "",
  );
  await page.screenshot({
    path: info.outputPath("pipeline-config.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "下一步：确认配置" }).click();
  await expect(
    page.getByText("将配置 1 条整套流水线，包含 5 个组件"),
  ).toBeVisible();
  await expect(
    page.getByText("https://registry.example.test/ci", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "确认并创建 CI/CD", exact: true })
    .click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({
    ciExecutionMode: "REPOSITORY_PIPELINE",
    registryConnectionId: "registry",
    runFirstBuild: false,
  });
  expect(submissions[0]?.components).toHaveLength(5);
  expect(requests.some((url) => url.includes("/deployments"))).toBe(false);
});

test("部分推送显示整套不可用，不把 TC 成功展示成镜像全部可用", async ({
  page,
}, info) => {
  await fixture(page, [
    {
      id: "build",
      applicationId: "app",
      componentId: null,
      teamCityBuildId: "100",
      teamCityBuildNumber: "100",
      branch: "main",
      commitSha: "a".repeat(40),
      status: "FAILED",
      publicationStatus: "PARTIAL",
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
      logUrl: null,
      triggerType: "VCS",
      component: null,
      images: [],
      stages: [{ code: "push", status: "FAILED" }],
      application: {
        id: "app",
        name: "IntegratedPlatform",
        code: "fixture",
        gitLabProject: project,
        teamCityConnection: teamcity,
      },
    },
  ]);
  await page.goto("/builds");
  await expect(page.getByText(/部分推送，整套不可用/)).toBeVisible();
  await expect(page.getByText(/0 个已登记镜像/)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("partial-push.png"),
    fullPage: true,
  });
});
