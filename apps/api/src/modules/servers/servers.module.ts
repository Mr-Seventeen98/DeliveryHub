import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ServersController } from "./servers.controller";
import { ServersService } from "./servers.service";
import { SshConfigDiscoveryService } from "./ssh-config-discovery.service";
import { SshExecutorService } from "./ssh-executor.service";

@Module({
  imports: [AuditModule],
  controllers: [ServersController],
  providers: [ServersService, SshExecutorService, SshConfigDiscoveryService],
  exports: [ServersService, SshExecutorService],
})
export class ServersModule {}
