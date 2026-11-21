// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/types';

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

const call = (path: string, init?: RequestInit, env?: Env) =>
  worker.fetch(new Request(`http://localhost${path}`, init), env ?? defaultEnv(), makeCtx());

function defaultEnv(): Env {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    // No GEMINI_API_KEY: exercises the missing-credential path without network.
  } as Env;
}

function envWithKey(): Env {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
  } as Env;
}

describe('Worker AI endpoints (Phase 4)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  describe('POST /api/ai/insights', () => {
    it('returns 400 for a non-JSON body', async () => {
      const response = await call(
        '/api/ai/insights',
        { method: 'POST', body: 'not json', headers: { 'Content-Type': 'application/json' } }
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Bad Request');
    });

    it('returns 400 when datasetId is missing', async () => {
      const response = await call(
        '/api/ai/insights',
        {
          method: 'POST',
          body: JSON.stringify({ context: {} }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Bad Request');
    });

    it('returns 400 when context is missing', async () => {
      const response = await call(
        '/api/ai/insights',
        {
          method: 'POST',
          body: JSON.stringify({ datasetId: 'ds-1' }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Bad Request');
    });

    it('returns 401 when the Gemini API key is not configured', async () => {
      const response = await call(
        '/api/ai/insights',
        {
          method: 'POST',
          body: JSON.stringify({ datasetId: 'ds-1', context: {} }),
          headers: { 'Content-Type': 'application/json' },
        },
        defaultEnv()
      );
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('AI Error');
    });

    it('returns 405 for GET', async () => {
      const response = await call('/api/ai/insights', { method: 'GET' }, envWithKey());
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
    });
  });

  describe('POST /api/ai/chat', () => {
    it('returns 400 when message is missing', async () => {
      const response = await call(
        '/api/ai/chat',
        {
          method: 'POST',
          body: JSON.stringify({ datasetId: 'ds-1', context: {}, history: [] }),
          headers: { 'Content-Type': 'application/json' },
        },
        envWithKey()
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when context is missing', async () => {
      const response = await call(
        '/api/ai/chat',
        {
          method: 'POST',
          body: JSON.stringify({ datasetId: 'ds-1', message: 'hi', history: [] }),
          headers: { 'Content-Type': 'application/json' },
        },
        envWithKey()
      );
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/ai/recommendations', () => {
    it('returns 400 when datasetId is missing', async () => {
      const response = await call(
        '/api/ai/recommendations',
        {
          method: 'POST',
          body: JSON.stringify({ context: {} }),
          headers: { 'Content-Type': 'application/json' },
        },
        envWithKey()
      );
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/ai/reports', () => {
    it('returns 401 when the Gemini API key is not configured', async () => {
      const response = await call(
        '/api/ai/reports',
        {
          method: 'POST',
          body: JSON.stringify({ datasetId: 'ds-1', context: {} }),
          headers: { 'Content-Type': 'application/json' },
        },
        defaultEnv()
      );
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('AI Error');
    });
  });

  describe('Unknown AI endpoints', () => {
    it('returns 404 for an unknown /api/ai path', async () => {
      const response = await call(
        '/api/ai/unknown',
        { method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } },
        envWithKey()
      );
      expect(response.status).toBe(404);
    });
  });
});
