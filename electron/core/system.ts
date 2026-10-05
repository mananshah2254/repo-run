import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, isAbsolute } from 'node:path';
import os from 'node:os';
import spawn from 'cross-spawn';
import type { Machine, ToolId, ToolState } from '../../shared/types';
import { catalog } from './catalog';

export async function searchPaths(): Promise<string[]> {
  const home = os.homedir();
  const paths = (process.env.PATH || '').split(delimiter).filter(isAbsolute);
  if (process.platform === 'darwin') {
    paths.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      join(home, '.local/bin'),
      join(home, '.cargo/bin'),
      join(home, '.bun/bin'),
      '/usr/local/go/bin',
      '/usr/local/share/dotnet',
    );
    for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
      const entries = await readdir(base).catch(() => []);
      for (const entry of entries
        .filter((x) => /^(node|python|ruby|openjdk|php|go)(@|$)/.test(x))
        .sort()
        .reverse())
        paths.push(join(base, entry, 'bin'));
    }
    const nvm = join(home, '.nvm/versions/node');
    for (const version of (await readdir(nvm).catch(() => [])).sort().reverse())
      paths.push(join(nvm, version, 'bin'));
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || join(home, 'AppData/Local');
    const program = process.env.ProgramFiles || 'C:\\Program Files';
    paths.push(
      join(program, 'nodejs'),
      join(program, 'Git/cmd'),
      join(program, 'Go/bin'),
      join(program, 'dotnet'),
      join(program, 'Docker/Docker/resources/bin'),
      join(local, 'Microsoft/WinGet/Links'),
      join(home, '.cargo/bin'),
      join(home, '.bun/bin'),
      join(home, '.local/bin'),
      join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'npm'),
    );
    const pythonBase = join(local, 'Programs/Python');
    for (const entry of await readdir(pythonBase).catch(() => [])) {
      paths.push(join(pythonBase, entry), join(pythonBase, entry, 'Scripts'));
    }
    const javaBase = join(program, 'Eclipse Adoptium');
    for (const entry of await readdir(javaBase).catch(() => []))
      paths.push(join(javaBase, entry, 'bin'));
  }
  return [...new Set(paths)];
}
export async function findBinary(binary: string): Promise<string | null> {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const path of await searchPaths())
    for (const extension of extensions) {
      const candidate = join(path, binary + extension);
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        /* next candidate */
      }
    }
  return null;
}
export async function commandOutput(
  binary: string,
  args: string[],
  timeout = 6500,
): Promise<string> {
  const paths = await searchPaths();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PATH: paths.join(delimiter),
        GIT_TERMINAL_PROMPT: '0',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        COREPACK_ENABLE_NETWORK: '0',
      },
      cwd: os.homedir(),
    });
    let result = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Version check timed out.'));
    }, timeout);
    const collect = (data: Buffer) => {
      if (result.length < 32000) result += data.toString();
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(result)
        : reject(new Error('The installed command did not return a version.'));
    });
  });
}
export function extractVersion(id: ToolId, output: string): string | null {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  if (id === 'java') {
    const v =
      clean.match(/version\s+"?(\d+(?:\.\d+){0,3})/i)?.[1] ||
      clean.match(/(?:openjdk|java)\s+(\d+(?:\.\d+){0,3})/i)?.[1];
    return v?.replace(/^1\.(\d+)/, '$1') || null;
  }
  if (id === 'gradle') return clean.match(/Gradle\s+(\d+(?:\.\d+){0,2})/i)?.[1] || null;
  return clean.match(/(?:^|[^\w.])(?:v|go)?(\d+\.\d+(?:\.\d+)?)/)?.[1] || null;
}
export async function inspectMachine(): Promise<Machine> {
  const tools: ToolState[] = [];
  const entries = Object.entries(catalog) as [ToolId, (typeof catalog)[ToolId]][];
  for (let start = 0; start < entries.length; start += 5)
    await Promise.all(
      entries.slice(start, start + 5).map(async ([id, entry]) => {
        const binary = await findBinary(
          process.platform === 'win32' && id === 'python' ? 'python' : entry.binary,
        );
        if (!binary) {
          tools.push({ id, name: entry.name, path: null, version: null });
          return;
        }
        try {
          const result = await commandOutput(binary, entry.args);
          let error: string | undefined;
          if (id === 'docker') {
            try {
              await commandOutput(binary, ['info', '--format', '{{.ServerVersion}}']);
            } catch {
              error =
                'Docker is installed, but its engine is not responding. Start Docker Desktop and recheck.';
            }
          }
          tools.push({
            id,
            name: entry.name,
            path: binary,
            version: extractVersion(id, result),
            error,
          });
        } catch (error) {
          tools.push({
            id,
            name: entry.name,
            path: binary,
            version: null,
            error: (error as Error).message,
          });
        }
      }),
    );
  return {
    platform: process.platform as Machine['platform'],
    label:
      process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux',
    arch: os.arch(),
    release: os.release(),
    checkedAt: new Date().toISOString(),
    tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
