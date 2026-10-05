import { describe, expect, it, vi } from 'vitest';
import { parseRepository, relevant } from '../electron/core/repository';
import { analyze } from '../electron/core/analyzer';
import { assess, normalizeRange } from '../electron/core/version';
import {
  installPlan,
  projectPlan,
  safeProjectDirectory,
  permitsPlatform,
} from '../electron/core/plans';
import { extractVersion } from '../electron/core/system';
import { demoScan } from '../src/demo';
import path from 'node:path';

describe('repository boundaries', () => {
  it('canonicalizes a public GitHub URL', () =>
    expect(parseRepository('https://github.com/vitejs/vite.git/').url).toBe(
      'https://github.com/vitejs/vite',
    ));
  it('supports nested GitLab namespaces', () =>
    expect(parseRepository('https://gitlab.com/team/sub/project').owner).toBe('team/sub'));
  it.each([
    'http://github.com/owner/repo',
    'https://github.com.evil.test/owner/repo',
    'https://user:secret@github.com/owner/repo',
    'file:///tmp/repo',
    'https://github.com/owner/repo/tree/main',
    'https://github.com/owner/repo?token=secret',
    'https://gitlab.com/group/-/tree/main',
    'https://github.com/owner/repo%0aevil',
    'https://github.com:4433/owner/repo',
  ])('rejects unsafe or unsupported input %s', (url) =>
    expect(() => parseRepository(url)).toThrow(),
  );
  it('skips nested dependency and fixture manifests', () => {
    expect(relevant('apps/web/package.json')).toBe(true);
    expect(relevant('node_modules/pkg/package.json')).toBe(false);
    expect(relevant('tests/fixtures/package.json')).toBe(false);
  });
});
describe('manifest analysis', () => {
  it('detects a package manager pin, runtime, framework and source', () => {
    const scan = analyze({
      'package.json': JSON.stringify({
        name: 'web',
        packageManager: 'pnpm@9.15.0+sha512.abc',
        engines: { node: '>=20 <23' },
        dependencies: { next: '15.0.0', react: '19.0.0' },
        scripts: { dev: 'next dev', 'bad;name': 'echo bad' },
      }),
    });
    expect(scan.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'node', range: '>=20 <23', source: 'package.json' }),
        expect.objectContaining({ tool: 'pnpm', range: '9.15.0' }),
      ]),
    );
    expect(scan.projects[0]).toMatchObject({
      frameworks: ['Next.js', 'React'],
      dependencies: 2,
      scripts: { dev: 'next dev' },
    });
  });
  it('recognizes workspace lockfiles without reading huge lock contents', () => {
    const scan = analyze({ 'apps/web/package.json': '{}', 'apps/web/yarn.lock': '' });
    expect(scan.projects[0].manager).toBe('yarn');
  });
  it('reports independent and incompatible runtime constraints', () => {
    const scan = analyze({ 'package.json': '{"engines":{"node":"<20"}}', '.nvmrc': '22' });
    expect(scan.notices.join(' ')).toContain('conflicting requirements');
  });
  it('detects Python projects, required versions, uv and framework', () => {
    const scan = analyze({
      'pyproject.toml':
        '[project]\nname="backend"\nrequires-python=">=3.10,<3.13"\ndependencies=["fastapi>=0.100"]',
      'uv.lock': '',
    });
    expect(scan.projects[0]).toMatchObject({
      name: 'backend',
      manager: 'uv',
      frameworks: ['fastapi'],
    });
    expect(scan.requirements.find((r) => r.tool === 'python')?.range).toBe('>=3.10,<3.13');
  });
  it('does not silently ignore broken manifests', () => {
    const scan = analyze({ 'package.json': '{invalid' });
    expect(scan.notices.join(' ')).toContain('could not be parsed');
    expect(scan.projects).toHaveLength(0);
  });
  it('extracts env names without recording values', () => {
    const scan = analyze({ '.env.example': 'SECRET=never-save-this\nDATABASE_URL=also-secret' });
    expect(scan.notices.join(' ')).toContain('SECRET');
    expect(JSON.stringify(scan)).not.toContain('never-save-this');
    expect(JSON.stringify(scan)).not.toContain('also-secret');
  });
  it('supports Rust, Go, Java and .NET manifests', () => {
    const scan = analyze({
      'Cargo.toml': '[package]\nname="worker"\nrust-version="1.80"',
      'go.mod': 'module example.com/service\ngo 1.22.0',
      'pom.xml': '<project><properties><java.version>21</java.version></properties></project>',
      'app.csproj':
        '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    });
    expect(scan.requirements.map((r) => r.tool)).toEqual(
      expect.arrayContaining(['rust', 'cargo', 'go', 'java', 'maven', 'dotnet']),
    );
  });
  it('treats unknown projects as requiring manual setup', () =>
    expect(analyze({ 'README.md': 'custom build system' }).notices.join(' ')).toContain(
      'No supported project manifest',
    ));
});
describe('honest compatibility results', () => {
  it('preserves full versions prefixed with v or go and suffixed with Ruby patch labels', () => {
    expect(extractVersion('node', 'v22.5.1\n')).toBe('22.5.1');
    expect(extractVersion('go', 'go version go1.24.2 darwin/arm64')).toBe('1.24.2');
    expect(extractVersion('ruby', 'ruby 2.6.10p210 (2022-04-12 revision 67958)')).toBe('2.6.10');
  });
  const requirement = demoScan.requirements.find((r) => r.tool === 'node')!;
  it('checks ranges, not just whether a tool exists', () => {
    expect(
      assess(requirement, [{ id: 'node', name: 'Node', path: '/node', version: '24.0.0' }]).status,
    ).toBe('mismatch');
    expect(
      assess(requirement, [{ id: 'node', name: 'Node', path: '/node', version: '22.0.0' }]).status,
    ).toBe('ready');
  });
  it('distinguishes missing tools and unreadable versions', () => {
    expect(assess(requirement, []).status).toBe('missing');
    expect(
      assess(requirement, [{ id: 'node', name: 'Node', path: '/node', version: null }]).status,
    ).toBe('unknown');
  });
  it.each(['lts/*', 'stable', '!=3.12', '${java.version}', '>=3.9; os_name=="posix"'])(
    'requires review for unsupported constraint %s',
    (range) => expect(normalizeRange(range)).toBeNull(),
  );
  it('understands basic PEP 440 compatible-release constraints', () => {
    expect(normalizeRange('~=3.10')).toBe('>=3.10.0 <4.0.0');
    expect(normalizeRange('~=3.10.2')).toBe('>=3.10.2 <3.11.0');
    expect(normalizeRange('>=3.10, <3.13')).not.toBeNull();
  });
  it('reads actual Java and Gradle versions, not incidental text', () => {
    expect(extractVersion('java', 'openjdk version "1.8.0_402"')).toBe('8.0');
    expect(extractVersion('java', 'openjdk 21.0.2 2024-01-16')).toBe('21.0.2');
    expect(extractVersion('gradle', 'Welcome!\nGradle 8.12\nJVM 21.0.2')).toBe('8.12');
  });
});
describe('reviewable installation and execution plans', () => {
  it('respects explicit OS and processor allowlists and denylists', () => {
    expect(permitsPlatform(['darwin'], 'win32')).toBe(false);
    expect(permitsPlatform(['!win32'], 'darwin')).toBe(true);
    expect(permitsPlatform(['any', '!arm64'], 'arm64')).toBe(false);
    expect(permitsPlatform(undefined, 'arm64')).toBe(true);
  });
  it('uses curated native installers and no shell commands', () => {
    expect(installPlan(demoScan.requirements[1], 'darwin', true).commands[0]).toMatchObject({
      executable: 'brew',
      args: ['install', 'node@20'],
    });
    expect(installPlan(demoScan.requirements[1], 'win32', true).commands[0]).toMatchObject({
      executable: 'winget',
      args: [
        'install',
        '--exact',
        '--id',
        'OpenJS.NodeJS.LTS',
        '--source',
        'winget',
        '--disable-interactivity',
      ],
    });
  });
  it('requires native installer availability', () =>
    expect(() => installPlan(demoScan.requirements[1], 'darwin', false)).toThrow('Homebrew'));
  it('blocks directory traversal', () => {
    const root = path.resolve('test-repo');
    expect(() => safeProjectDirectory(root, '../../outside')).toThrow();
    expect(() => safeProjectDirectory(root, '..\\outside')).toThrow();
    expect(safeProjectDirectory(root, 'apps/web')).toBe(path.join(root, 'apps/web'));
  });
  it('blocks execution until requirements are compatible', () =>
    expect(() =>
      projectPlan(demoScan, 'package.json', path.resolve('test-repo'), 'run', 'dev'),
    ).toThrow('Resolve'));
  it('only runs detected scripts and never accepts a raw command', () => {
    const ready = {
      ...demoScan,
      requirements: demoScan.requirements.map((r) => ({ ...r, status: 'ready' as const })),
    };
    expect(() =>
      projectPlan(ready, 'package.json', path.resolve('test-repo'), 'run', 'dev; rm -rf /'),
    ).toThrow('Choose a detected');
    expect(
      projectPlan(ready, 'package.json', path.resolve('test-repo'), 'run', 'dev').commands[0].args,
    ).toEqual(['run', 'dev']);
  });
});
