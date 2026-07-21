import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../database/prisma.service";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  it("does not reveal whether an account exists", async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null) } };
    const jwt = { signAsync: vi.fn() };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as never,
    );

    await expect(
      service.login({ username: "missing", password: "long-enough" }),
    ).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it("rotates a valid refresh token and issues a new session", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          username: "admin",
          role: "ADMIN",
          enabled: true,
        }),
      },
    };
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: "user-1",
        tokenType: "refresh",
      }),
      signAsync: vi
        .fn()
        .mockResolvedValueOnce("new-access-token")
        .mockResolvedValueOnce("new-refresh-token"),
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as never,
    );

    await expect(service.refresh("refresh-token")).resolves.toEqual({
      accessToken: "new-access-token",
      expiresIn: 900,
      refreshToken: "new-refresh-token",
      refreshExpiresIn: 604800,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
    });
    expect(jwt.signAsync).toHaveBeenCalledTimes(2);
  });

  it("does not accept an access token as a refresh token", async () => {
    const prisma = { user: { findUnique: vi.fn() } };
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: "user-1",
        tokenType: "access",
      }),
      signAsync: vi.fn(),
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as never,
    );

    await expect(service.refresh("access-token")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
