/**
 * 发布后真实 UAT 验收调度。只有部署成功且创建时已启用验收的记录才入队；
 * TeamCity 保管业务账号、执行浏览器并归档报告，Hub 通过回调通知和周期回读核对最终结果。
 * 验收失败不改写构建/镜像/部署成功状态，也不在未知业务影响下自动回滚。
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CredentialType, Prisma } from "@prisma/client";
import { TeamCityClient } from "../../adapters/teamcity/teamcity.client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";

const requiredChecks = [
  "release_identity_before",
  "login",
  "authorized_projects",
  "project_switch",
  "tenant_overview",
  "management_link",
  "map_runtime",
  "release_identity_after",
];

/** 回调令牌仅能通知这条发布记录回读；不能登录 Hub、修改策略或直接宣称验收通过。 */
export function acceptanceToken(secret: string, releaseId: string): string {
  return createHmac("sha256", secret)
    .update(`uat-acceptance:${releaseId}`)
    .digest("base64url");
}

/** 严格核验报告身份与必需检查，拒绝空报告、重复检查和用其他构建的成功报告覆盖当前发布。 */
export function validateAcceptanceResult(
  raw: unknown,
  expected: {
    releaseId: string;
    sourceBuildId: string;
    commitSha: string;
    teamCityBuildId: string;
  },
) {
  if (!raw || typeof raw !== "object") throw new Error("验收报告缺失");
  const value = raw as Record<string, unknown>;
  for (const [key, identity] of Object.entries(expected))
    if (value[key] !== identity) throw new Error("验收报告身份不匹配");
  if (
    value.schemaVersion !== 1 ||
    !["SUCCESS", "FAILED"].includes(String(value.status)) ||
    !Array.isArray(value.checks)
  )
    throw new Error("验收报告契约无效");
  const checks = value.checks as Array<{ name?: unknown; status?: unknown }>;
  if (
    checks.length > requiredChecks.length ||
    checks.some(
      (c) =>
        typeof c.name !== "string" ||
        !requiredChecks.includes(c.name) ||
        !["SUCCESS", "FAILED"].includes(String(c.status)),
    ) ||
    new Set(checks.map((c) => c.name)).size !== checks.length
  )
    throw new Error("验收检查项无效");
  if (
    value.status === "SUCCESS" &&
    (requiredChecks.some(
      (name) => !checks.some((c) => c.name === name && c.status === "SUCCESS"),
    ) ||
      checks.some((c) => c.status !== "SUCCESS"))
  )
    throw new Error("验收报告未完成全部必要检查");
  // 只持久化白名单元数据与检查状态；原始日志、HTTP 正文、账号及浏览器会话不进入 Hub 数据库。
  return {
    schemaVersion: 1,
    ...expected,
    status: String(value.status),
    checks: checks.map((c) => ({
      name: String(c.name).slice(0, 100),
      status: String(c.status),
    })),
  };
}

