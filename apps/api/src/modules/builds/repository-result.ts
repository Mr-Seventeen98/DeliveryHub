/** 整套制品的验证契约：执行结果、镜像推送和平台登记是三个独立事实。 */
import { z } from "zod";
import {
  pipelineStages,
  type RepositoryPipelineDefinition,
} from "../provisioning/repository-pipeline";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const repositoryResultSchema = z
  .object({
    version: z.literal(1),
    definitionSha256: z.string().regex(/^[a-f0-9]{64}$/),
    commitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    platform: z.literal("linux/amd64"),
    tag: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
    executionStatus: z.enum(["RUNNING", "SUCCESS", "FAILED", "CANCELED"]),
    publicationStatus: z.enum(["NONE", "PARTIAL", "VERIFIED"]),
    stages: z
      .array(
        z
          .object({
            code: z.enum(pipelineStages),
            status: z.enum([
              "RUNNING",
              "SUCCESS",
              "FAILED",
              "CANCELED",
              "SKIPPED",
            ]),
            startedAt: z.string().datetime().optional(),
            finishedAt: z.string().datetime().optional(),
          })
          .strict(),
      )
      .max(5),
    reports: z.record(
      z
        .object({
          passed: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          skipped: z.number().int().nonnegative(),
          mandatorySkipped: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    images: z
      .array(
        z
          .object({
            componentCode: z.string(),
            repository: z.string(),
            tag: z.string(),
            platform: z.literal("linux/amd64"),
            localImageId: z.string().optional(),
            digest: digest.optional(),
            verified: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    assetsLockSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type RepositoryResult = z.infer<typeof repositoryResultSchema>;

/** 完整集合、必跑测试、提交和标签必须一致；未知/重复组件不允许被忽略。 */
export function assertCompleteRepositoryResult(
  result: RepositoryResult,
  definition: RepositoryPipelineDefinition,
  sha256: string,
  commitSha: string,
): void {
  if (result.definitionSha256 !== sha256 || result.commitSha !== commitSha)
    throw new Error("构建配置或提交与 TeamCity 记录不一致");
  if (
    result.executionStatus !== "SUCCESS" ||
    result.publicationStatus !== "VERIFIED"
  )
    throw new Error("流水线尚未完成推送校验");
  if (
    result.stages.length !== pipelineStages.length ||
    new Set(result.stages.map((stage) => stage.code)).size !==
      pipelineStages.length ||
    result.stages.some((stage) => stage.status !== "SUCCESS")
  )
    throw new Error("流水线阶段未全部通过");
  for (const name of definition.requiredReports) {
    const report = result.reports[name];
    if (
      !report ||
      report.passed === 0 ||
      report.failed !== 0 ||
      report.mandatorySkipped !== 0
    )
      throw new Error(`必跑测试未通过：${name}`);
  }
  if (
    result.images.length !== definition.components.length ||
    new Set(result.images.map((image) => image.componentCode)).size !==
      definition.components.length
  )
    throw new Error("镜像集合不完整或重复");
  for (const component of definition.components) {
    const image = result.images.find(
      (item) => item.componentCode === component.code,
    );
    if (
      !image ||
      image.repository !== component.imageRepository ||
      image.tag !== result.tag ||
      !image.verified ||
      !image.digest
    )
      throw new Error(`镜像未通过校验：${component.code}`);
  }
}
