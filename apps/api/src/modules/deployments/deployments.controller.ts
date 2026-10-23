import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { DeploymentsService } from "./deployments.service";
import { CreateDeploymentDto } from "./dto/create-deployment.dto";
import { AutomaticDeploymentsService } from "./automatic-deployments.service";
import { AutomaticDeploymentPolicyDto } from "./dto/automatic-deployment-policy.dto";
import { AuditService } from "../audit/audit.service";
import { AuditResult } from "@prisma/client";

@ApiTags("deployments")
@ApiBearerAuth()
@Controller("deployments")
export class DeploymentsController {
  constructor(
    private readonly deployments: DeploymentsService,
    private readonly automatic: AutomaticDeploymentsService,
    private readonly audit: AuditService,
  ) {}

  @Get("automatic-policies")
  listPolicies() {
    return this.automatic.listPolicies();
  }

  @Get("repository-releases")
  listRepositoryReleases() {
    return this.automatic.list();
  }

  /** 自动发布意味着未来提交会写入环境，仅管理员可配置；普通用户仍可读取审计结果。 */
  @Put("automatic-policies/:id")
  async configurePolicy(
    @Param("id") id: string,
    @Body() dto: AutomaticDeploymentPolicyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.user.role !== "ADMIN")
      throw new ForbiddenException("Administrator required");
    const result = await this.automatic.configure(
      id,
      dto.enabled,
      dto.branch,
      dto.runnerPath,
    );
    // 策略保存后记录操作人和非敏感配置；审计失败不意味着策略写入已经回滚。
    await this.audit.record({
      userId: request.user.sub,
      action: "deployment.automatic.configure",
      resourceType: "ApplicationDeploymentDirectory",
      resourceId: id,
      requestId: request.header("x-request-id") ?? "unknown",
      after: {
        enabled: dto.enabled,
        branch: dto.branch,
        runnerPath: dto.runnerPath,
      },
      result: AuditResult.SUCCESS,
    });
    return result;
  }

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
