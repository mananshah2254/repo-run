import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Command as CommandIcon,
  Copy,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  Github,
  History,
  Info,
  Layers3,
  Loader2,
  LogOut,
  Monitor,
  MoreHorizontal,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import type { ActionPlan, AppState, LogEvent, Machine, Scan, Status } from '../shared/types';
import { decodeError } from '../shared/errors';
import { RetryTime } from './RetryTime';
import { demoMachine, demoScan } from './demo';

type Page = 'home' | 'history' | 'system' | 'settings' | 'guide';
type Modal = 'auth' | 'plan' | null;
const initialState: AppState = {
  desktop: !!window.repoRun,
  configured: false,
  user: null,
  machine: null,
  version: '0.1.0',
};
const statusLabels: Record<Status, string> = {
  ready: 'Compatible',
  missing: 'Not installed',
  mismatch: 'Version mismatch',
  unknown: 'Needs review',
};
function Icon({ children }: { children: ReactNode }) {
  return <span className="icon">{children}</span>;
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-mark">
        <Terminal size={21} strokeWidth={2.5} />
      </span>
      <span>
        repo<span className="brand-light">run</span>
        <span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
function relativeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.01v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.34Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.61-2.43l-3.24-2.5c-.9.6-2.06.97-3.37.97-2.61 0-4.83-1.76-5.62-4.12H3.03v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.38 13.92A6 6 0 0 1 6.07 12c0-.67.11-1.31.31-1.92V7.49H3.03A10 10 0 0 0 2 12c0 1.61.39 3.14 1.03 4.51l3.35-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.97 5.49l3.35 2.59A5.93 5.93 0 0 1 12 5.96Z"
      />
    </svg>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [page, setPage] = useState<Page>('home');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [errorInfo, setErrorInfo] = useState<ReturnType<typeof decodeError> | null>(null);
  const [githubToken, setGithubToken] = useState('');
  const [toast, setToast] = useState('');
  const [report, setReport] = useState<Scan | null>(null);
  const [history, setHistory] = useState<Scan[]>([]);
  const [syncWarning, setSyncWarning] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [detailTab, setDetailTab] = useState('requirements');
  const [modal, setModal] = useState<Modal>(null);
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [job, setJob] = useState<{
    id: string;
    title: string;
    done: boolean;
    error: boolean;
  } | null>(null);
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [config, setConfig] = useState({ url: '', key: '' });
  const [downloaded, setDownloaded] = useState<string[]>([]);
  const [selectedScripts, setSelectedScripts] = useState<Record<string, string>>({});
  const logEnd = useRef<HTMLDivElement>(null);
  const api = window.repoRun;
  const demo = report?.id === 'demo';
  const navigate = (next: Page) => {
    setGithubToken('');
    setPage(next);
    setReport(null);
    setError('');
    setFilter('all');
  };
  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 5000);
  };
  const perform = async <T,>(label: string, action: () => Promise<T>): Promise<T | undefined> => {
    setError('');
    setErrorInfo(null);
    setBusy(label);
    try {
      return await action();
    } catch (error) {
      const detail = decodeError(error);
      setError(detail.message);
      setErrorInfo(detail);
    } finally {
      setBusy('');
    }
  };
  const refreshHistory = async () => {
    if (!api) return;
    const result = await api.history();
    setHistory(result.scans);
    setSyncWarning(result.warning || '');
  };
  useEffect(() => {
    if (!api) return;
    api
      .getState()
      .then(async (s) => {
        setState(s);
        if (s.user) {
          const result = await api.history();
          setHistory(result.scans);
          setSyncWarning(result.warning || '');
        }
      })
      .catch((e) => setError(decodeError(e).message));
    api
      .system()
      .then((machine) => setState((s) => ({ ...s, machine })))
      .catch((e) => setError(decodeError(e).message));
    return api.onLog((event: LogEvent) => {
      setLogs((value) => (value + event.text).slice(-150000));
      if (event.done)
        setJob((value) => (value ? { ...value, done: true, error: !!event.error } : value));
    });
  }, []);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), a[href], select, [tabindex="0"]',
        ) || [],
      );
    elements()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
      if (e.key === 'Tab') {
        const items = elements();
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [modal]);
  const needDesktop = () => {
    if (api) return true;
    setError(
      'Open the Repo Run desktop app to check this computer, sign in, or install software. This browser preview includes a sample report.',
    );
    return false;
  };
  const scan = async (target = url) => {
    if (!needDesktop()) return;
    if (!state.user) {
      setModal('auth');
      return;
    }
    const result = await perform('Checking repository', () => api!.scan(target));
    if (result) {
      setReport(result);
      setDetailTab('requirements');
      setFilter('all');
      await refreshHistory();
    }
  };
  const signIn = async () => {
    if (!needDesktop()) {
      setModal(null);
      return;
    }
    if (!state.configured) {
      setModal(null);
      navigate('settings');
      return;
    }
    const user = await perform('Waiting for Google sign-in', () => api!.signIn());
    if (user) {
      setState(await api!.getState());
      setModal(null);
      await perform('Loading history', refreshHistory);
      notify('You’re signed in. Your checks will be saved to your account.');
    }
  };
  const reviewPlan = async (action: () => Promise<ActionPlan | null>) => {
    if (demo) {
      notify(
        'This is an example. Check a real repository in the desktop app to install or run it.',
      );
      return;
    }
    if (!needDesktop()) return;
    const result = await perform('Preparing your next step', action);
    if (result) {
      setPlan(result);
      setAccepted(false);
      setModal('plan');
    }
  };
  const execute = async () => {
    if (!plan || !api) return;
    const result = await perform('Starting task', () => api.execute(plan.id));
    if (result) {
      setJob({ id: result.jobId, title: plan.title, done: false, error: false });
      setLogs('');
      setShowLogs(true);
      setModal(null);
    }
  };
  useEffect(() => {
    if (job?.done && !job.error && plan?.kind === 'clone' && report)
      setDownloaded((value) => [...new Set([...value, report.id])]);
  }, [job?.done]);
  const open = (link: string) => {
    if (api) void api.openExternal(link);
    else window.open(link, '_blank', 'noopener,noreferrer');
  };
  const showDemo = () => {
    setReport(demoScan);
    setDetailTab('requirements');
    setFilter('all');
    setError('');
  };
  const machine = state.machine;
  const readyCount = report?.requirements.filter((r) => r.status === 'ready').length || 0;
  const issueCount = (report?.requirements.length || 0) - readyCount;
  const isBusy = !!busy;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-drag" />
        <Brand />
        <div className="workspace-label">
          YOUR WORKSPACE <span>PERSONAL</span>
        </div>
        <nav aria-label="Main navigation">
          <button
            className={page === 'home' && !report ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('home')}
          >
            <Plus size={18} />
            New check<span className="key-hint">↵</span>
          </button>
          <button
            className={page === 'history' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('history')}
          >
            <History size={18} />
            Repository history
            {history.length > 0 && <span className="count">{history.length}</span>}
          </button>
          <button
            className={page === 'system' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('system')}
          >
            <Monitor size={18} />
            My computer
          </button>
        </nav>
        <div className="sidebar-projects">
          <div className="workspace-label">RECENT REPOSITORIES</div>
          {history.length ? (
            history.slice(0, 4).map((item) => (
              <button
                key={item.id}
                className="recent-nav"
                onClick={() => {
                  setReport(item);
                  setDetailTab('requirements');
                }}
              >
                <FolderGit2 size={15} />
                <span>{item.repository.name}</span>
              </button>
            ))
          ) : (
            <p>
              Your next idea
              <br />
              starts with a repository.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="mini-orbit">
              <ShieldCheck size={18} />
            </span>
            <strong>Your machine. Your control.</strong>
            <p>
              You review every installation
              <br />
              before anything changes.
            </p>
          </div>
          <button
            className={`nav-item ${page === 'guide' ? 'active' : ''}`}
            onClick={() => navigate('guide')}
          >
            <CircleHelp size={18} />
            Getting started
            <ArrowUpRight className="push" size={14} />
          </button>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            Settings
          </button>
          <div className="account">
            <span className="avatar">
              {state.user ? state.user.name.slice(0, 2).toUpperCase() : <Code2 size={19} />}
            </span>
            <div>
              <strong>{state.user?.name || 'Your workspace'}</strong>
              <small>{state.user ? 'Personal account' : 'Sign in to save your checks'}</small>
            </div>
            <button
              aria-label={state.user ? 'Sign out' : 'Sign in'}
              title={state.user ? 'Sign out' : 'Sign in'}
              onClick={() =>
                state.user
                  ? void perform('Signing out', async () => {
                      await api!.signOut();
                      setState((s) => ({ ...s, user: null, githubConnected: false }));
                      setGithubToken('');
                      setHistory([]);
                      setReport(null);
                      setLogs('');
                      setJob(null);
                      setShowLogs(false);
                    })
                  : setModal('auth')
              }
            >
              {state.user ? <LogOut size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <FolderGit2 size={16} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {report
                ? report.repository.name
                : {
                    home: 'New check',
                    history: 'Repository history',
                    system: 'My computer',
                    settings: 'Settings',
                    guide: 'Getting started',
                  }[page]}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="device-tag">
              <span className="status-dot" />
              {state.desktop
                ? `${machine?.label || 'Desktop'} · ${machine?.arch === 'arm64' ? 'Apple silicon' : machine?.arch || 'Checking system'}`
                : 'Browser preview'}
            </span>
            {!state.user && (
              <button className="button small secondary" onClick={() => setModal('auth')}>
                <GoogleLogo />
                Sign in
              </button>
            )}
          </div>
        </header>
        <div className="content">
          {error && !modal && (
            <div role="alert" className="alert error">
              <TriangleAlert size={18} />
              <div>
                <span>{error}</span>
                {errorInfo?.message === error && errorInfo.retryAt && (
                  <RetryTime retryAt={errorInfo.retryAt} />
                )}
                {errorInfo?.message === error && errorInfo.provider === 'GitHub' && (
                  <p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setModal(null);
                        navigate('settings');
                      }}
                    >
                      GitHub connection settings
                    </button>
                  </p>
                )}
              </div>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div role="status" className="busy-bar">
              <Loader2 size={16} className="spin" />
              {busy}
              <span>Hang tight, we’re on it.</span>
            </div>
          )}
          {!report && page === 'home' && (
            <>
              <section className="welcome">
                <div className="eyebrow">
                  <span />
                  LESS SETUP. MORE BUILDING.
                </div>
                <h1>
                  Great projects start with
                  <br />a little less <span>guesswork.</span>
                </h1>
                <p>
                  From a repository link to a ready-to-run project.
                  <br />
                  Find out what you need. We’ll help you get there.
                </p>
              </section>
              <section className="scan-card">
                <div className="scan-heading">
                  <div className="icon-box">
                    <FolderGit2 size={23} />
                  </div>
                  <div>
                    <h2>Let’s check your repository</h2>
                    <p>Paste a public GitHub or GitLab link to get started.</p>
                  </div>
                  <span className="pill muted">FREE TO USE</span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void scan();
                  }}
                >
                  <label className="sr-only" htmlFor="repo-url">
                    Repository URL
                  </label>
                  <div className="repo-input-wrap">
                    <Github size={21} />
                    <input
                      id="repo-url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://github.com/username/repository"
                      type="url"
                      required
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button className="button primary" disabled={isBusy} type="submit">
                      {busy === 'Checking repository' ? (
                        <Loader2 size={17} className="spin" />
                      ) : (
                        'Check repository'
                      )}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </form>
                <div className="scan-foot">
                  <span>
                    <ShieldCheck size={15} />
                    Checks first. Nothing installs automatically.
                  </span>
                  <button className="text-button" onClick={showDemo}>
                    Explore a sample check
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </section>
              <section className="steps" aria-label="How Repo Run works">
                <div>
                  <span className="step-icon">
                    <Search size={20} />
                  </span>
                  <span className="step-number">01</span>
                  <h3>Understand the project</h3>
                  <p>
                    Languages, frameworks, and dependencies.
                    <br />
                    The essentials, all in one place.
                  </p>
                </div>
                <div>
                  <span className="step-icon">
                    <CheckCheck size={20} />
                  </span>
                  <span className="step-number">02</span>
                  <h3>Get your computer ready</h3>
                  <p>
                    See what’s installed, what’s missing,
                    <br />
                    and which versions need attention.
                  </p>
                </div>
                <div>
                  <span className="step-icon">
                    <Play size={19} />
                  </span>
                  <span className="step-number">03</span>
                  <h3>Make it run</h3>
                  <p>
                    Install what you need, download the
                    <br />
                    project, and bring your idea to life.
                  </p>
                </div>
              </section>
              <section className="recent-section">
                <div className="section-heading">
                  <div>
                    <h2>Pick up where you left off</h2>
                    <p>Your repository checks, ready for another look.</p>
                  </div>
                  <button className="text-button" onClick={() => navigate('history')}>
                    View history
                    <ArrowRight size={15} />
                  </button>
                </div>
                {history.length ? (
                  <div className="history-grid">
                    {history.slice(0, 3).map((item) => (
                      <HistoryCard key={item.id} scan={item} onOpen={() => setReport(item)} />
                    ))}
                  </div>
                ) : (
                  <div className="empty-history">
                    <div className="empty-history-art">
                      <span />
                      <span />
                      <FolderGit2 size={26} />
                    </div>
                    <div>
                      <h3>A fresh start. A world of repositories.</h3>
                      <p>Your checks will appear here once you get going.</p>
                    </div>
                    <button className="button secondary" onClick={() => setModal('auth')}>
                      <GoogleLogo />
                      Sign in to save history
                    </button>
                  </div>
                )}
              </section>
              <div className="bottom-line">
                <div>
                  <span className="status-dot" />
                  Built for macOS & Windows
                </div>
                <span>A little help between “git clone” and “it works.”</span>
                <span className="mono">v{state.version}</span>
              </div>
            </>
          )}

          {report && (
            <>
              <button className="back-button" onClick={() => setReport(null)}>
                <ArrowLeft size={15} />
                Back to workspace
              </button>
              {demo && (
                <div className="demo-banner">
                  <Sparkles size={16} />
                  <strong>A look at what’s possible</strong>
                  <span>This sample uses example repository and system data.</span>
                  <button onClick={() => setReport(null)}>
                    Try your own
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <div className="report-header">
                <div className="repo-avatar">
                  <FolderGit2 size={28} />
                </div>
                <div>
                  <div className="repo-owner">
                    {report.repository.owner} <span>/</span>
                  </div>
                  <h1>
                    {report.repository.name}
                    <span className="pill">Public repository</span>
                  </h1>
                  <p>{report.repository.description || 'Your repository readiness report.'}</p>
                  <div className="repo-meta">
                    <span>
                      <GitBranch size={14} />
                      {report.repository.branch}
                    </span>
                    <span className="mono">{report.repository.commit.slice(0, 7)}</span>
                    <span>{report.repository.language}</span>
                    {report.repository.license && <span>{report.repository.license}</span>}
                  </div>
                </div>
                <button
                  className="button secondary report-recheck"
                  disabled={isBusy}
                  onClick={() =>
                    demo
                      ? notify(
                          'Sample data stays the same. Check your own repository for live results.',
                        )
                      : void scan(report.repository.url)
                  }
                >
                  <RefreshCw size={15} />
                  Recheck
                </button>
              </div>
              <div className={`readiness ${issueCount ? '' : 'all-ready'}`}>
                <div
                  className="readiness-circle"
                  style={{
                    background: `conic-gradient(#92ad73 0 ${Math.round((readyCount / report.requirements.length) * 100)}%, #dce6cf 0)`,
                  }}
                >
                  <span>
                    {readyCount}
                    <small>/{report.requirements.length}</small>
                  </span>
                </div>
                <div>
                  <div className="eyebrow">YOUR READINESS CHECK</div>
                  <h2>
                    {issueCount ? `A few things to get ready.` : 'Your detected tools are ready.'}
                  </h2>
                  <p>
                    {issueCount
                      ? `${readyCount} compatible · ${report.requirements.filter((r) => r.status === 'missing').length} missing · ${report.requirements.filter((r) => r.status === 'mismatch').length} version conflicts`
                      : 'Next, download this revision and prepare the project.'}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={isBusy || (!!job && !job.done)}
                  onClick={() => reviewPlan(() => api!.planClone(report.id))}
                >
                  <ArrowDownToLine size={17} />
                  {downloaded.includes(report.id) ? 'Download another copy' : 'Download repository'}
                </button>
              </div>
              <div className="detail-tabs" role="tablist" aria-label="Report sections">
                {[
                  ['requirements', 'Requirements', report.requirements.length],
                  ['projects', 'Projects & run', report.projects.length],
                  ['notes', 'Setup notes', report.notices.length],
                  ['files', 'Inspected files', report.files.length],
                ].map(([id, title, count]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={detailTab === id}
                    className={detailTab === id ? 'selected' : ''}
                    onClick={() => setDetailTab(String(id))}
                  >
                    {title}
                    <span>{count}</span>
                  </button>
                ))}
              </div>
              {detailTab === 'requirements' && (
                <section className="panel requirements-panel">
                  <div className="panel-toolbar">
                    <h2>What this project needs</h2>
                    <div className="segmented">
                      <button
                        className={filter === 'all' ? 'selected' : ''}
                        onClick={() => setFilter('all')}
                      >
                        All requirements
                      </button>
                      <button
                        className={filter === 'attention' ? 'selected' : ''}
                        onClick={() => setFilter('attention')}
                      >
                        Needs attention <span>{issueCount}</span>
                      </button>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>REQUIREMENT</th>
                          <th>REQUIRED VERSION</th>
                          <th>DETECTED VERSION</th>
                          <th>STATUS</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {report.requirements
                          .filter((r) => filter === 'all' || r.status !== 'ready')
                          .map((r) => (
                            <tr key={r.id}>
                              <td>
                                <div className={`tool-symbol ${r.tool}`}>
                                  {r.tool === 'git' ? (
                                    <GitBranch size={18} />
                                  ) : r.tool === 'docker' ? (
                                    <Box size={18} />
                                  ) : (
                                    r.name.slice(0, 2)
                                  )}
                                </div>
                                <div className="tool-name">
                                  <strong>{r.name}</strong>
                                  <small title={r.reason}>{r.source}</small>
                                </div>
                              </td>
                              <td>
                                <code>{r.range === '*' ? 'Any version' : r.range}</code>
                              </td>
                              <td>
                                <span className={r.installed ? 'mono' : 'subtle'}>
                                  {r.installed || 'Not detected'}
                                </span>
                              </td>
                              <td>
                                <StatusBadge status={r.status} />
                                {r.detail && <small className="cell-detail">{r.detail}</small>}
                              </td>
                              <td>
                                {r.status === 'ready' ? (
                                  <Check size={18} className="green" />
                                ) : (
                                  <button
                                    className="button tiny secondary"
                                    disabled={isBusy || (!!job && !job.done)}
                                    onClick={() =>
                                      reviewPlan(() => api!.planInstall(report.id, r.id))
                                    }
                                  >
                                    {r.status === 'missing' ? 'Install' : 'Resolve'}
                                    <ArrowUpRight size={13} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {filter === 'attention' && !issueCount && (
                      <div className="simple-empty">
                        <CheckCircle2 size={26} />
                        <h3>Everything detected is compatible.</h3>
                      </div>
                    )}
                  </div>
                  <div className="panel-footer">
                    <Info size={14} />
                    <span>
                      Versions checked on {report.machine.label} · {report.machine.arch} ·{' '}
                      {relativeDate(report.checkedAt)}. Recheck to refresh your computer’s status.
                    </span>
                  </div>
                </section>
              )}
              {detailTab === 'projects' && (
                <div className="projects-list">
                  {report.projects.map((project) => (
                    <section className="panel project-card" key={project.id}>
                      <div className="section-heading">
                        <div>
                          <span className="eyebrow">
                            {project.ecosystem} · {project.directory}
                          </span>
                          <h2>{project.name}</h2>
                        </div>
                        <Package size={22} />
                      </div>
                      <div className="frameworks">
                        {project.frameworks.map((f) => (
                          <span className="pill" key={f}>
                            {f}
                          </span>
                        ))}
                        <span>{project.dependencies} declared packages</span>
                      </div>
                      <p className="subtle">
                        {downloaded.includes(report.id)
                          ? 'Downloaded. Install packages before starting the project.'
                          : 'Download the repository first, then set up and run this project.'}
                      </p>
                      <div className="project-actions">
                        <button
                          className="button secondary"
                          disabled={isBusy || (!!job && !job.done)}
                          onClick={() =>
                            reviewPlan(() => api!.planProject(report.id, project.id, 'setup'))
                          }
                        >
                          <Package size={16} />
                          Install packages
                        </button>
                        {Object.keys(project.scripts).length ? (
                          <>
                            <label className="sr-only" htmlFor={`script-${project.id}`}>
                              Run script for {project.name}
                            </label>
                            <select
                              id={`script-${project.id}`}
                              value={
                                selectedScripts[project.id] ||
                                (project.scripts.dev ? 'dev' : Object.keys(project.scripts)[0])
                              }
                              onChange={(e) =>
                                setSelectedScripts((s) => ({ ...s, [project.id]: e.target.value }))
                              }
                            >
                              {Object.entries(project.scripts).map(([name, command]) => (
                                <option key={name} value={name}>
                                  {name} — {command}
                                </option>
                              ))}
                            </select>
                            <button
                              className="button primary"
                              disabled={isBusy || (!!job && !job.done)}
                              onClick={() =>
                                reviewPlan(() =>
                                  api!.planProject(
                                    report.id,
                                    project.id,
                                    'run',
                                    selectedScripts[project.id] ||
                                      (project.scripts.dev
                                        ? 'dev'
                                        : Object.keys(project.scripts)[0]),
                                  ),
                                )
                              }
                            >
                              <Play size={15} />
                              Run
                            </button>
                          </>
                        ) : (
                          <span className="subtle">Follow the README to launch this project.</span>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}
              {detailTab === 'notes' && (
                <section className="panel notes-panel">
                  <h2>A few things to know</h2>
                  <p>Some projects need more than installed tools. Review these before you run.</p>
                  {report.notices.map((note, i) => (
                    <div className="note-row" key={i}>
                      <Info size={18} />
                      <span>{note}</span>
                    </div>
                  ))}
                </section>
              )}
              {detailTab === 'files' && (
                <section className="panel notes-panel">
                  <h2>Read, never executed</h2>
                  <p>
                    These files were inspected at revision {report.repository.commit.slice(0, 7)}.
                  </p>
                  {report.files.map((file) => (
                    <div className="file-row" key={file}>
                      <FileCode2 size={17} />
                      <code>{file}</code>
                      <Check size={15} />
                    </div>
                  ))}
                </section>
              )}
              <div className="report-bottom">
                <ShieldCheck size={16} />
                You’re always in control. Every installation starts with a plan you can review.
                <button
                  className="text-button"
                  onClick={() =>
                    demo
                      ? notify('This repository is an illustrative example.')
                      : open(report.repository.url)
                  }
                >
                  View repository
                  <ExternalLink size={14} />
                </button>
              </div>
            </>
          )}

          {!report && page === 'history' && (
            <>
              <PageHeading
                eyebrow="A LITTLE CONTINUITY"
                title="Your repository history."
                description="Every check is a starting point. Revisit a project and check it against your computer today."
              />
              {syncWarning && (
                <div className="alert">
                  <Info size={18} />
                  {syncWarning}
                </div>
              )}
              <div className="history-toolbar">
                <div className="search-input">
                  <Search size={17} />
                  <input
                    aria-label="Search repository history"
                    placeholder="Search your repositories…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button
                  className="button secondary"
                  disabled={!state.user || isBusy}
                  onClick={() => perform('Syncing history', refreshHistory)}
                >
                  <RefreshCw size={15} />
                  Sync history
                </button>
              </div>
              {history.length ? (
                <div className="history-grid">
                  {history
                    .filter((h) =>
                      `${h.repository.owner}/${h.repository.name}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((item) => (
                      <HistoryCard
                        key={item.id}
                        scan={item}
                        onOpen={() => {
                          setReport(item);
                          setDetailTab('requirements');
                        }}
                        onRecheck={() => void scan(item.repository.url)}
                        onDelete={() =>
                          void perform('Removing history', async () => {
                            await api!.removeHistory(item.id);
                            await refreshHistory();
                          })
                        }
                      />
                    ))}
                </div>
              ) : (
                <div className="panel big-empty">
                  <History size={35} />
                  <h2>Your next project belongs here.</h2>
                  <p>
                    {state.user
                      ? 'Check a repository to start building your history.'
                      : 'Sign in with Google to keep your checks together across computers.'}
                  </p>
                  <button
                    className="button primary"
                    onClick={() => (state.user ? navigate('home') : setModal('auth'))}
                  >
                    {state.user ? 'Check a repository' : 'Continue with Google'}
                    <ArrowRight size={16} />
                  </button>
                  <button className="text-button" onClick={showDemo}>
                    Take a look at a sample report
                  </button>
                </div>
              )}
            </>
          )}

          {!report && page === 'system' && (
            <>
              <PageHeading
                eyebrow="KNOW YOUR STARTING POINT"
                title="Meet your computer."
                description="A quick look at the developer tools available on this device."
              />
              <div className="machine-summary panel">
                <div className="machine-illustration">
                  <Monitor size={40} />
                </div>
                <div>
                  <h2>{machine?.label || 'Your desktop environment'}</h2>
                  <p>
                    {machine
                      ? `${machine.arch} architecture · ${machine.tools.filter((t) => t.path).length} tools detected`
                      : 'Open the desktop app to inspect your computer.'}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={isBusy}
                  onClick={() => {
                    if (needDesktop())
                      void perform('Checking your computer', async () => {
                        const result = await api!.system();
                        setState((s) => ({ ...s, machine: result }));
                      });
                  }}
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>
              {machine ? (
                <section className="panel system-list">
                  {machine.tools.map((tool) => (
                    <div className="system-row" key={tool.id}>
                      <span className="tool-symbol">{tool.name.slice(0, 2)}</span>
                      <div>
                        <strong>{tool.name}</strong>
                        <small>
                          {tool.path || 'Not found in the supported installation locations'}
                        </small>
                      </div>
                      <span className="mono">{tool.version || '—'}</span>
                      <span
                        className={`badge ${tool.path && tool.version ? 'ready' : tool.path ? 'unknown' : 'missing'}`}
                      >
                        {tool.path && tool.version
                          ? 'Installed'
                          : tool.path
                            ? 'Needs review'
                            : 'Not installed'}
                      </span>
                    </div>
                  ))}
                </section>
              ) : (
                <div className="panel big-empty">
                  <Monitor size={35} />
                  <h2>This browser can’t inspect your computer.</h2>
                  <p>The Mac and Windows desktop apps check installed tools locally.</p>
                </div>
              )}
              <p className="privacy-note">
                <ShieldCheck size={15} />
                Your full tool inventory and installation paths stay on this computer.
              </p>
            </>
          )}

          {!report && page === 'settings' && (
            <>
              <PageHeading
                eyebrow="MAKE YOURSELF AT HOME"
                title="A simple setup."
                description="Connect your account service and keep your workspace in sync."
              />
              <section className="panel settings-panel">
                <div className="section-heading">
                  <div>
                    <h2>Account & history</h2>
                    <p>Google sign-in, powered by your Supabase project.</p>
                  </div>
                  <span className={`badge ${state.configured ? 'ready' : 'unknown'}`}>
                    <span className="status-dot" />
                    {state.configured ? 'Connected' : 'Setup needed'}
                  </span>
                </div>
                <div className="setting-note">
                  <Info size={18} />
                  <p>
                    {state.configured
                      ? 'Your account service is configured. Sign in to sync checks across computers.'
                      : 'For the app owner: create a free Supabase project, enable Google sign-in, and apply the included database migration. End users will only need to sign in.'}
                  </p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (needDesktop())
                      void perform('Connecting account service', async () => {
                        await api!.configure(config);
                        setState(await api!.getState());
                        setHistory([]);
                        setConfig({ url: '', key: '' });
                        notify('Account service connected. You can now sign in with Google.');
                      });
                  }}
                >
                  <label htmlFor="supabase-url">Supabase project URL</label>
                  <input
                    id="supabase-url"
                    type="url"
                    placeholder="https://your-project.supabase.co"
                    value={config.url}
                    onChange={(e) => setConfig({ ...config, url: e.target.value })}
                    required
                  />
                  <label htmlFor="supabase-key">Publishable or anon key</label>
                  <input
                    id="supabase-key"
                    type="password"
                    placeholder="sb_publishable_…"
                    value={config.key}
                    onChange={(e) => setConfig({ ...config, key: e.target.value })}
                    required
                  />
                  <small>
                    Use the public client key. Never enter a service-role key or Google client
                    secret.
                  </small>
                  <div className="form-actions">
                    <button className="button primary" disabled={isBusy} type="submit">
                      Save connection
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => open('https://supabase.com/dashboard')}
                    >
                      Open Supabase
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </form>
              </section>
              <section className="panel settings-panel">
                <div className="section-heading">
                  <div>
                    <h2>GitHub connection</h2>
                    <p>Optional. Use your GitHub allowance for public repository checks.</p>
                  </div>
                  <span className={`badge ${state.githubConnected ? 'ready' : 'unknown'}`}>
                    {state.githubConnected ? 'Token saved' : 'Not connected'}
                  </span>
                </div>
                <p>
                  Google sign-in saves your history. This separate GitHub connection can increase
                  your API allowance. Private repositories remain unsupported.
                </p>
                <p>
                  Use a fine-grained personal access token with public-repository read access only.
                  Repo Run does not need write access. Your token is encrypted on this computer,
                  stored for your current Repo Run account, and sent only to GitHub’s API. It is
                  never synced to Supabase.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!needDesktop()) return;
                    const token = githubToken;
                    setGithubToken('');
                    void perform('Connecting GitHub', async () => {
                      await api!.setGithubToken(token);
                      setState(await api!.getState());
                      notify('GitHub connected. You can retry your repository check.');
                    });
                  }}
                >
                  <label htmlFor="github-token">GitHub personal access token</label>
                  <input
                    id="github-token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={githubToken}
                    onChange={(event) => setGithubToken(event.target.value)}
                    placeholder="github_pat_…"
                    required
                  />
                  <div className="form-actions">
                    <button
                      className="button primary"
                      type="submit"
                      disabled={isBusy || !state.user}
                    >
                      Save GitHub token
                    </button>
                    {state.githubConnected && (
                      <button
                        className="text-button"
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void perform('Removing GitHub connection', async () => {
                            await api!.removeGithubToken();
                            setGithubToken('');
                            setState(await api!.getState());
                            notify(
                              'GitHub token removed from this computer. You can also revoke it in GitHub.',
                            );
                          })
                        }
                      >
                        Remove GitHub token
                      </button>
                    )}
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => open('https://github.com/settings/personal-access-tokens/new')}
                    >
                      Create a token on GitHub <ExternalLink size={14} />
                    </button>
                  </div>
                  {!state.user && <small>Sign in to Repo Run before connecting GitHub.</small>}
                </form>
              </section>
              <section className="panel settings-panel">
                <h2>Made to be free.</h2>
                <p>
                  Repo Run has no subscription or paid feature tiers. Repository inspection and
                  system checks run on your computer. Your account stores your latest 100 repository
                  checks and relevant compatibility results. Older checks are removed as new checks
                  are saved.
                </p>
                <div className="setting-note">
                  <ShieldCheck size={19} />
                  <p>
                    Google sessions use the operating system’s encrypted credential storage.
                    Repository code only runs after you review and approve the commands.
                  </p>
                </div>
                <div className="version-row">
                  <Brand small />
                  <span>Version {state.version} · MIT licensed</span>
                </div>
              </section>
            </>
          )}

          {!report && page === 'guide' && (
            <>
              <PageHeading
                eyebrow="FROM REPO TO RUNNING"
                title="A little guidance goes a long way."
                description="Get a project onto your computer in four thoughtful steps."
              />
              <div className="guide-list">
                {[
                  {
                    icon: <GoogleLogo />,
                    title: 'Make it your workspace',
                    text: 'Sign in with Google. Your latest 100 repository checks are saved to your account so you can revisit them on a Mac or Windows computer.',
                  },
                  {
                    icon: <Search size={20} />,
                    title: 'Paste a repository link',
                    text: 'Use a public GitHub or GitLab repository URL. Repo Run reads supported manifests, identifies tools and version constraints, then compares them with your computer.',
                  },
                  {
                    icon: <Package size={20} />,
                    title: 'Resolve what’s missing',
                    text: 'Open Install or Resolve beside a requirement. Review the command before continuing. macOS uses Homebrew; Windows uses winget. Recheck after every installation to confirm compatibility.',
                  },
                  {
                    icon: <Play size={20} />,
                    title: 'Download, prepare, run',
                    text: 'Choose a download folder. Repo Run downloads the exact checked revision. In Projects & run, install packages and choose a run script. Check setup notes for credentials, environment variables, and external services.',
                  },
                ].map((step, i) => (
                  <section className="panel guide-card" key={step.title}>
                    <span className="step-icon">{step.icon}</span>
                    <div>
                      <span className="eyebrow">STEP 0{i + 1}</span>
                      <h2>{step.title}</h2>
                      <p>{step.text}</p>
                    </div>
                  </section>
                ))}
              </div>
              <div className="alert">
                <Info size={19} />
                <span>
                  Repo Run detects common project requirements. Custom build systems, private
                  repositories, self-hosted Git servers, and undocumented dependencies may need
                  manual setup.
                </span>
              </div>
              <button className="button primary" onClick={() => navigate('home')}>
                Let’s check a repository
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {job && !showLogs && (
        <button className="job-pill" onClick={() => setShowLogs(true)}>
          {job.done ? <Terminal size={16} /> : <Loader2 size={16} className="spin" />}
          {job.title}
          <ChevronDown size={16} />
        </button>
      )}
      {showLogs && job && (
        <section className="log-panel" aria-label="Task output">
          <div className="log-header">
            <Terminal size={17} />
            <strong>{job.title}</strong>
            <span className={job.error ? 'log-error' : ''}>
              {job.done ? (job.error ? 'Needs attention' : 'Completed') : 'Running'}
            </span>
            {!job.done && (
              <button onClick={() => api?.cancel(job.id)}>
                <Square size={12} />
                Stop
              </button>
            )}
            <button aria-label="Minimize output" onClick={() => setShowLogs(false)}>
              <ChevronDown size={18} />
            </button>
          </div>
          <pre>
            {logs || 'Preparing…'}
            <div ref={logEnd} />
          </pre>
        </section>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === 'plan' ? 'plan-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {error && (
              <div className="alert error" role="alert">
                <TriangleAlert size={17} />
                <div>
                  <span>{error}</span>
                  {errorInfo?.message === error && errorInfo.retryAt && (
                    <RetryTime retryAt={errorInfo.retryAt} />
                  )}
                  {errorInfo?.message === error && errorInfo.provider === 'GitHub' && (
                    <p>
                      <button
                        className="text-button"
                        onClick={() => {
                          setModal(null);
                          navigate('settings');
                        }}
                      >
                        GitHub connection settings
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}
            {modal === 'auth' ? (
              <>
                <Brand />
                <div className="auth-art">
                  <FolderGit2 size={30} />
                  <span>
                    <Check size={18} />
                  </span>
                </div>
                <span className="eyebrow">YOUR NEXT PROJECT, ONE STEP CLOSER</span>
                <h2 id="modal-title">
                  A workspace that
                  <br />
                  remembers you.
                </h2>
                <p>
                  Save your repository checks, pick up where you left off, and recheck on any
                  computer.
                </p>
                <button className="button google-button" disabled={isBusy} onClick={signIn}>
                  <GoogleLogo />
                  {busy.includes('Google')
                    ? 'Continue in your browser…'
                    : state.configured
                      ? 'Continue with Google'
                      : 'Set up Google sign-in'}
                </button>
                {!state.configured && (
                  <small className="auth-note">
                    The app owner needs to connect Supabase before Google sign-in is available.
                  </small>
                )}
                <div className="auth-benefits">
                  <span>
                    <Check size={15} />
                    Free to use
                  </span>
                  <span>
                    <Check size={15} />
                    No credit card
                  </span>
                  <span>
                    <Check size={15} />
                    Your history, synced
                  </span>
                </div>
              </>
            ) : (
              plan && (
                <>
                  <div className="icon-box">
                    <Terminal size={24} />
                  </div>
                  <h2 id="modal-title">{plan.title}</h2>
                  <p>{plan.description}</p>
                  <div className="command-list">
                    {plan.commands.map((command, i) => (
                      <div key={i}>
                        <small>{command.label}</small>
                        <code>
                          {[
                            command.executable,
                            ...command.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)),
                          ].join(' ')}
                        </code>
                        {command.cwd && <span>In {command.cwd}</span>}
                      </div>
                    ))}
                  </div>
                  {plan.warnings.map((warning) => (
                    <div className="plan-warning" key={warning}>
                      <Info size={16} />
                      <p>{warning}</p>
                    </div>
                  ))}
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    <span>I’ve reviewed these commands and want to continue.</span>
                  </label>
                  <div className="modal-actions">
                    <button className="button secondary" onClick={() => setModal(null)}>
                      Cancel
                    </button>
                    <button
                      className="button primary"
                      disabled={!accepted || isBusy}
                      onClick={execute}
                    >
                      {plan.kind === 'run'
                        ? 'Run project'
                        : plan.kind === 'clone'
                          ? 'Download repository'
                          : 'Install'}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function HistoryCard({
  scan,
  onOpen,
  onRecheck,
  onDelete,
}: {
  scan: Scan;
  onOpen: () => void;
  onRecheck?: () => void;
  onDelete?: () => void;
}) {
  const issues = scan.requirements.filter((r) => r.status !== 'ready').length;
  return (
    <article className="history-card">
      <button className="history-card-main" onClick={onOpen}>
        <div className="history-card-top">
          <span className="icon-box">
            <FolderGit2 size={22} />
          </span>
          <ArrowUpRight size={16} />
        </div>
        <small>{scan.repository.owner}</small>
        <h3>{scan.repository.name}</h3>
        <p>{scan.repository.description || 'Repository readiness check'}</p>
        <span className={`badge ${issues ? 'unknown' : 'ready'}`}>
          <span className="status-dot" />
          {issues ? `${issues} need attention` : 'Tools compatible'}
        </span>
      </button>
      <div className="history-card-footer">
        <span>
          <Clock3 size={13} />
          {relativeDate(scan.checkedAt)}
        </span>
        {onRecheck && (
          <button aria-label={`Recheck ${scan.repository.name}`} onClick={onRecheck}>
            <RefreshCw size={14} />
          </button>
        )}
        {onDelete && (
          <button aria-label={`Delete ${scan.repository.name} check`} onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </article>
  );
}
