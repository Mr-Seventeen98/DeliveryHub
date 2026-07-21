import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { DeploymentsService } from "./deployments.service";
import { CreateDeploymentDto } from "./dto/create-deployment.dto";

@ApiTags("deployments")
@ApiBearerAuth()
@Controller("deployments")
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Get()
  list() {
    return this.deployments.list();
  }

  @Post()
  create(
    @Body() dto: CreateDeploymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.deployments.create(
      dto,
      request.user.sub,
      request.header("x-request-id") ?? "unknown",
    );
  }
}
