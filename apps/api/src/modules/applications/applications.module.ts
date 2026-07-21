import { Module } from "@nestjs/common";
import { AdaptersModule } from "../../adapters/adapters.module";
import { AuditModule } from "../audit/audit.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { ServersModule } from "../servers/servers.module";
import { ApplicationsController } from "./applications.controller";
import { ApplicationsService } from "./applications.service";

@Module({
  imports: [AdaptersModule, AuditModule, CredentialsModule, ServersModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
