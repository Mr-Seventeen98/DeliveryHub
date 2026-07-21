import { BadGatewayException, Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { posix } from "node:path";

export interface SshCommandResult {
  output: string;
}

export interface ResolvedSshTarget {
  host: string;
  port: number;
  username: string;
}

@Injectable()
export class SshExecutorService {
  async resolveAlias(sshAlias: string): Promise<ResolvedSshTarget> {
    const alias = validateSshAlias(sshAlias);
    const result = await runLocalSsh(["-G", alias], 5_000);
    const values = new Map<string, string>();
    for (const line of result.output.split("\n")) {
      const separator = line.indexOf(" ");
      if (separator > 0) {
        values.set(line.slice(0, separator), line.slice(separator + 1).trim());
      }
    }
    const host = values.get("hostname");
    const username = values.get("user");
    const port = Number(values.get("port") ?? "22");
    if (!host || !username || !Number.isInteger(port))
      throw new BadGatewayException("OpenSSH Config could not resolve alias");
    return { host, port, username };
  }

  async testAlias(sshAlias: string): Promise<{ reachable: true }> {
    const result = await this.run(sshAlias, "printf DELIVERY_HUB_OK", {
      timeoutMs: 15_000,
    });
    if (result.output !== "DELIVERY_HUB_OK")
      throw new BadGatewayException("Unexpected OpenSSH test response");
    return { reachable: true };
  }

  async verifyDirectory(
    sshAlias: string,
    path: string,
    sudoPassword?: string,
  ): Promise<void> {
    const normalizedPath = normalizeRemotePath(path);
    await this.runWithSudoFallback(
      sshAlias,
      [
        `test -d ${shellQuote(normalizedPath)} || { printf 'Remote directory does not exist' >&2; exit 1; }`,
        `test -w ${shellQuote(normalizedPath)} || { printf 'Permission denied' >&2; exit 1; }`,
      ].join(" && "),
      { sudoPassword },
    );
  }

  async createDirectory(
    sshAlias: string,
    parentPath: string,
    directoryName: string,
    sudoPassword?: string,
  ): Promise<string> {
    const normalizedParentPath = normalizeRemotePath(parentPath);
    const normalizedDirectoryName = normalizeRemoteDirectoryName(directoryName);
    const directoryPath = posix.join(
      normalizedParentPath,
      normalizedDirectoryName,
    );
    await this.runWithSudoFallback(
      sshAlias,
      [
        `test -d ${shellQuote(normalizedParentPath)} || { printf 'Remote directory does not exist' >&2; exit 1; }`,
        `test -w ${shellQuote(normalizedParentPath)} || { printf 'Permission denied' >&2; exit 1; }`,
        `test ! -e ${shellQuote(directoryPath)} || { printf 'Directory already exists' >&2; exit 1; }`,
        `mkdir ${shellQuote(directoryPath)}`,
        `test -d ${shellQuote(directoryPath)} && test -w ${shellQuote(directoryPath)}`,
      ].join(" && "),
      { sudoPassword },
    );
    return directoryPath;
  }

  async listDirectories(
    sshAlias: string,
    path: string,
    sudoPassword?: string,
  ): Promise<{ directories: string[]; files: string[] }> {
    const normalizedPath = normalizeRemotePath(path);
    const result = await this.runWithSudoFallback(
      sshAlias,
      [
        `find ${shellQuote(normalizedPath)} -mindepth 1 -maxdepth 1 -type d -print`,
        "printf '\\nDELIVERY_HUB_FILE_SEPARATOR\\n'",
        `find ${shellQuote(normalizedPath)} -mindepth 1 -maxdepth 1 \\( -type f -o -type l \\) -print`,
      ].join(" && "),
      { sudoPassword },
    );
    const [directoryOutput = "", fileOutput = ""] = result.output.split(
      "DELIVERY_HUB_FILE_SEPARATOR",
      2,
    );
    const paths = (output: string): string[] =>
      output
        .split("\n")
        .map((item) => item.trim())
        .filter((item) => item.startsWith("/"));
    return {
      directories: paths(directoryOutput).sort(),
      files: paths(fileOutput).sort(),
    };
  }

  async readComposeFile(
    sshAlias: string,
    directoryPath: string,
    fileName: string,
    sudoPassword?: string,
  ): Promise<{ path: string; content: string }> {
    const normalizedDirectoryPath = normalizeRemotePath(directoryPath);
    if (!/^(?:compose|docker-compose)\.ya?ml$/i.test(fileName))
      throw new BadGatewayException("Invalid Docker Compose file name");
    const filePath = posix.join(normalizedDirectoryPath, fileName);
    const result = await this.runWithSudoFallback(
      sshAlias,
      [
        `test -f ${shellQuote(filePath)} || { printf 'Remote Compose file does not exist' >&2; exit 1; }`,
        `test "$(wc -c < ${shellQuote(filePath)})" -le 1048576 || { printf 'Remote Compose file is too large' >&2; exit 1; }`,
        `cat ${shellQuote(filePath)}`,
      ].join(" && "),
      { sudoPassword },
    );
    return { path: fileName, content: result.output };
  }

  runScript(
    sshAlias: string,
    script: string,
    sudoPassword?: string,
  ): Promise<SshCommandResult> {
    return this.runWithSudoFallback(sshAlias, "sh -s", {
      input: script,
      sudoPassword,
      timeoutMs: 10 * 60_000,
    });
  }

  private async runWithSudoFallback(
    sshAlias: string,
    remoteCommand: string,
    options: {
      input?: string;
      sudoPassword?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<SshCommandResult> {
    if (options.sudoPassword) {
      return this.run(sshAlias, remoteCommand, {
        ...options,
        sudoMode: "password",
      });
    }
    try {
      return await this.run(sshAlias, remoteCommand, options);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("请输入 sudo 提权密码")
      )
        throw error;
      return this.run(sshAlias, remoteCommand, {
        ...options,
        sudoMode: "non-interactive",
      });
    }
  }

  private run(
    sshAlias: string,
    remoteCommand: string,
    options: {
      input?: string;
      sudoPassword?: string;
      sudoMode?: "password" | "non-interactive";
      timeoutMs?: number;
    } = {},
  ): Promise<SshCommandResult> {
    const alias = validateSshAlias(sshAlias);
    const sudoMode =
      options.sudoMode ?? (options.sudoPassword ? "password" : undefined);
    const elevated = Boolean(sudoMode);
    const command =
      sudoMode === "password"
        ? `sudo -S -k -p '' -- sh -c ${shellQuote(remoteCommand)}`
        : sudoMode === "non-interactive"
          ? `sudo -n -- sh -c ${shellQuote(remoteCommand)}`
          : remoteCommand;
    const input =
      sudoMode === "password"
        ? `${options.sudoPassword}\n${options.input ?? ""}`
        : options.input;
    const timeoutMs = options.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const child = spawn(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ServerAliveInterval=5",
          "-o",
          "ServerAliveCountMax=3",
          "-o",
          "RemoteCommand=none",
          alias,
          command,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      let stderr = "";
      let settled = false;
      const append = (current: string, chunk: Buffer): string =>
        `${current}${chunk.toString()}`.slice(-32_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve({ output: output.trim() });
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new BadGatewayException("OpenSSH command timed out"));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        output = append(output, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", (error) => {
        finish(
          new BadGatewayException(
            error.message.includes("ENOENT")
              ? "OpenSSH client is not installed"
              : "OpenSSH process could not be started",
          ),
        );
      });
      child.on("close", (code) => {
        if (code === 0) return finish();
        const detail = stderr.trim().slice(-2_000);
        finish(
          new BadGatewayException(
            formatSshFailure(
              detail,
              elevated,
              code,
              sudoMode === "non-interactive",
            ),
          ),
        );
      });

      child.stdin.end(input);
    });
  }
}

