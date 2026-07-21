import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RegistryConnection } from "@prisma/client";
import {
  CreateRegistryConnectionDto,
  UpdateRegistryConnectionDto
} from "./dto/registry-connection.dto";
import { RegistriesService } from "./registries.service";

@ApiTags("integrations/registries")
@ApiBearerAuth()
@Controller("integrations/registries")
export class RegistriesController {
  constructor(private readonly registries: RegistriesService) {}

  @Post()
  create(@Body() dto: CreateRegistryConnectionDto): Promise<RegistryConnection> {
    return this.registries.create(dto);
  }

  @Get()
  list(): Promise<RegistryConnection[]> {
    return this.registries.list();
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateRegistryConnectionDto
  ): Promise<RegistryConnection> {
    return this.registries.update(id, dto);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ deleted: true }> {
    await this.registries.remove(id);
    return { deleted: true };
  }

  @Post(":id/test")
  test(@Param("id") id: string): Promise<{ reachable: true }> {
    return this.registries.test(id);
  }

}
