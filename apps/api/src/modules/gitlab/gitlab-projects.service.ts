import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CredentialType, Prisma, SyncStatus } from "@prisma/client";
import { GitLabClient } from "../../adapters/gitlab/gitlab.client";
import { PrismaService } from "../../database/prisma.service";
import { CredentialsService } from "../credentials/credentials.service";
import type { GitLabProjectQueryDto } from "./dto/gitlab-project-query.dto";

@Injectable()
export class GitLabProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly client: GitLabClient,
  ) {}

  async list(query: GitLabProjectQueryDto): Promise<{
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Prisma.GitLabProjectWhereInput = {
      syncStatus: SyncStatus.ACTIVE,
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: "insensitive" } },
              {
                pathWithNamespace: {
                  contains: query.keyword,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
      ...(query.group
        ? {
            namespaceName: {
              contains: query.group,
              mode: "insensitive",
            },
          }
        : {}),
      ...(query.importStatus ? { importStatus: query.importStatus } : {}),
      ...(query.archived === undefined ? {} : { archived: query.archived }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.gitLabProject.findMany({
        where,
        include: {
          gitLabInstance: { select: { id: true, name: true } },
          teamCityVcsRoots: {
            where: { active: true },
            select: {
              id: true,
              name: true,
              teamCityProjectId: true,
              teamCityProjectName: true,
              teamCityConnection: {
                select: { id: true, name: true, baseUrl: true },
              },
            },
          },
        },
        orderBy: [{ lastActivityAt: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.gitLabProject.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<unknown> {
    const project = await this.prisma.gitLabProject.findUnique({
      where: { id },
      include: {
        gitLabInstance: { select: { id: true, name: true } },
        teamCityVcsRoots: {
          where: { active: true },
          include: {
            teamCityConnection: {
              select: { id: true, name: true, baseUrl: true },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundException("GitLab project not found");
    return project;
  }

  async listBranches(id: string): Promise<{
    items: Array<{ name: string; default: boolean; protected: boolean }>;
  }> {
    const { project, config } = await this.getRepositoryAccess(id);
    const branches = [];
    for (let page = 1; page <= 1000; page += 1) {
      const items = await this.client.listBranchesPage(
        config,
        project.gitLabProjectId,
        page,
        100,
      );
      branches.push(...items);
      if (items.length < 100) break;
    }
    return {
      items: branches
        .map((branch) => ({
          name: branch.name,
          default:
            branch.default === true || branch.name === project.defaultBranch,
          protected: branch.protected === true,
        }))
        .sort(
          (left, right) =>
            Number(right.default) - Number(left.default) ||
            left.name.localeCompare(right.name),
        ),
    };
  }

  async listDockerfiles(
    id: string,
    requestedRef?: string,
  ): Promise<{
    ref: string;
    items: Array<{ id: string; name: string; path: string }>;
  }> {
    const { project, config } = await this.getRepositoryAccess(id);
    const ref = requestedRef?.trim() || project.defaultBranch;
    if (!ref) throw new NotFoundException("GitLab project has no branch");
    const tree = [];
    for (let page = 1; page <= 1000; page += 1) {
      const items = await this.client.listRepositoryTreePage(
        config,
        project.gitLabProjectId,
        ref,
        page,
        100,
      );
      tree.push(...items);
      if (items.length < 100) break;
    }
    return {
      ref,
      items: tree
        .filter(
          (item) =>
            item.type === "blob" &&
            (/(^|\/)dockerfile(?:\.[^/]+)?$/i.test(item.path) ||
              /\.dockerfile$/i.test(item.path)),
        )
        .map(({ id: itemId, name, path }) => ({ id: itemId, name, path }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  async listComposeFiles(
    id: string,
    requestedRef?: string,
  ): Promise<{
    ref: string;
    items: Array<{ id: string; name: string; path: string }>;
  }> {
    const { project, config } = await this.getRepositoryAccess(id);
    const ref = requestedRef?.trim() || project.defaultBranch;
    if (!ref) throw new NotFoundException("GitLab project has no branch");
    const tree = [];
    for (let page = 1; page <= 1000; page += 1) {
      const items = await this.client.listRepositoryTreePage(
        config,
        project.gitLabProjectId,
        ref,
        page,
        100,
      );
      tree.push(...items);
      if (items.length < 100) break;
    }
    return {
      ref,
      items: tree
        .filter((item) => item.type === "blob" && isComposeFilePath(item.path))
        .map(({ id: itemId, name, path }) => ({ id: itemId, name, path }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  async getComposeFile(
    id: string,
    requestedRef: string | undefined,
    path: string,
  ): Promise<{ ref: string; path: string; content: string }> {
    if (!isComposeFilePath(path))
      throw new BadRequestException("Invalid Docker Compose file path");
    const { project, config } = await this.getRepositoryAccess(id);
    const ref = requestedRef?.trim() || project.defaultBranch;
    if (!ref) throw new NotFoundException("GitLab project has no branch");
    const content = await this.client.getRepositoryFileRaw(
      config,
      project.gitLabProjectId,
      ref,
      path,
    );
    if (Buffer.byteLength(content, "utf8") > 1024 * 1024)
      throw new BadRequestException("Docker Compose file exceeds 1 MiB");
    if (content.includes("\0"))
      throw new BadRequestException(
        "Docker Compose file contains invalid data",
      );
    return { ref, path, content };
  }

  async scanRepository(
    id: string,
    requestedRef?: string,
  ): Promise<{
    ref: string;
    featureFiles: Array<{ path: string; kind: string }>;
    componentSuggestions: Array<{
      name: string;
      directory: string;
      dockerfilePath: string;
      type: string;
      evidence: string[];
    }>;
  }> {
    const { project, config } = await this.getRepositoryAccess(id);
    const ref = requestedRef?.trim() || project.defaultBranch;
    if (!ref) throw new NotFoundException("GitLab project has no branch");
    const tree = [];
    for (let page = 1; page <= 1000; page += 1) {
      const items = await this.client.listRepositoryTreePage(
        config,
        project.gitLabProjectId,
        ref,
        page,
        100,
      );
      tree.push(...items);
      if (items.length < 100) break;
    }
    const blobs = tree.filter((item) => item.type === "blob");
    const featureFiles = blobs
      .map((item) => ({ path: item.path, kind: featureFileKind(item.path) }))
      .filter((item): item is { path: string; kind: string } =>
        Boolean(item.kind),
      );
    const dockerfiles = blobs.filter(
      (item) =>
        /(^|\/)dockerfile(?:\.[^/]+)?$/i.test(item.path) ||
        /\.dockerfile$/i.test(item.path),
    );
    const componentSuggestions = dockerfiles.map((dockerfile) => {
      const separator = dockerfile.path.lastIndexOf("/");
      const directory =
        separator >= 0 ? dockerfile.path.slice(0, separator) : ".";
      const localFeatures = featureFiles.filter((feature) => {
        const featureDirectory = feature.path.includes("/")
          ? feature.path.slice(0, feature.path.lastIndexOf("/"))
          : ".";
        return featureDirectory === directory || featureDirectory === ".";
      });
      const kinds = localFeatures.map((feature) => feature.kind);
      const type = kinds.includes("Node.js")
        ? "Node.js"
        : kinds.includes("Java")
          ? "Java"
          : kinds.includes("Python")
            ? "Python"
            : kinds.includes("Go")
              ? "Go"
              : "Docker";
      return {
        name:
          directory === "."
            ? "root"
            : (directory.split("/").filter(Boolean).at(-1) ?? "component"),
        directory,
        dockerfilePath: dockerfile.path,
        type,
        evidence: localFeatures.map((feature) => feature.path),
      };
    });
    return { ref, featureFiles, componentSuggestions };
  }

  private async getRepositoryAccess(id: string): Promise<{
    project: {
      gitLabProjectId: number;
      defaultBranch: string;
      gitLabInstance: {
        apiUrl: string;
        tokenCredentialId: string;
        verifySsl: boolean;
      };
    };
    config: { apiUrl: string; token: string; verifySsl: boolean };
  }> {
    const project = await this.prisma.gitLabProject.findUnique({
      where: { id },
      select: {
        gitLabProjectId: true,
        defaultBranch: true,
        gitLabInstance: {
          select: {
            apiUrl: true,
            tokenCredentialId: true,
            verifySsl: true,
          },
        },
      },
    });
    if (!project) throw new NotFoundException("GitLab project not found");
    const token = await this.credentials.resolve(
      project.gitLabInstance.tokenCredentialId,
      [CredentialType.GITLAB_TOKEN],
    );
    return {
      project,
      config: {
        apiUrl: project.gitLabInstance.apiUrl,
        token,
        verifySsl: project.gitLabInstance.verifySsl,
      },
    };
  }
}

function isComposeFilePath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.split("/").includes("..") &&
    /(^|\/)(?:compose|docker-compose)\.ya?ml$/i.test(path)
  );
}

function featureFileKind(path: string): string | null {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (["package.json", "pnpm-lock.yaml", "yarn.lock"].includes(name))
    return "Node.js";
  if (["pom.xml", "build.gradle", "build.gradle.kts"].includes(name))
    return "Java";
  if (["requirements.txt", "pyproject.toml", "pipfile"].includes(name))
    return "Python";
  if (name === "go.mod") return "Go";
  if (["docker-compose.yml", "docker-compose.yaml"].includes(name))
    return "Docker Compose";
  return null;
}
