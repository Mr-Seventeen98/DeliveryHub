import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Agent, request } from "undici";

export interface ExternalRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  verifySsl?: boolean;
}

export interface ExternalResponse<T> {
  statusCode: number;
  body: T;
  headers: Record<string, string>;
}

@Injectable()
export class ExternalHttpClient {
  private readonly connectTimeout: number;
  private readonly readTimeout: number;

  constructor(config: ConfigService) {
    this.connectTimeout =
      Number(config.get("DEFAULT_HTTP_CONNECT_TIMEOUT_SECONDS") ?? 10) * 1000;
    this.readTimeout =
      Number(config.get("DEFAULT_HTTP_READ_TIMEOUT_SECONDS") ?? 30) * 1000;
  }

  async request<T>(
    url: string,
    options: ExternalRequestOptions = {}
  ): Promise<ExternalResponse<T>> {
    const dispatcher = new Agent({
      connect: {
        timeout: this.connectTimeout,
        rejectUnauthorized: options.verifySsl ?? true
      },
      headersTimeout: this.readTimeout,
      bodyTimeout: this.readTimeout
    });
    try {
      const response = await request(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        dispatcher
      });
      const text = await response.body.text();
      let body: unknown = text;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      return {
        statusCode: response.statusCode,
        body: body as T,
        headers: Object.fromEntries(
          Object.entries(response.headers)
            .filter((entry): entry is [string, string | string[]] =>
              entry[1] !== undefined,
            )
            .map(([name, value]) => [
              name.toLowerCase(),
              Array.isArray(value) ? value.join(", ") : value,
            ]),
        ),
      };
    } finally {
      await dispatcher.close();
    }
  }
}
