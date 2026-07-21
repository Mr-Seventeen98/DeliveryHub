import { describe, expect, it, vi } from "vitest";
import {
  formatSshFailure,
  normalizeRemoteDirectoryName,
  SshExecutorService,
  validateSshAlias,
} from "./ssh-executor.service";

describe("SshExecutorService", () => {
  it("retries deployment scripts with passwordless sudo and preserves the script input", async () => {
    const executor = new SshExecutorService();
    const run = vi
      .spyOn(
        executor as unknown as {
          run: (
            alias: string,
            command: string,
            options: Record<string, unknown>,
          ) => Promise<{ output: string }>;
        },
        "run",
      )
      .mockRejectedValueOnce(
        new Error("远程命令权限不足，请输入 sudo 提权密码后重试"),
      )
      .mockResolvedValueOnce({ output: "done" });

    await expect(
      executor.runScript("production", "docker compose up -d\n"),
    ).resolves.toEqual({ output: "done" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, "production", "sh -s", {
      input: "docker compose up -d\n",
      sudoPassword: undefined,
      timeoutMs: 10 * 60_000,
    });
    expect(run).toHaveBeenNthCalledWith(2, "production", "sh -s", {
      input: "docker compose up -d\n",
      sudoPassword: undefined,
      sudoMode: "non-interactive",
      timeoutMs: 10 * 60_000,
    });
  });
});

describe("formatSshFailure", () => {
  it("does not misreport SSH authentication failure as sudo failure", () => {
    expect(
      formatSshFailure(
        "root@example: Permission denied (publickey,password).",
        false,
        255,
      ),
    ).toContain("OpenSSH 登录鉴权失败");
  });

  it("still reports remote filesystem permission failures as sudo candidates", () => {
    expect(formatSshFailure("find: Permission denied", false, 1)).toContain(
      "sudo 提权密码",
    );
  });

  it("distinguishes a missing directory from a permission failure", () => {
    expect(
      formatSshFailure("Remote directory does not exist", false, 1),
    ).toContain("远程目录不存在");
  });

  it("asks for a password only when non-interactive sudo is unavailable", () => {
    expect(
      formatSshFailure("sudo: a password is required", true, 1, true),
    ).toContain("请输入 sudo 提权密码");
  });
});

describe("validateSshAlias", () => {
  it("accepts a configured OpenSSH host alias", () => {
    expect(validateSshAlias(" production-m2 ")).toBe("production-m2");
  });

  it("rejects aliases that could be interpreted as SSH arguments", () => {
    expect(() => validateSshAlias("-oProxyCommand=bad")).toThrow(
      "Invalid SSH config alias",
    );
    expect(() => validateSshAlias("prod; shutdown")).toThrow(
      "Invalid SSH config alias",
    );
  });
});

describe("normalizeRemoteDirectoryName", () => {
  it("accepts a single safe path segment", () => {
    expect(normalizeRemoteDirectoryName(" delivery hub ")).toBe("delivery hub");
  });

  it("rejects traversal and nested paths", () => {
    expect(() => normalizeRemoteDirectoryName("..")).toThrow(
      "Invalid remote directory name",
    );
    expect(() => normalizeRemoteDirectoryName("app/releases")).toThrow(
      "Invalid remote directory name",
    );
  });
});
