import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService, type SessionTokens } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { Public } from "./public.decorator";

const REFRESH_COOKIE_NAME = "delivery_hub_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @Public()
  @ApiOperation({ summary: "Sign in with a local administrator account" })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const tokens = await this.authService.login(dto);
    this.setRefreshCookie(response, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post("refresh")
  @Public()
  @ApiOperation({ summary: "Refresh the current browser session" })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const refreshToken = this.readCookie(request, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      throw new UnauthorizedException("Refresh token required");
    }

    const tokens = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post("logout")
  @Public()
  @ApiOperation({ summary: "Sign out the current browser session" })
  logout(@Res({ passthrough: true }) response: Response): { loggedOut: true } {
    response.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_ENV === "production",
      path: REFRESH_COOKIE_PATH,
    });
    return { loggedOut: true };
  }

  private setRefreshCookie(response: Response, tokens: SessionTokens): void {
    response.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_ENV === "production",
      path: REFRESH_COOKIE_PATH,
      maxAge: tokens.refreshExpiresIn * 1000,
    });
  }

  private readCookie(request: Request, name: string): string | null {
    const cookie = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    if (!cookie) return null;

    try {
      return decodeURIComponent(cookie.slice(name.length + 1));
    } catch {
      return null;
    }
  }
}
