import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, map } from "rxjs";

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.path.endsWith("/servers/events") &&
      request.headers.accept?.includes("text/event-stream")
    ) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        requestId: request.headers["x-request-id"],
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
