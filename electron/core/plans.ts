import { randomUUID } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';
import semver from 'semver';
import type { ActionPlan, Requirement, Scan, ToolId } from '../../shared/types';
import { catalog } from './catalog';
import { normalizeRange } from './version';

export function installPlan(
  requirement: Requirement,
  platform: string,
  hasManager: boolean,
  hasNpm = false,
): ActionPlan {
  const tool = catalog[requirement.tool];
  if (!['darwin', 'win32'].includes(platform))
    throw new Error('Automatic installation is available on macOS and Windows.');
  const range = normalizeRange(requirement.range);
  const min = range ? semver.minVersion(range) : null;
  if (['npm', 'pnpm', 'yarn'].includes(requirement.tool) && hasNpm && range) {
    if (requirement.tool === 'yarn' && min && min.major >= 2)
      throw new Error(
        'This project uses modern Yarn. Follow its Corepack setup instructions, then recheck.',
      );
    return {
      id: randomUUID(),
      kind: 'install',
      title: `Install ${tool.name}`,
      description: 'Install the requested package-manager version using npm.',
      commands: [
        {
          executable: 'npm',
          args: ['install', '--global', '--ignore-scripts', `${requirement.tool}@${range}`],
          label: `Install compatible ${tool.name}`,
        },
      ],
      warnings: [
        'This changes the global package-manager installation for your active Node.js version.',
        'Recheck afterward. An existing Corepack shim or another PATH entry may still take precedence.',
      ],
    };
  }
  if (!hasManager)
    throw new Error(
      platform === 'darwin'
        ? 'Install Homebrew from brew.sh first, then reopen Repo Run. Repo Run will use it to install tools.'
        : 'Install or update App Installer from Microsoft Store to enable winget, then reopen Repo Run.',
    );
  let packageName = platform === 'darwin' ? tool.brew : tool.winget;
  if (platform === 'darwin' && min && min.major > 0) {
    if (requirement.tool === 'node') packageName = `node@${min.major}`;
    if (requirement.tool === 'python') packageName = `python@${min.major}.${min.minor}`;
    if (requirement.tool === 'java') packageName = `openjdk@${min.major}`;
  }
  if (platform === 'win32' && min && min.major > 0) {
    if (requirement.tool === 'python') packageName = `Python.Python.${min.major}.${min.minor}`;
    if (requirement.tool === 'java') packageName = `EclipseAdoptium.Temurin.${min.major}.JDK`;
    if (requirement.tool === 'dotnet') packageName = `Microsoft.DotNet.SDK.${min.major}`;
  }
  if (!packageName)
    throw new Error(
      `Install ${tool.name} using its official instructions at ${tool.url}, then recheck. This installer cannot safely choose a version for this tool.`,
    );
  const args =
    platform === 'darwin'
      ? ['install', ...(requirement.tool === 'docker' ? ['--cask'] : []), packageName]
      : [
          'install',
          '--exact',
          '--id',
          packageName,
          '--source',
          'winget',
          '--disable-interactivity',
        ];
  return {
    id: randomUUID(),
    kind: 'install',
    title: `Install ${tool.name}`,
    description: `Use ${platform === 'darwin' ? 'Homebrew' : 'Windows Package Manager'} to install ${tool.name} on this computer.`,
    commands: [
      {
        executable: platform === 'darwin' ? 'brew' : 'winget',
        args,
        label: `Install ${tool.name}`,
      },
    ],
    warnings: [
      'This changes software installed on your computer. The package manager may request administrator permission or license acceptance.',
      `The project asks for ${requirement.range}. Package availability varies; recheck after installation to verify the installed version. Existing PATH entries can still take precedence.`,
    ],
  };
}
export function safeProjectDirectory(root: string, directory: string) {
  if (directory.includes('\\') || directory.includes('\0') || isAbsolute(directory))
    throw new Error('Invalid project directory.');
  const path = resolve(root, directory);
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('The project path must stay inside its repository.');
  return path;
}
export function permitsPlatform(restrictions: string[] | undefined, value: string): boolean {
  if (!restrictions?.length) return true;
  if (restrictions.includes(`!${value}`)) return false;
  const allowed = restrictions.filter((item) => !item.startsWith('!'));
  return !allowed.length || allowed.includes(value) || allowed.includes('any');
}
export function projectPlan(
  scan: Scan,
  projectId: string,
  root: string,
  kind: 'setup' | 'run',
  script?: string,
): ActionPlan {
  const project = scan.projects.find((p) => p.id === projectId);
  if (!project) throw new Error('Project not found. Run a fresh repository check.');
  if (
    !permitsPlatform(project.os, scan.machine.platform) ||
    !permitsPlatform(project.cpu, scan.machine.arch)
  )
    throw new Error(
      'This project declares an incompatible operating system or processor architecture. Review its platform restrictions in Setup notes.',
    );
  if (scan.requirements.some((r) => r.status !== 'ready'))
    throw new Error(
      'Resolve or manually verify all requirements, then recheck this repository before setting up or running it.',
    );
  const cwd = safeProjectDirectory(root, project.directory);
  const manager = project.manager || 'npm';
  let executable = catalog[manager].binary;
  let args: string[];
  if (kind === 'setup') {
    const choices: Partial<Record<ToolId, string[]>> = {
      npm: ['install'],
      pnpm: ['install'],
      yarn: ['install'],
      bun: ['install'],
      uv: ['sync'],
      poetry: ['install'],
      cargo: ['fetch'],
      go: ['mod', 'download'],
      bundler: ['install'],
      composer: ['install'],
      dotnet: ['restore'],
      maven: ['dependency:resolve'],
      gradle: ['build'],
    };
    if (manager === 'python') {
      if (project.id.endsWith('Pipfile'))
        throw new Error('Pipenv setup requires the repository’s manual instructions.');
      const venv = join(cwd, '.venv');
      return {
        id: randomUUID(),
        kind,
        title: 'Set up Python environment',
        description: 'Create an isolated .venv and install project dependencies.',
        commands: [
          {
            executable: process.platform === 'win32' ? 'python' : 'python3',
            args: ['-m', 'venv', '.venv'],
            cwd,
            label: 'Create virtual environment',
          },
          {
            executable: join(
              venv,
              process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
            ),
            args: [
              '-m',
              'pip',
              'install',
              ...(project.id.endsWith('requirements.txt') ? ['-r', 'requirements.txt'] : ['.']),
            ],
            cwd,
            label: 'Install dependencies',
          },
        ],
        warnings: [
          'Installing project dependencies can execute code supplied by the repository or its dependencies. Continue only if you trust this project.',
        ],
      };
    }
    args = choices[manager] || [];
    if (!args.length)
      throw new Error('This project needs manual setup. Follow its README instructions.');
  } else {
    if (
      !script ||
      !Object.hasOwn(project.scripts, script) ||
      !/^[a-zA-Z0-9:_-]{1,80}$/.test(script)
    )
      throw new Error('Choose a detected run script.');
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(manager)) args = ['run', script];
    else if (manager === 'cargo') args = ['run'];
    else if (manager === 'go') args = ['run', '.'];
    else if (manager === 'dotnet') args = ['run'];
    else throw new Error('Run this project using its README instructions.');
  }
  return {
    id: randomUUID(),
    title: kind === 'setup' ? 'Install project dependencies' : `Run ${script}`,
    kind,
    description: `${kind === 'setup' ? 'Prepare' : 'Start'} ${project.name} in ${cwd}.`,
    commands: [
      {
        executable,
        args,
        cwd,
        label: kind === 'setup' ? 'Install dependencies' : project.scripts[script!],
      },
    ],
    warnings: [
      'This executes code from the repository and its dependencies with your user permissions. Continue only if you trust this project.',
      ...(kind === 'run'
        ? [
            'Environment variables and external services must be configured first. Stop the process from the activity panel when finished.',
          ]
        : []),
    ],
  };
}
