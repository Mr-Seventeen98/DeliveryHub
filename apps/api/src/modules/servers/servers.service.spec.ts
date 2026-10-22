import { ServerStatus } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServersService } from "./servers.service";

function createService(testAlias: () => Promise<{ reachable: true }>) {
  const server = {
    id: "server-1",
    sshAlias: "production",
    status: ServerStatus.PENDING,
  };
  const update = vi.fn().mockResolvedValue(server);
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: "user-1" }),
    },
    server: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([server])
        .mockResolvedValueOnce([server]),
      findUnique: vi.fn(),
      update,
      create: vi.fn(),
    },
  };
  const service = new ServersService(
    prisma as never,
    {
      resolveAlias: vi.fn().mockResolvedValue({
        host: "server.example.com",
        port: 22,
        username: "delivery",
      }),
      testAlias,
    } as never,
    { discoverAliases: vi.fn().mockReturnValue(["production"]) } as never,
    { record: vi.fn() } as never,
    { get: vi.fn().mockReturnValue(60) } as never,
  );
  return { service, prisma, update };
}

describe("ServersService automatic health checks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { name: "health", interval: 60_000, label: "Server health refresh" },
    { name: "ssh", interval: 5 * 60_000, label: "SSH Config synchronization" },
  ])(
    "contains a rejected $name timer and retries after recovery",
    async ({ name, interval, label }) => {
      vi.useFakeTimers();
      const warn = vi
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      const { service } = createService(() =>
        Promise.resolve({ reachable: true }),
      );
      // 仅替代内部异步入口以隔离数据库/SSH；仍由真实定时器触发，不改变生产方法的私有可见性。
      const scheduledTasks = service as unknown as {
        refreshHealth: () => Promise<void>;
        synchronizeSshConfig: (userId: string) => Promise<string[]>;
      };
      const health = vi
        .spyOn(scheduledTasks, "refreshHealth")
        .mockResolvedValue(undefined);
      const sync = vi
        .spyOn(scheduledTasks, "synchronizeSshConfig")
        .mockResolvedValue([]);
      await service.onModuleInit();
      const task = name === "health" ? health : sync;
      task.mockRejectedValueOnce(new Error("fixture database disconnect"));
      try {
        // 使用真实调度入口而非直接调用 catch；未处理拒绝会让 Vitest 失败，恢复后下一轮必须再次执行。
        await vi.advanceTimersByTimeAsync(interval);
        expect(warn).toHaveBeenCalledWith(
          `${label} failed; retrying on the next scheduled check`,
        );
        await vi.advanceTimersByTimeAsync(interval);
        expect(task).toHaveBeenCalledTimes(3);
      } finally {
        service.onModuleDestroy();
      }
    },
  );

  it("lists cached targets without reparsing SSH Config", async () => {
    const { service, prisma } = createService(() =>
      Promise.resolve({ reachable: true }),
    );

    await service.list();

    expect(prisma.server.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.server.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, sshAlias: { not: null } },
      }),
    );
  });

  it("marks a reachable deployment target online during startup", async () => {
    const { service, update } = createService(() =>
      Promise.resolve({ reachable: true }),
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "server-1" },
        data: expect.objectContaining({ status: ServerStatus.ONLINE }),
      }),
    );
  });

  it("automatically marks an unreachable deployment target offline", async () => {
    const { service, update } = createService(() =>
      Promise.reject(new Error("unreachable")),
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "server-1" },
        data: expect.objectContaining({ status: ServerStatus.OFFLINE }),
      }),
    );
  });

  it("checks the target immediately before deployment", async () => {
    const testAlias = vi.fn().mockResolvedValue({ reachable: true });
    const update = vi.fn().mockResolvedValue({
      id: "server-1",
      enabled: true,
      sshAlias: "production",
      status: ServerStatus.ONLINE,
    });
    const service = new ServersService(
      {
        server: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({
              id: "server-1",
              enabled: true,
              sshAlias: "production",
              status: ServerStatus.OFFLINE,
            })
            .mockResolvedValueOnce({ status: ServerStatus.OFFLINE }),
          update,
        },
      } as never,
      { testAlias } as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue(60) } as never,
    );

    await expect(service.ensureOnline("server-1")).resolves.toMatchObject({
      status: ServerStatus.ONLINE,
    });
    expect(testAlias).toHaveBeenCalledWith("production");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ServerStatus.ONLINE }),
      }),
    );
  });

  it("excludes SSH endpoints that do not provide a server shell", async () => {
    const { service, update } = createService(() =>
      Promise.reject(
        new Error("OpenSSH command failed: Unknown command: printf"),
      ),
    );

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "server-1" },
        data: expect.objectContaining({
          status: ServerStatus.DISABLED,
          lastTestMessage: "SSH 端点不提供服务器 Shell",
        }),
      }),
    );
  });

  it("lists remote directories for an online deployment target", async () => {
    const listDirectories = vi.fn().mockResolvedValue({
      directories: ["/srv/apps", "/srv/data"],
      files: ["/srv/compose.yaml"],
    });
    const service = new ServersService(
      {
        server: {
          findUnique: vi.fn().mockResolvedValue({
            id: "server-1",
            enabled: true,
            status: ServerStatus.ONLINE,
            sshAlias: "production",
          }),
        },
      } as never,
      { listDirectories } as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue(60) } as never,
    );

    await expect(
      service.listDirectories("server-1", "/srv", "temporary-sudo-password"),
    ).resolves.toEqual({
      directories: ["/srv/apps", "/srv/data"],
      files: ["/srv/compose.yaml"],
    });
    expect(listDirectories).toHaveBeenCalledWith(
      "production",
      "/srv",
      "temporary-sudo-password",
    );
  });
});
