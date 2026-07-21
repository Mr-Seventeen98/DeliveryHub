import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "bullmq";
import { config as loadEnvironment } from "dotenv";
import { Redis } from "ioredis";
import pino from "pino";

loadEnvironment({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const connection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379/0",
  {
    maxRetriesPerRequest: null
  }
);

const worker = new Worker(
  "provisioning",
  async (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "provisioning started");
    await job.updateProgress(5);
    const appSecret = process.env.APP_SECRET_KEY;
    if (!appSecret) throw new Error("APP_SECRET_KEY is required by worker");
    const token = createHmac("sha256", appSecret)
      .update("delivery-hub-provisioning-worker")
      .digest("base64url");
    const response = await fetch(
      `${(process.env.WORKER_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/v1/ci-configurations/internal/execute`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          queueJobId: String(job.id),
          ...job.data,
        }),
      },
    );
    const payload = (await response.json()) as {
      data?: unknown;
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(payload.error?.message ?? `API HTTP ${response.status}`);
    await job.updateProgress(100);
    logger.info({ jobId: job.id }, "provisioning completed");
    return payload.data;
  },
  { connection, prefix: process.env.BULLMQ_PREFIX ?? "delivery-hub" }
);

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "job failed");
});

async function shutdown(): Promise<void> {
  await worker.close();
  await connection.quit();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
