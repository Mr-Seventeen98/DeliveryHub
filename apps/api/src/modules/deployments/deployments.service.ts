import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AuditResult,
  CredentialType,
  DeploymentStatus,
  ImageStatus,
  ServerStatus,
} from "@prisma/client";
import { isMap, parseDocument } from "yaml";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CredentialsService } from "../credentials/credentials.service";
import { GitLabProjectsService } from "../gitlab/gitlab-projects.service";
import { ServersService } from "../servers/servers.service";
import { SshExecutorService } from "../servers/ssh-executor.service";
import type { CreateDeploymentDto } from "./dto/create-deployment.dto";

const deploymentInclude = {
  imageVersion: {
    include: {
      component: { include: { application: true } },
    },
  },
  server: {
    select: {
      id: true,
      name: true,
      sshAlias: true,
      environment: true,
    },
  },
  deploymentDirectory: {
    select: { id: true, name: true, path: true },
  },
  createdBy: {
    select: { id: true, username: true, displayName: true },
  },
} as const;

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly ssh: SshExecutorService,
    private readonly servers: ServersService,
    private readonly audit: AuditService,
    private readonly gitLabProjects: GitLabProjectsService,
  ) {}

  list() {
    return this.prisma.deployment.findMany({
      include: deploymentInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async create(dto: CreateDeploymentDto, userId: string, requestId: string) {
    const [imageVersion, directory, server] = await Promise.all([
      this.prisma.imageVersion.findUnique({
        where: { id: dto.imageVersionId },
        include: {
          component: {
            include: {
              application: { include: { registryConnection: true } },
            },
          },
        },
      }),
      this.prisma.applicationDeploymentDirectory.findUnique({
        where: { id: dto.deploymentDirectoryId },
      }),
      this.prisma.server.findUnique({ where: { id: dto.serverId } }),
    ]);

    if (!imageVersion || imageVersion.status !== ImageStatus.AVAILABLE)
      throw new NotFoundException("Deployable image version not found");
    validateDeploymentRelationship(
      imageVersion.component.applicationId,
      directory,
      server,
    );
    if (!directory || !server)
      throw new BadRequestException("Invalid deployment selection");
    const onlineServer = await this.servers.ensureOnline(server.id);
    validateDeploymentSelection(
      imageVersion.component.applicationId,
      directory,
      onlineServer,
    );

    const registry = imageVersion.component.application.registryConnection;
    if (!registry)
      throw new BadRequestException(
        "The image application has no registry connection",
      );
    const application = imageVersion.component.application;
    if (!server.sshAlias)
      throw new BadRequestException(
        "Deployment target has no SSH Config alias",
      );
    const composeFile = await this.resolveComposeFile({
      dto,
      applicationId: application.id,
      gitLabProjectId: application.gitLabProjectId,
      releaseBranch: application.releaseBranch,
      targetSshAlias: server.sshAlias,
      targetDirectoryPath: directory.path,
    });
    if (!composeFile.content.trim())
      throw new BadRequestException("Docker Compose 文件内容不能为空");
    const updatedComposeFileContent = updateComposeServiceImage(
      composeFile.content,
      dto.serviceName,
      imageVersion.fullName,
    );
    const deployment = await this.prisma.deployment.create({
      data: {
        imageVersionId: imageVersion.id,
        serverId: server.id,
        deploymentDirectoryId: directory.id,
        serviceName: dto.serviceName,
        imageFullName: imageVersion.fullName,
        createdById: userId,
      },
      include: deploymentInclude,
    });

    await this.prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: DeploymentStatus.RUNNING, startedAt: new Date() },
    });

    try {
      await this.ssh.verifyDirectory(
        server.sshAlias,
        directory.path,
        dto.sudoPassword,
      );
      const [registryUsername, registryPassword] = await Promise.all([
        this.credentials.resolve(registry.usernameCredentialId, [
          CredentialType.REGISTRY_USERNAME,
        ]),
        this.credentials.resolve(registry.passwordCredentialId, [
          CredentialType.REGISTRY_PASSWORD,
        ]),
      ]);
      const result = await this.ssh.runScript(
        server.sshAlias,
        buildDockerComposeDeploymentScript({
          directory: directory.path,
          serviceName: dto.serviceName,
          imageFullName: imageVersion.fullName,
          registryHost: registry.registryUrl.replace(/^https?:\/\//, ""),
          registryUsername,
          registryPassword,
          composeFilePath: composeFile.path,
          composeFileContent: updatedComposeFileContent,
          composeFileSource: dto.composeFileSource,
        }),
        dto.sudoPassword,
      );
      const completed = await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.SUCCESS,
          output: result.output,
          finishedAt: new Date(),
        },
        include: deploymentInclude,
      });
      await this.audit
        .record({
          userId,
          action: "deployment.execute",
          resourceType: "deployment",
          resourceId: deployment.id,
          requestId,
          after: {
            imageVersionId: imageVersion.id,
            imageFullName: imageVersion.fullName,
            serverId: server.id,
            directory: directory.path,
            environment: directory.environment,
            composeFilePath: composeFile.path,
            composeFileSource: dto.composeFileSource,
            serviceName: dto.serviceName,
            status: DeploymentStatus.SUCCESS,
          },
          result: AuditResult.SUCCESS,
        })
        .catch(() => undefined);
      return completed;
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Deployment failed";
      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: DeploymentStatus.FAILED,
          errorMessage: message,
          finishedAt: new Date(),
        },
      });
      await this.audit
        .record({
          userId,
          action: "deployment.execute",
          resourceType: "deployment",
          resourceId: deployment.id,
          requestId,
          after: {
            imageVersionId: imageVersion.id,
            serverId: server.id,
            serviceName: dto.serviceName,
            status: DeploymentStatus.FAILED,
          },
          result: AuditResult.FAILED,
          errorMessage: message,
        })
        .catch(() => undefined);
      throw reason;
    }
  }

  private async resolveComposeFile({
    dto,
    applicationId,
    gitLabProjectId,
    releaseBranch,
    targetSshAlias,
    targetDirectoryPath,
  }: {
    dto: CreateDeploymentDto;
    applicationId: string;
    gitLabProjectId: string;
    releaseBranch: string;
    targetSshAlias: string;
    targetDirectoryPath: string;
  }): Promise<{ path: string; content: string }> {
    if (dto.composeFileSource === "SERVER") {
      return this.ssh.readComposeFile(
        targetSshAlias,
        targetDirectoryPath,
        dto.composeFilePath,
        dto.sudoPassword,
      );
    }
    if (dto.composeFileSource === "OTHER_ENVIRONMENT") {
      if (!dto.sourceDeploymentDirectoryId)
        throw new BadRequestException("缺少 Compose 来源环境目录");
      const source =
        await this.prisma.applicationDeploymentDirectory.findUnique({
          where: { id: dto.sourceDeploymentDirectoryId },
          include: { server: true },
        });
      if (
        !source?.enabled ||
        source.applicationId !== applicationId ||
        !source.server?.enabled ||
        !source.server.sshAlias
      ) {
        throw new BadRequestException("Compose 来源环境目录无效");
      }
      await this.servers.ensureOnline(source.server.id);
      return this.ssh.readComposeFile(
        source.server.sshAlias,
        source.path,
        dto.composeFilePath,
        dto.sudoPassword,
      );
    }
    if (dto.composeFileSource === "INLINE") {
      if (!dto.composeFileContent?.trim())
        throw new BadRequestException("请在线编辑或上传 Docker Compose 内容");
      if (Buffer.byteLength(dto.composeFileContent, "utf8") > 1024 * 1024)
        throw new BadRequestException("Docker Compose 文件不能超过 1 MiB");
      return { path: dto.composeFilePath, content: dto.composeFileContent };
    }
    return this.gitLabProjects.getComposeFile(
      gitLabProjectId,
      releaseBranch,
      dto.composeFilePath,
    );
  }
}

