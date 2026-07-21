import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Sse,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { ListServerDirectoriesDto } from "./dto/list-server-directories.dto";
import { ReadServerComposeFileDto } from "./dto/read-server-compose-file.dto";
import { ServersService } from "./servers.service";

@ApiTags("servers")
@ApiBearerAuth()
@Controller("servers")
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  list() {
    return this.servers.list();
  }

  @Sse("events")
  events() {
    return this.servers.events();
  }

  @Post("sync")
  sync(@Req() request: AuthenticatedRequest) {
    return this.servers.synchronize(request.user.sub);
  }

  @Get(":id/directories")
  listDirectories(
    @Param("id") id: string,
    @Query("path") path = "/",
  ): ReturnType<ServersService["listDirectories"]> {
    return this.servers.listDirectories(id, path);
  }

  @Post(":id/directories")
  listDirectoriesWithElevation(
    @Param("id") id: string,
    @Body() dto: ListServerDirectoriesDto,
  ): ReturnType<ServersService["listDirectories"]> {
    return this.servers.listDirectories(id, dto.path, dto.sudoPassword);
  }

  @Post(":id/compose-file")
  readComposeFile(
    @Param("id") id: string,
    @Body() dto: ReadServerComposeFileDto,
  ): ReturnType<ServersService["readComposeFile"]> {
    return this.servers.readComposeFile(
      id,
      dto.directoryPath,
      dto.fileName,
      dto.sudoPassword,
    );
  }

  @Post(":id/test")
  test(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.servers.test(
      id,
      request.user.sub,
      request.header("x-request-id") ?? "unknown",
    );
  }

  @Post(":id/check")
  check(@Param("id") id: string) {
    return this.servers.ensureOnline(id);
  }
}
