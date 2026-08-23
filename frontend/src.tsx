import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session } from '@supabase/supabase-js';
import type { CheckResult, Monitor, StatisticsSeries } from '../src/db/models';
import './style.css';

const API =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787/api/v1';
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !anon) {
  throw new Error(
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env.local.',
  );
}

// persistSession: false means the session lives only in memory for this
// page load — nothing is written to localStorage, so refreshing or
// returning to the site always starts at the login screen. Within a single
// page load the session still behaves normally (autoRefreshToken keeps the
// token valid while the tab stays open).
const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    storage: window.sessionStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
const INTERVALS = import.meta.env.DEV
  ? [1, 5, 10, 15, 30]
  : [5, 10, 15, 30];
const MANUAL_CHECKS_ENABLED = import.meta.env.DEV;

type Incident = {
  id: string;
  started_at: string;
  confirmed_at: string;
  resolved_at: string | null;
  status: string;
  failure_type: string | null;
  duration_seconds: number | null;
};

type Detail = {
  stats: StatisticsSeries;
  checks: CheckResult[];
  incidents: Incident[];
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [dashboardReady, setDashboardReady] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const selectedRef = useRef<Monitor | null>(null);
  const [signUp, setSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [selected, setSelected] = useState<Monitor | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [name, setName] = useState('My API');
  const [targetUrl, setTargetUrl] = useState('https://example.com');
  const [interval, setInterval] = useState(5);

  const MAX_RANGE_DAYS = 90;
  const DEFAULT_RANGE_DAYS = 30;

  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const [period, setPeriod] = useState(() => ({
    to: today(),
    from: daysAgo(DEFAULT_RANGE_DAYS - 1),
  }));

  const rangeDays =
    Math.round(
      (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000,
    ) + 1;

  // Validates and applies a new reporting window. Mirrors the backend's
  // reportQuery rules (from <= to, span <= 90 days) so the UI fails fast
  // with a clear message instead of round-tripping a 400 to the server.
  const applyRange = (from: string, to: string) => {
    if (!from || !to) return;

    if (from > to) {
      setNotice('The "from" date must not be later than the "to" date.');
      return;
    }

    const spanDays =
      Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

    if (spanDays > MAX_RANGE_DAYS) {
      setNotice(`Reporting period cannot exceed ${MAX_RANGE_DAYS} days.`);
      return;
    }

    setPeriod({ from, to });
  };

  // "Since creation" preset: starts at the monitor's creation date, but
  // clamped to the same MAX_RANGE_DAYS cap every other range respects — a
  // monitor older than 90 days shows its most recent 90 days, same as the
  // 90d preset; a younger monitor shows its full history.
  const sinceCreationFrom = (monitor: Monitor) => {
    const createdDate = monitor.created_at.slice(0, 10);
    const earliestAllowed = daysAgo(MAX_RANGE_DAYS - 1);

    return createdDate > earliestAllowed ? createdDate : earliestAllowed;
  };

  const clearPrivateState = () => {
    setMonitors([]);
    setSelected(null);
    setDetail(null);
    setNotice('');
    setDashboardReady(false);
  };

  useEffect(() => {
    let alive = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;

      sessionRef.current = data.session;
      setSession(data.session);
      setReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;

      sessionRef.current = next;
      setSession(next);
      setReady(true);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Every time a different monitor is selected, default its view back to
  // "All" (since creation, capped at 90 days) rather than carrying over
  // whatever range was picked for the previously selected monitor.
  useEffect(() => {
    if (selected) {
      setPeriod({ from: sinceCreationFrom(selected), to: today() });
    }
  }, [selected?.id]);

  const headers = (): HeadersInit => ({
    Authorization: `Bearer ${session?.access_token ?? ''}`,
    'Content-Type': 'application/json',
  });

  const request = async <T,>(
    path: string,
    options?: RequestInit,
  ): Promise<T> => {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...headers(),
        ...options?.headers,
      },
    });

    const contentType = res.headers.get('content-type') ?? '';
    const data: unknown = contentType.includes('application/json')
      ? await res.json()
      : await res.text();

    if (!res.ok) {
      throw new Error(
        typeof data === 'string'
          ? data || `Request failed (${res.status}).`
          : errorMessage(data, `Request failed (${res.status}).`),
      );
    }

    return data as T;
  };

  const loadMonitors = async () => {
    const currentSession = sessionRef.current;

    if (!currentSession) return;

    const userId = currentSession.user.id;

    setDashboardReady(false);

    try {
      const data = await request<Monitor[]>('/monitors');

      // Ignore responses belonging to a previous user/session.
      if (sessionRef.current?.user.id !== userId) {
        return;
      }

      setMonitors(data);

      setSelected(
        (current) =>
          data.find((m) => m.id === current?.id) ?? data[0] ?? null,
      );

      setNotice(
        data.length
          ? `${data.length} monitor${data.length === 1 ? '' : 's'} loaded.`
          : 'No monitors yet. Create one to start checking.',
      );

      setDashboardReady(true);
    } catch (e) {
      if (sessionRef.current?.user.id !== userId) {
        return;
      }

      setNotice(messageOf(e));
      setDashboardReady(true);
    }
  };

  const loadDetail = async (monitor: Monitor) => {
    const currentSession = sessionRef.current;

    if (!currentSession) return;

    const userId = currentSession.user.id;
    const monitorId = monitor.id;

    try {
      setDetail(null);

      // period is user-adjustable (default 30 days, up to 90) rather than
      // a fixed seven-day window.
      const query = `?from=${period.from}&to=${period.to}`;

      const [stats, checks, incidents] = await Promise.all([
        request<StatisticsSeries>(
          `/monitors/${monitorId}/statistics${query}`,
        ),
        request<CheckResult[]>(
          `/monitors/${monitorId}/checks${query}`,
        ),
        request<Incident[]>(
          `/monitors/${monitorId}/incidents`,
        ),
      ]);

      if (
        sessionRef.current?.user.id !== userId ||
        selectedRef.current?.id !== monitorId
      ) {
        return;
      }

      setDetail({ stats, checks, incidents });
    } catch (e) {
      if (
        sessionRef.current?.user.id !== userId ||
        selectedRef.current?.id !== monitorId
      ) {
        return;
      }

      setNotice(messageOf(e));
    }
  };

  useEffect(() => {
    if (!session) {
      clearPrivateState();
      return;
    }

    clearPrivateState();
    void loadMonitors();
  }, [session?.user.id]);

  useEffect(() => {
    if (selected && dashboardReady) {
      void loadDetail(selected);
    }
  }, [
    selected?.id,
    session?.user.id,
    dashboardReady,
    period.from,
    period.to,
  ]);

  const submitAuth = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setAuthNotice('');

    try {
      const result = signUp
        ? await supabase.auth.signUp({
          email,
          password,
        })
        : await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (result.error) {
        setAuthNotice(result.error.message);
      }
    } catch (e) {
      setAuthNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);

    try {
      await request<Monitor>('/monitors', {
        method: 'POST',
        body: JSON.stringify({
          name,
          url: targetUrl,
          interval_minutes: interval,
        }),
      });

      setTargetUrl('https://example.com');
      setShowCreate(false);
      await loadMonitors();

      setNotice(
        'Monitor created. Run a manual check or trigger the local scheduler to see results.',
      );
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const manualCheck = async () => {
    if (!selected) return;

    setBusy(true);

    try {
      await request(`/monitors/${selected.id}/check`, {
        method: 'POST',
      });

      setNotice('Manual health check completed.');
      await loadMonitors();
      await loadDetail(selected);
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!selected) return;

    setBusy(true);

    try {
      await request(`/monitors/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: !selected.enabled,
        }),
      });

      await loadMonitors();
      setNotice(selected.enabled ? 'Monitor paused.' : 'Monitor enabled.');
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || !confirm(`Delete ${selected.name}?`)) return;

    const removing = selected;

    setBusy(true);
    setDeletingName(removing.name);
    setSelected(null);
    setDetail(null);
    setMonitors((current) =>
      current.filter((monitor) => monitor.id !== removing.id),
    );
    setNotice(`Deleting ${removing.name}…`);

    try {
      await request(`/monitors/${removing.id}`, {
        method: 'DELETE',
      });

      setNotice(`${removing.name} deleted.`);
      await loadMonitors();
    } catch (e) {
      setNotice(messageOf(e));
      await loadMonitors();
    } finally {
      setDeletingName(null);
      setBusy(false);
    }
  };

  const downloadReport = async () => {
    if (!selected) return;

    // Uses the same user-selected period as the dashboard so the PDF
    // always matches what's currently on screen.
    try {
      const res = await fetch(
        `${API}/monitors/${selected.id}/report?from=${period.from}&to=${period.to}`,
        {
          headers: headers(),
        },
      );

      if (!res.ok) {
        throw new Error('Could not generate report.');
      }

      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');

      a.href = href;
      a.download = `${selected.name}-report.pdf`;
      a.click();

      URL.revokeObjectURL(href);
    } catch (e) {
      setNotice(messageOf(e));
    }
  };

  if (!ready) {
    return (
      <main className="auth">
        <p>Restoring your session…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth">
        <p className="eyebrow">API Monitor</p>
        <h1>{signUp ? 'Create account' : 'Welcome back'}</h1>
        <p>Simple uptime monitoring for your APIs and websites.</p>

        <form onSubmit={submitAuth}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          {authNotice && <p className="notice">{authNotice}</p>}

          <button disabled={busy}>
            {signUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button
          className="text"
          onClick={() => {
            setSignUp(!signUp);
            setAuthNotice('');
          }}
        >
          {signUp
            ? 'Already have an account? Sign in'
            : 'New here? Create an account'}
        </button>
      </main>
    );
  }

  if (!dashboardReady) {
    return (
      <main className="auth">
        <p>Loading your monitors…</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">API Monitor</p>
          <h2>Control room</h2>
          <p className="muted">{session.user.email}</p>
        </div>

        <button
          className="add-monitor"
          onClick={() => setShowCreate(true)}
        >
          + Add monitor
        </button>

        <div className="sidebar-heading">
          <span>YOUR MONITORS</span>
          <button
            onClick={() => void loadMonitors()}
            className="text"
          >
            Refresh
          </button>
        </div>

        <nav className="monitor-nav">
          {monitors.map((m) => (
            <button
              key={m.id}
              className={`monitor ${selected?.id === m.id ? 'selected' : ''
                }`}
              onClick={() => setSelected(m)}
            >
              <span className={`dot ${m.state.toLowerCase()}`} />
              <strong>{m.name}</strong>
              <small>
                {m.enabled ? m.state.replace('_', ' ') : 'PAUSED'}
              </small>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="live-dot" /> API connection active

          <button
            className="text signout"
            onClick={() => void supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>{selected ? selected.name : 'Your monitors'}</h1>
          </div>

          <p className="notice">{notice}</p>
        </header>

        {!selected ? (
          <Empty />
        ) : (
          <section className="detail">
            <div className="section-title">
              <div>
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.url}
                </a>

                <p className="muted">
                  Scheduled every {selected.interval_minutes} minutes ·
                  next scheduled check{' '}
                  {formatDate(selected.next_check_at)}
                  <br />
                  Manual checks are recorded immediately and do not
                  move the schedule.
                </p>
              </div>

              <span
                className={`pill ${selected.state.toLowerCase()}`}
              >
                {selected.enabled
                  ? selected.state.replace('_', ' ')
                  : 'PAUSED'}
              </span>
            </div>

            <div className="actions">
              {MANUAL_CHECKS_ENABLED && (
                <button
                  disabled={busy}
                  onClick={() => void manualCheck()}
                >
                  Run check now
                </button>
              )}

              <button
                className="secondary"
                disabled={busy}
                onClick={() => void toggle()}
              >
                {selected.enabled ? 'Pause monitor' : 'Enable monitor'}
              </button>

              <button
                className="secondary"
                onClick={() => void downloadReport()}
              >
                Download PDF
              </button>

              <button
                className="danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {deletingName === selected.name
                  ? 'Deleting…'
                  : 'Delete'}
              </button>
            </div>

            <div className="date-range">
              <div className="date-range-presets">
                <button
                  type="button"
                  className={`text ${rangeDays === 7 && period.to === today() ? 'active' : ''}`}
                  onClick={() => applyRange(daysAgo(6), today())}
                >
                  7d
                </button>
                <button
                  type="button"
                  className={`text ${rangeDays === 30 && period.to === today() ? 'active' : ''}`}
                  onClick={() => applyRange(daysAgo(DEFAULT_RANGE_DAYS - 1), today())}
                >
                  30d
                </button>
                <button
                  type="button"
                  className={`text ${rangeDays === 90 && period.to === today() ? 'active' : ''}`}
                  onClick={() => applyRange(daysAgo(MAX_RANGE_DAYS - 1), today())}
                >
                  90d
                </button>
                <button
                  type="button"
                  title="From monitor creation, capped at 90 days"
                  className={`text ${period.to === today() &&
                      period.from === sinceCreationFrom(selected)
                      ? 'active'
                      : ''
                    }`}
                  onClick={() => {
                    if (!selected) return;
                    applyRange(sinceCreationFrom(selected), today());
                  }}
                >
                  All
                </button>
              </div>

              <label className="date-range-field">
                From
                <input
                  type="date"
                  value={period.from}
                  max={period.to}
                  onChange={(e) => applyRange(e.target.value, period.to)}
                />
              </label>

              <label className="date-range-field">
                To
                <input
                  type="date"
                  value={period.to}
                  min={period.from}
                  max={today()}
                  onChange={(e) => applyRange(period.from, e.target.value)}
                />
              </label>

              <small className="muted">
                {rangeDays} day{rangeDays === 1 ? '' : 's'} · up to{' '}
                {MAX_RANGE_DAYS} days
              </small>
            </div>

            {detail ? (
              <Dashboard detail={detail} rangeDays={rangeDays} />
            ) : (
              <p>Loading monitor data…</p>
            )}
          </section>
        )}

        {showCreate && (
          <div
            className="drawer-backdrop"
            onMouseDown={() => !busy && setShowCreate(false)}
          >
            <section
              className="drawer"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="section-title">
                <div>
                  <p className="eyebrow">New monitor</p>
                  <h2>Add an endpoint</h2>
                </div>

                <button
                  className="text"
                  onClick={() => setShowCreate(false)}
                >
                  Close
                </button>
              </div>

              <p className="muted">
                We will make a scheduled HTTP check at your chosen
                interval.
              </p>

              <form onSubmit={create} className="create">
                <label>
                  Name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>

                <label>
                  URL
                  <input
                    type="url"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    required
                  />
                </label>

                <label>
                  Interval
                  <select
                    value={interval}
                    onChange={(e) =>
                      setInterval(Number(e.target.value))
                    }
                  >
                    {INTERVALS.map((x) => (
                      <option key={x} value={x}>
                        {x === 1 ? '1 minute (local testing)' : `${x} minutes`}
                      </option>
                    ))}
                  </select>
                </label>

                <button disabled={busy}>
                  {busy ? 'Creating…' : 'Create monitor'}
                </button>
              </form>
            </section>
          </div>
        )}

        {deletingName && (
          <div className="deleting-toast">
            <span className="spinner" />
            Deleting <strong>{deletingName}</strong>…
          </div>
        )}
      </section>
    </main>
  );
}

function Dashboard({
  detail,
  rangeDays,
}: {
  detail: Detail;
  rangeDays: number;
}) {
  const { summary: s, points, failureTypes, httpStatuses } = detail.stats;

  return (
    <>
      <div className="stats">
        <Metric
          label={`Uptime (${rangeDays} day${rangeDays === 1 ? '' : 's'})`}
          value={s.totalChecks ? `${s.uptimePercentage}%` : 'N/A'}
        />
        <Metric
          label="Average response"
          value={
            s.averageResponseMs === null
              ? 'N/A'
              : `${s.averageResponseMs} ms`
          }
        />
        <Metric
          label="Incidents"
          value={String(s.incidentCount)}
        />
        <Metric
          label="Downtime"
          value={duration(s.totalDowntimeSeconds)}
        />
      </div>

      <div className="chart-grid">
        <ChartPanel
          title="Response time"
          subtitle="Daily average response time"
        >
          <LineChart
            points={points.map((point) => ({
              label: point.date,
              value: point.averageResponseMs,
            }))}
            suffix="ms"
          />
        </ChartPanel>

        <ChartPanel
          title="Availability"
          subtitle="Successful checks by day"
        >
          <LineChart
            points={points.map((point) => ({
              label: point.date,
              value:
                point.totalChecks > 0
                  ? point.uptimePercentage
                  : null,
            }))}
            suffix="%"
            min={0}
            max={100}
          />
        </ChartPanel>
        <ChartPanel title="Failure breakdown" subtitle="Recent detailed checks">
          <BarChart rows={failureTypes.map((item) => ({ label: labelFailure(item.type), value: item.count }))} empty="No failures in this period." />
        </ChartPanel>
        <ChartPanel title="HTTP responses" subtitle="Actual responses received">
          <BarChart rows={httpStatuses.map((item) => ({ label: item.status === null ? 'N/A (no response)' : String(item.status), value: item.count }))} empty="No checks recorded yet." />
        </ChartPanel>
      </div>

      <section className="panel">
        <h3>Recent checks</h3>

        {detail.checks.length ? (
          <div className="checks-table">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Result</th>
                  <th>Status</th>
                  <th>Response</th>
                </tr>
              </thead>

              <tbody>
                {detail.checks.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.checked_at)}</td>
                    <td className={c.success ? 'success' : 'failure'}>
                      {c.success
                        ? 'Healthy'
                        : c.failure_type ?? 'N/A'}
                    </td>
                    <td>{c.http_status ?? 'N/A'}</td>
                    <td>
                      {c.response_ms === null
                        ? 'N/A'
                        : `${c.response_ms} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            No checks recorded yet. Use “Run check now” to test this
            monitor.
          </p>
        )}
      </section>

      <section className="panel">
        <h3>Incidents</h3>

        {detail.incidents.length ? (
          <div className="incidents-list">
            {detail.incidents.map((i) => (
              <p key={i.id}>
                {i.status} · started {formatDate(i.started_at)}
                {i.resolved_at
                  ? ` · recovered ${formatDate(i.resolved_at)}`
                  : ''}
              </p>
            ))}
          </div>
        ) : (
          <p className="muted">
            No confirmed incidents in this monitor’s history.
          </p>
        )}
      </section>
    </>
  );
}

function ChartPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="panel chart-panel">
      <div className="chart-heading">
        <div>
          <h3>{title}</h3>
          <small>{subtitle}</small>
        </div>
      </div>

      {children}
    </section>
  );
}

