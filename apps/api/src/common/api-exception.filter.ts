import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? (payload as { message: string | string[] }).message
      : status === HttpStatus.INTERNAL_SERVER_ERROR
        ? 'Internal server error'
        : String(payload);

    const code = typeof payload === 'object' && payload && 'code' in payload
      ? String((payload as { code: unknown }).code)
      : exception instanceof HttpException
        ? `HTTP_${status}`
        : 'INTERNAL_ERROR';
    const details = typeof payload === 'object' && payload && 'details' in payload
      ? (payload as { details: unknown }).details
      : undefined;

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
      requestId: request.headers['x-request-id'],
      timestamp: new Date().toISOString(),
    });
  }
}
