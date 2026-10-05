import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderHttp, retryTime } from '../electron/core/provider-http';
import { fetchRepository } from '../electron/core/repository';
import { GithubConnection } from '../electron/github';
import { encodeError, decodeError } from '../shared/errors';

const now = Date.UTC(2026, 9, 5, 12);
const endpoint = 'https://api.github.com/repos/example/repository';
const revision = 'a'.repeat(40);
const reply = (status: number, headers: Record<string, string> = {}, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('provider errors and wait times', () => {
  it('reads Retry-After seconds and HTTP dates, correcting server clock skew', () => {
    expect(retryTime(new Headers({ 'retry-after': '90' }), now)).toBe(now + 90_000);
    expect(
      retryTime(
        new Headers({
          date: new Date(now - 60_000).toUTCString(),
          'retry-after': new Date(now).toUTCString(),
        }),
        now,
      ),
    ).toBe(now + 60_000);
  });
  it('honors the later of exhausted primary reset and Retry-After', () => {
    expect(
      retryTime(
        new Headers({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(now / 1000 + 120),
          'retry-after': '60',
        }),
        now,
      ),
    ).toBe(now + 120_000);
    expect(
      retryTime(
        new Headers({ 'ratelimit-remaining': '0', 'ratelimit-reset': String(now / 1000 + 180) }),
        now,
      ),
    ).toBe(now + 180_000);
  });
  it('does not use a non-exhausted primary reset for a secondary limit', () => {
    expect(
      retryTime(
        new Headers({
          'x-ratelimit-remaining': '100',
          'x-ratelimit-reset': String(now / 1000 + 3600),
          'retry-after': '60',
        }),
        now,
      ),
    ).toBe(now + 60_000);
  });
  it('does not invent reset times for missing, malformed or expired headers', () => {
    for (const headers of [
      {},
      { 'retry-after': 'oops' },
      { 'retry-after': '-1' },
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' },
    ])
      expect(retryTime(new Headers(headers as Record<string, string>), now)).toBeUndefined();
  });
  it('distinguishes ordinary forbidden and expired-token responses from rate limits', async () => {
    const mock = vi.fn().mockResolvedValueOnce(reply(403)).mockResolvedValueOnce(reply(401));
    vi.stubGlobal('fetch', mock);
    const client = new ProviderHttp();
    await expect(client.request(endpoint)).rejects.toMatchObject({ detail: { code: 'forbidden' } });
    await expect(client.request(endpoint)).rejects.toMatchObject({
      detail: { code: 'authentication' },
    });
  });
  it('recognizes secondary throttling without exposing provider text or fake timing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reply(403, {}, { message: 'You have exceeded a secondary rate limit. SECRET' }),
        ),
    );
    await expect(new ProviderHttp().request(endpoint)).rejects.toMatchObject({
      detail: { code: 'rate-limit', retryAt: undefined },
    });
    await expect(new ProviderHttp().request(endpoint)).rejects.not.toThrow('SECRET');
  });
  it('blocks repeat requests until reset, then allows a manual retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const mock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { 'retry-after': '60' }))
      .mockResolvedValueOnce(reply(200));
    vi.stubGlobal('fetch', mock);
    const client = new ProviderHttp();
    await expect(client.request(endpoint)).rejects.toMatchObject({
      detail: { retryAt: now + 60_000 },
    });
    await expect(client.request(endpoint)).rejects.toThrow('API limit');
    expect(mock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 60_001);
    await expect(client.request(endpoint)).resolves.toBe('{}');
  });
  it('keeps anonymous, token and GitLab allowances separate', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { 'retry-after': '60' }))
      .mockImplementation(async () => reply(200));
    vi.stubGlobal('fetch', mock);
    const client = new ProviderHttp();
    await expect(client.request(endpoint)).rejects.toThrow('API limit');
    await client.request(endpoint, undefined, 'test_token');
    await client.request('https://gitlab.com/api/v4/projects/example', undefined, 'test_token');
    expect(mock.mock.calls[1][1].headers.Authorization).toBe('Bearer test_token');
    expect(mock.mock.calls[2][1].headers.Authorization).toBeUndefined();
    expect(mock.mock.calls[1][1].redirect).toBe('error');
    await expect(
      client.request('https://evil.example/api', undefined, 'test_token'),
    ).rejects.toThrow('Unsupported');
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it('reuses immutable data, but always refetches metadata and segregates cache by token', async () => {
    const mock = vi.fn().mockImplementation(async () => reply(200));
    vi.stubGlobal('fetch', mock);
    const client = new ProviderHttp();
    const immutable = `${endpoint}/git/trees/${revision}?recursive=1`;
    await client.request(immutable);
    await client.request(immutable);
    expect(mock).toHaveBeenCalledTimes(1);
    await client.request(endpoint);
    await client.request(endpoint);
    await client.request(immutable, undefined, 'test_token');
    expect(mock).toHaveBeenCalledTimes(4);
    client.clearCache();
    await client.request(immutable);
    expect(mock).toHaveBeenCalledTimes(5);
  });
  it('aborts a throttled manifest batch instead of returning a successful partial scan', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, {}, { default_branch: 'main' }))
      .mockResolvedValueOnce(reply(200, {}, { sha: revision }))
      .mockResolvedValueOnce(
        reply(
          200,
          {},
          {
            tree: ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile'].map(
              (path) => ({ path, type: 'blob', mode: '100644' }),
            ),
          },
        ),
      )
      .mockImplementation(async () => reply(429, { 'retry-after': '120' }));
    vi.stubGlobal('fetch', mock);
    await expect(fetchRepository('https://github.com/example/repository')).rejects.toMatchObject({
      detail: { code: 'rate-limit' },
    });
    expect(mock).toHaveBeenCalledTimes(7); // Metadata + revision + tree + one bounded four-file batch.
  });
  it('still refuses private repositories even with authentication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, {}, { private: true })));
    await expect(
      fetchRepository('https://github.com/example/repository', { githubToken: 'test_token' }),
    ).rejects.toThrow('Only public');
  });
  it('preserves structured retry information across an Electron message-only error boundary', () => {
    const detail = {
      message: 'GitHub API limit reached.',
      code: 'rate-limit' as const,
      provider: 'GitHub' as const,
      retryAt: now,
    };
    expect(decodeError(new Error(encodeError(detail)))).toEqual(detail);
    expect(decodeError(new Error('ordinary failure'))).toEqual({ message: 'ordinary failure' });
  });
});

describe('optional GitHub credentials', () => {
  it('validates before encrypted persistence, isolates accounts and supports removal', async () => {
    const values = new Map<string, string>();
    const storage = {
      authStorage: {
        getItem: vi.fn(async (key: string) => values.get(key) || null),
        setItem: vi.fn(async (key: string, value: string) => {
          values.set(key, value);
        }),
        removeItem: vi.fn(async (key: string) => {
          values.delete(key);
        }),
      },
    };
    const mock = vi
      .fn()
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200, {}, { login: 'tester' }));
    vi.stubGlobal('fetch', mock);
    const connection = new GithubConnection(storage, new ProviderHttp());
    const token = 'github_pat_test_fixture_only';
    await expect(connection.save('account-a', token)).rejects.toThrow('rejected');
    expect(storage.authStorage.setItem).not.toHaveBeenCalled();
    await connection.save('account-a', token);
    expect(await connection.token('account-a')).toBe(token);
    expect(await connection.token('account-b')).toBeUndefined();
    await connection.remove('account-a');
    expect(await connection.token('account-a')).toBeUndefined();
    expect(mock.mock.calls[0][0]).toBe('https://api.github.com/user');
    await expect(connection.save('account-a', 'password')).rejects.toThrow('personal access token');
  });
});
