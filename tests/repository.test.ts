import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRepository } from '../electron/core/repository';

const revision = 'a'.repeat(40);
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
describe('remote repository inspection', () => {
  it('pins file reads to the resolved revision and skips symlinks', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response({ default_branch: 'main', stargazers_count: 1 }))
      .mockResolvedValueOnce(response({ sha: revision }))
      .mockResolvedValueOnce(
        response({
          tree: [
            { path: 'package.json', type: 'blob', mode: '100644' },
            { path: 'nested/package.json', type: 'blob', mode: '120000' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({ encoding: 'base64', size: 2, content: Buffer.from('{}').toString('base64') }),
      );
    vi.stubGlobal('fetch', mock);
    const result = await fetchRepository('https://github.com/example/repository');
    expect(result.repository.commit).toBe(revision);
    expect(result.files).toEqual({ 'package.json': '{}' });
    expect(mock.mock.calls[3][0]).toContain(`?ref=${revision}`);
    expect(mock.mock.calls[0][1].redirect).toBe('error');
  });
  it('explains provider rate limits without retrying in a loop', async () => {
    const mock = vi.fn().mockResolvedValue(response({}, 429));
    vi.stubGlobal('fetch', mock);
    await expect(fetchRepository('https://github.com/example/repository')).rejects.toThrow(
      'API limit',
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('preserves a notice when a manifest cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ default_branch: 'main' }))
        .mockResolvedValueOnce(response({ sha: revision }))
        .mockResolvedValueOnce(
          response({
            tree: [{ path: 'package.json', type: 'blob', mode: '100644' }],
            truncated: true,
          }),
        )
        .mockResolvedValueOnce(response({}, 404)),
    );
    const result = await fetchRepository('https://github.com/example/repository');
    expect(Object.keys(result.files)).toHaveLength(0);
    expect(result.notices.join(' ')).toContain('partial tree');
    expect(result.notices.join(' ')).toContain('Could not inspect package.json');
  });
  it('bounds response size before parsing remote data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Length': '7000000' } })),
    );
    await expect(fetchRepository('https://github.com/example/repository')).rejects.toThrow(
      'size limit',
    );
  });
  it('handles nested GitLab project paths and immutable raw reads', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(response({ visibility: 'public', default_branch: 'main' }))
      .mockResolvedValueOnce(response({ id: revision }))
      .mockResolvedValueOnce(response([{ path: 'pyproject.toml', type: 'blob', mode: '100644' }]))
      .mockResolvedValueOnce(new Response('[project]\nname="demo"'));
    vi.stubGlobal('fetch', mock);
    const result = await fetchRepository('https://gitlab.com/team/group/project');
    expect(mock.mock.calls[0][0]).toContain('team%2Fgroup%2Fproject');
    expect(mock.mock.calls[3][0]).toContain(`raw?ref=${revision}`);
    expect(result.files['pyproject.toml']).toContain('[project]');
  });
});
