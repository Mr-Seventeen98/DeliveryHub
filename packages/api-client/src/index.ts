import type { ApiResponse } from '@delivery-hub/shared-types';

export class DeliveryHubApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken?: () => string | undefined,
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken?.();
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    const payload = (await response.json()) as ApiResponse<T>;
    if (!payload.success) throw new Error(`${payload.error.code}: ${String(payload.error.message)}`);
    return payload.data;
  }
}
