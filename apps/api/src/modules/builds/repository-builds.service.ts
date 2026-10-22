/** 仓库构建的生命周期：单次入队，阶段幂等登记，整套摘要核对后再原子登记可用镜像。 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  BuildStatus,
  CredentialType,
  ImageStatus,
  Prisma,
  TriggerType,
  type Application,
} from "@prisma/client";
import {
  TeamCityClient,
  type TeamCityBuildResponse,
  type TeamCityClientConfig,
} from "../../adapters/teamcity/teamcity.client";
import { RegistryClient } from "../../adapters/registry/registry.client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";
import { pipelineDefinitionSchema } from "../provisioning/repository-pipeline";
import {
  assertCompleteRepositoryResult,
  repositoryResultSchema,
} from "./repository-result";

@Injectable()
export class RepositoryBuildsService {
  private readonly logger = new Logger(RepositoryBuildsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly teamCity: TeamCityClient,
    private readonly registry: RegistryClient,
  ) {}

  /** 同一个受管流水线只入队一次，componentId=null 表示整套，不伪造五条相同 TeamCity ID 的 Build。 */
  async trigger(
    application: Application,
    config: TeamCityClientConfig,
    userId: string,
  ) {
    if (!application.pipelineBuildTypeId)
      throw new BadRequestException("仓库流水线尚未创建");
    const remote = await this.teamCity.queueBuild(
      config,
      application.pipelineBuildTypeId,
      application.releaseBranch,
    );
    if (!remote.id) throw new BadRequestException("TeamCity 未返回构建 ID");
    const build = await this.record(
      application,
      remote,
      TriggerType.API,
      userId,
    );
    return {
      builds: [
        {
          id: build.id,
          teamCityBuildId: build.teamCityBuildId,
          logUrl: build.logUrl,
        },
      ],
    };
  }

  /** 回调和补偿同步共用入口。以 TeamCity 的实际提交/终态为准，不信任回调的 SUCCESS 字样。 */
  async ingest(
    applicationId: string,
    buildId: string,
    payload: unknown,
    config: TeamCityClientConfig,
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });
    if (!application?.pipelineBuildTypeId)
      throw new NotFoundException("Repository pipeline not found");
    const remote = await this.teamCity.getBuildById(config, buildId);
    if (!remote || remote.buildType?.id !== application.pipelineBuildTypeId)
      throw new BadRequestException("构建不属于此仓库流水线");
    const build = await this.record(application, remote, TriggerType.VCS);
    if (build.publicationStatus === "VERIFIED")
      return { accepted: true as const, buildId: build.id, images: 0 };
    const parsed = repositoryResultSchema.safeParse(payload);
    if (!parsed.success) throw new BadRequestException("仓库制品清单格式无效");
    const result = parsed.data;
    const snapshot = build.definitionSnapshotJson as {
      definition?: unknown;
      sha256?: string;
    } | null;
    const definition = pipelineDefinitionSchema.parse(snapshot?.definition);
    if (
      result.definitionSha256 !== snapshot?.sha256 ||
      result.commitSha !== build.commitSha
    )
      throw new BadRequestException("制品清单的配置/提交身份不匹配");
    // 部分推送只保存证据，不创建 AVAILABLE 镜像；report 在 TC 最后一步执行时，先等待 TC 真正结束。
    const recorded = await this.prisma.$transaction(async (tx) => {
      // 条件更新保护并发迟到回调：已经登记的完整版本不得被旧 PARTIAL 清单降级。
      const updated = await tx.build.updateMany({
        where: { id: build.id, publicationStatus: { not: "VERIFIED" } },
        data: {
          artifactManifestJson: result as unknown as Prisma.InputJsonValue,
          publicationStatus:
            result.publicationStatus === "PARTIAL"
              ? "PARTIAL"
              : result.publicationStatus === "VERIFIED"
                ? "PENDING_VERIFY"
                : "NONE",
        },
      });
      if (!updated.count) return false;
      for (const stage of result.stages)
        await tx.buildStage.upsert({
          where: { buildId_code: { buildId: build.id, code: stage.code } },
          create: {
            buildId: build.id,
            code: stage.code,
            status: stage.status,
            startedAt: stage.startedAt ? new Date(stage.startedAt) : null,
            finishedAt: stage.finishedAt ? new Date(stage.finishedAt) : null,
          },
          update: {
            status: stage.status,
            finishedAt: stage.finishedAt ? new Date(stage.finishedAt) : null,
          },
        });
      return true;
    });
    if (!recorded)
      return { accepted: true as const, buildId: build.id, images: 0 };
    if (
      remote.state !== "finished" ||
      remote.status !== "SUCCESS" ||
      remote.canceledInfo
    )
      return { accepted: true as const, buildId: build.id, images: 0 };
    try {
      assertCompleteRepositoryResult(
        result,
        definition,
        snapshot?.sha256 ?? "",
        build.commitSha,
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "制品校验失败",
      );
    }
    const connection = application.registryConnectionId
      ? await this.prisma.registryConnection.findUnique({
          where: { id: application.registryConnectionId },
        })
      : null;
    if (!connection?.enabled) throw new BadRequestException("TCR 连接未启用");
    const [username, password] = await Promise.all([
      this.credentials.resolve(connection.usernameCredentialId, [
        CredentialType.REGISTRY_USERNAME,
      ]),
      this.credentials.resolve(connection.passwordCredentialId, [
        CredentialType.REGISTRY_PASSWORD,
      ]),
    ]);
    for (const image of result.images) {
      const actual = await this.registry.getManifestDigest(
        {
          registryUrl: connection.registryUrl,
          username,
          password,
          verifySsl: connection.verifySsl,
        },
        connection.namespace,
        image.repository,
        image.tag,
      );
      if (actual !== image.digest)
        throw new BadRequestException(`TCR 摘要不匹配：${image.componentCode}`);
    }
    const components = await this.prisma.component.findMany({
      where: { applicationId },
    });
    const byCode = new Map(
      components.map((component) => [component.code, component]),
    );
    if (result.images.some((image) => !byCode.has(image.componentCode)))
      throw new BadRequestException("构建组件记录已缺失");
    // 全部远端校验完成后才在同一事务登记，避免第三个镜像失败却出现半套可用版本。
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.build.findUniqueOrThrow({
        where: { id: build.id },
      });
      if (current.publicationStatus === "VERIFIED") return;
      for (const image of result.images) {
        const componentId = byCode.get(image.componentCode)!.id;
        const fullName = `${new URL(connection.registryUrl).host}/${connection.namespace}/${image.repository}:${image.tag}`;
        const data = {
          buildId: build.id,
          registry: new URL(connection.registryUrl).host,
          namespace: connection.namespace,
          repository: image.repository,
          tag: image.tag,
          digest: image.digest!,
          fullName,
          commitSha: result.commitSha,
          buildNumber: remote.number ?? "",
          status: ImageStatus.AVAILABLE,
        };
        await tx.imageVersion.upsert({
          where: { componentId_fullName: { componentId, fullName } },
          create: { componentId, ...data },
          update: data,
        });
      }
      await tx.build.update({
        where: { id: build.id },
        data: { publicationStatus: "VERIFIED" },
      });
    });
    return {
      accepted: true as const,
      buildId: build.id,
      images: result.images.length,
    };
  }

  /** 读取归档结果即可补登记；不会重新执行测试、镜像构建或推送。 */
  async sync(application: Application, config: TeamCityClientConfig) {
    if (!application.pipelineBuildTypeId) return;
    const remotes = await this.teamCity.listBuildsByBuildType(
      config,
      application.pipelineBuildTypeId,
      20,
    );
    for (const remote of remotes) {
      try {
        const build = await this.record(application, remote, TriggerType.VCS);
        if (
          remote.state === "finished" &&
          build.publicationStatus !== "VERIFIED"
        ) {
          const result = await this.teamCity.getPipelineResult(
            config,
            String(remote.id),
          );
          if (result)
            await this.ingest(
              application.id,
              String(remote.id),
              result,
              config,
            );
        }
      } catch {
        // 单个历史失败/部分推送结果不能阻塞其他批次的补偿；不记录可能含凭据的上游异常正文。
        this.logger.warn(
          `Repository result verification pending: ${String(remote.id)}`,
        );
      }
    }
  }

  /** 构建快照优先采用 TC 记录的生成参数；当前应用配置不能覆盖旧批次的版本身份。 */
  private async record(
    application: Application,
    remote: TeamCityBuildResponse,
    triggerType: TriggerType,
    userId?: string,
  ) {
    const props = new Map(
      (remote.resultingProperties?.property ?? []).map((item) => [
        item.name,
        item.value,
      ]),
    );
    const definition = props.get("env.DELIVERY_HUB_DEFINITION_JSON");
    const snapshot = {
      definition: definition
        ? JSON.parse(definition)
        : application.pipelineDefinitionJson,
      sha256:
        props.get("env.DELIVERY_HUB_DEFINITION_SHA256") ??
        application.pipelineDefinitionSha256,
    };
    const status = remote.canceledInfo
      ? BuildStatus.CANCELED
      : remote.state === "finished"
        ? remote.status === "SUCCESS"
          ? BuildStatus.SUCCESS
          : BuildStatus.FAILED
        : remote.state === "running"
          ? BuildStatus.RUNNING
          : BuildStatus.QUEUED;
    const data = {
      teamCityBuildNumber: remote.number ?? "",
      branch: remote.branchName ?? application.releaseBranch,
      commitSha: remote.revisions?.revision?.[0]?.version ?? "pending",
      status,
      logUrl: remote.webUrl ?? null,
      startedAt: teamCityDate(remote.startDate),
      finishedAt: teamCityDate(remote.finishDate),
      durationSeconds:
        remote.startDate && remote.finishDate
          ? Math.max(
              0,
              Math.round(
                ((teamCityDate(remote.finishDate)?.getTime() ?? 0) -
                  (teamCityDate(remote.startDate)?.getTime() ?? 0)) /
                  1000,
              ),
            )
          : null,
    };
    return this.prisma.build.upsert({
      where: { teamCityBuildId: String(remote.id) },
      create: {
        ...data,
        applicationId: application.id,
        componentId: null,
        teamCityBuildId: String(remote.id),
        triggerType,
        triggeredBy: userId,
        publicationStatus: "PENDING",
        definitionSnapshotJson: snapshot as Prisma.InputJsonValue,
      },
      update: data,
    });
  }
}

/** TeamCity 使用紧凑时区日期；无效日期保持缺失，不能用当前时间伪造启动/完成证据。 */
function teamCityDate(value?: string): Date | null {
  if (!value) return null;
  const normalized = value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/,
    "$1-$2-$3T$4:$5:$6$7:$8",
  );
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
