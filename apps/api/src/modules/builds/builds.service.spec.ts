/** 验证后台轮询的断连恢复边界；只模拟数据库读取失败，不伪造任何构建或镜像成功。 */
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildsService } from "./builds.service";

describe("BuildsService background polling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("contains a rejected sync cycle and retries after database recovery", async () => {
    vi.useFakeTimers();
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const findMany = vi
      .fn()
      .mockRejectedValueOnce(new Error("database temporarily unreachable"))
      .mockResolvedValue([]);
    const service = new BuildsService(
      { application: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: () => undefined } as never,
      {} as never,
    );
    service.onModuleInit();
    try {
      // 若定时器把拒绝丢到全局，Vitest 会报告未处理拒绝；恢复后的下一轮必须真的再次读取数据库。
      await vi.advanceTimersByTimeAsync(15_000);
      expect(warn).toHaveBeenCalledWith(
        "Build sync cycle failed; retrying on the next poll",
      );
      await vi.advanceTimersByTimeAsync(15_000);
      expect(findMany).toHaveBeenCalledTimes(2);
    } finally {
      service.onModuleDestroy();
    }
  });
});
