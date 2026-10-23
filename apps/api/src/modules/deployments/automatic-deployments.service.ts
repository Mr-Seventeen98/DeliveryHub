/** 整套自动发布：轮询已经原子验收的构建，以数据库租约和唯一记录补偿回调/进程中断。 */
import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { CredentialType, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";
import { GitLabProjectsService } from "../gitlab/gitlab-projects.service";
import { SshExecutorService } from "../servers/ssh-executor.service";

const codes = ["api", "worker", "migration", "web", "visualization"];
const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

/** 清单只接受同一完整源码提交的五个 AVAILABLE 镜像；输出固定摘要引用，禁止浮动 tag 部署。 */
export function releaseImages(
  commitSha: string,
  images: Array<{
    status: string;
    commitSha: string;
    fullName: string;
    digest: string | null;
    component: { code: string };
  }>,
) {
  if (
    !/^[0-9a-f]{40}$/.test(commitSha) ||
    images.length !== codes.length ||
    new Set(images.map((i) => i.component.code)).size !== codes.length
  )
    throw new BadRequestException("整套发布要求同一提交的五个组件");
  return Object.fromEntries(
    images.map((image) => {
      if (
        !codes.includes(image.component.code) ||
        image.status !== "AVAILABLE" ||
        image.commitSha !== commitSha ||
        !/^sha256:[0-9a-f]{64}$/.test(image.digest ?? "") ||
        !/^[a-zA-Z0-9._:/-]+:[a-zA-Z0-9._-]+$/.test(image.fullName)
      )
        throw new BadRequestException("发布镜像缺少有效摘要或提交身份不匹配");
      return [
        image.component.code,
        {
          fullName: image.fullName,
          digest: image.digest!,
          pinned: `${image.fullName.slice(0, image.fullName.lastIndexOf(":"))}@${image.digest}`,
        },
      ];
    }),
  );
}

@Injectable()
export class AutomaticDeploymentsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomaticDeploymentsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly repositories: GitLabProjectsService,
    private readonly ssh: SshExecutorService,
  ) {}

  onModuleInit(): void {
    // 与现有构建同步解耦：即使回调响应丢失或 API 重启，VERIFIED 的数据库记录仍会被下一轮发现。
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn("Automatic deployment scan failed"),
      );
    }, 15_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  listPolicies() {
    return this.prisma.applicationDeploymentDirectory.findMany({
      where: { autoDeployRunnerPath: { not: null } },
      select: {
        id: true,
        name: true,
        path: true,
        environment: true,
        autoDeployEnabled: true,
        autoDeployBranch: true,
        autoDeployRunnerPath: true,
        autoDeployEnabledAt: true,
        application: { select: { name: true } },
        server: { select: { name: true, sshAlias: true } },
      },
    });
  }
  list() {
    return this.prisma.repositoryDeployment.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: {
        build: {
          select: {
            teamCityBuildId: true,
            teamCityBuildNumber: true,
            commitSha: true,
            branch: true,
            application: { select: { name: true } },
          },
        },
        deploymentDirectory: {
          select: {
            name: true,
            path: true,
            environment: true,
            server: { select: { name: true, sshAlias: true } },
          },
        },
      },
    });
  }

  /** 更新策略只影响后续开始的构建，启用/重新配置不会自动发布旧历史；服务端再次验证目标归属。 */
  async configure(
    id: string,
    enabled: boolean,
    branch: string,
    runnerPath: string,
  ) {
    const directory =
      await this.prisma.applicationDeploymentDirectory.findUnique({
        where: { id },
        include: { application: true, server: true },
      });
    if (
      !directory?.enabled ||
      !directory.server?.enabled ||
      directory.server.status !== "ONLINE" ||
      !directory.server.sshAlias ||
      directory.application.ciExecutionMode !== "REPOSITORY_PIPELINE"
    )
      throw new BadRequestException(
        "自动部署要求可用的仓库流水线、服务器和部署目录",
      );
    if (
      branch !== directory.application.releaseBranch ||
      branch.startsWith("refs/") ||
      !/^scripts\/[a-zA-Z0-9_/-]+\.py$/.test(runnerPath) ||
      runnerPath.split("/").includes("..")
    )
      throw new BadRequestException(
        "发布分支必须等于应用发布分支，执行器必须为 scripts 内的 Python 文件",
      );
    if (directory.deployLeaseUntil && directory.deployLeaseUntil > new Date())
      throw new BadRequestException("正在部署，等待结束后再修改策略");
    return this.prisma.applicationDeploymentDirectory.update({
      where: { id },
      data: {
        autoDeployEnabled: enabled,
        autoDeployBranch: branch,
        autoDeployRunnerPath: runnerPath,
        autoDeployEnabledAt: new Date(),
      },
    });
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const directories =
        await this.prisma.applicationDeploymentDirectory.findMany({
          where: { enabled: true, autoDeployEnabled: true },
          select: { id: true },
        });
      for (const directory of directories)
        await this.process(directory.id).catch(() =>
          this.logger.warn(
            `Automatic deployment requires attention: ${directory.id}`,
          ),
        );
    } finally {
      this.running = false;
    }
  }

  private async process(id: string): Promise<void> {
    const token = randomUUID();
    // 租约长于 SSH 最大执行时间。进程丢失后下一实例可重新调用同一收据；远端锁不随本地租约释放。
    const claim = await this.prisma.applicationDeploymentDirectory.updateMany({
      where: {
        id,
        enabled: true,
        autoDeployEnabled: true,
        OR: [
          { deployLeaseUntil: null },
          { deployLeaseUntil: { lt: new Date() } },
        ],
      },
      data: {
        deployLeaseToken: token,
        deployLeaseUntil: new Date(Date.now() + 15 * 60_000),
      },
    });
    if (!claim.count) return;
    try {
      await this.execute(id);
    } finally {
      await this.prisma.applicationDeploymentDirectory.updateMany({
        where: { id, deployLeaseToken: token },
        data: { deployLeaseToken: null, deployLeaseUntil: null },
      });
    }
  }

  private async execute(id: string): Promise<void> {
    const directory =
      await this.prisma.applicationDeploymentDirectory.findUniqueOrThrow({
        where: { id },
        include: {
          server: true,
          application: { include: { registryConnection: true } },
        },
      });
    if (
      !directory.enabled ||
      !directory.autoDeployEnabled ||
      !directory.autoDeployEnabledAt ||
      !directory.server?.enabled ||
      directory.server.status !== "ONLINE" ||
      !directory.server.sshAlias
    )
      return;
    // 只选择最新的合格源码构建；迟到回调和历史归档不能让环境退回旧构建。
    const build = await this.prisma.build.findFirst({
      where: {
        applicationId: directory.applicationId,
        componentId: null,
        branch: {
          in: [
            directory.autoDeployBranch,
            `refs/heads/${directory.autoDeployBranch}`,
          ],
        },
        status: "SUCCESS",
        publicationStatus: "VERIFIED",
        startedAt: { gte: directory.autoDeployEnabledAt },
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      include: {
        images: { include: { component: { select: { code: true } } } },
      },
    });
    if (!build) return;
    const images = releaseImages(build.commitSha, build.images);
    const release = await this.prisma.repositoryDeployment.upsert({
      where: {
        deploymentDirectoryId_buildId: {
          deploymentDirectoryId: id,
          buildId: build.id,
        },
      },
      create: {
        deploymentDirectoryId: id,
        buildId: build.id,
        manifestJson: {},
      },
      update: {},
    });
    // FAILED 不静默重试，避免再次改动需要人工检查的环境；RUNNING 在租约过期后回读远端幂等收据。
    if (release.status === "SUCCESS" || release.status === "FAILED") return;
    const manifest = {
      schemaVersion: 1,
      releaseId: release.id,
      buildId: build.teamCityBuildId,
      commitSha: build.commitSha,
      directory: directory.path,
      images,
    };
    await this.prisma.repositoryDeployment.update({
      where: { id: release.id },
      data: {
        status: "RUNNING",
        startedAt: release.startedAt ?? new Date(),
        manifestJson: manifest as Prisma.InputJsonValue,
      },
    });
    try {
      const registry = directory.application.registryConnection;
      if (!registry?.enabled) throw new Error("发布 Registry 不可用");
      const runner = await this.repositories.getDeploymentRunner(
        directory.application.gitLabProjectId,
        build.commitSha,
        directory.autoDeployRunnerPath!,
      );
      const username = await this.credentials.resolve(
        registry.usernameCredentialId,
        [CredentialType.REGISTRY_USERNAME],
      );
      const password = await this.credentials.resolve(
        registry.passwordCredentialId,
        [CredentialType.REGISTRY_PASSWORD],
      );
      const script = deploymentCommand(
        runner,
        manifest,
        registry.registryUrl,
        username,
        password,
      );
      const result = await this.ssh.runScript(
        directory.server.sshAlias,
        script,
      );
      const receipt = JSON.parse(
        result.output.trim().split("\n").at(-1) ?? "null",
      ) as { status?: string; commitSha?: string; buildId?: string } | null;
      if (
        receipt?.status !== "SUCCESS" ||
        receipt.commitSha !== build.commitSha ||
        receipt.buildId !== build.teamCityBuildId
      )
        throw new Error("远端发布收据身份不匹配");
      await this.prisma.repositoryDeployment.update({
        where: { id: release.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          output: JSON.stringify(receipt, null, 2),
        },
      });
    } catch (error) {
      // SSH 超时不证明远端已停止：FAILED 提示检查远端收据，下一构建仍受远端锁和单调构建号保护。
      const message =
        error instanceof Error ? error.message : "Automatic deployment failed";
      await this.prisma.repositoryDeployment.update({
        where: { id: release.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: message.slice(-2000),
        },
      });
    }
  }
}

/** 凭据只进入 SSH 标准输入和 0700 临时 Docker 登录目录，不写数据库快照、命令参数或发布输出。 */
export function deploymentCommand(
  runner: string,
  manifest: unknown,
  registry: string,
  username: string,
  password: string,
): string {
  const encodedRunner = Buffer.from(runner).toString("base64");
  const encodedManifest = Buffer.from(JSON.stringify(manifest)).toString(
    "base64",
  );
  return `set -eu
umask 077
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM
export DOCKER_CONFIG="$temp_dir/docker"
mkdir "$DOCKER_CONFIG"
printf %s ${quote(password)} | docker login ${quote(registry.replace(/^https?:\/\//, "").replace(/\/$/, ""))} --username ${quote(username)} --password-stdin >/dev/null 2>&1
python3 - "$temp_dir" <<'DELIVERY_HUB_DATA'
import base64, pathlib, sys
p=pathlib.Path(sys.argv[1])
(p/'runner.py').write_bytes(base64.b64decode('${encodedRunner}'))
(p/'manifest.json').write_bytes(base64.b64decode('${encodedManifest}'))
DELIVERY_HUB_DATA
python3 "$temp_dir/runner.py" "$temp_dir/manifest.json"
`;
}
