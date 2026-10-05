import { describe, expect, it, vi } from 'vitest';
import { cloudScan, History } from '../electron/history';
import { demoScan } from '../src/demo';
import type { Auth } from '../electron/auth';
import type { Storage } from '../electron/storage';

function setup({
  local = [demoScan],
  remote = [],
  pending = [],
  offline = false,
}: {
  local?: (typeof demoScan)[];
  remote?: (typeof demoScan)[];
  pending?: string[];
  offline?: boolean;
} = {}) {
  const memory: Record<string, unknown> = {
    'history-user-one': local,
    'pending-user-one': pending,
  };
  const storage = {
    read: vi.fn(async (key, fallback) => memory[key] ?? fallback),
    write: vi.fn(async (key, value) => {
      memory[key] = value;
    }),
    scans: vi.fn(async () => memory['history-user-one']),
    saveScan: vi.fn(),
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({
      data: remote.map((report) => ({ report })),
      error: offline ? new Error('offline') : null,
    })),
    upsert: vi.fn(async () => ({ error: offline ? new Error('offline') : null })),
  };
  const auth = {
    requireUser: vi.fn(async () => ({ id: 'user-one' })),
    client: { from: vi.fn(() => query) },
  };
  return {
    history: new History(auth as unknown as Auth, storage as unknown as Storage),
    memory,
    storage,
    auth,
    query,
  };
}
describe('account history', () => {
  it('does not upload installed-tool paths or the full system inventory', () => {
    const report = cloudScan(demoScan);
    expect(report.machine.tools).toEqual([]);
    expect(report.machine.release).toBe('');
    expect(JSON.stringify(report)).not.toContain('/example/bin/');
    expect(report.requirements[0].installed).toBe('2.49.0');
  });
  it('does not resurrect a check deleted on another device', async () => {
    const { history } = setup();
    expect((await history.list()).scans).toEqual([]);
  });
  it('retains the local snapshot for a check still present in the cloud', async () => {
    const { history } = setup({ remote: [cloudScan(demoScan)] });
    expect((await history.list()).scans[0].machine.tools.length).toBeGreaterThan(0);
  });
  it('keeps unsynced checks and discloses an offline sync failure', async () => {
    const { history, memory } = setup({ pending: ['demo'], offline: true });
    const result = await history.list();
    expect(result.scans).toHaveLength(1);
    expect(result.warning).toContain('pending');
    expect(memory['pending-user-one']).toEqual(['demo']);
  });
  it('will not save a completed check into a different account', async () => {
    const { history, storage } = setup();
    await expect(history.save(demoScan, 'different-user')).rejects.toThrow('account changed');
    expect(storage.saveScan).not.toHaveBeenCalled();
  });
});
