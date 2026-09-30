import type {
  ApiError,
  DataResponse,
  PaginatedResponse,
} from '@linepool/contracts';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function hasJsonContent(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false;
}

async function parseError(response: Response): Promise<ApiClientError> {
  if (hasJsonContent(response)) {
    const payload = (await response.json()) as Partial<ApiError>;
    if (payload.error?.code && payload.error.message) {
      return new ApiClientError(
        response.status,
        payload.error.code,
        payload.error.message,
        payload.error.details,
      );
    }
  }

  return new ApiClientError(
    response.status,
    'NETWORK_ERROR',
    '服务暂时不可用，请稍后重试',
  );
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiClientError(0, 'NETWORK_ERROR', '无法连接到本地服务');
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  return response;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, init);
  const payload = (await response.json()) as DataResponse<T>;
  return payload.data;
}

export async function apiEnvelopeRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, init);
  return (await response.json()) as T;
}

export async function apiPaginatedRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<PaginatedResponse<T>> {
  const response = await apiFetch(path, init);
  return (await response.json()) as PaginatedResponse<T>;
}
