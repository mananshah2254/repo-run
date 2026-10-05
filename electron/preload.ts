import { contextBridge, ipcRenderer } from 'electron';
import type { RepoRunAPI, LogEvent, RpcResult } from '../shared/types';
import { encodeError } from '../shared/errors';
async function invoke<T>(channel: string, input?: unknown): Promise<T> {
  const result: RpcResult<T> = await ipcRenderer.invoke(channel, input);
  if (!result.ok) throw new Error(encodeError(result.error));
  return result.value;
}
const api: RepoRunAPI = {
  getState: () => invoke('repo:state'),
  configure: (value) => invoke('repo:configure', value),
  setGithubToken: (token) => invoke('repo:github-token', token),
  removeGithubToken: () => invoke('repo:github-disconnect'),
  signIn: () => invoke('repo:sign-in'),
  signOut: () => invoke('repo:sign-out'),
  scan: (value) => invoke('repo:scan', value),
  recheck: (id) => invoke('repo:recheck', id),
  history: () => invoke('repo:history'),
  removeHistory: (id) => invoke('repo:remove-history', id),
  system: () => invoke('repo:system'),
  planInstall: (scanId, requirementId) => invoke('repo:plan-install', { scanId, requirementId }),
  planClone: (scanId) => invoke('repo:plan-clone', scanId),
  planProject: (scanId, projectId, kind, script) =>
    invoke('repo:plan-project', { scanId, projectId, kind, script }),
  execute: (id) => invoke('repo:execute', id),
  cancel: (id) => invoke('repo:cancel', id),
  openExternal: (url) => invoke('repo:open-external', url),
  onLog: (callback) => {
    const handler = (_event: unknown, data: LogEvent) => callback(data);
    ipcRenderer.on('repo:log', handler);
    return () => {
      ipcRenderer.removeListener('repo:log', handler);
    };
  },
};
contextBridge.exposeInMainWorld('repoRun', api);
