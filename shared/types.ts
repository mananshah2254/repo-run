export type ToolId =
  | 'git'
  | 'node'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'python'
  | 'uv'
  | 'poetry'
  | 'rust'
  | 'cargo'
  | 'go'
  | 'java'
  | 'maven'
  | 'gradle'
  | 'ruby'
  | 'bundler'
  | 'php'
  | 'composer'
  | 'dotnet'
  | 'docker';
export type Status = 'ready' | 'missing' | 'mismatch' | 'unknown';
export interface Requirement {
  id: string;
  tool: ToolId;
  name: string;
  range: string;
  source: string;
  reason: string;
  installed: string | null;
  status: Status;
  detail?: string;
}
export interface ToolState {
  id: ToolId;
  name: string;
  version: string | null;
  path: string | null;
  error?: string;
}
export interface Machine {
  platform: 'darwin' | 'win32' | 'linux';
  label: string;
  arch: string;
  release: string;
  tools: ToolState[];
  checkedAt: string;
}
export interface Repository {
  provider: 'github' | 'gitlab';
  owner: string;
  name: string;
  url: string;
  cloneUrl: string;
  branch: string;
  commit: string;
  description: string;
  stars: number;
  language: string;
  license: string | null;
}
export interface Project {
  id: string;
  directory: string;
  name: string;
  ecosystem: string;
  frameworks: string[];
  dependencies: number;
  scripts: Record<string, string>;
  manager?: ToolId;
  os?: string[];
  cpu?: string[];
}
export interface Scan {
  id: string;
  repository: Repository;
  requirements: Requirement[];
  projects: Project[];
  notices: string[];
  files: string[];
  machine: Machine;
  checkedAt: string;
}
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface AppState {
  desktop: boolean;
  configured: boolean;
  user: User | null;
  machine: Machine | null;
  version: string;
}
export interface Command {
  executable: string;
  args: string[];
  cwd?: string;
  label: string;
}
export interface ActionPlan {
  id: string;
  title: string;
  description: string;
  commands: Command[];
  warnings: string[];
  kind: 'install' | 'clone' | 'setup' | 'run';
  directory?: string;
}
export interface LogEvent {
  jobId: string;
  text: string;
  done?: boolean;
  error?: boolean;
}
export interface HistoryResult {
  scans: Scan[];
  warning?: string;
}
export interface RepoRunAPI {
  getState(): Promise<AppState>;
  configure(input: { url: string; key: string }): Promise<void>;
  signIn(): Promise<User>;
  signOut(): Promise<void>;
  scan(url: string): Promise<Scan>;
  recheck(id: string): Promise<Scan>;
  history(): Promise<HistoryResult>;
  removeHistory(id: string): Promise<void>;
  system(): Promise<Machine>;
  planInstall(scanId: string, requirementId: string): Promise<ActionPlan>;
  planClone(scanId: string): Promise<ActionPlan | null>;
  planProject(
    scanId: string,
    projectId: string,
    kind: 'setup' | 'run',
    script?: string,
  ): Promise<ActionPlan>;
  execute(planId: string): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onLog(callback: (event: LogEvent) => void): () => void;
}
declare global {
  interface Window {
    repoRun?: RepoRunAPI;
  }
}
