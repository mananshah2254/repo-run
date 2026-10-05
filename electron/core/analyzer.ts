import TOML from '@iarna/toml';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseYaml } from 'yaml';
import type { Project, Requirement, ToolId } from '../../shared/types';
import { catalog } from './catalog';
import { conflicts } from './version';

export function analyze(files: Record<string, string>) {
  const requirements: Requirement[] = [];
  const projects: Project[] = [];
  const notices: string[] = [];
  const add = (tool: ToolId, range: unknown, source: string, reason: string) => {
    const constraint = typeof range === 'string' || typeof range === 'number' ? String(range) : '*';
    if (!requirements.some((r) => r.tool === tool && r.range === constraint && r.source === source))
      requirements.push({
        id: `${source}:${tool}:${requirements.length}`,
        tool,
        name: catalog[tool].name,
        range: constraint || '*',
        source,
        reason,
        installed: null,
        status: 'unknown',
      });
  };
  add('git', '>=2', 'Repository', 'Downloads the exact revision you checked.');
  const project = (source: string, ecosystem: string, options: Partial<Project> = {}) => {
    const directory = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '.';
    projects.push({
      id: source,
      directory,
      name: directory === '.' ? 'Root project' : directory,
      ecosystem,
      frameworks: [],
      dependencies: 0,
      scripts: {},
      ...options,
    });
  };
  for (const [path, content] of Object.entries(files)) {
    const name = path.split('/').pop()!;
    const dir = path.slice(0, path.length - name.length);
    try {
      if (name === 'package.json') {
        const data = JSON.parse(content);
        const deps = { ...data.dependencies, ...data.devDependencies };
        const engines = data.engines || {};
        add(
          'node',
          engines.node || data.volta?.node || '*',
          path,
          'JavaScript runtime for this project.',
        );
        const declared =
          typeof data.packageManager === 'string'
            ? data.packageManager.match(/^(npm|pnpm|yarn|bun)@([^+]+)/)
            : null;
        const manager = (declared?.[1] ||
          (dir + 'pnpm-lock.yaml' in files
            ? 'pnpm'
            : dir + 'yarn.lock' in files
              ? 'yarn'
              : dir + 'bun.lock' in files || dir + 'bun.lockb' in files
                ? 'bun'
                : 'npm')) as ToolId;
        add(
          manager,
          declared?.[2] || engines[manager] || '*',
          path,
          'Installs the project’s JavaScript packages.',
        );
        for (const id of ['npm', 'pnpm', 'yarn', 'bun'] as ToolId[])
          if (engines[id] && id !== manager)
            add(id, engines[id], path, 'Declared in package.json engines.');
        const frameworks = Object.entries({
          next: 'Next.js',
          react: 'React',
          vue: 'Vue',
          nuxt: 'Nuxt',
          svelte: 'Svelte',
          '@angular/core': 'Angular',
          express: 'Express',
          electron: 'Electron',
          vite: 'Vite',
          astro: 'Astro',
          'react-native': 'React Native',
        })
          .filter(([key]) => key in deps)
          .map(([, label]) => label);
        const scripts = Object.fromEntries(
          Object.entries(data.scripts || {}).filter(
            ([key, val]) => /^[a-zA-Z0-9:_-]{1,80}$/.test(key) && typeof val === 'string',
          ),
        ) as Record<string, string>;
        project(path, 'JavaScript', {
          ...(typeof data.name === 'string' ? { name: data.name } : {}),
          manager,
          frameworks,
          dependencies: Object.keys(deps).length,
          scripts,
          os: Array.isArray(data.os)
            ? data.os.filter((value: unknown) => typeof value === 'string')
            : undefined,
          cpu: Array.isArray(data.cpu)
            ? data.cpu.filter((value: unknown) => typeof value === 'string')
            : undefined,
        });
        if (data.os || data.cpu)
          notices.push(
            `${path} declares platform restrictions: OS ${JSON.stringify(data.os || 'any')}; architecture ${JSON.stringify(data.cpu || 'any')}. Check these before installation.`,
          );
        if (data.workspaces)
          notices.push(
            `${path} is a workspace. Install dependencies from the workspace root; large workspaces may exceed the inspection limit.`,
          );
      } else if (name === '.nvmrc' || name === '.node-version')
        add('node', content.trim(), path, 'Pinned Node.js version.');
      else if (name === '.python-version')
        add('python', content.trim(), path, 'Pinned Python version.');
      else if (name === '.ruby-version')
        add('ruby', content.trim().replace(/^ruby-/, ''), path, 'Pinned Ruby version.');
      else if (name === '.tool-versions')
        for (const line of content.split('\n')) {
          const [id, version] = line.trim().split(/\s+/);
          const map: Record<string, ToolId> = {
            nodejs: 'node',
            python: 'python',
            ruby: 'ruby',
            golang: 'go',
            rust: 'rust',
            java: 'java',
          };
          if (map[id]) add(map[id], version, path, 'Runtime declared by the project.');
        }
      else if (name === 'pyproject.toml') {
        const data: any = TOML.parse(content);
        const poetry = data.tool?.poetry;
        const deps = data.project?.dependencies || Object.keys(poetry?.dependencies || {});
        const manager =
          dir + 'uv.lock' in files
            ? 'uv'
            : poetry || dir + 'poetry.lock' in files
              ? 'poetry'
              : 'python';
        add(
          'python',
          data.project?.['requires-python'] || poetry?.dependencies?.python || '*',
          path,
          'Python runtime for this project.',
        );
        if (manager !== 'python')
          add(manager, '*', path, 'Creates an environment and installs Python dependencies.');
        project(path, 'Python', {
          name: data.project?.name || poetry?.name || 'Python project',
          manager,
          dependencies: deps.length,
          frameworks: ['fastapi', 'django', 'flask', 'streamlit', 'torch'].filter((x) =>
            deps.some((d: string) => d.toLowerCase().startsWith(x)),
          ),
          scripts: {},
        });
      } else if (name === 'requirements.txt' || name === 'Pipfile') {
        add('python', '*', path, 'Python runtime; no version constraint found in this file.');
        if (!(dir + 'pyproject.toml' in files))
          project(path, 'Python', {
            manager: 'python',
            dependencies: content.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length,
          });
        if (name === 'Pipfile')
          notices.push(`${path}: Pipenv workflows currently need manual dependency installation.`);
      } else if (name === 'Cargo.toml') {
        const data: any = TOML.parse(content);
        add(
          'rust',
          data.package?.['rust-version'] ? `>=${data.package['rust-version']}` : '*',
          path,
          'Rust compiler.',
        );
        add('cargo', '*', path, 'Builds and runs Rust projects.');
        project(path, 'Rust', {
          manager: 'cargo',
          name: data.package?.name || 'Rust workspace',
          dependencies: Object.keys(data.dependencies || {}).length,
          scripts: { run: 'cargo run' },
        });
      } else if (name === 'rust-toolchain.toml') {
        const data: any = TOML.parse(content);
        add('rust', data.toolchain?.channel || '*', path, 'Pinned Rust toolchain.');
      } else if (name === 'go.mod') {
        add(
          'go',
          content.match(/^go\s+(\S+)/m)?.[1] ? `>=${content.match(/^go\s+(\S+)/m)![1]}` : '*',
          path,
          'Go compiler and module tools.',
        );
        project(path, 'Go', { manager: 'go', scripts: { run: 'go run .' } });
      } else if (name === 'Gemfile') {
        add(
          'ruby',
          content.match(/^\s*ruby\s+['"]([^'"]+)/m)?.[1] || '*',
          path,
          'Ruby interpreter.',
        );
        add('bundler', '*', path, 'Installs Ruby gems.');
        project(path, 'Ruby', { manager: 'bundler' });
      } else if (name === 'composer.json') {
        const data = JSON.parse(content);
        add('php', data.require?.php || '*', path, 'PHP interpreter.');
        add('composer', '*', path, 'Installs PHP packages.');
        project(path, 'PHP', {
          manager: 'composer',
          dependencies: Object.keys(data.require || {}).length,
        });
      } else if (name === 'global.json') {
        const data = JSON.parse(content);
        add('dotnet', data.sdk?.version || '*', path, 'Declared .NET SDK.');
        if (data.sdk?.rollForward)
          notices.push(`${path}: SDK rollForward policy requires a manual compatibility check.`);
      } else if (name.endsWith('.csproj')) {
        const data = new XMLParser({ ignoreAttributes: false }).parse(content);
        const target = JSON.stringify(data).match(/net(\d+)\.(\d+)/);
        add(
          'dotnet',
          target ? `${target[1]}.${target[2]}.x` : '*',
          path,
          '.NET SDK target framework.',
        );
        project(path, '.NET', { manager: 'dotnet', scripts: { run: 'dotnet run' } });
      } else if (name === 'pom.xml') {
        const data = new XMLParser().parse(content);
        const props = data.project?.properties || {};
        const v =
          props['maven.compiler.release'] ||
          props['maven.compiler.source'] ||
          props['java.version'];
        add('java', v ? `>=${String(v).replace(/^1\./, '')}` : '*', path, 'Java runtime and JDK.');
        add('maven', '*', path, 'Builds the Java project.');
        project(path, 'Java', { manager: 'maven' });
      } else if (name.startsWith('build.gradle')) {
        add('java', '*', path, 'Java runtime; Gradle scripts require manual version review.');
        add('gradle', '*', path, 'Builds the Java project.');
        project(path, 'Java', { manager: 'gradle' });
      } else if (name === 'Dockerfile' || /^(docker-)?compose\.ya?ml$/.test(name)) {
        add('docker', '*', path, 'Container runtime. The Docker engine must also be running.');
        if (name !== 'Dockerfile') {
          const data = parseYaml(content);
          notices.push(
            `${path} defines container services: ${Object.keys(data?.services || {}).join(', ') || 'review the Compose file'}. Host runtimes may be unnecessary when using containers.`,
          );
        }
      } else if (/^\.env\.(example|sample)$/.test(name)) {
        const keys = content
          .split('\n')
          .map((l) => l.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/)?.[1])
          .filter(Boolean);
        if (keys.length)
          notices.push(
            `${path}: configure ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ' and other environment variables' : ''} locally. Secrets are never collected by Repo Run.`,
          );
      }
    } catch {
      notices.push(`${path} could not be parsed. Review it manually before running the project.`);
    }
  }
  if (!projects.length)
    notices.push('No supported project manifest was found. This repository may need manual setup.');
  notices.push(...conflicts(requirements));
  notices.push(
    'Manifest checks cannot verify credentials, external services, native libraries, hardware requirements, or undocumented README steps. Review the repository instructions before running.',
  );
  return { requirements, projects, notices };
}