export function validateDeploymentSelection(
  applicationId: string,
  directory: {
    applicationId: string;
    enabled: boolean;
    serverId?: string | null;
  } | null,
  server: { id: string; enabled: boolean; status: ServerStatus } | null,
): void {
  validateDeploymentRelationship(applicationId, directory, server);
  if (server?.status !== ServerStatus.ONLINE)
    throw new BadRequestException("Select an online deployment target");
}

function validateDeploymentRelationship(
  applicationId: string,
  directory: {
    applicationId: string;
    enabled: boolean;
    serverId?: string | null;
  } | null,
  server: { id: string; enabled: boolean } | null,
): void {
  if (!directory?.enabled || directory.applicationId !== applicationId)
    throw new BadRequestException(
      "Select a deployment directory configured for this application",
    );
  if (!server?.enabled)
    throw new BadRequestException("Select an enabled deployment target");
  if (directory.serverId && directory.serverId !== server.id)
    throw new BadRequestException(
      "Select the deployment target configured for this directory",
    );
}

interface DockerComposeDeployment {
  directory: string;
  serviceName: string;
  imageFullName: string;
  registryHost: string;
  registryUsername: string;
  registryPassword: string;
  composeFilePath: string;
  composeFileContent: string;
  composeFileSource: "SERVER" | "OTHER_ENVIRONMENT" | "REPOSITORY" | "INLINE";
}

