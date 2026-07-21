import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { Public } from "../auth/public.decorator";
import { CreateCiConfigurationDto } from "./dto/create-ci-configuration.dto";
import {
  ProvisioningService,
  type ProvisioningResult,
} from "./provisioning.service";
import { ExecuteProvisioningJobDto } from "./dto/execute-provisioning-job.dto";
import { ProvisioningQueueService } from "./provisioning-queue.service";

@ApiTags("ci-provisioning")
@ApiBearerAuth()
@Controller("ci-configurations")
export class ProvisioningController {
  constructor(
    private readonly provisioning: ProvisioningService,
    private readonly queue: ProvisioningQueueService,
  ) {}

  @Get("gitlab-project/:gitLabProjectId")
  getByGitLabProject(
    @Param("gitLabProjectId") gitLabProjectId: string,
  ): ReturnType<ProvisioningService["getByGitLabProject"]> {
    return this.provisioning.getByGitLabProject(gitLabProjectId);
  }

  @Post()
  async create(
    @Body() dto: CreateCiConfigurationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ jobId: string; status: "queued" }> {
    return this.queue.enqueue(
      dto,
      request.user.sub,
      request.header("x-request-id") ?? "unknown",
    );
  }

  @Get("jobs/:jobId")
  job(@Param("jobId") jobId: string): ReturnType<ProvisioningQueueService["getStatus"]> {
    return this.queue.getStatus(jobId);
  }

  @Post("jobs/:jobId/retry")
  retry(@Param("jobId") jobId: string): ReturnType<ProvisioningQueueService["retry"]> {
    return this.queue.retry(jobId);
  }

  @Public()
  @Post("internal/execute")
  execute(
    @Headers("authorization") authorization: string | undefined,
    @Body() dto: ExecuteProvisioningJobDto,
  ): Promise<ProvisioningResult> {
    this.queue.verifyWorkerToken(authorization);
    return this.provisioning.provision(
      dto.configuration,
      dto.userId,
      dto.requestId,
      dto.queueJobId,
    );
  }
}