@Injectable()
export class UatAcceptanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UatAcceptanceService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly teamcity: TeamCityClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn("UAT acceptance scan requires attention"),
      );
    }, 15_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** 配置现有独立验收任务，只影响后续新建的发布；禁止误绑构建/发布任务形成递归执行。 */
  async configure(directoryId: string, buildTypeId: string | null) {
    const directory =
      await this.prisma.applicationDeploymentDirectory.findUniqueOrThrow({
        where: { id: directoryId },
        include: { application: { include: { teamCityConnection: true } } },
      });
    if (buildTypeId) {
      if (
        !/^[A-Za-z0-9_]+$/.test(buildTypeId) ||
        buildTypeId === directory.application.pipelineBuildTypeId
      )
        throw new BadRequestException("请选择独立的 UAT 验收任务");
      const connection = directory.application.teamCityConnection;
      const token = await this.credentials.resolve(
        connection.tokenCredentialId,
        [CredentialType.TEAMCITY_TOKEN],
      );
      const remote = await this.teamcity.getBuildTypeById(
        { baseUrl: connection.baseUrl, token, verifySsl: connection.verifySsl },
        buildTypeId,
      );
      if (
        !remote ||
        remote.project?.id !== directory.application.teamCityProjectId
      )
        throw new BadRequestException(
          "验收任务必须属于当前应用的 TeamCity 项目",
        );
    }
    return this.prisma.applicationDeploymentDirectory.update({
      where: { id: directoryId },
      data: { acceptanceBuildTypeId: buildTypeId },
    });
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const records = await this.prisma.repositoryDeployment.findMany({
        where: {
          status: "SUCCESS",
          acceptanceStatus: { in: ["PENDING", "QUEUED", "RUNNING"] },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: { id: true },
      });
      for (const record of records)
        await this.process(record.id).catch(() =>
          this.logger.warn(`UAT acceptance requires attention: ${record.id}`),
        );
    } finally {
      this.running = false;
    }
  }

  /** 回调只加速回读。构建最后一步发送通知时 TeamCity 可能尚未终结/归档，周期扫描负责补偿。 */
  async callback(
    id: string,
    authorization: string | undefined,
    buildId: string,
  ) {
    const supplied = Buffer.from(
      authorization?.startsWith("Bearer ") ? authorization.slice(7) : "",
    );
    const expected = Buffer.from(
      acceptanceToken(this.config.getOrThrow<string>("APP_SECRET_KEY"), id),
    );
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new UnauthorizedException("Invalid acceptance callback token");
    const release = await this.prisma.repositoryDeployment.findUniqueOrThrow({
      where: { id },
    });
    if (release.acceptanceTeamCityBuildId !== buildId)
      throw new BadRequestException("验收构建身份不匹配");
    await this.process(id);
    return { accepted: true };
  }

  private async process(id: string) {
    const lease = randomUUID();
    const claim = await this.prisma.repositoryDeployment.updateMany({
      where: {
        id,
        status: "SUCCESS",
        acceptanceStatus: { in: ["PENDING", "QUEUED", "RUNNING"] },
        OR: [
          { acceptanceLeaseUntil: null },
          { acceptanceLeaseUntil: { lt: new Date() } },
        ],
      },
      data: {
        acceptanceLeaseToken: lease,
        acceptanceLeaseUntil: new Date(Date.now() + 3 * 60_000),
      },
    });
    if (!claim.count) return;
    try {
      await this.synchronize(id);
    } finally {
      await this.prisma.repositoryDeployment.updateMany({
        where: { id, acceptanceLeaseToken: lease },
        data: { acceptanceLeaseToken: null, acceptanceLeaseUntil: null },
      });
    }
  }

  private async synchronize(id: string) {
    const release = await this.prisma.repositoryDeployment.findUniqueOrThrow({
      where: { id },
      include: {
        build: true,
        deploymentDirectory: {
          include: { application: { include: { teamCityConnection: true } } },
        },
      },
    });
    if (release.status !== "SUCCESS" || !release.acceptanceBuildTypeId) return;
    if (
      release.acceptanceStartedAt &&
      Date.now() - release.acceptanceStartedAt.getTime() > 30 * 60_000
    ) {
      await this.fail(id, "UAT 验收超过 30 分钟，请检查 TeamCity 任务");
      return;
    }
    const connection =
      release.deploymentDirectory.application.teamCityConnection;
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.TEAMCITY_TOKEN,
    ]);
    const client = {
      baseUrl: connection.baseUrl,
      token,
      verifySsl: connection.verifySsl,
    };
    let buildId = release.acceptanceTeamCityBuildId;
    if (!buildId) {
      // 首次先落开始时间；中断后保留 PENDING，并在下一轮查找远端同 release 的队列/构建。
      await this.prisma.repositoryDeployment.update({
        where: { id },
        data: {
          acceptanceStartedAt: release.acceptanceStartedAt ?? new Date(),
        },
      });
      const recovered = await this.teamcity.findAcceptanceBuild(
        client,
        release.acceptanceBuildTypeId,
        id,
      );
      const queued =
        recovered ??
        (await this.teamcity.queueAcceptanceBuild(client, {
          buildTypeId: release.acceptanceBuildTypeId,
          branch: release.build.branch,
          commitSha: release.build.commitSha,
          releaseId: id,
          sourceBuildId: release.build.teamCityBuildId!,
          callbackUrl: `${this.config.getOrThrow<string>("PUBLIC_CALLBACK_BASE_URL").replace(/\/$/, "")}/api/v1/deployments/repository-releases/${id}/acceptance-callback`,
          callbackToken: acceptanceToken(
            this.config.getOrThrow<string>("APP_SECRET_KEY"),
            id,
          ),
        }));
      buildId = String(queued.id);
      await this.prisma.repositoryDeployment.update({
        where: { id },
        data: {
          acceptanceTeamCityBuildId: buildId,
          acceptanceStatus: "QUEUED",
          acceptanceErrorMessage: null,
        },
      });
    }
    const remote = await this.teamcity.getBuildById(client, buildId);
    if (!remote || remote.buildType?.id !== release.acceptanceBuildTypeId) {
      await this.fail(id, "TeamCity 验收任务不存在或归属不匹配");
      return;
    }
    if (remote.state !== "finished") {
      await this.prisma.repositoryDeployment.update({
        where: { id },
        data: {
          acceptanceStatus: remote.state === "running" ? "RUNNING" : "QUEUED",
        },
      });
      return;
    }
    // 真实 TC 终态与报告同时成立才可通过；失败报告仍回传检查状态，方便区分部署与业务失败。
    if (
      !remote.revisions?.revision?.some(
        (r) => r.version === release.build.commitSha,
      )
    ) {
      await this.fail(id, "TeamCity 验收 checkout 与已部署源码不匹配");
      return;
    }
    const raw = await this.teamcity.getAcceptanceResult(client, buildId);
    if (!raw) {
      await this.fail(id, "TeamCity 验收已结束但未归档结果报告");
      return;
    }
    try {
      const result = validateAcceptanceResult(raw, {
        releaseId: id,
        sourceBuildId: release.build.teamCityBuildId!,
        commitSha: release.build.commitSha,
        teamCityBuildId: buildId,
      });
      const passed =
        remote.status === "SUCCESS" &&
        !remote.canceledInfo &&
        result.status === "SUCCESS";
      await this.prisma.repositoryDeployment.update({
        where: { id },
        data: {
          acceptanceStatus: passed ? "SUCCESS" : "FAILED",
          acceptanceResultJson: result as Prisma.InputJsonValue,
          acceptanceFinishedAt: new Date(),
          acceptanceErrorMessage: passed
            ? null
            : "真实 UAT 浏览器验收未通过，请查看 TeamCity 报告与截图",
        },
      });
    } catch {
      await this.fail(id, "验收报告身份或必要检查不完整");
    }
  }

  private fail(id: string, message: string) {
    return this.prisma.repositoryDeployment.update({
      where: { id },
      data: {
        acceptanceStatus: "FAILED",
        acceptanceErrorMessage: message,
        acceptanceFinishedAt: new Date(),
      },
    });
  }
}
