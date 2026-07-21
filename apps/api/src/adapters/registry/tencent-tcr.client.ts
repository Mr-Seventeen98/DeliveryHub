import { Injectable } from "@nestjs/common";
import { tcr } from "tencentcloud-sdk-nodejs-tcr";
import { ExternalApiException } from "../external-api.exception";
import { normalizeTencentCloudDate } from "./tencent-date";

export interface TencentCloudApiConfig {
  secretId: string;
  secretKey: string;
  region: string;
}

export interface TencentPersonalImageTag {
  tag: string;
  digest: string | null;
  createdAt: string | null;
}

@Injectable()
export class TencentTcrClient {
  async listPersonalImageTags(
    config: TencentCloudApiConfig,
    repositoryName: string,
  ): Promise<TencentPersonalImageTag[]> {
    const client = this.createClient(config);
    try {
      const tags: TencentPersonalImageTag[] = [];
      let offset = 0;
      for (;;) {
        const response = await client.DescribeImagePersonal({
          RepoName: repositoryName,
          Offset: offset,
          Limit: 100,
        });
        const items = response.Data?.TagInfo ?? [];
        tags.push(
          ...items.flatMap((item) =>
            item.TagName
              ? [
                  {
                    tag: item.TagName,
                    digest: item.ImageId ?? null,
                    createdAt: normalizeTencentCloudDate(item.CreationTime),
                  },
                ]
              : [],
          ),
        );
        const total = response.Data?.TagCount ?? tags.length;
        offset += items.length;
        if (items.length === 0 || offset >= total) break;
      }
      return tags.sort(
        (left, right) =>
          timestamp(right.createdAt) - timestamp(left.createdAt) ||
          right.tag.localeCompare(left.tag),
      );
    } catch (error) {
      throw new ExternalApiException(
        "tencent-cloud",
        "Tencent Cloud image tag listing failed",
        { reason: error instanceof Error ? error.message : "unknown" },
      );
    }
  }

  async listPersonalRepositories(
    config: TencentCloudApiConfig,
  ): Promise<
    Array<{ name: string; tagCount: number; updatedAt: string | null }>
  > {
    const client = this.createClient(config);
    try {
      const repositories: Array<{
        name: string;
        tagCount: number;
        updatedAt: string | null;
      }> = [];
      let offset = 0;
      for (;;) {
        const response = await client.DescribeRepositoryOwnerPersonal({
          Offset: offset,
          Limit: 100,
        });
        const items = response.Data?.RepoInfo ?? [];
        repositories.push(
          ...items.flatMap((item) =>
            item.RepoName
              ? [
                  {
                    name: item.RepoName,
                    tagCount: item.TagCount ?? 0,
                    updatedAt: normalizeTencentCloudDate(item.UpdateTime),
                  },
                ]
              : [],
          ),
        );
        const total = response.Data?.TotalCount ?? repositories.length;
        offset += items.length;
        if (items.length === 0 || offset >= total) break;
      }
      return repositories;
    } catch (error) {
      throw new ExternalApiException(
        "tencent-cloud",
        "Tencent Cloud repository listing failed",
        { reason: error instanceof Error ? error.message : "unknown" },
      );
    }
  }

  private createClient(config: TencentCloudApiConfig) {
    return new tcr.v20190924.Client({
      credential: { secretId: config.secretId, secretKey: config.secretKey },
      region: config.region,
      profile: { httpProfile: { endpoint: "tcr.tencentcloudapi.com" } },
    });
  }
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
