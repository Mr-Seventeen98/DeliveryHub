import { Module } from "@nestjs/common";
import { ExternalHttpClient } from "./external-http.client";
import { GitLabClient } from "./gitlab/gitlab.client";
import { RegistryClient } from "./registry/registry.client";
import { TencentTcrClient } from "./registry/tencent-tcr.client";
import { TeamCityClient } from "./teamcity/teamcity.client";

@Module({
  providers: [ExternalHttpClient, GitLabClient, TeamCityClient, RegistryClient, TencentTcrClient],
  exports: [GitLabClient, TeamCityClient, RegistryClient, TencentTcrClient]
})
export class AdaptersModule {}