export function formatSshFailure(
  detail: string,
  elevated: boolean,
  code: number | null,
  nonInteractiveSudo = false,
): string {
  if (/remote directory does not exist/i.test(detail))
    return "远程目录不存在，请重新选择服务器目录";
  if (nonInteractiveSudo && /sudo:|password is required/i.test(detail))
    return "远程命令需要 sudo 提权，请输入 sudo 提权密码后重试";
  if (
    elevated &&
    /sudo:|incorrect password|authentication failure/i.test(detail)
  )
    return "sudo 提权失败，请检查密码以及该用户的 sudo 权限";
  if (/permission denied \([^)]*(?:publickey|password)/i.test(detail))
    return "OpenSSH 登录鉴权失败，请检查 SSH Config 的用户、密钥或密码配置";
  if (/permission denied|operation not permitted/i.test(detail))
    return "远程命令权限不足，请输入 sudo 提权密码后重试";
  return detail
    ? `OpenSSH command failed: ${detail}`
    : `OpenSSH command exited with ${code ?? "unknown"}`;
}

function runLocalSsh(
  arguments_: string[],
  timeoutMs: number,
): Promise<SshCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    let settled = false;
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString()}`.slice(-32_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ output: output.trim() });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new BadGatewayException("OpenSSH Config resolution timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output = append(output, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", () => {
      finish(new BadGatewayException("OpenSSH client is not installed"));
    });
    child.on("close", (code) => {
      if (code === 0) return finish();
      finish(
        new BadGatewayException(
          stderr.trim() || "OpenSSH Config resolution failed",
        ),
      );
    });
  });
}

export function validateSshAlias(value: string): string {
  const alias = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(alias))
    throw new BadGatewayException("Invalid SSH config alias");
  return alias;
}

function normalizeRemotePath(path: string): string {
  const normalized = posix.normalize(path.trim());
  if (!normalized.startsWith("/"))
    throw new BadGatewayException("Remote path must be absolute");
  return normalized;
}

export function normalizeRemoteDirectoryName(value: string): string {
  const name = value.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new BadGatewayException("Invalid remote directory name");
  }
  return name;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
