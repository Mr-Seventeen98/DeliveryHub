/** 配置不可信输入和门控测试：只验证解析/编排边界，不连接 GitLab、TeamCity 或 Registry。 */
import { describe, expect, it } from "vitest";
import {
  parsePipelineDefinition,
  repositoryPipelineSteps,
} from "./repository-pipeline";
import { assertCompleteRepositoryResult } from "../builds/repository-result";

import {
  definitionFixture,
  resultFixture,
} from "./repository-pipeline.fixtures";

describe("repository pipeline contract", () => {
  it("保留显式上下文，生成五个门控阶段与取消后仍执行的 report", () => {
    const { definition } = parsePipelineDefinition(
      JSON.stringify(definitionFixture),
    );
    const steps = repositoryPipelineSteps(definition, "delivery.yaml");
    expect(steps).toHaveLength(6);
    expect(steps.at(-1)?.executionMode).toBe("execute_always");
    expect(steps.every((step) => !step.script.includes("ssh "))).toBe(true);
    expect(definition.components[0]?.context).toBe("contexts/api");
  });
  it.each([
    "../outside.py",
    "/tmp/run.py",
    "scripts/run.py;curl",
    "scripts/$(id).py",
  ])("拒绝越界/命令注入入口 %s", (entrypoint) => {
    expect(() =>
      parsePipelineDefinition(
        JSON.stringify({ ...definitionFixture, entrypoint }),
      ),
    ).toThrow();
  });
  it("拒绝重复镜像与未知配置字段", () => {
    expect(() =>
      parsePipelineDefinition(
        JSON.stringify({ ...definitionFixture, deploy: true }),
      ),
    ).toThrow();
    expect(() =>
      parsePipelineDefinition(
        JSON.stringify({
          ...definitionFixture,
          components: [
            ...definitionFixture.components,
            definitionFixture.components[0],
          ],
        }),
      ),
    ).toThrow();
    expect(() => parsePipelineDefinition("version: 1\nversion: 2\n")).toThrow();
  });
  it("完整五镜像及必跑测试通过才能接受整套", () => {
    const { definition, sha256, result } = resultFixture();
    expect(() =>
      assertCompleteRepositoryResult(
        result,
        definition,
        sha256,
        result.commitSha,
      ),
    ).not.toThrow();
    expect(() =>
      assertCompleteRepositoryResult(
        { ...result, images: result.images.slice(1) },
        definition,
        sha256,
        result.commitSha,
      ),
    ).toThrow("镜像集合");
    expect(() =>
      assertCompleteRepositoryResult(
        result,
        definition,
        sha256,
        "c".repeat(40),
      ),
    ).toThrow("提交");
    expect(() =>
      assertCompleteRepositoryResult(
        {
          ...result,
          reports: {
            ...result.reports,
            backend: {
              passed: 100,
              failed: 0,
              skipped: 1,
              mandatorySkipped: 1,
            },
          },
        },
        definition,
        sha256,
        result.commitSha,
      ),
    ).toThrow("必跑测试");
  });
  it("部分推送、未完成阶段和重复组件不能伪装成功", () => {
    const { definition, sha256, result } = resultFixture();
    expect(() =>
      assertCompleteRepositoryResult(
        { ...result, publicationStatus: "PARTIAL" },
        definition,
        sha256,
        result.commitSha,
      ),
    ).toThrow();
    expect(() =>
      assertCompleteRepositoryResult(
        { ...result, stages: result.stages.slice(1) },
        definition,
        sha256,
        result.commitSha,
      ),
    ).toThrow();
    expect(() =>
      assertCompleteRepositoryResult(
        { ...result, images: result.images.map(() => result.images[0]!) },
        definition,
        sha256,
        result.commitSha,
      ),
    ).toThrow();
  });
});
