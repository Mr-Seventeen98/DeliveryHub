import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { TeamCityConnection } from "@prisma/client";
import {
  CreateTeamCityConnectionDto,
  UpdateTeamCityConnectionDto,
} from "./dto/teamcity-connection.dto";
import { TeamCityService } from "./teamcity.service";

@ApiTags("integrations/teamcity")
@ApiBearerAuth()
@Controller("integrations/teamcity")
export class TeamCityController {
  constructor(private readonly teamcity: TeamCityService) {}

  @Post()
  create(
    @Body() dto: CreateTeamCityConnectionDto,
  ): Promise<TeamCityConnection> {
    return this.teamcity.create(dto);
  }

  @Get()
  list(): Promise<TeamCityConnection[]> {
    return this.teamcity.list();
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTeamCityConnectionDto,
  ): Promise<TeamCityConnection> {
    return this.teamcity.update(id, dto);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ deleted: true }> {
    await this.teamcity.remove(id);
    return { deleted: true };
  }

  @Post(":id/test")
  test(
    @Param("id") id: string,
  ): Promise<{ version: string; buildNumber: string }> {
    return this.teamcity.test(id);
  }

  @Post(":id/sync-vcs-roots")
  syncVcsRoots(@Param("id") id: string): Promise<{
    scanned: number;
    matched: number;
    configuredProjects: number;
    unmatched: number;
  }> {
    return this.teamcity.syncVcsRoots(id);
  }

  @Get(":id/configuration-conventions")
  configurationConventions(@Param("id") id: string): Promise<{
    buildTypeCount: number;
    parameterNames: Array<{ name: string; uses: number; password: boolean }>;
    stepNames: Array<{ name: string; uses: number }>;
    triggerTypes: Array<{ type: string; uses: number }>;
    vcsTriggerConfigurations: Array<{
      buildTypeId: string;
      buildTypeName: string;
      properties: Record<string, string>;
    }>;
    releaseBranches: Array<{ branch: string; uses: number }>;
  }> {
    return this.teamcity.configurationConventions(id);
  }

  @Get(":id/projects")
  projects(@Param("id") id: string): Promise<{
    parentProjectId: string;
    items: Array<{ id: string; name: string; parentProjectId: string }>;
  }> {
    return this.teamcity.listProjects(id);
  }

  @Get(":id/agents")
  agents(@Param("id") id: string): ReturnType<TeamCityService["agents"]> {
    return this.teamcity.agents(id);
  }
}
