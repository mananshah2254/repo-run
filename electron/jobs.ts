import { randomUUID } from 'node:crypto';
import { delimiter, isAbsolute } from 'node:path';
import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import type { ActionPlan, LogEvent } from '../shared/types';
import { findBinary, searchPaths } from './core/system';

export class Jobs {
  private active = new Map<string, { process?: ChildProcess; cancelled: boolean }>();
  constructor(private emit: (event: LogEvent) => void) {}
  start(plan: ActionPlan, after?: () => Promise<void>): string {
    if (this.active.size)
      throw new Error('Stop or finish the current task before starting another.');
    const id = randomUUID();
    this.active.set(id, { cancelled: false });
    // Allow the renderer to subscribe to the returned job ID before output starts.
    setTimeout(() => void this.run(id, plan, after), 100);
    return id;
  }
  private async run(id: string, plan: ActionPlan, after?: () => Promise<void>) {
    try {
      for (const command of plan.commands) {
        const state = this.active.get(id)!;
        if (state.cancelled) throw new Error('Task stopped.');
        this.emit({
          jobId: id,
          text: `\n› ${command.label}\n$ ${[command.executable, ...command.args].join(' ')}\n`,
        });
        const binary = isAbsolute(command.executable)
          ? command.executable
          : await findBinary(command.executable);
        if (!binary)
          throw new Error(
            `${command.executable} was not found. Install it and recheck this computer.`,
          );
        const env = {
          ...process.env,
          PATH: (await searchPaths()).join(delimiter),
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
          COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
          NO_COLOR: '1',
        };
        await new Promise<void>((resolve, reject) => {
          const child = spawn(binary, command.args, {
            cwd: command.cwd,
            env,
            windowsHide: true,
            shell: false,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          state.process = child;
          const timeout =
            plan.kind === 'run'
              ? undefined
              : setTimeout(() => {
                  void this.cancel(id);
                  reject(new Error('Task exceeded the 20 minute limit.'));
                }, 20 * 60_000);
          child.stdout?.on('data', (chunk) => this.emit({ jobId: id, text: chunk.toString() }));
          child.stderr?.on('data', (chunk) => this.emit({ jobId: id, text: chunk.toString() }));
          child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          child.on('close', (code) => {
            clearTimeout(timeout);
            state.cancelled
              ? reject(new Error('Task stopped.'))
              : code === 0
                ? resolve()
                : reject(
                    new Error(
                      `Command exited with code ${code ?? 'unknown'}. Review the output above.`,
                    ),
                  );
          });
        });
      }
      await after?.();
      this.emit({
        jobId: id,
        text: '\nTask completed. Recheck requirements after installing software.\n',
        done: true,
      });
    } catch (error) {
      this.emit({ jobId: id, text: `\n${(error as Error).message}\n`, done: true, error: true });
    } finally {
      this.active.delete(id);
    }
  }
  async cancel(id: string) {
    const state = this.active.get(id);
    if (!state) return;
    state.cancelled = true;
    if (!state.process?.pid) return;
    if (process.platform === 'win32')
      spawn('taskkill.exe', ['/pid', String(state.process.pid), '/T', '/F'], { windowsHide: true });
    else {
      try {
        process.kill(-state.process.pid, 'SIGTERM');
      } catch {
        state.process.kill();
      }
    }
  }
  stopAll() {
    for (const id of this.active.keys()) void this.cancel(id);
  }
}
