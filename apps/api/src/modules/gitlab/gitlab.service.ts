import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  CredentialType,
  SyncStatus,
  type GitLabInstance,
} from "@prisma/client";
import { GitLabClient } from "../../adapters/gitlab/gitlab.client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";
import type {
  CreateGitLabConnectionDto,
  UpdateGitLabConnectionDto,
} from "./dto/gitlab-connection.dto";

@Injectable()
export class GitLabService {
  private readonly logger = new Logger(GitLabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly client: GitLabClient,
  ) {}

  create(dto: CreateGitLabConnectionDto): Promise<GitLabInstance> {
    return this.prisma.gitLabInstance.create({
      data: {
        name: dto.name,
        baseUrl: dto.baseUrl.replace(/\/$/, ""),
        apiUrl: dto.apiUrl.replace(/\/$/, ""),
        tokenCredentialId: dto.tokenCredentialId,
        verifySsl: dto.verifySsl ?? true,
        syncEnabled: dto.syncEnabled ?? true,
        syncIntervalMinutes: dto.syncIntervalMinutes ?? 30,
      },
    });
  }

  list(): Promise<GitLabInstance[]> {
    return this.prisma.gitLabInstance.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  async get(id: string): Promise<GitLabInstance> {
    const connection = await this.prisma.gitLabInstance.findUnique({
      where: { id },
    });
    if (!connection) throw new NotFoundException("GitLab connection not found");
    return connection;
  }

  async update(
    id: string,
    dto: UpdateGitLabConnectionDto,
  ): Promise<GitLabInstance> {
    await this.get(id);
    return this.prisma.gitLabInstance.update({
      where: { id },
      data: {
        ...dto,
        baseUrl: dto.baseUrl?.replace(/\/$/, ""),
        apiUrl: dto.apiUrl?.replace(/\/$/, ""),
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.gitLabInstance.delete({ where: { id } });
  }

  async test(id: string): Promise<{ username: string; name: string }> {
    const connection = await this.get(id);
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.GITLAB_TOKEN,
    ]);
    try {
      const result = await this.client.testConnection({
        apiUrl: connection.apiUrl,
        token,
        verifySsl: connection.verifySsl,
      });
      await this.prisma.gitLabInstance.update({
        where: { id },
        data: { lastSyncStatus: "connection_ok" },
      });
      return { username: result.username, name: result.name };
    } catch (error) {
      await this.prisma.gitLabInstance.update({
        where: { id },
        data: { lastSyncStatus: "connection_failed" },
      });
      throw error;
    }
  }

  async sync(id: string): Promise<{ synced: number; unavailable: number }> {
    const connection = await this.get(id);
    const token = await this.credentials.resolve(connection.tokenCredentialId, [
      CredentialType.GITLAB_TOKEN,
    ]);
    await this.prisma.gitLabInstance.update({
      where: { id },
      data: { lastSyncStatus: "running" },
    });

    try {
      const projectIds: number[] = [];
      const perPage = 100;
      for (let pageNumber = 1; pageNumber <= 1000; pageNumber += 1) {
        const projects = await this.client.listProjectsPage(
          {
            apiUrl: connection.apiUrl,
            token,
            verifySsl: connection.verifySsl,
          },
          pageNumber,
          perPage,
        );
        if (projects.length === 0) break;
        projectIds.push(...projects.map((project) => project.id));
        await this.prisma.$transaction(
          projects.map((project) =>
            this.prisma.gitLabProject.upsert({
              where: {
                gitLabInstanceId_gitLabProjectId: {
                  gitLabInstanceId: id,
                  gitLabProjectId: project.id,
                },
              },
              create: {
                gitLabInstanceId: id,
                gitLabProjectId: project.id,
                name: project.name,
                path: project.path,
                pathWithNamespace: project.path_with_namespace,
                namespaceName:
                  project.namespace.full_path ?? project.namespace.name,
                webUrl: project.web_url,
                httpCloneUrl: project.http_url_to_repo,
                sshCloneUrl: project.ssh_url_to_repo,
                defaultBranch: project.default_branch ?? "",
                visibility: project.visibility ?? "private",
                description: project.description,
                archived: project.archived ?? false,
                lastActivityAt: project.last_activity_at
                  ? new Date(project.last_activity_at)
                  : null,
                syncStatus: SyncStatus.ACTIVE,
              },
              update: {
                name: project.name,
                path: project.path,
                pathWithNamespace: project.path_with_namespace,
                namespaceName:
                  project.namespace.full_path ?? project.namespace.name,
                webUrl: project.web_url,
                httpCloneUrl: project.http_url_to_repo,
                sshCloneUrl: project.ssh_url_to_repo,
                defaultBranch: project.default_branch ?? "",
                visibility: project.visibility ?? "private",
                description: project.description,
                archived: project.archived ?? false,
                lastActivityAt: project.last_activity_at
                  ? new Date(project.last_activity_at)
                  : null,
                syncStatus: SyncStatus.ACTIVE,
              },
            }),
          ),
        );
        if (projects.length < perPage) break;
      }

      const unavailable = await this.prisma.gitLabProject.updateMany({
        where: {
          gitLabInstanceId: id,
          ...(projectIds.length > 0
            ? { gitLabProjectId: { notIn: projectIds } }
            : {}),
        },
        data: { syncStatus: SyncStatus.MISSING },
      });
      await this.prisma.gitLabInstance.update({
        where: { id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: `success:${projectIds.length}`,
        },
      });
      return { synced: projectIds.length, unavailable: unavailable.count };
    } catch (error) {
      this.logger.error(
        `GitLab project sync failed for connection ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.prisma.gitLabInstance.update({
        where: { id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: "failed",
        },
      });
      throw error;
    }
  }

  async syncStatus(id: string): Promise<{
    status: string | null;
    lastSyncAt: Date | null;
    projectCount: number;
  }> {
    const connection = await this.get(id);
    const projectCount = await this.prisma.gitLabProject.count({
      where: { gitLabInstanceId: id, syncStatus: SyncStatus.ACTIVE },
    });
    return {
      status: connection.lastSyncStatus,
      lastSyncAt: connection.lastSyncAt,
      projectCount,
    };
  }
}
