import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { GitLabProjectQueryDto } from "./dto/gitlab-project-query.dto";
import { GitLabProjectsService } from "./gitlab-projects.service";

@ApiTags("gitlab-projects")
@ApiBearerAuth()
@Controller("gitlab-projects")
export class GitLabProjectsController {
  constructor(private readonly projects: GitLabProjectsService) {}

  @Get()
  list(@Query() query: GitLabProjectQueryDto): Promise<{
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.projects.list(query);
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<unknown> {
    return this.projects.get(id);
  }

  @Get(":id/branches")
  branches(@Param("id") id: string): Promise<{
    items: Array<{ name: string; default: boolean; protected: boolean }>;
  }> {
    return this.projects.listBranches(id);
  }

  @Get(":id/dockerfiles")
  dockerfiles(
    @Param("id") id: string,
    @Query("ref") ref?: string,
  ): Promise<{
    ref: string;
    items: Array<{ id: string; name: string; path: string }>;
  }> {
    return this.projects.listDockerfiles(id, ref);
  }

  @Get(":id/compose-files")
  composeFiles(
    @Param("id") id: string,
    @Query("ref") ref?: string,
  ): ReturnType<GitLabProjectsService["listComposeFiles"]> {
    return this.projects.listComposeFiles(id, ref);
  }

  @Get(":id/compose-file")
  composeFile(
    @Param("id") id: string,
    @Query("path") path: string,
    @Query("ref") ref?: string,
  ): ReturnType<GitLabProjectsService["getComposeFile"]> {
    return this.projects.getComposeFile(id, ref, path);
  }

  @Get(":id/repository-scan")
  scan(
    @Param("id") id: string,
    @Query("ref") ref?: string,
  ): ReturnType<GitLabProjectsService["scanRepository"]> {
    return this.projects.scanRepository(id, ref);
  }
}
