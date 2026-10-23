import { Injectable } from "@nestjs/common";
import { ExternalApiException } from "../external-api.exception";
import { ExternalHttpClient } from "../external-http.client";

export interface TeamCityClientConfig {
  baseUrl: string;
  token: string;
  verifySsl: boolean;
}

interface TeamCityServer {
  version: string;
  buildNumber: string;
}

export interface TeamCityVcsRootResponse {
  id: string;
  name: string;
  project?: { id?: string; name?: string };
  properties?: {
    property?: Array<{ name: string; value?: string }>;
  };
}

interface TeamCityVcsRootsResponse {
  count: number;
  nextHref?: string;
  "vcs-root"?: TeamCityVcsRootResponse[];
}

export interface TeamCityBuildTypeResponse {
  id: string;
  name: string;
  project?: { id?: string; name?: string };
  parameters?: {
    property?: Array<{ name: string; type?: { rawValue?: string } }>;
  };
  steps?: { step?: Array<{ id?: string; name?: string; type?: string }> };
  triggers?: {
    trigger?: Array<{
      id?: string;
      type?: string;
      properties?: { property?: Array<{ name: string; value?: string }> };
    }>;
  };
  "agent-requirements"?: {
    "agent-requirement"?: Array<{
      id?: string;
      type?: string;
      disabled?: boolean;
      inherited?: boolean;
      properties?: { property?: Array<{ name: string; value?: string }> };
    }>;
  };
}

export interface TeamCityBuildResponse {
  buildType?: { id?: string };
  id: number;
  number?: string;
  status?: "SUCCESS" | "FAILURE" | "UNKNOWN";
  state?: "queued" | "running" | "finished";
  branchName?: string;
  statusText?: string;
  waitReason?: string;
  compatibleAgents?: {
    count?: number;
    agent?: Array<{
      id?: number;
      name?: string;
      connected?: boolean;
      enabled?: boolean;
    }>;
  };
  webUrl?: string;
  queuedDate?: string;
  startDate?: string;
  finishDate?: string;
  canceledInfo?: unknown;
  revisions?: { revision?: Array<{ version?: string }> };
  resultingProperties?: {
    property?: Array<{ name: string; value?: string }>;
  };
}

interface TeamCityBuildTypesResponse {
  count: number;
  nextHref?: string;
  buildType?: TeamCityBuildTypeResponse[];
}

interface TeamCityBuildsResponse {
  count: number;
  build?: TeamCityBuildResponse[];
}

export interface TeamCityProjectResponse {
  id: string;
  name: string;
  parentProjectId?: string;
  archived?: boolean;
}

export interface TeamCityCreateProjectInput {
  id: string;
  name: string;
  parentProjectId: string;
}

export interface TeamCityCreateVcsRootInput {
  id: string;
  name: string;
  projectId: string;
  repositoryUrl: string;
  branch: string;
  authMode?: "PASSWORD" | "TEAMCITY_SSH_KEY";
  username?: string;
  password?: string;
  sshKeyName?: string;
}

export interface TeamCityCreateBuildTypeInput {
  id: string;
  name: string;
  projectId: string;
  parameters: Array<{
    name: string;
    value: string;
    type?: { rawValue: string };
  }>;
  steps: Array<{
    id: string;
    name: string;
    script: string;
    executionMode?: string;
  }>;
  autoBuildEnabled: boolean;
  releaseBranch: string;
}

interface TeamCityProjectsResponse {
  count: number;
  nextHref?: string;
  project?: TeamCityProjectResponse[];
}

export interface TeamCityAgentResponse {
  id: number;
  name: string;
  connected?: boolean;
  enabled?: boolean;
  authorized?: boolean;
  ip?: string;
  pool?: { id?: number; name?: string };
  currentBuild?: { id?: number; buildType?: { id?: string; name?: string } };
  incompatibleBuildTypes?: {
    count?: number;
    compatibility?: Array<{
      buildType?: { id?: string; name?: string };
      unmetRequirements?: { description?: string };
    }>;
  };
}

interface TeamCityAgentsResponse {
  count: number;
  agent?: TeamCityAgentResponse[];
}

