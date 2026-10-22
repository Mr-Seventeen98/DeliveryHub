import { Injectable } from "@nestjs/common";
import { ExternalApiException } from "../external-api.exception";
import { ExternalHttpClient } from "../external-http.client";

export interface RegistryClientConfig {
  registryUrl: string;
  username: string;
  password: string;
  verifySsl: boolean;
}

interface RegistryTagsResponse {
  name?: string;
  tags?: string[] | null;
}

interface RegistryTokenResponse {
  token?: string;
  access_token?: string;
}

@Injectable()
export class RegistryClient {
  constructor(private readonly http: ExternalHttpClient) {}

  async testConnection(
    config: RegistryClientConfig,
  ): Promise<{ reachable: true }> {
    try {
      const response = await this.authenticatedGet<unknown>(
        config,
        `${config.registryUrl.replace(/\/$/, "")}/v2/`,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Registry returned HTTP ${response.statusCode}`);
      }
      return { reachable: true };
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException("registry", "Registry connection failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async listTags(
    config: RegistryClientConfig,
    namespace: string,
    repository: string,
  ): Promise<{ name: string; tags: string[] }> {
    try {
      const imagePath = `${namespace}/${repository}`
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const response = await this.authenticatedGet<RegistryTagsResponse>(
        config,
        `${config.registryUrl.replace(/\/$/, "")}/v2/${imagePath}/tags/list?n=10000`,
        `repository:${namespace}/${repository}:pull`,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new ExternalApiException(
          "registry",
          "Registry tag listing failed",
          { statusCode: response.statusCode },
        );
      }
      return {
        name: response.body.name ?? `${namespace}/${repository}`,
        tags: [...new Set(response.body.tags ?? [])].sort((a, b) =>
          b.localeCompare(a),
        ),
      };
    } catch (error) {
      if (error instanceof ExternalApiException) throw error;
      throw new ExternalApiException(
        "registry",
        "Registry tag listing failed",
        {
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
    }
  }

  /** 从目标仓库回读 manifest 摘要；没有合法远端摘要时不把本地推送声明当验证成功。 */
  async getManifestDigest(
    config: RegistryClientConfig,
    namespace: string,
    repository: string,
    tag: string,
  ): Promise<string> {
    const path = [namespace, repository].map(encodeURIComponent).join("/");
    const response = await this.authenticatedGet<unknown>(
      config,
      `${config.registryUrl.replace(/\/$/, "")}/v2/${path}/manifests/${encodeURIComponent(tag)}`,
      `repository:${namespace}/${repository}:pull`,
      {
        Accept:
          "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
      },
    );
    const digest = response.headers["docker-content-digest"];
    if (
      response.statusCode !== 200 ||
      !/^sha256:[a-f0-9]{64}$/.test(digest ?? "")
    )
      throw new ExternalApiException(
        "registry",
        "Registry manifest verification failed",
        { statusCode: response.statusCode },
      );
    return digest!;
  }

  private async authenticatedGet<T>(
    config: RegistryClientConfig,
    url: string,
    requestedScope?: string,
    extraHeaders: Record<string, string> = {},
  ) {
    const basic = Buffer.from(`${config.username}:${config.password}`).toString(
      "base64",
    );
    const first = await this.http.request<T>(url, {
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
        ...extraHeaders,
      },
      verifySsl: config.verifySsl,
    });
    if (first.statusCode !== 401) return first;
    const challenge = first.headers?.["www-authenticate"];
    if (!challenge?.toLowerCase().startsWith("bearer ")) return first;
    const attributes = Object.fromEntries(
      [...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [
        match[1]!,
        match[2]!,
      ]),
    );
    if (!attributes.realm) return first;
    const tokenUrl = new URL(attributes.realm);
    if (attributes.service)
      tokenUrl.searchParams.set("service", attributes.service);
    const scope = requestedScope ?? attributes.scope;
    if (scope) tokenUrl.searchParams.set("scope", scope);
    const tokenResponse = await this.http.request<RegistryTokenResponse>(
      tokenUrl.toString(),
      {
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: "application/json",
        },
        verifySsl: config.verifySsl,
      },
    );
    const token = tokenResponse.body.token ?? tokenResponse.body.access_token;
    if (
      tokenResponse.statusCode < 200 ||
      tokenResponse.statusCode >= 300 ||
      !token
    )
      return first;
    return this.http.request<T>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...extraHeaders,
      },
      verifySsl: config.verifySsl,
    });
  }
}
