import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { DeploymentEnvironment } from "@prisma/client";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { CreateApplicationDeploymentDirectoryDto } from "./dto/application-deployment-directory.dto";
import { ApplicationsService } from "./applications.service";

@ApiTags("applications")
@ApiBearerAuth()
@Controller("applications")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(): ReturnType<ApplicationsService["list"]> {
    return this.applications.list();
  }

  @Get(":id")
  get(@Param("id") id: string): ReturnType<ApplicationsService["get"]> {
    return this.applications.get(id);
  }

  @Post("import-existing/:gitLabProjectId")
  importExistingCiProject(
    @Param("gitLabProjectId") gitLabProjectId: string,
    @Req() request: AuthenticatedRequest,
  ): ReturnType<ApplicationsService["importExistingCiProject"]> {
    return this.applications.importExistingCiProject(
      gitLabProjectId,
      request.user.sub,
      request.header("x-request-id") ?? "unknown",
    );
  }

  @Post(":id/check-configuration")
  check(
    @Param("id") id: string,
  ): ReturnType<ApplicationsService["checkConfiguration"]> {
    return this.applications.checkConfiguration(id);
  }

  @Get(":id/deployment-directories")
  listDeploymentDirectories(
    @Param("id") id: string,
    @Query("environment") environment?: DeploymentEnvironment,
  ) {
    return this.applications.listDeploymentDirectories(id, environment);
  }

  @Post(":id/deployment-directories")
  addDeploymentDirectory(
    @Param("id") id: string,
    @Body() dto: CreateApplicationDeploymentDirectoryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.applications.addDeploymentDirectory(
      id,
      dto,
      request.user.sub,
      request.header("x-request-id") ?? "unknown",
    );
  }

  @Delete(":id/deployment-directories/:directoryId")
  async removeDeploymentDirectory(
    @Param("id") id: string,
    @Param("directoryId") directoryId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ disabled: true }> {
    await this.applications.removeDeploymentDirectory(
      id,
      directoryId,
      request.user.sub,
      request.header("x-request-id") ?? "unknown",
    );
    return { disabled: true };
  }
}
