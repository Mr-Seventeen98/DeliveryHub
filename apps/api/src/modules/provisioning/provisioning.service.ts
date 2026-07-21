import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApplicationStatus,
  AuditResult,
  CredentialType,
  ExternalResourceStatus,
  ImportStatus,
  ProvisionStatus,
  ProvisionStepStatus,
  RegistryType,
  TeamCityResourceType,
  type Component,
  type Prisma,
} from "@prisma/client";
import { GitLabClient } from "../../adapters/gitlab/gitlab.client";
import { ExternalApiException } from "../../adapters/external-api.exception";
import {
  TeamCityClient,
  type TeamCityClientConfig,
} from "../../adapters/teamcity/teamcity.client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CredentialsService } from "../credentials/credentials.service";
import { normalizeRepositoryUrl } from "../teamcity/teamcity-repository";
import { deriveTeamCityCallbackToken } from "../builds/build-callback-token";
import type { CreateCiConfigurationDto } from "./dto/create-ci-configuration.dto";

const IMAGE_REGISTRY = "ccr.ccs.tencentyun.com";
const IMAGE_NAMESPACE = "fc17_dev";
const TEAMCITY_GITLAB_SSH_KEY = "haoyu-gitlab";

export interface ProvisioningResult {
  taskId: string;
  applicationId: string;
  teamCityGroup: { id: string; name: string; url: string };
  components: Array<{
    name: string;
    projectId: string;
    buildTypeId: string;
    url: string;
    queuedBuildId?: number;
  }>;
  createdResources: number;
  reusedResources: number;
}

