import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { verify } from "argon2";
import { PrismaService } from "../../database/prisma.service";
import type { LoginDto } from "./dto/login.dto";

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;
const REFRESH_TOKEN_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

export interface SessionTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
}

interface RefreshTokenPayload {
  sub: string;
  tokenType: "refresh";
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<SessionTokens> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (!user?.enabled || !(await verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException("Invalid username or password");
    }

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    if (payload.tokenType !== "refresh") {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user?.enabled) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    return this.issueTokens(user);
  }

  private async issueTokens(user: {
    id: string;
    username: string;
    role: string;
  }): Promise<SessionTokens> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        {
          sub: user.id,
          username: user.username,
          role: user.role,
          tokenType: "access",
        },
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS },
      ),
      this.jwt.signAsync(
        { sub: user.id, tokenType: "refresh" },
        { expiresIn: REFRESH_TOKEN_EXPIRES_IN_SECONDS },
      ),
    ]);

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      refreshToken,
      refreshExpiresIn: REFRESH_TOKEN_EXPIRES_IN_SECONDS,
    };
  }
}
