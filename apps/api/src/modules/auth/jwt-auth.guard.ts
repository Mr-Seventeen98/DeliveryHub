import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator";

export interface AuthenticatedUser {
  sub: string;
  username: string;
  role: "ADMIN" | "USER";
  tokenType: "access";
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Bearer token required");
    }
    try {
      const user = await this.jwt.verifyAsync<AuthenticatedUser>(
        authorization.slice(7),
      );
      if (user.tokenType !== "access") {
        throw new UnauthorizedException("Invalid access token");
      }
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}
