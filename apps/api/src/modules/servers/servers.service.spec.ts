import { ServerStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
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
