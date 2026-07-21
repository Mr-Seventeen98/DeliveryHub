import { timingSafeEqual } from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApplicationStatus,
  BuildStatus,
  CredentialType,
  ImageStatus,
  TriggerType,
  type Prisma,
} from "@prisma/client";
import {
  TeamCityClient,
  type TeamCityBuildResponse,
} from "../../adapters/teamcity/teamcity.client";
import { RegistryClient } from "../../adapters/registry/registry.client";
import { TencentTcrClient } from "../../adapters/registry/tencent-tcr.client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";
import { deriveTeamCityCallbackToken } from "./build-callback-token";
import type { BuildQueryDto } from "./dto/build-query.dto";
import type { ImageQueryDto } from "./dto/image-query.dto";
import type { RegistryCatalogQueryDto } from "./dto/registry-catalog-query.dto";
import type { TeamCityBuildCallbackDto } from "./dto/teamcity-build-callback.dto";
import type { TriggerBuildDto } from "./dto/trigger-build.dto";

@Injectable()
export class BuildsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BuildsService.name);
  private readonly pollIntervalMs: number;
  private pollTimer?: ReturnType<typeof setInterval>;
  private syncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly teamCity: TeamCityClient,
    private readonly registry: RegistryClient,
    private readonly tencentTcr: TencentTcrClient,
    private readonly config: ConfigService,
  ) {
    this.pollIntervalMs =
      Number(config.get("DEFAULT_BUILD_STATUS_POLL_INTERVAL_SECONDS") ?? 15) *
      1000;
  }

  onModuleInit(): void {
    this.pollTimer = setInterval(
      () => void this.syncAll(),
      this.pollIntervalMs,
    );
    this.pollTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async list(query: BuildQueryDto): Promise<{
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const search = query.search?.trim();
    const where: Prisma.BuildWhereInput = {
      ...(query.applicationId ? { applicationId: query.applicationId } : {}),
      ...(query.componentId ? { componentId: query.componentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              {
                application: {
                  gitLabProject: {
                    name: { contains: search, mode: "insensitive" },
                  },
                },
              },
              {
                application: {
                  gitLabProject: {
                    pathWithNamespace: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              },
              {
                component: {
                  name: { contains: search, mode: "insensitive" },
                },
              },
              {
                component: {
                  teamCityBuildTypeId: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.build.findMany({
        where,
        include: {
          application: {
            select: {
              id: true,
              name: true,
              code: true,
              gitLabProject: {
                select: { name: true, pathWithNamespace: true, webUrl: true },
              },
              teamCityConnection: { select: { baseUrl: true } },
            },
          },
          component: { select: { id: true, name: true, code: true } },
          images: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.build.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async listImages(query: ImageQueryDto): Promise<{
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Prisma.ImageVersionWhereInput = {
      ...(query.componentId ? { componentId: query.componentId } : {}),
      ...(query.applicationId
        ? { component: { applicationId: query.applicationId } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.imageVersion.findMany({
        where,
        include: {
          component: {
            select: {
              id: true,
              name: true,
              application: { select: { id: true, name: true, code: true } },
            },
          },
          build: {
            select: { id: true, status: true, branch: true, logUrl: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.imageVersion.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async registryVersions(id: string): Promise<{
    repository: {
      registry: string;
      namespace: string;
      repository: string;
      name: string;
    };
    items: Array<{
      tag: string;
      fullName: string;
      current: boolean;
      digest: string | null;
      buildNumber: string | null;
      commitSha: string | null;
      createdAt: Date | null;
      recorded: boolean;
    }>;
    total: number;
  }> {
    const image = await this.prisma.imageVersion.findUnique({
      where: { id },
      include: {
        component: {
          include: {
            application: { include: { registryConnection: true } },
          },
        },
      },
    });
    if (!image) throw new NotFoundException("Image version not found");
    const connection = image.component.application.registryConnection;
    if (!connection)
      throw new NotFoundException("Registry connection not configured");
    const [username, password, localVersions] = await Promise.all([
      this.credentials.resolve(connection.usernameCredentialId, [
        CredentialType.REGISTRY_USERNAME,
      ]),
      this.credentials.resolve(connection.passwordCredentialId, [
        CredentialType.REGISTRY_PASSWORD,
      ]),
      this.prisma.imageVersion.findMany({
        where: {
          registry: image.registry,
          namespace: image.namespace,
          repository: image.repository,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const remote = await this.registry.listTags(
      {
        registryUrl: connection.registryUrl,
        username,
        password,
        verifySsl: connection.verifySsl,
      },
      image.namespace,
      image.repository,
    );
    const localByTag = new Map(
      localVersions.map((version) => [version.tag, version]),
    );
    const tags = remote.tags.sort((left, right) => {
      if (left === image.tag) return -1;
      if (right === image.tag) return 1;
      if (left === "latest") return -1;
      if (right === "latest") return 1;
      return right.localeCompare(left);
    });
    const items = tags.map((tag) => {
      const local = localByTag.get(tag);
      return {
        tag,
        fullName: `${image.registry}/${image.namespace}/${image.repository}:${tag}`,
        current: tag === image.tag,
        digest: local?.digest ?? null,
        buildNumber: local?.buildNumber ?? null,
        commitSha: local?.commitSha ?? null,
        createdAt: local?.createdAt ?? null,
        recorded: Boolean(local),
      };
    });
    return {
      repository: {
        registry: image.registry,
        namespace: image.namespace,
        repository: image.repository,
        name: remote.name,
      },
      items,
      total: items.length,
    };
  }

  async registryCatalog(query: RegistryCatalogQueryDto): Promise<{
    items: Array<{
      name: string;
      namespace: string;
      repository: string;
      fullName: string;
      remoteTagCount: number;
      updatedAt: string | null;
      tags: Array<{
        imageVersionId: string | null;
        applicationId: string | null;
        tag: string;
        fullName: string;
        digest: string | null;
        buildNumber: string | null;
        commitSha: string | null;
        createdAt: Date | null;
        recorded: boolean;
      }>;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const connection = await this.prisma.registryConnection.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: "asc" },
    });
    if (!connection)
      throw new NotFoundException("Registry connection not configured");
    if (
      !connection.cloudSecretIdCredentialId ||
      !connection.cloudSecretKeyCredentialId
    )
      throw new BadRequestException(
        "Tencent Cloud API credentials are not configured",
      );
    const [secretId, secretKey, localVersions] = await Promise.all([
      this.credentials.resolve(connection.cloudSecretIdCredentialId, [
        CredentialType.TENCENT_CLOUD_SECRET_ID,
      ]),
      this.credentials.resolve(connection.cloudSecretKeyCredentialId, [
        CredentialType.TENCENT_CLOUD_SECRET_KEY,
      ]),
      this.prisma.imageVersion.findMany({
        where: {
          registry: connection.registryUrl.replace(/^https?:\/\//, ""),
          namespace: connection.namespace,
        },
        include: {
          component: { select: { applicationId: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const prefix = `${connection.namespace}/`;
    const search = query.search?.trim().toLowerCase();
    const repositories = (
      await this.tencentTcr.listPersonalRepositories({
        secretId,
        secretKey,
        region: "ap-guangzhou",
      })
    )
      .filter((item) => item.name.startsWith(prefix))
      .filter((item) => !search || item.name.toLowerCase().includes(search));
    const total = repositories.length;
    const selected = repositories.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    );
    const localByRepositoryAndTag = new Map(
      localVersions.map((version) => [
        `${version.repository}:${version.tag}`,
        version,
      ]),
    );
    const registryHost = connection.registryUrl.replace(/^https?:\/\//, "");
    const items = await Promise.all(
      selected.map(async (remoteRepository) => {
        const name = remoteRepository.name;
        const repository = name.slice(prefix.length);
        const remoteTags = await this.tencentTcr.listPersonalImageTags(
          { secretId, secretKey, region: "ap-guangzhou" },
          name,
        );
        const tags = remoteTags
          .map((remoteTag) => {
            const local = localByRepositoryAndTag.get(
              `${repository}:${remoteTag.tag}`,
            );
            const remoteCreatedAt = parseRemoteDate(remoteTag.createdAt);
            return {
              imageVersionId: local?.id ?? null,
              applicationId: local?.component.applicationId ?? null,
              tag: remoteTag.tag,
              fullName: `${registryHost}/${name}:${remoteTag.tag}`,
              digest: local?.digest ?? remoteTag.digest,
              buildNumber: local?.buildNumber ?? null,
              commitSha: local?.commitSha ?? null,
              createdAt: remoteCreatedAt ?? local?.createdAt ?? null,
              recorded: Boolean(local),
            };
          })
          .sort(
            (left, right) =>
              (right.createdAt?.getTime() ?? 0) -
                (left.createdAt?.getTime() ?? 0) ||
              right.tag.localeCompare(left.tag),
          );
        return {
          name,
          namespace: connection.namespace,
          repository,
          fullName: `${registryHost}/${name}`,
          remoteTagCount: remoteRepository.tagCount,
          updatedAt: remoteRepository.updatedAt,
          tags,
        };
      }),
    );
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async trigger(
    dto: TriggerBuildDto,
    userId: string,
  ): Promise<{
    builds: Array<{
      id: string;
      teamCityBuildId: string;
      logUrl: string | null;
    }>;
  }> {
    const application = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
      include: {
        teamCityConnection: true,
        components: {
          where: {
            enabled: true,
            teamCityBuildTypeId: { not: null },
            ...(dto.componentId ? { id: dto.componentId } : {}),
          },
        },
      },
    });
    if (!application || application.status !== ApplicationStatus.ACTIVE)
      throw new NotFoundException("Application not found or not active");
    if (application.components.length === 0)
      throw new NotFoundException("No buildable component found");

    const token = await this.credentials.resolve(
      application.teamCityConnection.tokenCredentialId,
      [CredentialType.TEAMCITY_TOKEN],
    );
    const clientConfig = {
      baseUrl: application.teamCityConnection.baseUrl,
      token,
      verifySsl: application.teamCityConnection.verifySsl,
    };
    const builds = [];
    for (const component of application.components) {
      const queued = await this.teamCity.queueBuild(
        clientConfig,
        component.teamCityBuildTypeId!,
        normalizeTeamCityBranch(application.releaseBranch),
      );
      if (!queued.id)
        throw new BadGatewayException("TeamCity did not return a build ID");
      const record = await this.upsertTeamCityBuild(
        application.id,
        component.id,
        queued,
        TriggerType.API,
        userId,
      );
      builds.push({
        id: record.id,
        teamCityBuildId: record.teamCityBuildId,
        logUrl: record.logUrl,
      });
    }
    return { builds };
  }

  async diagnostics(id: string): Promise<{
    state: string;
    status: string;
    statusText: string | null;
    waitReason: string | null;
    compatibleAgents: TeamCityBuildResponse["compatibleAgents"];
    agentRequirements: unknown[];
    logUrl: string | null;
  }> {
    const build = await this.prisma.build.findUnique({
      where: { id },
      include: {
        application: { include: { teamCityConnection: true } },
        component: { select: { teamCityBuildTypeId: true } },
      },
    });
    if (!build) throw new NotFoundException("Build not found");
    const connection = build.application.teamCityConnection;
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    const config = {
      baseUrl: connection.baseUrl,
      token,
      verifySsl: connection.verifySsl,
    };
    const [remote, buildType] = await Promise.all([
      this.teamCity.getBuildById(config, build.teamCityBuildId),
      build.component?.teamCityBuildTypeId
        ? this.teamCity.getBuildTypeDiagnostics(
            config,
            build.component.teamCityBuildTypeId,
          )
        : null,
    ]);
    if (!remote) throw new NotFoundException("TeamCity build not found");
    return {
      state: remote.state ?? "unknown",
      status: remote.status ?? "UNKNOWN",
      statusText: remote.statusText ?? null,
      waitReason: remote.waitReason ?? null,
      compatibleAgents: remote.compatibleAgents,
      agentRequirements:
        buildType?.["agent-requirements"]?.["agent-requirement"] ?? [],
      logUrl: remote.webUrl ?? build.logUrl,
    };
  }

  async cancel(
    id: string,
  ): Promise<{ canceled: boolean; status: BuildStatus }> {
    const build = await this.prisma.build.findUnique({
      where: { id },
      include: { application: { include: { teamCityConnection: true } } },
    });
    if (!build) throw new NotFoundException("Build not found");
    if (
      build.status !== BuildStatus.QUEUED &&
      build.status !== BuildStatus.RUNNING
    ) {
      throw new BadGatewayException(
        "Only queued or running builds can be canceled",
      );
    }
    const connection = build.application.teamCityConnection;
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    const clientConfig = {
      baseUrl: connection.baseUrl,
      token,
      verifySsl: connection.verifySsl,
    };
    const remote = await this.teamCity.getBuildById(
      clientConfig,
      build.teamCityBuildId,
    );
    if (remote && remote.state !== "queued" && remote.state !== "running") {
      const status = remoteBuildStatus(remote);
      await this.prisma.build.update({
        where: { id },
        data: {
          status,
          finishedAt: parseTeamCityDate(remote.finishDate) ?? new Date(),
          logUrl: remote.webUrl ?? build.logUrl,
        },
      });
      return { canceled: false, status };
    }
    await this.teamCity.cancelBuild(
      clientConfig,
      build.teamCityBuildId,
      build.status === BuildStatus.QUEUED,
    );
    await this.prisma.build.update({
      where: { id },
      data: { status: BuildStatus.CANCELED, finishedAt: new Date() },
    });
    return { canceled: true, status: BuildStatus.CANCELED };
  }

  async handleCallback(
    authorization: string | undefined,
    dto: TeamCityBuildCallbackDto,
  ): Promise<{ accepted: true; buildId: string; images: number }> {
    this.verifyCallbackToken(authorization, dto.teamcity_connection_id);
    const application = await this.prisma.application.findFirst({
      where: {
        id: dto.delivery_project_id,
        teamCityConnectionId: dto.teamcity_connection_id,
      },
      include: { components: true, teamCityConnection: true },
    });
    if (!application) throw new NotFoundException("Application not found");
    const componentByCode = new Map(
      application.components.map((component) => [component.code, component]),
    );
    const primaryComponent = dto.images[0]
      ? componentByCode.get(dto.images[0].component_code)
      : undefined;
    const startedAt = dto.started_at ? new Date(dto.started_at) : null;
    const finishedAt = dto.finished_at ? new Date(dto.finished_at) : null;
    const durationSeconds =
      startedAt && finishedAt
        ? Math.max(
            0,
            Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
          )
        : null;
    const build = await this.prisma.build.upsert({
      where: { teamCityBuildId: dto.teamcity_build_id },
      create: {
        applicationId: application.id,
        componentId: primaryComponent?.id,
        teamCityBuildId: dto.teamcity_build_id,
        teamCityBuildNumber: dto.build_number,
        branch: dto.branch,
        commitSha: dto.commit_sha,
        status: callbackStatus(dto.status),
        triggerType: TriggerType.VCS,
        startedAt,
        finishedAt,
        durationSeconds,
        logUrl: `${application.teamCityConnection.baseUrl.replace(/\/$/, "")}/viewLog.html?buildId=${encodeURIComponent(dto.teamcity_build_id)}`,
      },
      update: {
        componentId: primaryComponent?.id,
        teamCityBuildNumber: dto.build_number,
        branch: dto.branch,
        commitSha: dto.commit_sha,
        status: callbackStatus(dto.status),
        startedAt,
        finishedAt,
        durationSeconds,
      },
    });

    let imageCount = 0;
    for (const image of dto.images) {
      const component = componentByCode.get(image.component_code);
      if (!component) continue;
      const fullName = `${image.registry}/${image.namespace}/${image.repository}:${image.tag}`;
      await this.prisma.imageVersion.upsert({
        where: {
          componentId_fullName: { componentId: component.id, fullName },
        },
        create: {
          componentId: component.id,
          buildId: build.id,
          registry: image.registry,
          namespace: image.namespace,
          repository: image.repository,
          tag: image.tag,
          digest: image.digest,
          fullName,
          commitSha: dto.commit_sha,
          buildNumber: dto.build_number,
          status: ImageStatus.AVAILABLE,
        },
        update: {
          buildId: build.id,
          digest: image.digest,
          commitSha: dto.commit_sha,
          buildNumber: dto.build_number,
          status: ImageStatus.AVAILABLE,
        },
      });
      imageCount += 1;
    }
    return { accepted: true, buildId: build.id, images: imageCount };
  }

  async syncAll(): Promise<{ discovered: number; updated: number }> {
    if (this.syncing) return { discovered: 0, updated: 0 };
    this.syncing = true;
    let discovered = 0;
    let updated = 0;
    try {
      const applications = await this.prisma.application.findMany({
        where: { status: ApplicationStatus.ACTIVE },
        include: {
          teamCityConnection: true,
          components: {
            where: { enabled: true, teamCityBuildTypeId: { not: null } },
          },
        },
      });
      for (const application of applications) {
        try {
          const token = await this.credentials.resolve(
            application.teamCityConnection.tokenCredentialId,
            [CredentialType.TEAMCITY_TOKEN],
          );
          const clientConfig = {
            baseUrl: application.teamCityConnection.baseUrl,
            token,
            verifySsl: application.teamCityConnection.verifySsl,
          };
          for (const component of application.components) {
            const remoteBuilds = await this.teamCity.listBuildsByBuildType(
              clientConfig,
              component.teamCityBuildTypeId!,
              20,
            );
            for (const remote of remoteBuilds) {
              const existed = await this.prisma.build.findUnique({
                where: { teamCityBuildId: String(remote.id) },
                select: { id: true },
              });
              await this.upsertTeamCityBuild(
                application.id,
                component.id,
                remote,
                TriggerType.VCS,
              );
              if (existed) updated += 1;
              else discovered += 1;
            }
          }
        } catch (error) {
          this.logger.warn(
            `Build sync failed for ${application.id}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
      return { discovered, updated };
    } finally {
      this.syncing = false;
    }
  }

  private async upsertTeamCityBuild(
    applicationId: string,
    componentId: string,
    remote: TeamCityBuildResponse,
    triggerType: TriggerType,
    triggeredBy?: string,
  ) {
    const startedAt = parseTeamCityDate(remote.startDate);
    const finishedAt = parseTeamCityDate(remote.finishDate);
    const durationSeconds =
      startedAt && finishedAt
        ? Math.max(
            0,
            Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
          )
        : null;
    const build = await this.prisma.build.upsert({
      where: { teamCityBuildId: String(remote.id) },
      create: {
        applicationId,
        componentId,
        teamCityBuildId: String(remote.id),
        teamCityBuildNumber: remote.number ?? "",
        branch: remote.branchName ?? "",
        commitSha: remote.revisions?.revision?.[0]?.version ?? "pending",
        status: remoteBuildStatus(remote),
        triggerType,
        triggeredBy,
        startedAt,
        finishedAt,
        durationSeconds,
        logUrl: remote.webUrl,
      },
      update: {
        teamCityBuildNumber: remote.number ?? "",
        branch: remote.branchName ?? "",
        commitSha: remote.revisions?.revision?.[0]?.version ?? "pending",
        status: remoteBuildStatus(remote),
        startedAt,
        finishedAt,
        durationSeconds,
        logUrl: remote.webUrl,
      },
    });
    if (build.status === BuildStatus.SUCCESS)
      await this.recordPolledImage(build, componentId, remote);
    return build;
  }

  private async recordPolledImage(
    build: {
      id: string;
      commitSha: string;
      teamCityBuildNumber: string;
    },
    componentId: string,
    remote: TeamCityBuildResponse,
  ): Promise<void> {
    const properties = new Map(
      (remote.resultingProperties?.property ?? []).map((property) => [
        property.name,
        property.value ?? "",
      ]),
    );
    const digest = properties.get("env.DELIVERY_HUB_IMAGE_DIGEST");
    if (!digest || build.commitSha === "pending") return;
    const component = await this.prisma.component.findUnique({
      where: { id: componentId },
    });
    if (!component) return;
    const tag = properties.get("env.DELIVERY_HUB_IMAGE_TAG") ?? build.commitSha;
    const registry = "ccr.ccs.tencentyun.com";
    const namespace = "fc17_dev";
    const fullName = `${registry}/${namespace}/${component.imageRepository}:${tag}`;
    await this.prisma.imageVersion.upsert({
      where: { componentId_fullName: { componentId, fullName } },
      create: {
        componentId,
        buildId: build.id,
        registry,
        namespace,
        repository: component.imageRepository,
        tag,
        digest,
        fullName,
        commitSha: build.commitSha,
        buildNumber: build.teamCityBuildNumber,
        status: ImageStatus.AVAILABLE,
      },
      update: {
        buildId: build.id,
        digest,
        commitSha: build.commitSha,
        buildNumber: build.teamCityBuildNumber,
        status: ImageStatus.AVAILABLE,
      },
    });
  }

  private verifyCallbackToken(
    authorization: string | undefined,
    connectionId: string,
  ): void {
    const supplied = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expected = deriveTeamCityCallbackToken(
      this.config.getOrThrow<string>("APP_SECRET_KEY"),
      connectionId,
    );
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    )
      throw new UnauthorizedException("Invalid TeamCity callback token");
  }
}

function normalizeTeamCityBranch(branch: string): string {
  return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
}

function callbackStatus(
  status: TeamCityBuildCallbackDto["status"],
): BuildStatus {
  return BuildStatus[status];
}

function remoteBuildStatus(remote: TeamCityBuildResponse): BuildStatus {
  if (remote.canceledInfo) return BuildStatus.CANCELED;
  if (remote.state === "queued") return BuildStatus.QUEUED;
  if (remote.state === "running") return BuildStatus.RUNNING;
  if (remote.status === "SUCCESS") return BuildStatus.SUCCESS;
  if (remote.status === "FAILURE") return BuildStatus.FAILED;
  return BuildStatus.UNKNOWN;
}

function parseTeamCityDate(value?: string): Date | null {
  if (!value) return null;
  const compact = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/,
  );
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}${compact[7]}:${compact[8]}`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRemoteDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