export function buildDockerComposeDeploymentScript(
  deployment: DockerComposeDeployment,
): string {
  const composeFileName = deployment.composeFilePath.split("/").at(-1);
  if (
    !composeFileName ||
    !/^(?:compose|docker-compose)\.ya?ml$/i.test(composeFileName)
  )
    throw new BadRequestException("Invalid Docker Compose file path");
  const requireExistingComposeFile =
    deployment.composeFileSource === "SERVER"
      ? [
          "test -f \"$compose_file\" || { echo '线上 Compose 文件不存在' >&2; exit 1; }",
        ]
      : [];
  return [
    "set -eu",
    `cd ${shellQuote(deployment.directory)}`,
    "command -v docker >/dev/null 2>&1 || { echo '目标服务器未安装 Docker' >&2; exit 1; }",
    "docker compose version >/dev/null 2>&1 || { echo '目标服务器不可用 docker compose' >&2; exit 1; }",
    `compose_file=${shellQuote(composeFileName)}`,
    ...requireExistingComposeFile,
    `service=${shellQuote(deployment.serviceName)}`,
    'compose_tmp=".${compose_file}.delivery-hub.tmp"',
    'compose_backup=".${compose_file}.delivery-hub.backup"',
    "had_original=0",
    'if [ -f "$compose_file" ]; then had_original=1; fi',
    'rollback_compose() { rm -f "$compose_tmp"; if [ "$had_original" = 1 ]; then if [ -f "$compose_backup" ]; then mv -f "$compose_backup" "$compose_file"; fi; else rm -f "$compose_file"; fi; }',
    "trap rollback_compose EXIT HUP INT TERM",
    `printf '%s' ${shellQuote(deployment.composeFileContent)} > "$compose_tmp"`,
    "docker compose -f \"$compose_tmp\" config >/dev/null || { echo '更新后的 Compose 文件校验失败' >&2; exit 1; }",
    'docker compose -f "$compose_tmp" config --services | grep -qxF "$service" || { echo \'Compose 服务不存在\' >&2; exit 1; }',
    'if [ "$had_original" = 1 ]; then cp -p "$compose_file" "$compose_backup"; fi',
    'mv -f "$compose_tmp" "$compose_file"',
    `printf '%s' ${shellQuote(deployment.registryPassword)} | docker login ${shellQuote(deployment.registryHost)} --username ${shellQuote(deployment.registryUsername)} --password-stdin >/dev/null`,
    'docker compose -f "$compose_file" pull "$service"',
    'docker compose -f "$compose_file" up -d --no-deps "$service"',
    'rm -f "$compose_backup"',
    "trap - EXIT HUP INT TERM",
    'docker compose -f "$compose_file" ps "$service"',
  ].join("\n");
}

export function updateComposeServiceImage(
  content: string,
  serviceName: string,
  imageFullName: string,
): string {
  const document = parseDocument(content);
  if (document.errors.length > 0)
    throw new BadRequestException("Docker Compose 文件格式无效");
  const services = document.get("services", true);
  if (!isMap(services))
    throw new BadRequestException("Docker Compose 文件缺少 services 配置");
  const service = services.get(serviceName, true);
  if (!isMap(service))
    throw new BadRequestException(`Compose 服务 ${serviceName} 不存在`);
  service.set("image", imageFullName);
  return document.toString({ lineWidth: 0 });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