export interface TeamCityAgentPoolResponse {
  id: number;
  name: string;
  agents?: { count?: number; agent?: Array<{ id?: number; name?: string }> };
  projects?: {
    count?: number;
    project?: Array<{ id?: string; name?: string }>;
  };
}

interface TeamCityAgentPoolsResponse {
  count: number;
  agentPool?: TeamCityAgentPoolResponse[];
}

@Injectable()
export class TeamCityClient {
  constructor(private readonly http: ExternalHttpClient) {}

  async testConnection(config: TeamCityClientConfig): Promise<TeamCityServer> {
    try {
      const response = await this.http.request<TeamCityServer>(
        `${config.baseUrl.replace(/\/$/, "")}/app/rest/server`,
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
          },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new ExternalApiException(
          "teamcity",
          "TeamCity connection failed",
          {
            statusCode: response.statusCode,
            response: summarizeResponse(response.body),
          },
        );
      }
      return response.body;
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("teamcity", "TeamCity connection failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async listVcsRootsPage(
    config: TeamCityClientConfig,
    start: number,
    count = 100,
  ): Promise<{ items: TeamCityVcsRootResponse[]; hasNext: boolean }> {
    try {
      const query = new URLSearchParams({
        locator: `count:${count},start:${start}`,
        fields:
          "count,nextHref,vcs-root(id,name,project(id,name),properties(property(name,value)))",
      });
      const response = await this.http.request<TeamCityVcsRootsResponse>(
        `${config.baseUrl.replace(/\/$/, "")}/app/rest/vcs-roots?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
          },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`TeamCity returned HTTP ${response.statusCode}`);
      }
      const items = response.body["vcs-root"] ?? [];
      return { items, hasNext: Boolean(response.body.nextHref) };
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException(
        "teamcity",
        "TeamCity VCS Root scan failed",
        { reason: error instanceof Error ? error.message : "unknown" },
      );
    }
  }

  async listBuildTypesPage(
    config: TeamCityClientConfig,
    start: number,
    count = 100,
  ): Promise<{ items: TeamCityBuildTypeResponse[]; hasNext: boolean }> {
    try {
      const query = new URLSearchParams({
        locator: `count:${count},start:${start}`,
        fields:
          "count,nextHref,buildType(id,name,project(id,name),parameters(property(name,type(rawValue))),steps(step(id,name,type)),triggers(trigger(id,type,properties(property(name,value)))))",
      });
      const response = await this.http.request<TeamCityBuildTypesResponse>(
        `${config.baseUrl.replace(/\/$/, "")}/app/rest/buildTypes?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
          },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`TeamCity returned HTTP ${response.statusCode}`);
      }
      return {
        items: response.body.buildType ?? [],
        hasNext: Boolean(response.body.nextHref),
      };
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException(
        "teamcity",
        "TeamCity Build Configuration analysis failed",
        { reason: error instanceof Error ? error.message : "unknown" },
      );
    }
  }

  async listProjectsPage(
    config: TeamCityClientConfig,
    start: number,
    count = 100,
  ): Promise<{ items: TeamCityProjectResponse[]; hasNext: boolean }> {
    try {
      const query = new URLSearchParams({
        locator: `count:${count},start:${start}`,
        fields: "count,nextHref,project(id,name,parentProjectId,archived)",
      });
      const response = await this.http.request<TeamCityProjectsResponse>(
        `${config.baseUrl.replace(/\/$/, "")}/app/rest/projects?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
          },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`TeamCity returned HTTP ${response.statusCode}`);
      }
      return {
        items: response.body.project ?? [],
        hasNext: Boolean(response.body.nextHref),
      };
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException(
        "teamcity",
        "TeamCity project lookup failed",
        {
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
    }
  }

  async listAgents(
    config: TeamCityClientConfig,
  ): Promise<TeamCityAgentResponse[]> {
    const response = await this.getOptional<TeamCityAgentsResponse>(
      config,
      "/app/rest/agents?fields=count,agent(id,name,connected,enabled,authorized,ip,pool(id,name),currentBuild(id,buildType(id,name)),incompatibleBuildTypes(count,compatibility(buildType(id,name),unmetRequirements(description))))",
      "TeamCity agent lookup failed",
    );
    return response?.agent ?? [];
  }

  async listAgentPools(
    config: TeamCityClientConfig,
  ): Promise<TeamCityAgentPoolResponse[]> {
    const response = await this.getOptional<TeamCityAgentPoolsResponse>(
      config,
      "/app/rest/agentPools?fields=count,agentPool(id,name,agents(count,agent(id,name)),projects(count,project(id,name)))",
      "TeamCity agent pool lookup failed",
    );
    return response?.agentPool ?? [];
  }

  async getProjectById(
    config: TeamCityClientConfig,
    id: string,
  ): Promise<TeamCityProjectResponse | null> {
    return this.getOptional<TeamCityProjectResponse>(
      config,
      `/app/rest/projects/id:${encodeURIComponent(id)}`,
      "TeamCity project lookup failed",
    );
  }

  async createProject(
    config: TeamCityClientConfig,
    input: TeamCityCreateProjectInput,
  ): Promise<TeamCityProjectResponse> {
    return this.postJson<TeamCityProjectResponse>(
      config,
      "/app/rest/projects",
      {
        parentProject: { locator: `id:${input.parentProjectId}` },
        name: input.name,
        id: input.id,
        copyAllAssociatedSettings: true,
      },
      "TeamCity project creation failed",
    );
  }

  async updateProjectName(
    config: TeamCityClientConfig,
    projectId: string,
    name: string,
  ): Promise<void> {
    await this.putText(
      config,
      `/app/rest/projects/id:${encodeURIComponent(projectId)}/name`,
      name,
      "TeamCity project name update failed",
    );
  }

  async getVcsRootById(
    config: TeamCityClientConfig,
    id: string,
  ): Promise<TeamCityVcsRootResponse | null> {
    return this.getOptional<TeamCityVcsRootResponse>(
      config,
      `/app/rest/vcs-roots/id:${encodeURIComponent(id)}`,
      "TeamCity VCS Root lookup failed",
    );
  }

  async createVcsRoot(
    config: TeamCityClientConfig,
    input: TeamCityCreateVcsRootInput,
  ): Promise<TeamCityVcsRootResponse> {
    return this.postJson<TeamCityVcsRootResponse>(
      config,
      "/app/rest/vcs-roots",
      this.vcsRootPayload(input),
      "TeamCity VCS Root creation failed",
    );
  }

  async updateVcsRoot(
    config: TeamCityClientConfig,
    input: TeamCityCreateVcsRootInput,
  ): Promise<void> {
    await this.putJson<unknown>(
      config,
      `/app/rest/vcs-roots/id:${encodeURIComponent(input.id)}/properties`,
      this.vcsRootPayload(input).properties,
      "TeamCity VCS Root update failed",
    );
  }

  private vcsRootPayload(input: TeamCityCreateVcsRootInput): {
    id: string;
    name: string;
    vcsName: string;
    project: { id: string };
    properties: { property: Array<{ name: string; value: string }> };
  } {
    const branch = input.branch.startsWith("refs/heads/")
      ? input.branch
      : `refs/heads/${input.branch}`;
    const authenticationProperties =
      input.authMode === "TEAMCITY_SSH_KEY"
        ? [
            { name: "authMethod", value: "TEAMCITY_SSH_KEY" },
            { name: "teamcitySshKey", value: input.sshKeyName ?? "" },
            { name: "ignoreKnownHosts", value: "true" },
            { name: "usernameStyle", value: "USERID" },
          ]
        : [
            { name: "authMethod", value: "PASSWORD" },
            { name: "username", value: input.username ?? "" },
            { name: "secure:password", value: input.password ?? "" },
          ];
    return {
      id: input.id,
      name: input.name,
      vcsName: "jetbrains.git",
      project: { id: input.projectId },
      properties: {
        property: [
          { name: "url", value: input.repositoryUrl },
          { name: "branch", value: branch },
          { name: "teamcity:branchSpec", value: `+:${branch}` },
          { name: "agentCleanFilesPolicy", value: "ALL_UNTRACKED" },
          { name: "agentCleanPolicy", value: "ON_BRANCH_CHANGE" },
          { name: "submoduleCheckout", value: "CHECKOUT" },
          { name: "useAlternates", value: "AUTO" },
          ...authenticationProperties,
        ],
      },
    };
  }

  async getBuildTypeById(
    config: TeamCityClientConfig,
    id: string,
  ): Promise<TeamCityBuildTypeResponse | null> {
    return this.getOptional<TeamCityBuildTypeResponse>(
      config,
      `/app/rest/buildTypes/id:${encodeURIComponent(id)}`,
      "TeamCity Build Configuration lookup failed",
    );
  }

  async getBuildTypeDiagnostics(
    config: TeamCityClientConfig,
    id: string,
  ): Promise<TeamCityBuildTypeResponse | null> {
    return this.getOptional<TeamCityBuildTypeResponse>(
      config,
      `/app/rest/buildTypes/id:${encodeURIComponent(id)}?fields=id,name,project(id,name),agent-requirements(agent-requirement(id,type,disabled,inherited,properties(property(name,value))))`,
      "TeamCity Build Configuration diagnostics failed",
    );
  }

  async createBuildType(
    config: TeamCityClientConfig,
    input: TeamCityCreateBuildTypeInput,
  ): Promise<TeamCityBuildTypeResponse> {
    const trigger = input.autoBuildEnabled
      ? {
          triggers: this.buildTriggersPayload(
            input.autoBuildEnabled,
            input.releaseBranch,
          ),
        }
      : {};
    return this.postJson<TeamCityBuildTypeResponse>(
      config,
      "/app/rest/buildTypes",
      {
        id: input.id,
        name: input.name,
        project: { id: input.projectId },
        parameters: { property: input.parameters },
        steps: this.buildStepsPayload(input.steps),
        ...trigger,
      },
      "TeamCity Build Configuration creation failed",
    );
  }

  async updateBuildSteps(
    config: TeamCityClientConfig,
    buildTypeId: string,
    steps: TeamCityCreateBuildTypeInput["steps"],
  ): Promise<void> {
    await this.putJson<unknown>(
      config,
      `/app/rest/buildTypes/id:${encodeURIComponent(buildTypeId)}/steps`,
      this.buildStepsPayload(steps),
      "TeamCity build steps update failed",
    );
  }

  async updateBuildParameters(
    config: TeamCityClientConfig,
    buildTypeId: string,
    parameters: TeamCityCreateBuildTypeInput["parameters"],
  ): Promise<void> {
    await this.putJson<unknown>(
      config,
      `/app/rest/buildTypes/id:${encodeURIComponent(buildTypeId)}/parameters`,
      { property: parameters },
      "TeamCity build parameters update failed",
    );
  }

  async updateBuildTriggers(
    config: TeamCityClientConfig,
    buildTypeId: string,
    autoBuildEnabled: boolean,
    releaseBranch: string,
  ): Promise<void> {
    await this.putJson<unknown>(
      config,
      `/app/rest/buildTypes/id:${encodeURIComponent(buildTypeId)}/triggers`,
      this.buildTriggersPayload(autoBuildEnabled, releaseBranch),
      "TeamCity build triggers update failed",
    );
  }

  private buildTriggersPayload(
    autoBuildEnabled: boolean,
    releaseBranch: string,
  ): {
    trigger: Array<{
      type: string;
      properties: { property: Array<{ name: string; value: string }> };
    }>;
  } {
    return {
      trigger: autoBuildEnabled
        ? [
            {
              type: "vcsTrigger",
              properties: {
                property: [
                  {
                    name: "branchFilter",
                    // 所选发布分支也是 VCS Root 的默认分支，TC 触发器以 <default> 识别它。
                    // 同时保留精确逻辑名；只写 refs/heads/... 会漏掉默认分支上的提交。
                    value: `-:*\n+:<default>\n+:${normalizeTeamCityBranch(releaseBranch)}`,
                  },
                  { name: "perCheckinTriggering", value: "true" },
                  { name: "groupCheckinsByCommitter", value: "true" },
                  { name: "quietPeriodMode", value: "USE_DEFAULT" },
                ],
              },
            },
          ]
        : [],
    };
  }

  private buildStepsPayload(steps: TeamCityCreateBuildTypeInput["steps"]): {
    step: Array<{
      id: string;
      name: string;
      type: string;
      properties: { property: Array<{ name: string; value: string }> };
    }>;
  } {
    return {
      step: steps.map((step) => ({
        id: step.id,
        name: step.name,
        type: "simpleRunner",
        properties: {
          property: [
            { name: "use.custom.script", value: "true" },
            { name: "script.content", value: step.script },
            {
              name: "teamcity.step.mode",
              value: step.executionMode ?? "default",
            },
          ],
        },
      })),
    };
  }

  async hasVcsRootEntry(
    config: TeamCityClientConfig,
    buildTypeId: string,
    vcsRootId: string,
  ): Promise<boolean> {
    const result = await this.getOptional<unknown>(
      config,
      `/app/rest/buildTypes/id:${encodeURIComponent(buildTypeId)}/vcs-root-entries/${encodeURIComponent(vcsRootId)}`,
      "TeamCity VCS Root attachment lookup failed",
    );
    return result !== null;
  }

  async attachVcsRoot(
    config: TeamCityClientConfig,
    buildTypeId: string,
    vcsRootId: string,
  ): Promise<void> {
    await this.postJson<unknown>(
      config,
      `/app/rest/buildTypes/id:${encodeURIComponent(buildTypeId)}/vcs-root-entries`,
      { id: vcsRootId, "vcs-root": { id: vcsRootId } },
      "TeamCity VCS Root attachment failed",
    );
  }

  /**
   * 构建入队统一接收 Git 发布分支，按受管 VCS Root 使用的完整引用发送给 TeamCity。
   * 仓库流水线与首次构建会传 main 等短名；已有组件入口可能已传 refs/heads/main。
   * 在 HTTP 边界归一化可同时覆盖这些入口，避免短名被当作未监控分支而回退默认提交并判失败。
   */
  async queueBuild(
    config: TeamCityClientConfig,
    buildTypeId: string,
    branchName: string,
  ): Promise<TeamCityBuildResponse> {
    return this.postJson<TeamCityBuildResponse>(
      config,
      "/app/rest/buildQueue",
      {
        branchName: normalizeTeamCityBranch(branchName),
        buildType: { id: buildTypeId },
      },
      "TeamCity build queue request failed",
    );
  }

  async cancelBuild(
    config: TeamCityClientConfig,
    buildId: string,
    queued: boolean,
  ): Promise<void> {
    const collection = queued ? "buildQueue" : "builds";
    await this.postJson<unknown>(
      config,
      `/app/rest/${collection}/id:${encodeURIComponent(buildId)}`,
      {
        comment: "Canceled from Delivery Hub",
        readdIntoQueue: false,
      },
      "TeamCity build cancellation failed",
    );
  }

  async getBuildById(
    config: TeamCityClientConfig,
    buildId: string,
  ): Promise<TeamCityBuildResponse | null> {
    const fields = [
      "id",
      "buildType(id)",
      "number",
      "status",
      "state",
      "branchName",
      "statusText",
      "waitReason",
      "compatibleAgents(count,agent(id,name,connected,enabled))",
      "webUrl",
      "queuedDate",
      "startDate",
      "finishDate",
      "canceledInfo",
      "revisions(revision(version))",
      "resultingProperties(property(name,value))",
    ].join(",");
    return this.getOptional<TeamCityBuildResponse>(
      config,
      `/app/rest/builds/id:${encodeURIComponent(buildId)}?fields=${encodeURIComponent(fields)}`,
      "TeamCity build lookup failed",
    );
  }

  async listBuildsByBuildType(
    config: TeamCityClientConfig,
    buildTypeId: string,
    count = 20,
  ): Promise<TeamCityBuildResponse[]> {
    const fields = [
      "count",
      "build(id,buildType(id),number,status,state,branchName,webUrl,queuedDate,startDate,finishDate,canceledInfo,revisions(revision(version)),resultingProperties(property(name,value)))",
    ].join(",");
    const query = new URLSearchParams({
      locator: `buildType:(id:${buildTypeId}),count:${count},defaultFilter:false`,
      fields,
    });
    const response = await this.getOptional<TeamCityBuildsResponse>(
      config,
      `/app/rest/builds?${query.toString()}`,
      "TeamCity build list failed",
    );
    return response?.build ?? [];
  }

  /** 仓库模式固定单任务串行执行，并保留结果 JSON 供回调丢失后的只读补登记。 */
  async configureRepositoryPipeline(
    config: TeamCityClientConfig,
    buildTypeId: string,
  ): Promise<void> {
    const base = `/app/rest/buildTypes/id:${encodeURIComponent(buildTypeId)}`;
    for (const [name, value] of Object.entries({
      // 脚本核验 git HEAD 和干净工作区，必须保留 .git，不能退回服务器导出模式。
      checkoutMode: "ON_AGENT",
      // REST BuildType 的并发设置名称与 UI 文案不同，服务端使用 maximumNumberOfBuilds。
      maximumNumberOfBuilds: "1",
      artifactRules:
        ".artifacts/ci/%teamcity.build.id%/result.json => ci\n.artifacts/ci/%teamcity.build.id%/reports/** => reports",
      executionTimeoutMin: "90",
    }))
      await this.putText(
        config,
        `${base}/settings/${name}`,
        value,
        "TeamCity pipeline settings update failed",
      );
  }

  /** 内容由当前受管 Build Configuration 生成；调用方仍需验证提交、配置和远端镜像摘要。 */
  async getPipelineResult(
    config: TeamCityClientConfig,
    buildId: string,
  ): Promise<unknown | null> {
    return this.getOptional(
      config,
      `/app/rest/builds/id:${encodeURIComponent(buildId)}/artifacts/content/ci/result.json`,
      "TeamCity pipeline artifact lookup failed",
    );
  }

  private async getOptional<T>(
    config: TeamCityClientConfig,
    path: string,
    message: string,
  ): Promise<T | null> {
    try {
      const response = await this.http.request<T>(
        `${config.baseUrl.replace(/\/$/, "")}${path}`,
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
          },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode === 404) return null;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new ExternalApiException("teamcity", message, {
          statusCode: response.statusCode,
          response: summarizeResponse(response.body),
        });
      }
      return response.body;
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("teamcity", message, {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  private async postJson<T>(
    config: TeamCityClientConfig,
    path: string,
    body: unknown,
    message: string,
  ): Promise<T> {
    try {
      const response = await this.http.request<T>(
        `${config.baseUrl.replace(/\/$/, "")}${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new ExternalApiException("teamcity", message, {
          statusCode: response.statusCode,
          response: summarizeResponse(response.body),
        });
      }
      return response.body;
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("teamcity", message, {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  private async putJson<T>(
    config: TeamCityClientConfig,
    path: string,
    body: unknown,
    message: string,
  ): Promise<T> {
    try {
      const response = await this.http.request<T>(
        `${config.baseUrl.replace(/\/$/, "")}${path}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new ExternalApiException("teamcity", message, {
          statusCode: response.statusCode,
          response: summarizeResponse(response.body),
        });
      }
      return response.body;
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("teamcity", message, {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  private async putText(
    config: TeamCityClientConfig,
    path: string,
    body: string,
    message: string,
  ): Promise<void> {
    try {
      const response = await this.http.request<unknown>(
        `${config.baseUrl.replace(/\/$/, "")}${path}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${config.token}`,
            // settings/name 等标量接口只返回 text/plain；请求 JSON 会被真实 TC 拒绝为 406。
            Accept: "text/plain",
            "Content-Type": "text/plain",
          },
          body,
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new ExternalApiException("teamcity", message, {
          statusCode: response.statusCode,
          response: summarizeResponse(response.body),
        });
      }
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("teamcity", message, {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

function normalizeTeamCityBranch(branch: string): string {
  return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
}

function summarizeResponse(body: unknown): string {
  const text =
    typeof body === "string"
      ? body
      : JSON.stringify(body, (key, value) =>
          /(password|token|secret|credential)/i.test(key)
            ? "[REDACTED]"
            : value,
        );
  return (text || "empty response").replace(/\s+/g, " ").slice(0, 1000);
}
