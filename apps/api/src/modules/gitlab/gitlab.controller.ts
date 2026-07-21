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
import type { GitLabInstance } from "@prisma/client";
import {
  CreateGitLabConnectionDto,
  UpdateGitLabConnectionDto,
} from "./dto/gitlab-connection.dto";
import { GitLabService } from "./gitlab.service";

@ApiTags("integrations/gitlab")
@ApiBearerAuth()
@Controller("integrations/gitlab")
export class GitLabController {
  constructor(private readonly gitlab: GitLabService) {}

  @Post()
  create(@Body() dto: CreateGitLabConnectionDto): Promise<GitLabInstance> {
    return this.gitlab.create(dto);
  }

  @Get()
  list(): Promise<GitLabInstance[]> {
    return this.gitlab.list();
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<GitLabInstance> {
    return this.gitlab.get(id);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateGitLabConnectionDto,
  ): Promise<GitLabInstance> {
    return this.gitlab.update(id, dto);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ deleted: true }> {
    await this.gitlab.remove(id);
    return { deleted: true };
  }

  @Post(":id/test")
  test(@Param("id") id: string): Promise<{ username: string; name: string }> {
    return this.gitlab.test(id);
  }

  @Post(":id/sync")
  sync(
    @Param("id") id: string,
  ): Promise<{ synced: number; unavailable: number }> {
    return this.gitlab.sync(id);
  }

  @Get(":id/sync-status")
  syncStatus(@Param("id") id: string): Promise<{
    status: string | null;
    lastSyncAt: Date | null;
    projectCount: number;
  }> {
    return this.gitlab.syncStatus(id);
  }
}
