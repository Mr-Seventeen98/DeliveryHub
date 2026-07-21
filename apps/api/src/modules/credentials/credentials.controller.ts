import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import {
  CredentialsService,
  type CredentialView
} from "./credentials.service";
import { CreateCredentialDto } from "./dto/create-credential.dto";

@ApiTags("credentials")
@ApiBearerAuth()
@Controller("credentials")
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Post()
  @ApiOperation({ summary: "Create an encrypted credential" })
  create(
    @Body() dto: CreateCredentialDto,
    @Req() request: AuthenticatedRequest
  ): Promise<CredentialView> {
    return this.credentials.create(dto, request.user.sub);
  }

  @Get()
  @ApiOperation({ summary: "List credential metadata without secrets" })
  list(): Promise<CredentialView[]> {
    return this.credentials.list();
  }

  @Delete(":id")
  @ApiOperation({ summary: "Disable a credential" })
  async disable(@Param("id") id: string): Promise<{ disabled: true }> {
    await this.credentials.disable(id);
    return { disabled: true };
  }
}
