import type {
  AiChatRequest,
  AiChatResponse,
  AiInsightsResponse,
  AiRecommendationsResponse,
  AiReportResponse,
  HealthResponse,
  ApiResponse,
  DatasetContext,
} from '@/types';

const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  // Only declare a JSON body when there is one; a Content-Type on GET is pointless
  // and forces a CORS preflight for cross-origin calls.
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    // Cancelled requests must stay AbortErrors so callers can ignore them.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server. Check your internet connection and try again.', 0, url);
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json() as { message?: string; error?: string };
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      // Use default error message
    }
    throw new ApiError(errorMessage, response.status, url);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  // Non-JSON bodies are returned as plain text; callers should use T = string for these.
  return (await response.text()) as unknown as T;
}

export const api = {
  async get<T>(endpoint: string): Promise<T> {
    return request<T>(endpoint, { method: 'GET' });
  },

  async post<T>(endpoint: string, data: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    });
  },

  async put<T>(endpoint: string, data: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete<T>(endpoint: string): Promise<T> {
    return request<T>(endpoint, { method: 'DELETE' });
  },
};

export async function checkHealth(): Promise<ApiResponse<HealthResponse>> {
  try {
    const data = await api.get<HealthResponse>('/health');
    return { data, error: null, loading: false };
  } catch (error) {
    if (error instanceof ApiError) {
      return { data: null, error: error.message, loading: false };
    }
    return { data: null, error: 'Unknown error occurred', loading: false };
  }
}

/** POST /api/ai/insights — generate AI insights from the dataset context. */
export async function generateAiInsights(context: DatasetContext, signal?: AbortSignal): Promise<AiInsightsResponse> {
  return api.post<AiInsightsResponse>('/ai/insights', { datasetId: context.datasetId, context }, signal);
}

/** POST /api/ai/chat — ask a question about the dataset. */
export async function askAiAboutDataset(
  datasetId: string,
  context: DatasetContext,
  message: string,
  history: AiChatRequest["history"],
  signal?: AbortSignal
): Promise<AiChatResponse> {
  return api.post<AiChatResponse>('/ai/chat', { datasetId, context, message, history }, signal);
}

/** POST /api/ai/recommendations — generate evidence-based recommendations. */
export async function generateAiRecommendations(context: DatasetContext, signal?: AbortSignal): Promise<AiRecommendationsResponse> {
  return api.post<AiRecommendationsResponse>('/ai/recommendations', { datasetId: context.datasetId, context }, signal);
}

/** POST /api/ai/reports — generate a comprehensive AI report. */
export async function generateAiReport(context: DatasetContext, signal?: AbortSignal): Promise<AiReportResponse> {
  return api.post<AiReportResponse>('/ai/reports', { datasetId: context.datasetId, context }, signal);
}

export { ApiError };
export type { HealthResponse };