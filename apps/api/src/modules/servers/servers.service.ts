import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuditResult, ServerStatus, type Prisma } from "@prisma/client";
import { watch, type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import { interval, map, merge, Subject, type Observable } from "rxjs";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SshConfigDiscoveryService } from "./ssh-config-discovery.service";
import { SshExecutorService } from "./ssh-executor.service";

const serverView = {
  id: true,
  name: true,
  sshAlias: true,
  host: true,
  port: true,
  username: true,
  environment: true,
  status: true,
  lastTestAt: true,
  lastTestMessage: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServerSelect;

type ServerView = Prisma.ServerGetPayload<{ select: typeof serverView }>;
type ServerStatusEvent =
  | { type: "server.updated"; data: ServerView }
  | { type: "servers.changed"; data: { at: number } }
  | { type: "heartbeat"; data: { at: number } };

@Injectable()
export class ServersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServersService.name);
  private readonly healthCheckIntervalMs: number;
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private sshConfigSyncTimer?: ReturnType<typeof setInterval>;
  private sshConfigWatcher?: FSWatcher;
  private sshConfigWatchDebounce?: ReturnType<typeof setTimeout>;
  private healthCheckInFlight: Promise<void> | null = null;
  private syncInFlight: Promise<string[]> | null = null;
  private readonly unsupportedShellAliases = new Set<string>();
  private readonly statusEvents = new Subject<ServerStatusEvent>();
  private readonly nextHealthCheckAt = new Map<string, number>();
  private readonly healthFailureCounts = new Map<string, number>();
  private activeUserId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshExecutorService,
    private readonly discovery: SshConfigDiscoveryService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.healthCheckIntervalMs =
      Number(config.get("DEFAULT_SERVER_HEALTH_CHECK_INTERVAL_SECONDS") ?? 15) *
      1000;
  }

  async onModuleInit(): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { enabled: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!user) return;
    this.activeUserId = user.id;
    try {
      await this.synchronizeSshConfig(user.id);
      await this.refreshHealth();
    } catch (error) {
      this.logger.warn(
        `Initial server health check failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    this.healthCheckTimer = setInterval(
      () => void this.refreshHealth(),
      this.healthCheckIntervalMs,
    );
    this.healthCheckTimer.unref();
    this.sshConfigSyncTimer = setInterval(
      () => void this.synchronizeSshConfig(user.id),
      5 * 60_000,
    );
    this.sshConfigSyncTimer.unref();
    this.watchSshConfig();
  }

  onModuleDestroy(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    if (this.sshConfigSyncTimer) clearInterval(this.sshConfigSyncTimer);
    if (this.sshConfigWatchDebounce) clearTimeout(this.sshConfigWatchDebounce);
    this.sshConfigWatcher?.close();
    this.statusEvents.complete();
  }

  list() {
    return this.prisma.server.findMany({
      where: { enabled: true, sshAlias: { not: null } },
      select: serverView,
      orderBy: [{ environment: "asc" }, { name: "asc" }],
    });
  }

  events(): Observable<ServerStatusEvent> {
    return merge(
      this.statusEvents.asObservable(),
      interval(20_000).pipe(
        map((): ServerStatusEvent => ({
          type: "heartbeat",
          data: { at: Date.now() },
        })),
      ),
    );
  }

  async synchronize(userId: string) {
    await this.synchronizeSshConfig(userId);
    return this.list();
  }

  async test(id: string, userId: string, requestId: string) {
    try {
      const updated = await this.ensureOnline(id);
      await this.audit.record({
        userId,
        action: "server.test",
        resourceType: "server",
        resourceId: id,
        requestId,
        after: safeServerAudit(updated),
        result: AuditResult.SUCCESS,
      });
      return updated;
    } catch (error) {
      throw error;
    }
  }

  async ensureOnline(id: string): Promise<ServerView> {
    const server = await this.requireServer(id);
    const sshAlias = requireSshAlias(server);
    try {
      await this.ssh.testAlias(sshAlias);
      this.healthFailureCounts.delete(id);
      this.nextHealthCheckAt.set(id, Date.now() + this.healthCheckIntervalMs);
      return await this.updateServerStatus(id, {
        status: ServerStatus.ONLINE,
        lastTestAt: new Date(),
        lastTestMessage: "OpenSSH 实时检测正常",
      });
    } catch (error) {
      await this.updateServerStatus(id, {
        status: ServerStatus.OFFLINE,
        lastTestAt: new Date(),
        lastTestMessage: "OpenSSH 实时检测失败",
      });
      throw error;
    }
  }

  async listDirectories(
    id: string,
    path: string,
    sudoPassword?: string,
  ): Promise<{ directories: string[]; files: string[] }> {
    const server = await this.requireServer(id);
    if (server.status !== ServerStatus.ONLINE)
      throw new BadRequestException("Select an online deployment target");
    return this.ssh.listDirectories(
      requireSshAlias(server),
      path,
      sudoPassword,
    );
  }

  async readComposeFile(
    id: string,
    directoryPath: string,
    fileName: string,
    sudoPassword?: string,
  ): Promise<{ path: string; content: string }> {
    const server = await this.requireServer(id);
    if (server.status !== ServerStatus.ONLINE)
      throw new BadRequestException("Select an online deployment target");
    return this.ssh.readComposeFile(
      requireSshAlias(server),
      directoryPath,
      fileName,
      sudoPassword,
    );
  }

  private async requireServer(id: string) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server?.enabled) throw new NotFoundException("Server not found");
    return server;
  }

  private refreshHealth(): Promise<void> {
    if (this.healthCheckInFlight) return this.healthCheckInFlight;
    this.healthCheckInFlight = this.performHealthCheck().finally(() => {
      this.healthCheckInFlight = null;
    });
    return this.healthCheckInFlight;
  }

  private async performHealthCheck(): Promise<void> {
    const servers = await this.prisma.server.findMany({
      where: { enabled: true, sshAlias: { not: null } },
      select: { id: true, sshAlias: true, status: true },
    });
    const now = Date.now();
    await Promise.all(
      servers.map(async (server) => {
        if (!server.sshAlias) return;
        if ((this.nextHealthCheckAt.get(server.id) ?? 0) > now) return;
        try {
          await this.ssh.testAlias(server.sshAlias);
          this.healthFailureCounts.delete(server.id);
          this.nextHealthCheckAt.set(
            server.id,
            now + this.healthCheckIntervalMs,
          );
          await this.updateServerStatus(server.id, {
            status: ServerStatus.ONLINE,
            lastTestAt: new Date(),
            lastTestMessage: "OpenSSH 自动检测正常",
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          if (isUnsupportedShellEndpoint(message)) {
            this.unsupportedShellAliases.add(server.sshAlias);
            await this.updateServerStatus(server.id, {
              status: ServerStatus.DISABLED,
              lastTestAt: new Date(),
              lastTestMessage: "SSH 端点不提供服务器 Shell",
            });
            if (server.status !== ServerStatus.DISABLED) {
              this.logger.debug(
                `Ignoring non-shell SSH endpoint ${server.sshAlias}`,
              );
            }
            return;
          }
          const failures = (this.healthFailureCounts.get(server.id) ?? 0) + 1;
          this.healthFailureCounts.set(server.id, failures);
          const retryDelay = Math.min(
            this.healthCheckIntervalMs * 2 ** Math.min(failures, 5),
            5 * 60_000,
          );
          this.nextHealthCheckAt.set(server.id, now + retryDelay);
          await this.updateServerStatus(server.id, {
            status: ServerStatus.OFFLINE,
            lastTestAt: new Date(),
            lastTestMessage: "OpenSSH 自动检测失败",
          });
          if (server.status !== ServerStatus.OFFLINE) {
            this.logger.debug(
              `Server ${server.sshAlias} is offline: ${message}`,
            );
          }
        }
      }),
    );
  }

  private async updateServerStatus(
    id: string,
    data: {
      status: ServerStatus;
      lastTestAt: Date;
      lastTestMessage: string;
    },
  ): Promise<ServerView> {
    const previous = await this.prisma.server.findUnique({
      where: { id },
      select: { status: true },
    });
    const updated = await this.prisma.server.update({
      where: { id },
      data,
      select: serverView,
    });
    if (previous?.status !== updated.status) {
      this.statusEvents.next({ type: "server.updated", data: updated });
    }
    return updated;
  }

  private synchronizeSshConfig(userId: string): Promise<string[]> {
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = this.performSshConfigSync(userId).finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  private async performSshConfigSync(userId: string): Promise<string[]> {
    const aliases = this.discovery
      .discoverAliases()
      .filter((alias) => !this.unsupportedShellAliases.has(alias));
    const existingServers = await this.prisma.server.findMany({
      where: { sshAlias: { not: null } },
      select: {
        id: true,
        sshAlias: true,
        status: true,
        enabled: true,
        host: true,
        port: true,
        username: true,
      },
    });
    const existingByAlias = new Map(
      existingServers.flatMap((server) =>
        server.sshAlias ? [[server.sshAlias, server] as const] : [],
      ),
    );
    let changed = false;

    for (const server of existingServers) {
      if (
        server.sshAlias &&
        !aliases.includes(server.sshAlias) &&
        server.enabled
      ) {
        await this.prisma.server.update({
          where: { id: server.id },
          data: { enabled: false },
        });
        changed = true;
      }
    }

    for (const alias of aliases) {
      const resolved = await this.ssh.resolveAlias(alias).catch(() => null);
      const existing = existingByAlias.get(alias);
      if (existing) {
        const nextStatus =
          existing.status === ServerStatus.DISABLED
            ? ServerStatus.PENDING
            : existing.status;
        const serverChanged =
          !existing.enabled ||
          existing.host !== (resolved?.host ?? null) ||
          existing.port !== (resolved?.port ?? 22) ||
          existing.username !== (resolved?.username ?? null) ||
          nextStatus !== existing.status;
        await this.prisma.server.update({
          where: { sshAlias: alias },
          data: {
            enabled: true,
            status: nextStatus,
            host: resolved?.host,
            port: resolved?.port,
            username: resolved?.username,
          },
        });
        changed ||= serverChanged;
        continue;
      }

      await this.prisma.server.create({
        data: {
          name: await this.availableServerName(alias),
          sshAlias: alias,
          host: resolved?.host,
          port: resolved?.port ?? 22,
          username: resolved?.username,
          environment: "SSH Config",
          createdById: userId,
        },
      });
      changed = true;
    }

    if (changed) {
      this.statusEvents.next({
        type: "servers.changed",
        data: { at: Date.now() },
      });
    }

    return aliases;
  }

  private watchSshConfig(): void {
    if (!this.discovery.configPath) return;
    try {
      this.sshConfigWatcher = watch(
        dirname(this.discovery.configPath),
        (_event, fileName) => {
          if (fileName?.toString() !== "config" || !this.activeUserId) return;
          if (this.sshConfigWatchDebounce)
            clearTimeout(this.sshConfigWatchDebounce);
          this.sshConfigWatchDebounce = setTimeout(
            () => void this.synchronizeSshConfig(this.activeUserId!),
            300,
          );
        },
      );
      this.sshConfigWatcher.unref();
    } catch (error) {
      this.logger.warn(
        `SSH Config watcher could not start: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  private async availableServerName(alias: string): Promise<string> {
    const directName = await this.prisma.server.findUnique({
      where: { name: alias },
      select: { id: true },
    });
    if (!directName) return alias;

    let suffix = 1;
    while (true) {
      const candidate = `SSH ${alias}${suffix === 1 ? "" : ` ${suffix}`}`;
      const existing = await this.prisma.server.findUnique({
        where: { name: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
      suffix += 1;
    }
  }
}

function isUnsupportedShellEndpoint(message: string): boolean {
  return /unknown command:|shell access (?:is )?disabled|does not provide shell/i.test(
    message,
  );
}

function requireSshAlias(server: { sshAlias: string | null }): string {
  if (!server.sshAlias)
    throw new BadRequestException(
      "Legacy server configuration has no SSH Config alias",
    );
  return server.sshAlias;
}

function safeServerAudit(server: {
  id: string;
  name: string;
  sshAlias: string | null;
  environment: string;
  status: string;
}): Prisma.InputJsonValue {
  return {
    id: server.id,
    name: server.name,
    sshAlias: server.sshAlias,
    environment: server.environment,
    status: server.status,
  };
}
