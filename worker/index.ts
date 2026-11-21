import type { Env, ErrorResponse, HealthResponse } from './types';
import { AiServiceError, GeminiService } from './gemini';
import type {
  AiChatRequest,
  AiInsightsRequest,
  AiRecommendationsRequest,
  AiReportRequest,
  DatasetContext,
} from './types';

/** Largest accepted request body. A dataset context is a few kilobytes; anything near this is abuse. */
const MAX_BODY_BYTES = 256 * 1024;

function createHealthResponse(): HealthResponse {
  return {
    status: 'ok',
    service: 'datamind-ai',
    phase: '0',
    timestamp: new Date().toISOString(),
  };
}

function createErrorResponse(error: string, message: string, path: string): ErrorResponse {
  return { error, message, path };
}

/** Removes trailing slashes so `/api/health/` behaves like `/api/health`. */
function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

function isApiRequest(normalizedPathname: string): boolean {
  return normalizedPathname === '/api' || normalizedPathname.startsWith('/api/');
}

/** JSON response helper. HEAD requests get the same status and headers with no body. */
function jsonResponse(
  request: Request,
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function isAiRequest(normalizedPathname: string): boolean {
  return normalizedPathname.startsWith('/api/ai/');
}

class BadRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Parses a JSON request body, rejecting malformed or oversized payloads. */
async function parseJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new BadRequestError('Request body must be JSON.');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new BadRequestError('Request body is too large.', 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new BadRequestError('Request body is too large.', 413);
  if (!text.trim()) throw new BadRequestError('Request body is empty.');
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError('Request body is not valid JSON.');
  }
}

/**
 * The AI endpoints spend the owner's Gemini quota, so they only answer the app itself: a browser request that
 * comes from another site (CSRF, hot-linking from a page that is not this app) is refused.
 */
function isCrossSite(request: Request): boolean {
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

function aiErrorResponse(error: unknown, pathname: string): Response {
  let message = 'The AI service could not complete the request.';
  let status = 500;
  if (error instanceof AiServiceError) {
    message = error.message;
    status = error.status;
  } else {
    // Unexpected failure: log it for the operator, never forward it to the browser.
    console.error('Unexpected AI error', error instanceof Error ? error.message : String(error));
  }
  return new Response(JSON.stringify(createErrorResponse('AI Error', message, pathname)), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function badRequest(request: Request, message: string, pathname: string, status = 400): Response {
  return jsonResponse(request, createErrorResponse('Bad Request', message, pathname), status);
}

type WithContext = { datasetId?: unknown; context?: unknown };

/** Checks the fields every AI endpoint needs; returns an error message, or null when the body is fine. */
function validateCommon(body: unknown): string | null {
  const req = body as WithContext | null;
  if (!req || typeof req !== 'object') return 'Request body must be a JSON object.';
  if (!req.datasetId || typeof req.datasetId !== 'string') return 'datasetId is required.';
  if (!req.context || typeof req.context !== 'object' || Array.isArray(req.context)) return 'context is required.';
  return null;
}

async function handleAiRequest(
  request: Request,
  pathname: string,
  normalizedPathname: string,
  env: Env
): Promise<Response> {
  const service = new GeminiService({ env });

  const route = normalizedPathname.slice('/api/ai/'.length);
  const [endpoint] = route.split('/');

  if (request.method !== 'POST') {
    return jsonResponse(
      request,
      createErrorResponse('Method Not Allowed', 'Only POST is allowed for AI endpoints', pathname),
      405,
      { Allow: 'POST' }
    );
  }

  if (!['insights', 'chat', 'recommendations', 'reports'].includes(endpoint)) {
    return jsonResponse(request, createErrorResponse('Not Found', `API endpoint ${pathname} not found`, pathname), 404);
  }

  if (isCrossSite(request)) {
    return jsonResponse(request, createErrorResponse('Forbidden', 'Cross-site requests are not allowed.', pathname), 403);
  }

  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    const status = error instanceof BadRequestError ? error.status : 400;
    return badRequest(request, error instanceof Error ? error.message : 'Invalid JSON body.', pathname, status);
  }

  const invalid = validateCommon(body);
  if (invalid) return badRequest(request, invalid, pathname);
  const req = body as { datasetId: string; context: DatasetContext };

  if (endpoint === 'chat') {
    const chat = body as AiChatRequest;
    if (!chat.message || typeof chat.message !== 'string' || !chat.message.trim()) {
      return badRequest(request, 'message is required.', pathname);
    }
    if (chat.message.length > 4_000) return badRequest(request, 'message is too long (4000 characters at most).', pathname);
  }

  try {
    // Report a missing server key before doing any other work for the request.
    service.assertConfigured();
    const headers = { 'Cache-Control': 'no-store' };

    if (endpoint === 'insights') {
      const response = await service.generateInsights((req as AiInsightsRequest).context);
      return jsonResponse(request, response, 200, headers);
    }
    if (endpoint === 'chat') {
      const chat = body as AiChatRequest;
      const history = Array.isArray(chat.history) ? chat.history : [];
      const response = await service.chat(chat.context, chat.message, history);
      return jsonResponse(request, response, 200, headers);
    }
    if (endpoint === 'recommendations') {
      const response = await service.generateRecommendations((req as AiRecommendationsRequest).context);
      return jsonResponse(request, response, 200, headers);
    }
    const response = await service.generateReport((req as AiReportRequest).context);
    return jsonResponse(request, response, 200, headers);
  } catch (error) {
    return aiErrorResponse(error, pathname);
  }
}

async function handleApiRequest(request: Request, pathname: string, normalizedPathname: string, env: Env): Promise<Response> {
  if (normalizedPathname === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse(
        request,
        createErrorResponse('Method Not Allowed', 'Only GET and HEAD methods are allowed', pathname),
        405,
        { Allow: 'GET, HEAD' }
      );
    }
    return jsonResponse(request, createHealthResponse(), 200, { 'Cache-Control': 'no-store' });
  }

  if (isAiRequest(normalizedPathname)) {
    return handleAiRequest(request, pathname, normalizedPathname, env);
  }

  return jsonResponse(
    request,
    createErrorResponse('Not Found', `API endpoint ${pathname} not found`, pathname),
    404
  );
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const normalizedPathname = normalizePathname(pathname);

    if (isApiRequest(normalizedPathname)) {
      return handleApiRequest(request, pathname, normalizedPathname, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
