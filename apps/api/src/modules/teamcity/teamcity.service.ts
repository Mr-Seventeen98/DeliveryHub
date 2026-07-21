import { Injectable, NotFoundException } from "@nestjs/common";
import { CredentialType, type TeamCityConnection } from "@prisma/client";
import { TeamCityClient } from "../../adapters/teamcity/teamcity.client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";
import type {
  CreateTeamCityConnectionDto,
  UpdateTeamCityConnectionDto,
} from "./dto/teamcity-connection.dto";
import { normalizeRepositoryUrl } from "./teamcity-repository";

@Injectable()
export class TeamCityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly client: TeamCityClient,
  ) {}

  create(dto: CreateTeamCityConnectionDto): Promise<TeamCityConnection> {
    return this.prisma.teamCityConnection.create({
      data: {
        name: dto.name,
        baseUrl: dto.baseUrl.replace(/\/$/, ""),
        tokenCredentialId: dto.tokenCredentialId,
        parentProjectId: dto.parentProjectId,
        verifySsl: dto.verifySsl ?? true,
      },
    });
  }

  list(): Promise<TeamCityConnection[]> {
    return this.prisma.teamCityConnection.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async get(id: string): Promise<TeamCityConnection> {
    const connection = await this.prisma.teamCityConnection.findUnique({
      where: { id },
    });
    if (!connection)
      throw new NotFoundException("TeamCity connection not found");
    return connection;
  }

  async update(
    id: string,
    dto: UpdateTeamCityConnectionDto,
  ): Promise<TeamCityConnection> {
    await this.get(id);
    return this.prisma.teamCityConnection.update({
      where: { id },
      data: { ...dto, baseUrl: dto.baseUrl?.replace(/\/$/, "") },
    });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.teamCityConnection.delete({ where: { id } });
  }

  async test(id: string): Promise<{ version: string; buildNumber: string }> {
    const connection = await this.get(id);
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    try {
      const result = await this.client.testConnection({
        baseUrl: connection.baseUrl,
        token,
        verifySsl: connection.verifySsl,
      });
      await this.prisma.teamCityConnection.update({
        where: { id },
        data: { lastTestAt: new Date(), lastTestStatus: "success" },
      });
      return result;
    } catch (error) {
      await this.prisma.teamCityConnection.update({
        where: { id },
        data: { lastTestAt: new Date(), lastTestStatus: "failed" },
      });
      throw error;
    }
  }

  async syncVcsRoots(id: string): Promise<{
    scanned: number;
    matched: number;
    configuredProjects: number;
    unmatched: number;
  }> {
    const connection = await this.get(id);
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    const gitLabProjects = await this.prisma.gitLabProject.findMany({
      select: {
        id: true,
        pathWithNamespace: true,
        httpCloneUrl: true,
        sshCloneUrl: true,
      },
    });
    const byFullUrl = new Map<string, Set<string>>();
    const byPath = new Map<string, Set<string>>();
    const addCandidate = (
      index: Map<string, Set<string>>,
      key: string,
      projectId: string,
    ): void => {
      const matches = index.get(key) ?? new Set<string>();
      matches.add(projectId);
      index.set(key, matches);
    };
    for (const project of gitLabProjects) {
      for (const cloneUrl of [project.httpCloneUrl, project.sshCloneUrl]) {
        const normalized = normalizeRepositoryUrl(cloneUrl);
        if (normalized) {
          addCandidate(byFullUrl, normalized.full, project.id);
          addCandidate(byPath, normalized.path, project.id);
        }
      }
      addCandidate(
        byPath,
        project.pathWithNamespace.replace(/\.git$/i, "").toLowerCase(),
        project.id,
      );
    }

    const roots = [];
    for (let start = 0, page = 0; page < 1000; page += 1, start += 100) {
      const result = await this.client.listVcsRootsPage(
        {
          baseUrl: connection.baseUrl,
          token,
          verifySsl: connection.verifySsl,
        },
        start,
        100,
      );
      roots.push(...result.items);
      if (!result.hasNext) break;
    }

    const seenIds: string[] = [];
    const matchedProjectIds = new Set<string>();
    let matched = 0;
    const lastSeenAt = new Date();
    for (const root of roots) {
      const repositoryUrl =
        root.properties?.property?.find((property) => property.name === "url")
          ?.value ?? "";
      const normalized = normalizeRepositoryUrl(repositoryUrl);
      if (!normalized) continue;
      seenIds.push(root.id);
      const fullCandidates = byFullUrl.get(normalized.full);
      const pathCandidates = byPath.get(normalized.path);
      const candidates = fullCandidates?.size ? fullCandidates : pathCandidates;
      const gitLabProjectId =
        candidates?.size === 1 ? [...candidates][0] : undefined;
      if (gitLabProjectId) {
        matched += 1;
        matchedProjectIds.add(gitLabProjectId);
      }
      await this.prisma.teamCityVcsRoot.upsert({
        where: {
          teamCityConnectionId_externalId: {
            teamCityConnectionId: id,
            externalId: root.id,
          },
        },
        create: {
          teamCityConnectionId: id,
          externalId: root.id,
          name: root.name,
          teamCityProjectId: root.project?.id ?? "",
          teamCityProjectName: root.project?.name ?? "",
          repositoryUrl,
          normalizedRepository: normalized.full,
          gitLabProjectId,
          active: true,
          lastSeenAt,
        },
        update: {
          name: root.name,
          teamCityProjectId: root.project?.id ?? "",
          teamCityProjectName: root.project?.name ?? "",
          repositoryUrl,
          normalizedRepository: normalized.full,
          gitLabProjectId,
          active: true,
          lastSeenAt,
        },
      });
    }
    await this.prisma.teamCityVcsRoot.updateMany({
      where: {
        teamCityConnectionId: id,
        ...(seenIds.length > 0 ? { externalId: { notIn: seenIds } } : {}),
      },
      data: { active: false },
    });
    await this.prisma.teamCityConnection.update({
      where: { id },
      data: { lastTestAt: lastSeenAt, lastTestStatus: "success" },
    });
    return {
      scanned: seenIds.length,
      matched,
      configuredProjects: matchedProjectIds.size,
      unmatched: seenIds.length - matched,
    };
  }

  async configurationConventions(id: string): Promise<{
    buildTypeCount: number;
    parameterNames: Array<{ name: string; uses: number; password: boolean }>;
    stepNames: Array<{ name: string; uses: number }>;
    triggerTypes: Array<{ type: string; uses: number }>;
    vcsTriggerConfigurations: Array<{
      buildTypeId: string;
      buildTypeName: string;
      properties: Record<string, string>;
    }>;
    releaseBranches: Array<{ branch: string; uses: number }>;
  }> {
    const connection = await this.get(id);
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    const config = {
      baseUrl: connection.baseUrl,
      token,
      verifySsl: connection.verifySsl,
    };
    const buildTypes = [];
    for (let start = 0, page = 0; page < 1000; page += 1, start += 100) {
      const result = await this.client.listBuildTypesPage(config, start, 100);
      buildTypes.push(...result.items);
      if (!result.hasNext) break;
    }
    const roots = [];
    for (let start = 0, page = 0; page < 1000; page += 1, start += 100) {
      const result = await this.client.listVcsRootsPage(config, start, 100);
      roots.push(...result.items);
      if (!result.hasNext) break;
    }
    const countValues = <T extends string>(values: T[]): Array<[T, number]> => {
      const counts = new Map<T, number>();
      for (const value of values)
        counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts.entries()].sort(
        ([leftName, leftCount], [rightName, rightCount]) =>
          rightCount - leftCount || leftName.localeCompare(rightName),
      );
    };
    const parameters = buildTypes.flatMap(
      (buildType) => buildType.parameters?.property ?? [],
    );
    const parameterPasswordTypes = new Map(
      parameters.map((parameter) => [
        parameter.name,
        parameter.type?.rawValue?.includes("password") ?? false,
      ]),
    );
    const parameterNames = countValues(
      parameters.map((parameter) => parameter.name),
    ).map(([name, uses]) => ({
      name,
      uses,
      password:
        parameterPasswordTypes.get(name) ??
        /(password|token|secret|credential)/i.test(name),
    }));
    const stepNames = countValues(
      buildTypes.flatMap((buildType) =>
        (buildType.steps?.step ?? []).map(
          (step) => step.name || step.type || "未命名步骤",
        ),
      ),
    ).map(([name, uses]) => ({ name, uses }));
    const triggerTypes = countValues(
      buildTypes.flatMap((buildType) =>
        (buildType.triggers?.trigger ?? []).map(
          (trigger) => trigger.type || "unknown",
        ),
      ),
    ).map(([type, uses]) => ({ type, uses }));
    const vcsTriggerConfigurations = buildTypes.flatMap((buildType) =>
      (buildType.triggers?.trigger ?? [])
        .filter((trigger) => trigger.type === "vcsTrigger")
        .map((trigger) => ({
          buildTypeId: buildType.id,
          buildTypeName: buildType.name,
          properties: Object.fromEntries(
            (trigger.properties?.property ?? []).flatMap((property) =>
              property.value === undefined
                ? []
                : [[property.name, property.value]],
            ),
          ),
        })),
    );
    const releaseBranches = countValues(
      roots
        .map(
          (root) =>
            root.properties?.property?.find(
              (property) => property.name === "branch",
            )?.value,
        )
        .filter((branch): branch is string => Boolean(branch)),
    ).map(([branch, uses]) => ({ branch, uses }));
    return {
      buildTypeCount: buildTypes.length,
      parameterNames,
      stepNames,
      triggerTypes,
      vcsTriggerConfigurations,
      releaseBranches,
    };
  }

  async listProjects(id: string): Promise<{
    parentProjectId: string;
    items: Array<{ id: string; name: string; parentProjectId: string }>;
  }> {
    const connection = await this.get(id);
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    const config = {
      baseUrl: connection.baseUrl,
      token,
      verifySsl: connection.verifySsl,
    };
    const projects = [];
    for (let start = 0, page = 0; page < 1000; page += 1, start += 100) {
      const result = await this.client.listProjectsPage(config, start, 100);
      projects.push(...result.items);
      if (!result.hasNext) break;
    }
    return {
      parentProjectId: connection.parentProjectId,
      items: projects
        .filter(
          (project) =>
            project.archived !== true &&
            project.id !== connection.parentProjectId &&
            project.parentProjectId === connection.parentProjectId,
        )
        .map((project) => ({
          id: project.id,
          name: project.name,
          parentProjectId:
            project.parentProjectId ?? connection.parentProjectId,
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    };
  }

  async agents(id: string): Promise<{
    total: number;
    connected: number;
    enabled: number;
    items: Array<{
      id: number;
      name: string;
      connected: boolean;
      enabled: boolean;
      authorized: boolean;
      ip?: string;
      pool?: string;
      currentBuild?: { id?: number; buildType?: string };
      incompatibleBuildTypes: Array<{
        id?: string;
        name?: string;
        reason?: string;
      }>;
    }>;
    pools: Array<{
      id: number;
      name: string;
      agentCount: number;
      projectCount: number;
      projectIds: string[];
    }>;
  }> {
    const connection = await this.get(id);
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    const config = {
      baseUrl: connection.baseUrl,
      token,
      verifySsl: connection.verifySsl,
    };
    const [agents, pools] = await Promise.all([
      this.client.listAgents(config),
      this.client.listAgentPools(config),
    ]);
    const items = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      connected: agent.connected === true,
      enabled: agent.enabled === true,
      authorized: agent.authorized === true,
      ...(agent.ip ? { ip: agent.ip } : {}),
      ...(agent.pool?.name ? { pool: agent.pool.name } : {}),
      ...(agent.currentBuild
        ? {
            currentBuild: {
              id: agent.currentBuild.id,
              buildType:
                agent.currentBuild.buildType?.name ??
                agent.currentBuild.buildType?.id,
            },
          }
        : {}),
      incompatibleBuildTypes: (
        agent.incompatibleBuildTypes?.compatibility ?? []
      ).map((compatibility) => ({
        id: compatibility.buildType?.id,
        name: compatibility.buildType?.name,
        reason: compatibility.unmetRequirements?.description,
      })),
    }));
    return {
      total: items.length,
      connected: items.filter((agent) => agent.connected).length,
      enabled: items.filter((agent) => agent.enabled).length,
      items,
      pools: pools.map((pool) => ({
        id: pool.id,
        name: pool.name,
        agentCount: pool.agents?.count ?? 0,
        projectCount: pool.projects?.count ?? 0,
        projectIds: (pool.projects?.project ?? [])
          .map((project) => project.id)
          .filter((projectId): projectId is string => Boolean(projectId)),
      })),
    };
  }
}
