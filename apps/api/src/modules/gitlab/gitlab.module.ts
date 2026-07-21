import { Module } from "@nestjs/common";
import { AdaptersModule } from "../../adapters/adapters.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { GitLabController } from "./gitlab.controller";
import { GitLabProjectsController } from "./gitlab-projects.controller";
import { GitLabProjectsService } from "./gitlab-projects.service";
import { GitLabService } from "./gitlab.service";

@Module({
  imports: [AdaptersModule, CredentialsModule],
  controllers: [GitLabController, GitLabProjectsController],
  providers: [GitLabService, GitLabProjectsService],
  exports: [GitLabProjectsService],
})
export class GitLabModule {}
