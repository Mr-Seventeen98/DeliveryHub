/** 仓库流水线契约：平台只编排受管阶段，具体测试/编译逻辑由同一 Git 提交中的入口维护。 */
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";

// 配置路径只能留在 checkout 内，禁止通过脚本参数引入 shell 表达式或越过仓库根目录。
export const repositoryPath = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9_.\/-]+$/)
  .refine(
    (value) => !value.startsWith("/") && !value.split("/").includes(".."),
    "必须使用仓库内相对路径",
  );
export const pipelineStages = [
  "prepare",
  "test",
  "build",
  "verify",
  "push",
] as const;
export const pipelineDefinitionSchema = z
  .object({
    version: z.literal(1),
    mode: z.literal("repository-pipeline"),
    platform: z.literal("linux/amd64"),
    entrypoint: repositoryPath,
    assetsLock: repositoryPath,
    buildEnv: repositoryPath,
    requiredReports: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1),
    components: z
      .array(
        z
          .object({
            code: z.string().regex(/^[a-z][a-z0-9-]*$/),
            name: z.string().min(1).max(100),
            dockerfile: repositoryPath,
            context: repositoryPath,
            imageRepository: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((definition, context) => {
    for (const field of ["code", "imageRepository"] as const) {
      if (
        new Set(definition.components.map((component) => component[field]))
          .size !== definition.components.length
      )
        context.addIssue({ code: "custom", message: `组件 ${field} 不得重复` });
    }
    if (
      new Set(definition.requiredReports).size !==
      definition.requiredReports.length
    )
      context.addIssue({ code: "custom", message: "测试报告名称不得重复" });
  });
export type RepositoryPipelineDefinition = z.infer<
  typeof pipelineDefinitionSchema
>;

/** 拒绝未知字段和 YAML alias，原始文件摘要用于阻止配置变更在未重新接入时静默生效。 */
export function parsePipelineDefinition(content: string) {
  if (Buffer.byteLength(content) > 64 * 1024 || content.includes("\0"))
    throw new Error("流水线配置超过 64 KiB 或包含非法内容");
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw new Error("流水线配置不是有效 YAML/JSON");
  const definition = pipelineDefinitionSchema.parse(
    document.toJS({ maxAliasCount: 0 }),
  );
  return {
    definition,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

/** 脚本参数均来自经过白名单验证的相对路径；秘密参数由 TeamCity 环境变量传递。 */
export function repositoryPipelineSteps(
  definition: RepositoryPipelineDefinition,
  definitionPath: string,
) {
  repositoryPath.parse(definitionPath);
  return [...pipelineStages, "report" as const].map((stage) => ({
    id: `repository_${stage}`,
    name: `Repository CI: ${stage}`,
    script: `set -eu\npython3 '${definition.entrypoint}' --definition '${definitionPath}' --stage ${stage}`,
    // report 同时负责临时服务清理；使用 TC runner 的真实常量 execute_always（不是 UI 文案 always）。
    // 即使用户取消也尽量执行，失联由轮询恢复状态。
    executionMode: stage === "report" ? "execute_always" : "default",
  }));
}
