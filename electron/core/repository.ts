import { ProviderError, ProviderHttp } from './provider-http';
import type { Repository } from '../../shared/types';

export function parseRepository(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Paste a full GitHub or GitLab repository URL, including https://.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use a public HTTPS repository URL without credentials, query parameters, or fragments.',
    );
  if (!['github.com', 'gitlab.com'].includes(url.hostname))
    throw new Error('This version supports public repositories on github.com and gitlab.com.');
  const parts = url.pathname
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (
    parts.length < 2 ||
    (url.hostname === 'github.com' && parts.length !== 2) ||
    parts.some((x) => !/^[a-zA-Z0-9_.-]+$/.test(x) || x === '.' || x === '..' || x === '-')
  )
    throw new Error('Paste the repository’s main URL, rather than a file, branch, or folder link.');
  const name = parts.pop()!;
  const owner = parts.join('/');
  const canonical = `https://${url.hostname}/${owner}/${name}`;
  return {
    provider: url.hostname === 'github.com' ? ('github' as const) : ('gitlab' as const),
    owner,
    name,
    url: canonical,
    cloneUrl: canonical + '.git',
  };
}
const names = new Set([
  'package.json',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.ruby-version',
  '.tool-versions',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'Cargo.toml',
  'rust-toolchain.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'global.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Dockerfile',
  'compose.yaml',
  'compose.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  '.env.sample',
  'README.md',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'package-lock.json',
  'uv.lock',
  'poetry.lock',
]);
export function relevant(path: string) {
  return (
    path.split('/').length <= 5 &&
    !/(^|\/)(node_modules|vendor|\.git|dist|build|fixtures|__fixtures__|test|tests)(\/|$)/.test(
      path,
    ) &&
    (names.has(path.split('/').pop()!) || path.endsWith('.csproj'))
  );
}
const markerOnly =
  /(^|\/)(pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|package-lock\.json|uv\.lock|poetry\.lock)$/;
export async function fetchRepository(
  input: string,
  options: { client?: ProviderHttp; githubToken?: string } = {},
): Promise<{ repository: Repository; files: Record<string, string>; notices: string[] }> {
  const base = parseRepository(input);
  const client = options.client || new ProviderHttp();
  const request = (url: string, max?: number) => client.request(url, max, options.githubToken);
  const json = async (url: string) => JSON.parse(await request(url));
  const notices: string[] = [];
  let repository: Repository;
  let paths: string[];
  let read: (path: string) => Promise<string>;
  if (base.provider === 'github') {
    const endpoint = `https://api.github.com/repos/${base.owner}/${base.name}`;
    const meta = await json(endpoint);
    if (meta.private) throw new Error('Only public repositories are supported.');
    const commit = await json(`${endpoint}/commits/${encodeURIComponent(meta.default_branch)}`);
    const tree = await json(`${endpoint}/git/trees/${commit.sha}?recursive=1`);
    if (tree.truncated)
      notices.push(
        'The repository tree is very large. GitHub returned a partial tree, so some requirements may not be visible.',
      );
    paths = tree.tree
      .filter((entry: any) => entry.type === 'blob' && entry.mode !== '120000')
      .map((entry: any) => entry.path);
    repository = {
      ...base,
      branch: meta.default_branch,
      commit: commit.sha,
      description: meta.description || '',
      stars: meta.stargazers_count,
      language: meta.language || 'Mixed',
      license: meta.license?.spdx_id || null,
    };
    read = async (path) => {
      const data = await json(
        `${endpoint}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit.sha}`,
      );
      if (data.size > 150_000 || data.encoding !== 'base64')
        throw new Error('File is too large to inspect.');
      return Buffer.from(data.content, 'base64').toString('utf8');
    };
  } else {
    const endpoint = `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${base.owner}/${base.name}`)}`;
    const meta = await json(endpoint);
    if (meta.visibility !== 'public') throw new Error('Only public repositories are supported.');
    const commit = await json(
      `${endpoint}/repository/commits/${encodeURIComponent(meta.default_branch)}`,
    );
    paths = [];
    for (let page = 1; page <= 5; page++) {
      const tree = await json(
        `${endpoint}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${commit.id}`,
      );
      paths.push(
        ...tree
          .filter((e: any) => e.type === 'blob' && e.mode !== '120000')
          .map((e: any) => e.path),
      );
      if (tree.length < 100) break;
      if (page === 5)
        notices.push(
          'Only the first 500 repository entries were inspected. Some requirements may not be visible.',
        );
    }
    repository = {
      ...base,
      branch: meta.default_branch,
      commit: commit.id,
      description: meta.description || '',
      stars: meta.star_count,
      language: 'Mixed',
      license: null,
    };
    read = (path) =>
      request(
        `${endpoint}/repository/files/${encodeURIComponent(path)}/raw?ref=${commit.id}`,
        150_000,
      );
  }
  if (!/^[a-f0-9]{40,64}$/.test(repository.commit))
    throw new Error('The provider returned an invalid revision.');
  const selected = paths
    .filter(relevant)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  if (selected.length > 35)
    notices.push(
      `Found ${selected.length} relevant files; inspected the first 35, prioritizing the project root. Additional workspace requirements may exist.`,
    );
  const files: Record<string, string> = {};
  for (let i = 0; i < Math.min(selected.length, 35); i += 4)
    await Promise.allSettled(
      selected.slice(i, Math.min(i + 4, 35)).map(async (path) => {
        try {
          files[path] = markerOnly.test(path) ? '' : await read(path);
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          notices.push(`Could not inspect ${path}: ${(error as Error).message}`);
        }
      }),
    ).then((results) => {
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    });
  return { repository, files, notices };
}
