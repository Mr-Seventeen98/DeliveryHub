import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ExternalApiException } from "../external-api.exception";
import { ExternalHttpClient } from "../external-http.client";

export interface GitLabClientConfig {
  apiUrl: string;
  token: string;
  verifySsl: boolean;
}

interface GitLabUser {
  id: number;
  username: string;
  name: string;
}

export interface GitLabProjectResponse {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  namespace: { name: string; full_path?: string };
  web_url: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  default_branch: string | null;
  visibility?: string;
  description: string | null;
  archived?: boolean;
  last_activity_at: string | null;
}

export interface GitLabBranchResponse {
  name: string;
  default?: boolean;
  protected?: boolean;
}

export interface GitLabRepositoryTreeItemResponse {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
  mode?: string;
}

@Injectable()
export class GitLabClient {
  constructor(private readonly http: ExternalHttpClient) {}

  async testConnection(config: GitLabClientConfig): Promise<GitLabUser> {
    try {
      const response = await this.http.request<GitLabUser>(
        `${config.apiUrl.replace(/\/$/, "")}/user`,
        {
          headers: { "PRIVATE-TOKEN": config.token },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitLab returned HTTP ${response.statusCode}`);
      }
      return response.body;
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("gitlab", "GitLab connection failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async listProjectsPage(
    config: GitLabClientConfig,
    page: number,
    perPage = 100,
  ): Promise<GitLabProjectResponse[]> {
    try {
      const query = new URLSearchParams({
        membership: "true",
        order_by: "id",
        sort: "asc",
        page: String(page),
        per_page: String(perPage),
      });
      const response = await this.http.request<GitLabProjectResponse[]>(
        `${config.apiUrl.replace(/\/$/, "")}/projects?${query.toString()}`,
        {
          headers: { "PRIVATE-TOKEN": config.token },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitLab returned HTTP ${response.statusCode}`);
      }
      if (!Array.isArray(response.body)) {
        throw new Error("GitLab projects response is not an array");
      }
      return response.body;
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("gitlab", "GitLab project sync failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async listBranchesPage(
    config: GitLabClientConfig,
    projectId: number,
    page: number,
    perPage = 100,
  ): Promise<GitLabBranchResponse[]> {
    try {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      const response = await this.http.request<GitLabBranchResponse[]>(
        `${config.apiUrl.replace(/\/$/, "")}/projects/${projectId}/repository/branches?${query.toString()}`,
        {
          headers: { "PRIVATE-TOKEN": config.token },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitLab returned HTTP ${response.statusCode}`);
      }
      if (!Array.isArray(response.body)) {
        throw new Error("GitLab branches response is not an array");
      }
      return response.body;
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("gitlab", "GitLab branch lookup failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async listRepositoryTreePage(
    config: GitLabClientConfig,
    projectId: number,
    ref: string,
    page: number,
    perPage = 100,
  ): Promise<GitLabRepositoryTreeItemResponse[]> {
    try {
      const query = new URLSearchParams({
        recursive: "true",
        ref,
        page: String(page),
        per_page: String(perPage),
      });
      const response = await this.http.request<
        GitLabRepositoryTreeItemResponse[]
      >(
        `${config.apiUrl.replace(/\/$/, "")}/projects/${projectId}/repository/tree?${query.toString()}`,
        {
          headers: { "PRIVATE-TOKEN": config.token },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode === HttpStatus.NOT_FOUND) {
        throw new GitLabRefNotFoundException(ref);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitLab returned HTTP ${response.statusCode}`);
      }
      if (!Array.isArray(response.body)) {
        throw new Error("GitLab repository tree response is not an array");
      }
      return response.body;
    } catch (error) {
      if (
        error instanceof ExternalApiException ||
        error instanceof GitLabRefNotFoundException
      )
        throw error;
      throw new ExternalApiException(
        "gitlab",
        "GitLab repository tree lookup failed",
        { reason: error instanceof Error ? error.message : "unknown" },
      );
    }
  }

  async getRepositoryFileRaw(
    config: GitLabClientConfig,
    projectId: number,
    ref: string,
    path: string,
  ): Promise<string> {
    try {
      const query = new URLSearchParams({ ref });
      const encodedPath = encodeURIComponent(path);
      const response = await this.http.request<string>(
        `${config.apiUrl.replace(/\/$/, "")}/projects/${projectId}/repository/files/${encodedPath}/raw?${query.toString()}`,
        {
          responseType: "text",
          headers: { "PRIVATE-TOKEN": config.token },
          verifySsl: config.verifySsl,
        },
      );
      if (response.statusCode === HttpStatus.NOT_FOUND) {
        throw new NotFoundException("GitLab repository file not found");
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitLab returned HTTP ${response.statusCode}`);
      }
      if (typeof response.body !== "string") {
        throw new Error("GitLab repository file response is not text");
      }
      return response.body;
    } catch (error) {
      if (
        error instanceof ExternalApiException ||
        error instanceof NotFoundException
      )
        throw error;
      throw new ExternalApiException(
        "gitlab",
        "GitLab repository file lookup failed",
        { reason: error instanceof Error ? error.message : "unknown" },
      );
    }
  }
}

class GitLabRefNotFoundException extends HttpException {
  constructor(ref: string) {
    super(
      {
        code: "GITLAB_REF_NOT_FOUND",
        message: `GitLab branch or ref "${ref}" no longer exists`,
        details: { ref },
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