type ChartPoint = {
  label: string;
  value: number | null;
};

function LineChart({
  points,
  suffix,
  max,
  min = 0,
  formatValue = (value) => `${value}${suffix}`,
}: {
  points: ChartPoint[];
  suffix: string;
  max?: number;
  min?: number;
  formatValue?: (value: number) => string;
}) {
  if (!points.length) {
    return (
      <p className="muted chart-empty">
        N/A - no applicable readings for this period.
      </p>
    );
  }

  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value !== null);

  if (!values.length) {
    return (
      <p className="muted chart-empty">
        N/A - no applicable readings for this period.
      </p>
    );
  }

  const rawMax = max ?? Math.max(...values);

  // Give a response-time chart some visual headroom.
  const chartMax =
    max !== undefined
      ? max
      : rawMax === 0
        ? 1
        : niceCeiling(rawMax);

  const chartMin = min;
  const range = Math.max(chartMax - chartMin, 1);

  const width = 760;
  const height = 250;

  const padding = {
    top: 18,
    right: 18,
    bottom: 42,
    left: 54,
  };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xForIndex = (index: number) => {
    if (points.length === 1) {
      return padding.left + plotWidth / 2;
    }

    return (
      padding.left +
      (index / (points.length - 1)) * plotWidth
    );
  };

  const yForValue = (value: number) => {
    return (
      padding.top +
      plotHeight -
      ((value - chartMin) / range) * plotHeight
    );
  };

  const tickCount = 5;
  const ticks = Array.from(
    { length: tickCount },
    (_, index) =>
      chartMin +
      ((chartMax - chartMin) * index) / (tickCount - 1),
  );

  /*
   * Split the series into contiguous runs so a missing day does not
   * accidentally produce a line across a data gap.
   */
  const segments: Array<
    Array<{ index: number; point: ChartPoint }>
  > = [];

  let currentSegment: Array<{
    index: number;
    point: ChartPoint;
  }> = [];

  points.forEach((point, index) => {
    if (point.value === null) {
      if (currentSegment.length) {
        segments.push(currentSegment);
        currentSegment = [];
      }

      return;
    }

    currentSegment.push({ index, point });
  });

  if (currentSegment.length) {
    segments.push(currentSegment);
  }

  const formatTick = (value: number) => {
    if (suffix === '%') {
      return `${Math.round(value)}%`;
    }

    return formatDurationValue(value);
  };

  return (
    <div className="line-chart">
      <div className="chart-meta">
        <strong>
          {formatValue(values[values.length - 1])}
        </strong>
        <span>
          {values.length} day{values.length === 1 ? '' : 's'} with data
        </span>
      </div>

      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${suffix === '%' ? 'Availability' : 'Response time'} trend`}
      >
        {ticks.map((tick) => {
          const y = yForValue(tick);

          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="chart-grid-line"
              />

              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                className="chart-axis-label"
              >
                {formatTick(tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={padding.left}
          x2={padding.left}
          y1={padding.top}
          y2={height - padding.bottom}
          className="chart-axis"
        />

        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          className="chart-axis"
        />

        {segments.map((segment, segmentIndex) => {
          const coordinates = segment
            .map(
              ({ index, point }) =>
                `${xForIndex(index)},${yForValue(point.value!)}`,
            )
            .join(' ');

          return (
            <polyline
              key={segmentIndex}
              points={coordinates}
              className="chart-line"
            />
          );
        })}

        {points.map((point, index) => {
          if (point.value === null) return null;

          const x = xForIndex(index);
          const y = yForValue(point.value);

          return (
            <g key={`${point.label}-${index}`}>
              <circle
                cx={x}
                cy={y}
                r="4"
                className="chart-point"
              >
                <title>
                  {shortDate(point.label)} ·{' '}
                  {formatValue(point.value)}
                </title>
              </circle>
            </g>
          );
        })}

        {points.map((point, index) => {
          const shouldShow =
            points.length <= 8 ||
            index === 0 ||
            index === points.length - 1 ||
            index % Math.ceil(points.length / 6) === 0;

          if (!shouldShow) return null;

          return (
            <text
              key={`label-${point.label}-${index}`}
              x={xForIndex(index)}
              y={height - 14}
              textAnchor={
                index === 0
                  ? 'start'
                  : index === points.length - 1
                    ? 'end'
                    : 'middle'
              }
              className="chart-axis-label"
            >
              {shortDate(point.label)}
            </text>
          );
        })}
      </svg>

      <div className="chart-axis-title">
        <span>
          {suffix === '%' ? 'Availability (%)' : 'Response time'}
        </span>
        {suffix !== '%' && <span>Time →</span>}
      </div>
    </div>
  );
}

function BarChart({
  rows,
  empty,
}: {
  rows: Array<{ label: string; value: number }>;
  empty: string;
}) {
  if (!rows.length) {
    return <p className="muted chart-empty">{empty}</p>;
  }

  const maximum = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="bar-chart">
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <span title={row.label}>{row.label}</span>

          <div className="bar-track">
            <i
              style={{
                width: `${(row.value / maximum) * 100}%`,
              }}
            />
          </div>

          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

function niceCeiling(value: number) {
  if (value <= 10) return 10;
  if (value <= 25) return 25;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  if (value <= 250) return 250;
  if (value <= 500) return 500;
  if (value <= 1000) return 1000;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;

  return 10 * magnitude;
}

function formatDurationValue(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }

  return `${Math.round(value)}ms`;
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Empty() {
  return (
    <div className="empty">
      <h2>No monitor selected</h2>
      <p>Create a monitor on the left to begin.</p>
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return 'N/A';
  return new Date(value).toLocaleString();
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function labelFailure(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function duration(seconds: number) {
  if (!seconds) return '0s';

  const m = Math.floor(seconds / 60);

  return m ? `${m}m ${seconds % 60}s` : `${seconds}s`;
}

function errorMessage(data: unknown, fallback: string) {
  return typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'object' &&
    data.error !== null &&
    'message' in data.error &&
    typeof data.error.message === 'string'
    ? data.error.message
    : fallback;
}

function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Unexpected request failure.';
}

createRoot(document.getElementById('root')!).render(<App />);