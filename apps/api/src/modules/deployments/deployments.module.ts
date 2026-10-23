import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { GitLabModule } from "../gitlab/gitlab.module";
import { ServersModule } from "../servers/servers.module";
import { DeploymentsController } from "./deployments.controller";
import { DeploymentsService } from "./deployments.service";
import { AutomaticDeploymentsService } from "./automatic-deployments.service";

@Module({
  imports: [AuditModule, CredentialsModule, GitLabModule, ServersModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService, AutomaticDeploymentsService],
})
export class DeploymentsModule {}
