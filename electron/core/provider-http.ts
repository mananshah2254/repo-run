import { createHash } from 'node:crypto';
import type { ProviderFailure } from '../../shared/types';

export class ProviderError extends Error {
  constructor(public readonly detail: ProviderFailure) {
    super(detail.message);
  }
}

// Correct absolute provider times for clock skew. Never invent an exact reset time.
export function retryTime(headers: Headers, now = Date.now()): number | undefined {
  const serverDate = Date.parse(headers.get('date') || '');
  const reference = Number.isFinite(serverDate) ? serverDate : now;
  const candidates: number[] = [];
  const after = headers.get('retry-after');
  if (after !== null) {
    const seconds = /^\d+(?:\.\d+)?$/.test(after.trim()) ? Number(after) : NaN;
    const value = Number.isFinite(seconds)
      ? now + seconds * 1000
      : now + Date.parse(after) - reference;
    if (Number.isFinite(value)) candidates.push(value);
  }
  // A secondary limit may coexist with an unrelated, non-exhausted primary window.
  const remaining = headers.get('x-ratelimit-remaining') ?? headers.get('ratelimit-remaining');
  if (remaining === '0') {
    const reset = headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset');
    if (reset && /^\d+(?:\.\d+)?$/.test(reset)) {
      const value = now + Number(reset) * 1000 - reference;
      if (Number.isFinite(value)) candidates.push(value);
    }
  }
  const result = Math.max(...candidates);
  return Number.isFinite(result) && result > now && result <= 8.64e15 ? result : undefined;
}

async function readBody(response: Response, max: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel();
    throw new Error('Repository response exceeds the inspection size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const buffers: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error('Repository response exceeds the inspection size limit.');
      buffers.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(buffers).toString('utf8');
}

export class ProviderHttp {
  private cooldowns = new Map<string, ProviderFailure>();
  private cache = new Map<string, { value: string; expires: number; bytes: number }>();

  clearCache() {
    this.cache.clear();
  }

  async request(url: string, max = 6_000_000, githubToken?: string): Promise<string> {
    const target = new URL(url);
    const github = target.origin === 'https://api.github.com';
    if (
      target.username ||
      target.password ||
      (!github &&
        !(target.origin === 'https://gitlab.com' && target.pathname.startsWith('/api/v4/')))
    )
      throw new Error('Unsupported repository API endpoint.');
    const provider = github ? 'GitHub' : 'GitLab';
    const token = github ? githubToken : undefined;
    const bucket = `${provider}:${token ? createHash('sha256').update(token).digest('hex') : 'public'}`;
    // Cache only immutable revision data, never repository visibility or branch resolution.
    const immutable =
      /\/git\/trees\/[a-f0-9]{40,64}\?/.test(url) || /[?&]ref=[a-f0-9]{40,64}(?:&|$)/.test(url);
    const key = `${bucket}:${max}:${url}`;
    const cached = this.cache.get(key);
    if (immutable && cached && cached.expires > Date.now()) return cached.value;
    const cooldown = this.cooldowns.get(bucket);
    if (cooldown?.retryAt && cooldown.retryAt > Date.now()) throw new ProviderError(cooldown);
    this.cooldowns.delete(bucket);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RepoRun/0.1',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(25000),
        redirect: 'error',
      });
    } catch {
      throw new Error(`Could not reach ${provider}. Check your connection and try again.`);
    }
    if (!response.ok) {
      // Bound and classify the response; never display an untrusted provider body or credentials.
      const body = await readBody(response, 16_384).catch(() => '');
      let message = '';
      try {
        message = JSON.parse(body).message || '';
      } catch {
        /* Non-JSON errors are handled by status. */
      }
      const limited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' ||
            response.headers.get('ratelimit-remaining') === '0' ||
            response.headers.has('retry-after') ||
            (typeof message === 'string' && /\brate limit\b|\bsecondary rate\b/i.test(message))));
      if (limited) {
        const retryAt = retryTime(response.headers);
        const detail: ProviderFailure = {
          code: 'rate-limit',
          provider,
          retryAt,
          message: `${provider} API limit reached. ${retryAt ? 'Wait until the retry time below before checking again.' : 'The provider did not supply an exact retry time. Wait at least a minute before trying again.'}`,
        };
        if (retryAt) {
          if (this.cooldowns.size >= 100)
            this.cooldowns.delete(this.cooldowns.keys().next().value!);
          this.cooldowns.set(bucket, detail);
        }
        throw new ProviderError(detail);
      }
      if (response.status === 401)
        throw new ProviderError({
          code: 'authentication',
          provider,
          message: `${provider} rejected the credentials. ${github ? 'Replace or remove your GitHub token in Settings; it may have expired or been revoked.' : 'Check repository access.'}`,
        });
      if (response.status === 403)
        throw new ProviderError({
          code: 'forbidden',
          provider,
          message: `${provider} denied access to this repository or file. Check repository visibility and permissions${github ? ' and any token restrictions' : ''}. This response did not confirm a rate limit.`,
        });
      if (response.status === 404)
        throw new Error(
          'Repository or file not found. Check the URL and make sure the repository is public.',
        );
      throw new Error(`${provider} returned HTTP ${response.status}. Please try again later.`);
    }
    const value = await readBody(response, max);
    if (immutable) {
      const bytes = Buffer.byteLength(value);
      this.cache.delete(key);
      let total = [...this.cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      while (this.cache.size && (this.cache.size >= 100 || total + bytes > 20_000_000)) {
        const oldest = this.cache.keys().next().value!;
        total -= this.cache.get(oldest)!.bytes;
        this.cache.delete(oldest);
      }
      this.cache.set(key, { value, bytes, expires: Date.now() + 10 * 60_000 });
    }
    return value;
  }
}
