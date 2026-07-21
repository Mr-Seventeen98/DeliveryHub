import { HttpException, HttpStatus } from "@nestjs/common";

export class ExternalApiException extends HttpException {
  constructor(system: string, message: string, details?: unknown) {
    super(
      {
        code: `${system.toUpperCase()}_API_ERROR`,
        message,
        ...(details === undefined ? {} : { details })
      },
      HttpStatus.BAD_GATEWAY
    );
  }
}
