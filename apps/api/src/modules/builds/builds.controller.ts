import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { Public } from "../auth/public.decorator";
import { BuildQueryDto } from "./dto/build-query.dto";
import { ImageQueryDto } from "./dto/image-query.dto";
import { RegistryCatalogQueryDto } from "./dto/registry-catalog-query.dto";
import { TeamCityBuildCallbackDto } from "./dto/teamcity-build-callback.dto";
import { TriggerBuildDto } from "./dto/trigger-build.dto";
import { BuildsService } from "./builds.service";

@ApiTags("builds")
@ApiBearerAuth()
@Controller("builds")
export class BuildsController {
  constructor(private readonly builds: BuildsService) {}

  @Get()
  list(@Query() query: BuildQueryDto): ReturnType<BuildsService["list"]> {
    return this.builds.list(query);
  }

  @Post("trigger")
  trigger(
    @Body() dto: TriggerBuildDto,
    @Req() request: AuthenticatedRequest,
  ): ReturnType<BuildsService["trigger"]> {
    return this.builds.trigger(dto, request.user.sub);
  }

  @Post("sync")
  sync(): ReturnType<BuildsService["syncAll"]> {
    return this.builds.syncAll();
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string): ReturnType<BuildsService["cancel"]> {
    return this.builds.cancel(id);
  }

  @Get(":id/diagnostics")
  diagnostics(
    @Param("id") id: string,
  ): ReturnType<BuildsService["diagnostics"]> {
    return this.builds.diagnostics(id);
  }
}

@ApiTags("images")
@ApiBearerAuth()
@Controller("images")
export class ImagesController {
  constructor(private readonly builds: BuildsService) {}

  @Get()
  list(@Query() query: ImageQueryDto): ReturnType<BuildsService["listImages"]> {
    return this.builds.listImages(query);
  }

  @Get("registry/catalog")
  registryCatalog(
    @Query() query: RegistryCatalogQueryDto,
  ): ReturnType<BuildsService["registryCatalog"]> {
    return this.builds.registryCatalog(query);
  }

  @Get(":id/registry-versions")
  registryVersions(
    @Param("id") id: string,
  ): ReturnType<BuildsService["registryVersions"]> {
    return this.builds.registryVersions(id);
  }
}

@ApiTags("integrations/teamcity")
@Controller("integrations/teamcity")
export class TeamCityBuildCallbackController {
  constructor(private readonly builds: BuildsService) {}

  @Public()
  @Post("build-callback")
  callback(
    @Headers("authorization") authorization: string | undefined,
    @Body() dto: TeamCityBuildCallbackDto,
  ): ReturnType<BuildsService["handleCallback"]> {
    return this.builds.handleCallback(authorization, dto);
  }
}
