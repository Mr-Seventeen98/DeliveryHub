import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { validateEnvironment } from "./config/environment";
import { HealthController } from "./health.controller";
import { RequestIdInterceptor } from "./common/request-id.interceptor";
import { PrismaModule } from "./database/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CredentialsModule } from "./modules/credentials/credentials.module";
import { JwtAuthGuard } from "./modules/auth/jwt-auth.guard";
import { GitLabModule } from "./modules/gitlab/gitlab.module";
import { TeamCityModule } from "./modules/teamcity/teamcity.module";
import { RegistriesModule } from "./modules/registries/registries.module";
import { ProvisioningModule } from "./modules/provisioning/provisioning.module";
import { BuildsModule } from "./modules/builds/builds.module";
import { ApplicationsModule } from "./modules/applications/applications.module";
import { ServersModule } from "./modules/servers/servers.module";
import { DeploymentsModule } from "./modules/deployments/deployments.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    AuthModule,
    AuditModule,
    CredentialsModule,
    GitLabModule,
    TeamCityModule,
    RegistriesModule,
    ProvisioningModule,
    BuildsModule,
    ApplicationsModule,
    ServersModule,
    DeploymentsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
  ],
})
export class AppModule {}