export interface ExistingCiConfigurationResult {
  configured: boolean;
  configuration: {
    applicationId: string;
    releaseBranch: string;
    teamCityConnectionId: string;
    teamCityGroupId: string;
    teamCityGroupName: string;
    autoBuildEnabled: boolean;
    components: Array<{
      id: string;
      name: string;
      dockerfilePath: string;
      buildContext: string;
      imageRepository: string;
      teamCityBuildTypeId: string | null;
    }>;
  } | null;
}

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly gitLab: GitLabClient,
    private readonly teamCity: TeamCityClient,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  async getByGitLabProject(
    gitLabProjectId: string,
  ): Promise<ExistingCiConfigurationResult> {
    const application = await this.prisma.application.findFirst({
      where: { gitLabProjectId },
      orderBy: { updatedAt: "desc" },
      include: {
        components: {
          where: { enabled: true },
          orderBy: { createdAt: "asc" },
        },
        teamCityResources: {
          where: {
            componentId: null,
            resourceType: TeamCityResourceType.PROJECT,
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!application) return { configured: false, configuration: null };

    const group = application.teamCityResources[0];
    const teamCityGroupId =
      application.teamCityProjectId ?? group?.resourceExternalId;
    if (!teamCityGroupId)
      return { configured: false, configuration: null };

    return {
      configured: true,
      configuration: {
        applicationId: application.id,
        releaseBranch: application.releaseBranch,
        teamCityConnectionId: application.teamCityConnectionId,
        teamCityGroupId,
        teamCityGroupName: group?.resourceName ?? application.name,
        autoBuildEnabled: application.autoBuildEnabled,
        components: application.components.map((component) => ({
          id: component.id,
          name: component.name,
          dockerfilePath: component.dockerfilePath,
          buildContext: component.buildContext,
          imageRepository: component.imageRepository,
          teamCityBuildTypeId: component.teamCityBuildTypeId,
        })),
      },
    };
  }

  async provision(
    dto: CreateCiConfigurationDto,
    userId: string,
    requestId: string,
    queueJobId?: string,
  ): Promise<ProvisioningResult> {
    this.validateRequest(dto);
    const [project, connection] = await Promise.all([
      this.prisma.gitLabProject.findUnique({
        where: { id: dto.gitLabProjectId },
        include: { gitLabInstance: true },
      }),
      this.prisma.teamCityConnection.findUnique({
        where: { id: dto.teamCityConnectionId },
      }),
    ]);
    if (!project) throw new NotFoundException("GitLab project not found");
    if (!connection?.enabled)
      throw new NotFoundException("TeamCity connection not found");

    const [gitLabToken, teamCityToken] = await Promise.all([
      this.credentials.resolve(project.gitLabInstance.tokenCredentialId, [
        CredentialType.GITLAB_TOKEN,
      ]),
      this.credentials.resolve(connection.tokenCredentialId, [
        CredentialType.TEAMCITY_TOKEN,
      ]),
    ]);
    await this.validateDockerfiles(
      project.gitLabInstance.apiUrl,
      project.gitLabInstance.verifySsl,
      gitLabToken,
      project.gitLabProjectId,
      dto.releaseBranch,
      dto.components.map((component) => component.dockerfilePath),
    );

    const applicationCode = `app-${stableToken(project.pathWithNamespace)}`;
    const existingApplication = await this.prisma.application.findFirst({
      where: {
        gitLabProjectId: project.id,
        teamCityConnectionId: connection.id,
      },
    });
    const registryConnection = await this.prisma.registryConnection.findFirst({
      where: {
        registryType: RegistryType.TENCENT_TCR,
        registryUrl: `https://${IMAGE_REGISTRY}`,
        namespace: IMAGE_NAMESPACE,
        enabled: true,
      },
      select: { id: true },
    });
    const application = existingApplication
      ? await this.prisma.application.update({
          where: { id: existingApplication.id },
          data: {
            name: project.name,
            releaseBranch: dto.releaseBranch,
            autoBuildEnabled: dto.autoBuildEnabled,
            registryConnectionId:
              existingApplication.registryConnectionId ?? registryConnection?.id,
            status: ApplicationStatus.CONFIGURING,
          },
        })
      : await this.prisma.application.create({
          data: {
            gitLabProjectId: project.id,
            name: project.name,
            code: applicationCode,
            releaseBranch: dto.releaseBranch,
            autoBuildEnabled: dto.autoBuildEnabled,
            teamCityConnectionId: connection.id,
            registryConnectionId: registryConnection?.id,
            status: ApplicationStatus.CONFIGURING,
            createdById: userId,
          },
        });

    const components = await this.saveComponents(application.id, dto);
    const taskData = {
      applicationId: application.id,
      status: ProvisionStatus.RUNNING,
      currentStep: "prepare_teamcity_group",
      progressPercent: 5,
      requestSnapshotJson: dto as unknown as Prisma.InputJsonValue,
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: null,
      createdById: userId,
    } satisfies Prisma.CiProvisionTaskUncheckedCreateInput;
    const task = queueJobId
      ? await this.prisma.ciProvisionTask.upsert({
          where: { queueJobId },
          create: { ...taskData, queueJobId },
          update: taskData,
        })
      : await this.prisma.ciProvisionTask.create({ data: taskData });

    const config: TeamCityClientConfig = {
      baseUrl: connection.baseUrl,
      token: teamCityToken,
      verifySsl: connection.verifySsl,
    };
    const callbackToken = deriveTeamCityCallbackToken(
      this.configService.getOrThrow<string>("APP_SECRET_KEY"),
      connection.id,
    );
    const callbackUrl = `${this.configService
      .getOrThrow<string>("PUBLIC_CALLBACK_BASE_URL")
      .replace(/\/$/, "")}/api/v1/integrations/teamcity/build-callback`;
    let activeStepCode = "prepare_teamcity_group";
    try {
      let createdResources = 0;
      let reusedResources = 0;
      const group = await this.runStep(
        task.id,
        activeStepCode,
        "创建或复用 TeamCity 组",
        async () => {
          const groupId =
            dto.teamCityGroupMode === "existing"
              ? dto.teamCityGroupId!
              : `DeliveryHub_${stableToken(`${connection.parentProjectId}-${dto.teamCityGroupName!}`)}`;
          const existing = await this.teamCity.getProjectById(config, groupId);
          if (existing) {
            reusedResources += 1;
            return existing;
          }
          if (dto.teamCityGroupMode === "existing") {
            throw new BadRequestException("所选 TeamCity 组已不存在，请刷新后重选");
          }
          createdResources += 1;
          return this.teamCity.createProject(config, {
            id: groupId,
            name: dto.teamCityGroupName!,
            parentProjectId: connection.parentProjectId,
          });
        },
      );
      await this.saveResource(
        application.id,
        null,
        TeamCityResourceType.PROJECT,
        group.id,
        group.name,
        { role: "group" },
      );

      const results: ProvisioningResult["components"] = [];
      for (const [index, component] of components.entries()) {
        activeStepCode = `component_${index + 1}`;
        await this.prisma.ciProvisionTask.update({
          where: { id: task.id },
          data: {
            currentStep: activeStepCode,
            progressPercent: 10 + Math.floor((index / components.length) * 80),
          },
        });
        const created = await this.runStep(
          task.id,
          activeStepCode,
          `配置 ${component.name}`,
          async () => {
            const prefix = `${group.id}_${stableToken(`${project.pathWithNamespace}-${component.dockerfilePath}`)}`;
            const projectId = `${prefix}_Project`;
            const vcsRootId = `${prefix}_GitLab`;
            const buildTypeId = `${prefix}_Build`;

            const childProject = await this.teamCity.getProjectById(
              config,
              projectId,
            );
            if (childProject) {
              reusedResources += 1;
              if (childProject.name !== component.name)
                await this.teamCity.updateProjectName(
                  config,
                  projectId,
                  component.name,
                );
            }
            else {
              createdResources += 1;
              await this.teamCity.createProject(config, {
                id: projectId,
                name: component.name,
                parentProjectId: group.id,
              });
            }
            await this.saveResource(
              application.id,
              component.id,
              TeamCityResourceType.PROJECT,
              projectId,
              component.name,
              { role: "component-project", parentProjectId: group.id },
            );

            const vcsRootInput = {
              id: vcsRootId,
              name: `${project.pathWithNamespace} (${dto.releaseBranch})`,
              projectId,
              repositoryUrl: project.sshCloneUrl,
              branch: dto.releaseBranch,
              authMode: "TEAMCITY_SSH_KEY" as const,
              sshKeyName: TEAMCITY_GITLAB_SSH_KEY,
            };
            const vcsRoot = await this.teamCity.getVcsRootById(config, vcsRootId);
            if (vcsRoot) reusedResources += 1;
            else {
              createdResources += 1;
              await this.teamCity.createVcsRoot(config, vcsRootInput);
            }
            if (vcsRoot)
              await this.teamCity.updateVcsRoot(config, vcsRootInput);
            await this.saveResource(
              application.id,
              component.id,
              TeamCityResourceType.VCS_ROOT,
              vcsRootId,
              `${project.pathWithNamespace} (${dto.releaseBranch})`,
              {
                repositoryUrl: project.sshCloneUrl,
                authentication: `TeamCity SSH Key: ${TEAMCITY_GITLAB_SSH_KEY}`,
              },
            );
            const normalized = normalizeRepositoryUrl(project.sshCloneUrl);
            await this.prisma.teamCityVcsRoot.upsert({
              where: {
                teamCityConnectionId_externalId: {
                  teamCityConnectionId: connection.id,
                  externalId: vcsRootId,
                },
              },
              create: {
                teamCityConnectionId: connection.id,
                externalId: vcsRootId,
                name: `${project.pathWithNamespace} (${dto.releaseBranch})`,
                teamCityProjectId: projectId,
                teamCityProjectName: component.name,
                repositoryUrl: project.sshCloneUrl,
                normalizedRepository: normalized?.full ?? project.sshCloneUrl,
                gitLabProjectId: project.id,
                active: true,
                lastSeenAt: new Date(),
              },
              update: {
                name: `${project.pathWithNamespace} (${dto.releaseBranch})`,
                teamCityProjectId: projectId,
                teamCityProjectName: component.name,
                repositoryUrl: project.sshCloneUrl,
                normalizedRepository: normalized?.full ?? project.sshCloneUrl,
                gitLabProjectId: project.id,
                active: true,
                lastSeenAt: new Date(),
              },
            });

            const buildType = await this.teamCity.getBuildTypeById(
              config,
              buildTypeId,
            );
            if (buildType) reusedResources += 1;
            else {
              createdResources += 1;
              await this.teamCity.createBuildType(config, {
                id: buildTypeId,
                name: "Build and Push Image",
                projectId,
                parameters: buildParameters(
                  component,
                  application.id,
                  connection.id,
                  callbackUrl,
                  callbackToken,
                ),
                steps: buildSteps(),
                autoBuildEnabled: dto.autoBuildEnabled,
                releaseBranch: dto.releaseBranch,
              });
            }
            if (buildType) {
              await this.teamCity.updateBuildParameters(
                config,
                buildTypeId,
                buildParameters(
                  component,
                  application.id,
                  connection.id,
                  callbackUrl,
                  callbackToken,
                ),
              );
              await this.teamCity.updateBuildSteps(
                config,
                buildTypeId,
                buildSteps(),
              );
              await this.teamCity.updateBuildTriggers(
                config,
                buildTypeId,
                dto.autoBuildEnabled,
                dto.releaseBranch,
              );
            }
            const attached = await this.teamCity.hasVcsRootEntry(
              config,
              buildTypeId,
              vcsRootId,
            );
            if (!attached)
              await this.teamCity.attachVcsRoot(config, buildTypeId, vcsRootId);
            await this.saveResource(
              application.id,
              component.id,
              TeamCityResourceType.BUILD_TYPE,
              buildTypeId,
              "Build and Push Image",
              {
                dockerfilePath: component.dockerfilePath,
                buildContext: component.buildContext,
                image: `${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/${component.imageRepository}`,
              },
            );
            await this.prisma.component.update({
              where: { id: component.id },
              data: { teamCityBuildTypeId: buildTypeId },
            });

            const queued = dto.runFirstBuild
              ? await this.teamCity.queueBuild(
                  config,
                  buildTypeId,
                  dto.releaseBranch,
                )
              : undefined;
            return {
              name: component.name,
              projectId,
              buildTypeId,
              url: `${connection.baseUrl}/buildConfiguration/${encodeURIComponent(buildTypeId)}`,
              ...(queued?.id ? { queuedBuildId: queued.id } : {}),
            };
          },
        );
        results.push(created);
      }

      const result: ProvisioningResult = {
        taskId: task.id,
        applicationId: application.id,
        teamCityGroup: {
          id: group.id,
          name: group.name,
          url: `${connection.baseUrl}/project.html?projectId=${encodeURIComponent(group.id)}`,
        },
        components: results,
        createdResources,
        reusedResources,
      };
      await this.prisma.$transaction([
        this.prisma.application.update({
          where: { id: application.id },
          data: {
            teamCityProjectId: group.id,
            status: ApplicationStatus.ACTIVE,
          },
        }),
        this.prisma.gitLabProject.update({
          where: { id: project.id },
          data: { importStatus: ImportStatus.IMPORTED },
        }),
        this.prisma.ciProvisionTask.update({
          where: { id: task.id },
          data: {
            status: ProvisionStatus.SUCCESS,
            currentStep: "completed",
            progressPercent: 100,
            resultJson: result as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        }),
      ]);
      await this.audit.record({
        userId,
        action: "ci_configuration.create",
        resourceType: "application",
        resourceId: application.id,
        requestId,
        result: AuditResult.SUCCESS,
        after: result as unknown as Prisma.InputJsonValue,
      });
      return result;
    } catch (error) {
      const message = safeErrorMessage(error);
      this.logger.error(`CI provisioning task ${task.id} failed: ${message}`);
      await this.prisma.$transaction([
        this.prisma.application.update({
          where: { id: application.id },
          data: { status: ApplicationStatus.ERROR },
        }),
        this.prisma.ciProvisionTask.update({
          where: { id: task.id },
          data: {
            status: ProvisionStatus.FAILED,
            currentStep: activeStepCode,
            errorMessage: message,
            finishedAt: new Date(),
          },
        }),
      ]);
      await this.audit.record({
        userId,
        action: "ci_configuration.create",
        resourceType: "application",
        resourceId: application.id,
        requestId,
        result: AuditResult.FAILED,
        errorMessage: message,
      });
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException(`CI/CD 配置失败：${message}`);
    }
  }

  private validateRequest(dto: CreateCiConfigurationDto): void {
    if (dto.teamCityGroupMode === "existing" && !dto.teamCityGroupId?.trim())
      throw new BadRequestException("请选择 TeamCity 组");
    if (dto.teamCityGroupMode === "new" && !dto.teamCityGroupName?.trim())
      throw new BadRequestException("请输入新组名称");
    const dockerfiles = new Set(dto.components.map((item) => item.dockerfilePath));
    const names = new Set(dto.components.map((item) => item.name.trim()));
    const images = new Set(dto.components.map((item) => item.imageRepository));
    if (dockerfiles.size !== dto.components.length)
      throw new BadRequestException("Dockerfile 不能重复选择");
    if (names.size !== dto.components.length)
      throw new BadRequestException("TeamCity 项目名称不能重复");
    if (images.size !== dto.components.length)
      throw new BadRequestException("镜像名称不能重复");
  }

  private async validateDockerfiles(
    apiUrl: string,
    verifySsl: boolean,
    token: string,
    projectId: number,
    ref: string,
    paths: string[],
  ): Promise<void> {
    const found = new Set<string>();
    for (let page = 1; page <= 1000; page += 1) {
      const items = await this.gitLab.listRepositoryTreePage(
        { apiUrl, token, verifySsl },
        projectId,
        ref,
        page,
        100,
      );
      for (const item of items)
        if (item.type === "blob" && paths.includes(item.path))
          found.add(item.path);
      if (items.length < 100 || found.size === paths.length) break;
    }
    const missing = paths.filter((path) => !found.has(path));
    if (missing.length)
      throw new BadRequestException(
        `所选分支中找不到 Dockerfile：${missing.join("、")}`,
      );
  }

  private async saveComponents(
    applicationId: string,
    dto: CreateCiConfigurationDto,
  ): Promise<Component[]> {
    const codes = dto.components.map((item) => stableToken(item.dockerfilePath));
    await this.prisma.component.updateMany({
      where: { applicationId, code: { notIn: codes } },
      data: { enabled: false },
    });
    const result: Component[] = [];
    for (const item of dto.components) {
      const code = stableToken(item.dockerfilePath);
      const directory = posix.dirname(item.dockerfilePath);
      const buildContext = directory === "." ? "." : directory;
      result.push(
        await this.prisma.component.upsert({
          where: { applicationId_code: { applicationId, code } },
          create: {
            applicationId,
            name: item.name.trim(),
            code,
            sourceDirectory: buildContext,
            dockerfilePath: item.dockerfilePath,
            buildContext,
            imageRepository: item.imageRepository,
            enabled: true,
          },
          update: {
            name: item.name.trim(),
            sourceDirectory: buildContext,
            dockerfilePath: item.dockerfilePath,
            buildContext,
            imageRepository: item.imageRepository,
            enabled: true,
          },
        }),
      );
    }
    return result;
  }

  private async runStep<T>(
    taskId: string,
    stepCode: string,
    stepName: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const step = await this.prisma.ciProvisionStep.upsert({
      where: { taskId_stepCode: { taskId, stepCode } },
      create: {
        taskId,
        stepCode,
        stepName,
        status: ProvisionStepStatus.RUNNING,
        startedAt: new Date(),
      },
      update: {
        stepName,
        status: ProvisionStepStatus.RUNNING,
        errorMessage: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    });
    try {
      const result = await action();
      await this.prisma.ciProvisionStep.update({
        where: { id: step.id },
        data: {
          status: ProvisionStepStatus.SUCCESS,
          responseSummaryJson: sanitizeStepResult(result),
          finishedAt: new Date(),
        },
      });
      return result;
    } catch (error) {
      await this.prisma.ciProvisionStep.update({
        where: { id: step.id },
        data: {
          status: ProvisionStepStatus.FAILED,
          errorMessage: safeErrorMessage(error),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async saveResource(
    applicationId: string,
    componentId: string | null,
    resourceType: TeamCityResourceType,
    externalId: string,
    name: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.teamCityResource.upsert({
      where: {
        applicationId_resourceType_resourceExternalId: {
          applicationId,
          resourceType,
          resourceExternalId: externalId,
        },
      },
      create: {
        applicationId,
        componentId,
        resourceType,
        resourceExternalId: externalId,
        resourceName: name,
        lastVerifiedAt: new Date(),
        status: ExternalResourceStatus.ACTIVE,
        metadataJson: metadata,
      },
      update: {
        componentId,
        resourceName: name,
        lastVerifiedAt: new Date(),
        status: ExternalResourceStatus.ACTIVE,
        metadataJson: metadata,
      },
    });
  }
}

function stableToken(value: string): string {
  const readable = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const hash = createHash("sha1").update(value).digest("hex").slice(0, 10);
  return `${readable || "resource"}_${hash}`;
}

function buildParameters(
  component: Component,
  applicationId: string,
  teamCityConnectionId: string,
  callbackUrl: string,
  callbackToken: string,
): Array<{
  name: string;
  value: string;
  type?: { rawValue: string };
}> {
  return [
    { name: "env.IMAGE_REGISTRY", value: IMAGE_REGISTRY },
    { name: "env.IMAGE_NAMESPACE", value: IMAGE_NAMESPACE },
    { name: "env.IMAGE_REPOSITORY", value: component.imageRepository },
    { name: "env.DOCKERFILE_PATH", value: component.dockerfilePath },
    { name: "env.BUILD_CONTEXT", value: component.buildContext },
    { name: "env.DELIVERY_HUB_PROJECT_ID", value: applicationId },
    { name: "env.DELIVERY_HUB_COMPONENT_CODE", value: component.code },
    {
      name: "env.TEAMCITY_CONNECTION_ID",
      value: teamCityConnectionId,
    },
    { name: "env.DELIVERY_HUB_CALLBACK_URL", value: callbackUrl },
    {
      name: "env.DELIVERY_HUB_CALLBACK_TOKEN",
      value: callbackToken,
      type: { rawValue: "password display='normal'" },
    },
  ];
}

function buildSteps(): Array<{ id: string; name: string; script: string }> {
  const imageVariables = [
    'IMAGE_TAG="%build.vcs.number%"',
    'IMAGE_BASE="%env.IMAGE_REGISTRY%/%env.IMAGE_NAMESPACE%/%env.IMAGE_REPOSITORY%"',
    'IMAGE="${IMAGE_BASE}:${IMAGE_TAG}"',
  ].join("\n");
  return [
    {
      id: "build_image",
      name: "Build image",
      script: `set -eu\n${imageVariables}\ndocker build --pull --rm -f "%env.DOCKERFILE_PATH%" -t "${"${IMAGE}"}" "%env.BUILD_CONTEXT%"`,
    },
    {
      id: "push_image",
      name: "Push image",
      script: `set -eu\n${imageVariables}\nprintf '%s' "%env.TCR_PASSWORD%" | docker login --username "%env.TCR_USERNAME%" --password-stdin "%env.IMAGE_REGISTRY%"\ndocker push "${"${IMAGE}"}"\nDIGEST="$(docker image inspect "${"${IMAGE}"}" --format '{{join .RepoDigests "\\n"}}' | grep "^%env.IMAGE_REGISTRY%/%env.IMAGE_NAMESPACE%/%env.IMAGE_REPOSITORY%@" | head -n 1 | sed 's/.*@//')"\nFINISHED_AT="$(date -u -Iseconds)"\nfor ATTEMPT in 1 2 3; do\n  curl -fsS -X POST \\\n    -H 'Content-Type: application/json' \\\n    -H "Authorization: Bearer %env.DELIVERY_HUB_CALLBACK_TOKEN%" \\\n    --data-binary @- \\\n    "%env.DELIVERY_HUB_CALLBACK_URL%" <<JSON && break\n{"teamcity_connection_id":"%env.TEAMCITY_CONNECTION_ID%","delivery_project_id":"%env.DELIVERY_HUB_PROJECT_ID%","teamcity_build_id":"%teamcity.build.id%","build_number":"%build.number%","status":"SUCCESS","branch":"%teamcity.build.branch%","commit_sha":"%build.vcs.number%","finished_at":"${"${FINISHED_AT}"}","images":[{"component_code":"%env.DELIVERY_HUB_COMPONENT_CODE%","registry":"%env.IMAGE_REGISTRY%","namespace":"%env.IMAGE_NAMESPACE%","repository":"%env.IMAGE_REPOSITORY%","tag":"${"${IMAGE_TAG}"}","digest":"${"${DIGEST}"}"}]}\nJSON\n  if [ "${"${ATTEMPT}"}" = 3 ]; then echo 'Delivery Hub callback failed after 3 attempts' >&2; else sleep 2; fi\ndone`,
    },
    {
      id: "record_image_metadata",
      name: "Record image metadata",
      script: `set -eu\n${imageVariables}\nDIGEST="$(docker image inspect "${"${IMAGE}"}" --format '{{join .RepoDigests "\\n"}}' | grep "^%env.IMAGE_REGISTRY%/%env.IMAGE_NAMESPACE%/%env.IMAGE_REPOSITORY%@" | head -n 1 | sed 's/.*@//')"\necho "##teamcity[setParameter name='env.DELIVERY_HUB_IMAGE_DIGEST' value='${"${DIGEST}"}']"\necho "##teamcity[setParameter name='env.DELIVERY_HUB_IMAGE_TAG' value='${"${IMAGE_TAG}"}']"`,
    },
    {
      id: "cleanup_image",
      name: "Cleanup image",
      script: `set -eu\n${imageVariables}\ndocker image rm "${"${IMAGE}"}" || true`,
    },
  ];
}

function sanitizeStepResult(value: unknown): Prisma.InputJsonValue {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, item]) =>
        !/(password|token|secret)/i.test(key) &&
        ["string", "number", "boolean"].includes(typeof item),
    ),
  ) as Prisma.InputJsonValue;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ExternalApiException) {
    const response = error.getResponse();
    if (response && typeof response === "object") {
      const payload = response as {
        message?: string;
        details?: { statusCode?: number; response?: string };
      };
      return [
        payload.message,
        payload.details?.statusCode
          ? `TeamCity HTTP ${payload.details.statusCode}`
          : undefined,
        payload.details?.response,
      ]
        .filter(Boolean)
        .join("：")
        .slice(0, 1000);
    }
  }
  if (error instanceof Error) return error.message.slice(0, 1000);
  return "unknown error";
}
