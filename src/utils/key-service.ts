/**
 * MCP Key Service client for credential resolution.
 *
 * When KEY_SERVICE_URL and KEY_SERVICE_TOKEN are configured, user API keys
 * (usr_XXXXXXXX) are resolved via the external key service which returns
 * the user's LTA DataMall API key.
 */

export type ResolveResult =
  | { ok: true; apiKey: string }
  | { ok: false; reason: 'invalid_key' | 'service_unavailable' | 'malformed_response'; message: string };

const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL || '';
const KEY_SERVICE_TOKEN = process.env.KEY_SERVICE_TOKEN || '';

const CACHE_TTL_MS = 60_000;          // 60 seconds
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const REQUEST_TIMEOUT_MS = 10_000;     // 10 seconds

// Cache: only successful resolutions are cached
interface CacheEntry {
  apiKey: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// In-flight promise deduplication
const pending = new Map<string, Promise<ResolveResult>>();

// Periodic cache cleanup to prevent unbounded growth
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) {
      cache.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref?.();

function extractErrorMessage(rawBody: string): string {
  const bodySnippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!bodySnippet) return '';

  try {
    const parsed = JSON.parse(rawBody) as { error?: string; message?: string };
    return parsed.error || parsed.message || bodySnippet;
  } catch {
    return bodySnippet;
  }
}

/**
 * Returns true if the key service is configured and should be used.
 */
export function isKeyServiceEnabled(): boolean {
  return Boolean(KEY_SERVICE_URL && KEY_SERVICE_TOKEN);
}

/**
 * Resolve a user API key via the MCP Key Service.
 *
 * Maps key-service HTTP statuses to typed results:
 * - 401 → invalid_key (user's key is bad)
 * - 400 → service_unavailable (server sent a malformed internal request)
 * - 403 → service_unavailable (server token mismatch, not user's fault)
 * - 500 → service_unavailable (upstream error)
 * - 200 { valid: true } → ok
 * - 200 { valid: false } → invalid_key
 */
export async function resolveKeyCredentials(userKey: string): Promise<ResolveResult> {
  // Check cache first
  const cached = cache.get(userKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { ok: true, apiKey: cached.apiKey };
  }

  // Deduplicate concurrent requests for the same key
  const inflight = pending.get(userKey);
  if (inflight) {
    return inflight;
  }

  const promise = doResolve(userKey);
  pending.set(userKey, promise);

  try {
    return await promise;
  } finally {
    pending.delete(userKey);
  }
}

async function doResolve(userKey: string): Promise<ResolveResult> {
  const shortKey = userKey.substring(0, 12);

  try {
    const res = await fetch(KEY_SERVICE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: userKey, server_id: 'ltadatamallsg' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!res.ok) {
      let rawBody = '';
      try {
        rawBody = await res.text();
      } catch {
        rawBody = '';
      }
      const errorMessage = extractErrorMessage(rawBody);

      // 401 = invalid/revoked/suspended user key
      if (res.status === 401 && isJson) {
        return { ok: false, reason: 'invalid_key', message: errorMessage || 'Invalid or expired user key' };
      }

      // 400 = malformed internal request from this server
      // 403 = bad server token or server_id mismatch (server misconfiguration, not user error)
      // 500 = decryption failure (upstream error)
      // Anything else = service_unavailable
      console.error(
        `Key service returned ${res.status} (${contentType || 'unknown'}) for key ${shortKey}...` +
        (errorMessage ? ` Body: ${errorMessage}` : '')
      );
      return {
        ok: false,
        reason: 'service_unavailable',
        message: errorMessage || `Key service returned status ${res.status}`,
      };
    }

    if (!isJson) {
      const bodySnippet = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
      console.error(
        `Key service returned non-JSON success (${contentType || 'unknown'}) for key ${shortKey}...` +
        (bodySnippet ? ` Body: ${bodySnippet}` : '')
      );
      return { ok: false, reason: 'malformed_response', message: 'Key service returned non-JSON response' };
    }

    const data = await res.json() as {
      valid?: boolean;
      credentials?: Record<string, string>;
    };

    if (!data.valid) {
      return { ok: false, reason: 'invalid_key', message: 'Key service reported key as invalid' };
    }

    // The connector field is "apiKey" (may be empty if user registered without one)
    const apiKey = data.credentials?.apiKey ?? '';

    // Cache successful resolution
    cache.set(userKey, {
      apiKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return { ok: true, apiKey };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`Key service request timed out for key ${shortKey}...`);
    } else {
      console.error(`Key service request failed for key ${shortKey}...:`, error);
    }
    return { ok: false, reason: 'service_unavailable', message: 'Key service unreachable' };
  }
}
