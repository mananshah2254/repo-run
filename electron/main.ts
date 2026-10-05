import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { mkdir, readFile, realpath, access, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ActionPlan, Machine, Scan } from '../shared/types';
import { fetchRepository, parseRepository } from './core/repository';
import { analyze } from './core/analyzer';
import { assess } from './core/version';
import { commandOutput, findBinary, inspectMachine } from './core/system';
import { installPlan, projectPlan } from './core/plans';
import { Storage } from './storage';
import { Auth } from './auth';
import { History } from './history';
import { Jobs } from './jobs';
import { GithubConnection } from './github';
import { ProviderError, ProviderHttp } from './core/provider-http';

let window: BrowserWindow;
let jobs: Jobs;
app.setName('Repo Run');
const dev = process.env.REPO_RUN_DEV === '1' && !app.isPackaged;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const storage = new Storage(app.getPath('userData'));
      const auth = new Auth(storage);
      const providerHttp = new ProviderHttp();
      const github = new GithubConnection(storage, providerHttp);
      const history = new History(auth, storage);
      const defaults = JSON.parse(
        await readFile(join(__dirname, 'config.json'), 'utf8').catch(
          () => '{"supabaseUrl":"","supabaseKey":""}',
        ),
      );
      await auth.initialize({
        supabaseUrl: process.env.REPO_RUN_SUPABASE_URL || defaults.supabaseUrl,
        supabaseKey: process.env.REPO_RUN_SUPABASE_ANON_KEY || defaults.supabaseKey,
      });
      let machine: Machine | null = null;
      let scanning = false;
      const plans = new Map<
        string,
        { plan: ActionPlan; userId: string; expires: number; after?: () => Promise<void> }
      >();
      const downloads = new Map<string, { root: string; userId: string }>();
      const activeScans = new Set<string>();
      const downloadKey = (userId: string, report: Scan) =>
        `${userId}:${report.repository.url}:${report.repository.commit}`;
      jobs = new Jobs((event) => {
        if (!window.isDestroyed()) window.webContents.send('repo:log', event);
      });
      const createWindow = () => {
        window = new BrowserWindow({
          width: 1360,
          height: 900,
          minWidth: 960,
          minHeight: 680,
          title: 'Repo Run',
          backgroundColor: '#f8f9f6',
          titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
          webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (event) => event.preventDefault());
        window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
          callback(false),
        );
        if (dev) void window.loadURL('http://127.0.0.1:5173');
        else void window.loadFile(join(__dirname, '../dist/index.html'));
      };
      createWindow();
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Repo Run',
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
          },
          {
            label: 'Edit',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' },
            ],
          },
          {
            label: 'View',
            submenu: [
              { role: 'resetZoom' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              { role: 'togglefullscreen' },
              ...(dev ? [{ role: 'toggleDevTools' as const }] : []),
            ],
          },
        ]),
      );
      const handle = (name: string, schema: z.ZodType, fn: (value: any) => unknown) =>
        ipcMain.handle(`repo:${name}`, async (event, input) => {
          const url = event.senderFrame?.url;
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            (dev ? !url?.startsWith('http://127.0.0.1:5173/') : url !== window.webContents.getURL())
          )
            throw new Error('Untrusted request.');
          try {
            return { ok: true, value: await fn(schema.parse(input)) };
          } catch (error) {
            return {
              ok: false,
              error:
                error instanceof ProviderError
                  ? error.detail
                  : {
                      message:
                        error instanceof Error
                          ? error.message
                          : 'The operation could not be completed.',
                    },
            };
          }
        });
      const id = z.string().uuid();
      const none = z.undefined();
      const savePlan = async (plan: ActionPlan, after?: () => Promise<void>) => {
        const user = await auth.requireUser();
        for (const [key, value] of plans) if (value.expires < Date.now()) plans.delete(key);
        plans.set(plan.id, { plan, userId: user.id, expires: Date.now() + 5 * 60_000, after });
        return plan;
      };
      async function scan(url: string): Promise<Scan> {
        const user = await auth.requireUser();
        if (scanning) throw new Error('A check is already running. Please wait.');
        scanning = true;
        try {
          const githubToken = await github.token(user.id);
          const [remote, system] = await Promise.all([
            fetchRepository(url, { client: providerHttp, githubToken }),
            inspectMachine(),
          ]);
          machine = system;
          const findings = analyze(remote.files);
          const report: Scan = {
            id: randomUUID(),
            repository: remote.repository,
            ...findings,
            notices: [...remote.notices, ...findings.notices],
            requirements: findings.requirements.map((r) => assess(r, system.tools)),
            files: Object.keys(remote.files),
            machine: system,
            checkedAt: new Date().toISOString(),
          };
          const warning = await history.save(report, user.id);
          if (warning) report.notices.unshift(warning);
          activeScans.add(report.id);
          return report;
        } finally {
          scanning = false;
        }
      }
      handle('state', none, async () => {
        const user = await auth.user();
        return {
          desktop: true,
          configured: !!auth.client,
          user,
          machine,
          version: app.getVersion(),
          githubConnected: !!(user && (await github.token(user.id))),
        };
      });
      handle('github-token', z.string().max(255), async (token) => {
        const user = await auth.requireUser();
        await github.save(user.id, token);
      });
      handle('github-disconnect', none, async () => {
        const user = await auth.requireUser();
        await github.remove(user.id);
      });
      handle(
        'configure',
        z.object({ url: z.string().max(250), key: z.string().max(2000) }),
        async (value) => {
          jobs.stopAll();
          plans.clear();
          downloads.clear();
          activeScans.clear();
          await auth.configure(value.url, value.key);
          providerHttp.clearCache();
        },
      );
      handle('sign-in', none, () => auth.signIn());
      handle('sign-out', none, async () => {
        jobs.stopAll();
        await auth.signOut();
        providerHttp.clearCache();
        plans.clear();
        downloads.clear();
        activeScans.clear();
      });
      handle('scan', z.string().max(1000), scan);
      handle('recheck', id, async (id) => scan((await history.get(id)).repository.url));
      handle('history', none, () => history.list());
      handle('remove-history', id, (id) => history.remove(id));
      handle('system', none, async () => {
        machine = await inspectMachine();
        return machine;
      });
      handle(
        'plan-install',
        z.object({ scanId: id, requirementId: z.string().max(1000) }),
        async ({ scanId, requirementId }) => {
          if (!activeScans.has(scanId))
            throw new Error(
              'Recheck this repository on the current computer before installing tools.',
            );
          const report = await history.get(scanId);
          const req = report.requirements.find((r) => r.id === requirementId);
          if (!req) throw new Error('Requirement not found.');
          return savePlan(
            installPlan(
              req,
              process.platform,
              !!(await findBinary(process.platform === 'darwin' ? 'brew' : 'winget')),
              !!(await findBinary('npm')),
            ),
          );
        },
      );
      handle('plan-clone', id, async (scanId) => {
        const user = await auth.requireUser();
        const report = await history.get(scanId);
        const repo = parseRepository(report.repository.url);
        if (!/^[a-f0-9]{40,64}$/.test(report.repository.commit))
          throw new Error('Invalid repository revision. Recheck the repository.');
        if (!(await findBinary('git')))
          throw new Error('Install Git before downloading a repository.');
        const savedDownloads = await storage.read<Record<string, string>>(
          `downloads-${user.id}`,
          {},
        );
        const key = downloadKey(user.id, report);
        const existing = savedDownloads[key];
        if (existing) {
          const git = await findBinary('git');
          const head = await commandOutput(git!, ['-C', existing, 'rev-parse', 'HEAD']).catch(
            () => '',
          );
          if (head.trim() === report.repository.commit) {
            return savePlan(
              {
                id: randomUUID(),
                kind: 'clone',
                title: 'Use your existing download',
                description: `${repo.name} is already downloaded at ${existing}, at the checked revision.`,
                commands: [],
                directory: existing,
                warnings: [
                  'Your local changes will be preserved. Review them before running the project.',
                ],
              },
              async () => {
                downloads.set(key, { root: existing, userId: user.id });
              },
            );
          }
        }
        const choice = await dialog.showOpenDialog(window, {
          title: 'Choose where to download the repository',
          buttonLabel: 'Use this folder',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (choice.canceled) return null;
        const root = join(choice.filePaths[0], repo.name);
        try {
          await access(root);
          throw new Error(
            'A folder with that repository name already exists. Choose a different parent folder.',
          );
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
        }
        const hooks = join(app.getPath('userData'), 'empty-hooks');
        await mkdir(hooks, { recursive: true });
        const common = ['-c', `core.hooksPath=${hooks}`, '-c', 'protocol.file.allow=never'];
        const plan: ActionPlan = {
          id: randomUUID(),
          kind: 'clone',
          title: `Download ${repo.name}`,
          description: `Download revision ${report.repository.commit.slice(0, 7)} to ${root}.`,
          directory: root,
          commands: [
            {
              executable: 'git',
              args: [
                ...common,
                'clone',
                '--no-checkout',
                '--depth',
                '1',
                '--',
                repo.cloneUrl,
                root,
              ],
              label: 'Download repository',
            },
            {
              executable: 'git',
              args: [...common, 'fetch', '--depth', '1', 'origin', report.repository.commit],
              cwd: root,
              label: 'Fetch the checked revision',
            },
            {
              executable: 'git',
              args: [...common, 'checkout', '--detach', report.repository.commit],
              cwd: root,
              label: 'Check out the inspected revision',
            },
          ],
          warnings: [
            'This creates a new folder. Submodules and Git LFS assets need separate setup. Project code will only run when you approve a setup or run action.',
          ],
        };
        return savePlan(plan, async () => {
          downloads.set(key, { root, userId: user.id });
          const saved = await storage.read<Record<string, string>>(`downloads-${user.id}`, {});
          saved[key] = root;
          await storage.write(`downloads-${user.id}`, saved);
        });
      });
      handle(
        'plan-project',
        z.object({
          scanId: id,
          projectId: z.string().max(1000),
          kind: z.enum(['setup', 'run']),
          script: z.string().max(80).optional(),
        }),
        async ({ scanId, projectId, kind, script }) => {
          const user = await auth.requireUser();
          if (!activeScans.has(scanId))
            throw new Error('Recheck this repository on the current computer before running it.');
          const report = await history.get(scanId);
          const download = downloads.get(downloadKey(user.id, report));
          if (!download || download.userId !== user.id)
            throw new Error('Download this checked revision through Repo Run first.');
          const current = await inspectMachine();
          report.machine = current;
          report.requirements = report.requirements.map((r) => assess(r, current.tools));
          const plan = projectPlan(report, projectId, download.root, kind, script);
          const realRoot = await realpath(download.root);
          for (const command of plan.commands)
            if (command.cwd) {
              const actual = await realpath(command.cwd);
              const rel = relative(realRoot, actual);
              if (rel.startsWith('..') || isAbsolute(rel))
                throw new Error('A project directory points outside the repository.');
              if (command.args.includes('venv')) {
                const info = await lstat(join(command.cwd, '.venv')).catch(() => null);
                if (info?.isSymbolicLink())
                  throw new Error(
                    'The project’s .venv is a symbolic link. Remove it or set up Python manually.',
                  );
              }
            }
          return savePlan(plan);
        },
      );
      handle('execute', id, async (planId) => {
        const user = await auth.requireUser();
        const entry = plans.get(planId);
        if (!entry || entry.userId !== user.id || entry.expires < Date.now())
          throw new Error('This plan expired. Review a new plan before continuing.');
        const jobId = jobs.start(entry.plan, entry.after);
        plans.delete(planId);
        return { jobId };
      });
      handle('cancel', id, async (jobId) => {
        await auth.requireUser();
        await jobs.cancel(jobId);
      });
      handle('open-external', z.string().max(2000), async (value) => {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error('Only HTTPS links can be opened.');
        await shell.openExternal(url.toString());
      });
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox('Repo Run could not start', error.message);
      app.quit();
    });
  app.on('before-quit', () => jobs?.stopAll());
  app.on('window-all-closed', () => {
    jobs?.stopAll();
    if (process.platform !== 'darwin') app.quit();
  });
}
