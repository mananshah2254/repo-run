import { contextBridge, ipcRenderer } from 'electron';
import type { RepoRunAPI, LogEvent } from '../shared/types';
const api: RepoRunAPI = {
  getState: () => ipcRenderer.invoke('repo:state'),
  configure: (value) => ipcRenderer.invoke('repo:configure', value),
  signIn: () => ipcRenderer.invoke('repo:sign-in'),
  signOut: () => ipcRenderer.invoke('repo:sign-out'),
  scan: (value) => ipcRenderer.invoke('repo:scan', value),
  recheck: (id) => ipcRenderer.invoke('repo:recheck', id),
  history: () => ipcRenderer.invoke('repo:history'),
  removeHistory: (id) => ipcRenderer.invoke('repo:remove-history', id),
  system: () => ipcRenderer.invoke('repo:system'),
  planInstall: (scanId, requirementId) =>
    ipcRenderer.invoke('repo:plan-install', { scanId, requirementId }),
  planClone: (scanId) => ipcRenderer.invoke('repo:plan-clone', scanId),
  planProject: (scanId, projectId, kind, script) =>
    ipcRenderer.invoke('repo:plan-project', { scanId, projectId, kind, script }),
  execute: (id) => ipcRenderer.invoke('repo:execute', id),
  cancel: (id) => ipcRenderer.invoke('repo:cancel', id),
  openExternal: (url) => ipcRenderer.invoke('repo:open-external', url),
  onLog: (callback) => {
    const handler = (_event: unknown, data: LogEvent) => callback(data);
    ipcRenderer.on('repo:log', handler);
    return () => {
      ipcRenderer.removeListener('repo:log', handler);
    };
  },
};
contextBridge.exposeInMainWorld('repoRun', api);
