import { Module } from "@nestjs/common";
import { AdaptersModule } from "../../adapters/adapters.module";
import { AuditModule } from "../audit/audit.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { ProvisioningController } from "./provisioning.controller";
import { ProvisioningService } from "./provisioning.service";
import { ProvisioningQueueService } from "./provisioning-queue.service";

@Module({
  imports: [AdaptersModule, AuditModule, CredentialsModule],
  controllers: [ProvisioningController],
  providers: [ProvisioningService, ProvisioningQueueService],
})
export class ProvisioningModule {}
