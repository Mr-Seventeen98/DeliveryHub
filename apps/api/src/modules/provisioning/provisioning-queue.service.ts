import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "../../database/prisma.service";
import type { CreateCiConfigurationDto } from "./dto/create-ci-configuration.dto";

export interface ProvisioningJobData {
  configuration: CreateCiConfigurationDto;
  userId: string;
  requestId: string;
}

@Injectable()
export class ProvisioningQueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<ProvisioningJobData>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.connection = new Redis(config.getOrThrow<string>("REDIS_URL"), {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue<ProvisioningJobData>("provisioning", {
      connection: this.connection,
      prefix: config.get<string>("BULLMQ_PREFIX") ?? "delivery-hub",
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }

  async enqueue(
    configuration: CreateCiConfigurationDto,
    userId: string,
    requestId: string,
  ): Promise<{ jobId: string; status: "queued" }> {
    const job = await this.queue.add(
      "provision-ci",
      { configuration, userId, requestId },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    );
    if (!job.id) throw new BadRequestException("Unable to allocate queue job ID");
    return { jobId: job.id, status: "queued" };
  }

  async getStatus(jobId: string): Promise<{
    jobId: string;
    status: string;
    progressPercent: number;
    currentStep: string | null;
    attemptsMade: number;
    errorMessage: string | null;
    result: unknown;
  }> {
    const job = await this.queue.getJob(jobId);
    const task = await this.prisma.ciProvisionTask.findUnique({
      where: { queueJobId: jobId },
      select: {
        progressPercent: true,
        currentStep: true,
        errorMessage: true,
        resultJson: true,
      },
    });
    if (!job && !task) throw new NotFoundException("Provisioning job not found");
    const state = job ? await job.getState() : "completed";
    return {
      jobId,
      status: state,
      progressPercent:
        task?.progressPercent ??
        (typeof job?.progress === "number" ? job.progress : 0),
      currentStep: task?.currentStep ?? null,
      attemptsMade: job?.attemptsMade ?? 0,
      errorMessage: task?.errorMessage ?? job?.failedReason ?? null,
      result:
        state === "completed"
          ? (job?.returnvalue ?? task?.resultJson ?? null)
          : null,
    };
  }

  async retry(jobId: string): Promise<{ jobId: string; status: "queued" }> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException("Provisioning job not found");
    const state = await job.getState();
    if (state !== "failed")
      throw new BadRequestException("Only failed jobs can be retried");
    await job.retry();
    return { jobId, status: "queued" };
  }

  verifyWorkerToken(authorization: string | undefined): void {
    const supplied = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expected = workerToken(
      this.config.getOrThrow<string>("APP_SECRET_KEY"),
    );
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    )
      throw new UnauthorizedException("Invalid worker token");
  }
}

export function workerToken(appSecret: string): string {
  return createHmac("sha256", appSecret)
    .update("delivery-hub-provisioning-worker")
    .digest("base64url");
}
