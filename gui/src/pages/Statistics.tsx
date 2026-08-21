import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatProviderDisplayName } from "../provider-icons";
import { formatTokens } from "../format-tokens";
import { formatEstimatedUsdValue } from "../intl-formatters";
import { modelLabel } from "../model-display";
import { useI18n, useT, type TFn } from "../i18n/shared";
import { Select } from "../ui";
import "./Statistics.css";

type Granularity = "5m" | "1h" | "1d";

type Summary = {
  requests: number;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheHitRatio: number;
  estimatedCostUsd: number;
};

type TrendPoint = Summary & { bucketStart: number };

type ModelRow = Summary & {
  provider: string;
  account: string;
  model: string;
  shareRatio: number;
};

type QuotaRow = {
  provider: string;
  account: string;
  quotaType: "five-hour" | "weekly" | "monthly" | "custom";
  label: string;
  periodStart: number;
  periodEnd: number;
  usedPercent: number;
  usedTokens: number;
  estimatedTotalTokens: number | null;
  usedCostUsd: number;
  estimatedTotalCostUsd: number | null;
};

type StatisticsResponse = {
  generatedAt: number;
  from: number;
  to: number;
  granularity: Granularity;
  summary: Summary;
  previousSummary: Summary;
  trend: TrendPoint[];
  models: ModelRow[];
  costsByProvider: { provider: string; estimatedCostUsd: number; shareRatio: number }[];
  quotas: QuotaRow[];
  filters: { providers: string[]; accounts: string[]; models: string[] };
};

type PriceRow = {
  provider: string;
  model: string;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  source: "jawcode" | "expected" | "user" | "unpriced";
  custom: boolean;
};

type PriceDraft = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const API_BASE_DEFAULT = import.meta.env.VITE_API_BASE || "";
const DAY_MS = 24 * 60 * 60_000;

function dateTimeLocal(ms: number): string {
  const d = new Date(ms);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(ms - offset).toISOString().slice(0, 16);
}

function parseLocalInput(value: string): number | null {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function delta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

function formatDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatDateTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function formatTrendLabel(ms: number, granularity: Granularity, locale: string): string {
  const options: Intl.DateTimeFormatOptions = granularity === "1d"
    ? { month: "2-digit", day: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat(locale, options).format(new Date(ms));
}

function quotaLabel(t: TFn, quota: QuotaRow): string {
  if (quota.quotaType === "five-hour") return t("quota.fiveHourLimit");
  if (quota.quotaType === "weekly") return t("quota.weeklyLimit");
  if (quota.quotaType === "monthly") return t("quota.monthlyLimit");
  return quota.label || t("models.customBadge");
}

function priceSourceLabel(t: TFn, row: PriceRow): string {
  if (row.source === "user") return t("models.customBadge");
  if (row.source === "jawcode") return t("logs.detail.source.jawcode");
  if (row.source === "expected") return t("logs.detail.source.expected");
  return t("logs.cost.unavailable");
}

function MetricCard({
  label,
  value,
  comparison,
  children,
}: {
  label: string;
  value: string;
  comparison: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="statistics-metric panel">
      <div className="statistics-metric-label muted">{label}</div>
      <div className="statistics-metric-value">{value}</div>
      {children}
      <div className="statistics-metric-delta muted">Δ {comparison}</div>
    </div>
  );
}

function UsageTrend({
  points,
  granularity,
  locale,
  t,
}: {
  points: TrendPoint[];
  granularity: Granularity;
  locale: string;
  t: TFn;
}) {
  const width = 960;
  const height = 286;
  const pad = { left: 28, right: 22, top: 20, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxTokens = Math.max(1, ...points.map(point => point.inputTokens + point.outputTokens));
  const step = points.length > 0 ? plotW / points.length : plotW;
  const barW = Math.max(4, Math.min(36, step * 0.62));

  return (
    <section className="panel statistics-trend-panel">
      <div className="statistics-panel-head">
        <h2>{t("usage.section.overview")}</h2>
        <code>{granularity}</code>
      </div>
      <div className="statistics-legend" aria-hidden="true">
        <span><i className="statistics-swatch input" />{t("logs.tokens.input")}</span>
        <span><i className="statistics-swatch hit" />{t("logs.tokens.cacheRead")}</span>
        <span><i className="statistics-swatch create" />{t("logs.tokens.cacheWrite")}</span>
        <span><i className="statistics-swatch output" />{t("logs.tokens.output")}</span>
      </div>
      {points.length === 0 ? <div className="statistics-empty muted">{t("pws.dashboard.noUsage")}</div> : (
        <svg className="statistics-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("usage.section.overview")}>
          {[0, 0.25, 0.5, 0.75, 1].map(level => {
            const y = pad.top + plotH - plotH * level;
            return <line key={level} x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="statistics-grid-line" />;
          })}
          {points.map((point, index) => {
            const x = pad.left + step * index + (step - barW) / 2;
            const inputH = (point.inputTokens / maxTokens) * plotH;
            const outputH = (point.outputTokens / maxTokens) * plotH;
            const cacheReadH = Math.min(inputH, (point.cacheReadInputTokens / maxTokens) * plotH);
            const cacheWriteH = Math.min(
              Math.max(0, inputH - cacheReadH),
              (point.cacheCreationInputTokens / maxTokens) * plotH,
            );
            const directInputH = Math.max(0, inputH - cacheReadH - cacheWriteH);
            const baseY = pad.top + plotH;
            const labelEvery = Math.max(1, Math.ceil(points.length / 8));
            return (
              <g key={point.bucketStart}>
                <rect x={x} y={baseY - directInputH} width={barW} height={directInputH} className="statistics-bar-input" rx="2" />
                <rect x={x} y={baseY - directInputH - cacheReadH} width={barW} height={cacheReadH} className="statistics-bar-hit" rx="2" />
                <rect x={x} y={baseY - inputH} width={barW} height={cacheWriteH} className="statistics-bar-create" rx="2" />
                <rect x={x + barW * 0.72} y={baseY - outputH} width={Math.max(3, barW * 0.28)} height={outputH} className="statistics-bar-output" rx="2" />
                <title>{`${formatTrendLabel(point.bucketStart, granularity, locale)} · ${t("logs.tokens.input")}: ${formatTokens(point.inputTokens, locale)} · ${t("logs.tokens.cacheRead")}: ${formatTokens(point.cacheReadInputTokens, locale)} · ${t("logs.tokens.cacheWrite")}: ${formatTokens(point.cacheCreationInputTokens, locale)} · ${t("logs.tokens.output")}: ${formatTokens(point.outputTokens, locale)}`}</title>
                {index % labelEvery === 0 && (
                  <text x={x + barW / 2} y={height - 10} textAnchor="middle" className="statistics-axis-label">
                    {formatTrendLabel(point.bucketStart, granularity, locale)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}

function QuotaTable({ rows, locale, t }: { rows: QuotaRow[]; locale: string; t: TFn }) {
  return (
    <section className="panel statistics-quota-panel">
      <div className="statistics-panel-head"><h2>{t("pws.rateLimits")}</h2></div>
      {rows.length === 0 ? <div className="statistics-empty muted">{t("pws.dashboard.noQuota")}</div> : (
        <div className="tbl-wrap statistics-table-wrap">
          <table className="tbl statistics-table statistics-quota-table">
            <thead><tr>
              <th>{t("logs.col.provider")} / {t("auth.adminAccountLabel")}</th>
              <th>{t("pws.rateLimits")}</th>
              <th>%</th>
              <th>{t("usage.col.tokens")}</th>
              <th>{t("pws.col.cost")}</th>
            </tr></thead>
            <tbody>{rows.map(row => (
              <tr key={`${row.provider}-${row.account}-${row.quotaType}-${row.periodEnd}`}>
                <td>
                  <strong>{formatProviderDisplayName(row.provider, t)}</strong>
                  {row.account !== "default" && <small>{row.account}</small>}
                </td>
                <td>
                  <span className={`statistics-quota-badge ${row.quotaType}`}>{quotaLabel(t, row)}</span>
                  <small className="mono statistics-period">{formatDateTime(row.periodStart, locale)} → {formatDateTime(row.periodEnd, locale)}</small>
                </td>
                <td>
                  <div className="statistics-percent-cell">
                    <strong>{Math.round(row.usedPercent)}%</strong>
                    <span className="statistics-progress"><i style={{ width: `${Math.max(0, Math.min(100, row.usedPercent))}%` }} /></span>
                  </div>
                </td>
                <td className="mono">
                  {formatTokens(row.usedTokens, locale)} / {row.estimatedTotalTokens === null ? "—" : formatTokens(row.estimatedTotalTokens, locale)}
                </td>
                <td className="mono">
                  {formatEstimatedUsdValue(row.usedCostUsd, locale)} / {row.estimatedTotalCostUsd === null ? "—" : formatEstimatedUsdValue(row.estimatedTotalCostUsd, locale)}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ModelTable({ rows, locale, t }: { rows: ModelRow[]; locale: string; t: TFn }) {
  return (
    <section className="panel statistics-model-panel">
      <div className="statistics-panel-head"><h2>{t("pws.modelBreakdown")}</h2></div>
      {rows.length === 0 ? <div className="statistics-empty muted">{t("pws.dashboard.noUsage")}</div> : (
        <div className="tbl-wrap statistics-table-wrap">
          <table className="tbl statistics-table statistics-model-table">
            <thead><tr>
              <th>#</th>
              <th>{t("logs.col.provider")} / {t("models.contextModel")}</th>
              <th className="num">{t("usage.col.requests")}</th>
              <th className="num statistics-input-column">{t("logs.tokens.input")}</th>
              <th className="num">{t("logs.tokens.output")}</th>
              <th className="num">{t("logs.tokens.reasoning")}</th>
              <th className="num">{t("pws.col.cost")}</th>
            </tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${row.provider}-${row.account}-${row.model}`}>
                <td>{index + 1}</td>
                <td>
                  <strong>{formatProviderDisplayName(row.provider, t)} / {modelLabel(row.model)}</strong>
                  {row.account !== "default" && <small>{row.account}</small>}
                </td>
                <td className="num">{row.requests.toLocaleString(locale)}</td>
                <td className="num statistics-input-cell">
                  <strong>{formatTokens(row.inputTokens, locale)}</strong>
                  <small>
                    <span>{t("logs.tokens.cacheRead")}: {formatTokens(row.cacheReadInputTokens, locale)}</span>
                    <span>{t("logs.tokens.cacheWrite")}: {formatTokens(row.cacheCreationInputTokens, locale)}</span>
                  </small>
                </td>
                <td className="num mono">{formatTokens(row.outputTokens, locale)}</td>
                <td className="num mono">{formatTokens(row.reasoningOutputTokens, locale)}</td>
                <td className="num mono">{formatEstimatedUsdValue(row.estimatedCostUsd, locale)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PriceModal({
  apiBase,
  open,
  onClose,
  onChanged,
  t,
}: {
  apiBase: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  t: TFn;
}) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`${apiBase}/api/statistics/prices`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json() as { prices?: PriceRow[] };
    const prices = data.prices ?? [];
    setRows(prices);
    setDrafts(Object.fromEntries(prices.map(row => [`${row.provider}\u0000${row.model}`, {
      input: row.input ?? 0,
      output: row.output ?? 0,
      cacheRead: row.cacheRead ?? 0,
      cacheWrite: row.cacheWrite ?? 0,
    }])));
  }, [apiBase]);

  useEffect(() => {
    if (!open) return;
    void load().catch(() => setError(t("usage.loadError")));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [load, onClose, open, t]);

  if (!open) return null;

  const change = (key: string, field: keyof PriceDraft, value: string) => {
    const parsed = Number(value);
    setDrafts(current => ({
      ...current,
      [key]: {
        ...(current[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
        [field]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
      },
    }));
  };

  const persist = async (row: PriceRow, reset = false) => {
    const key = `${row.provider}\u0000${row.model}`;
    setSaving(key);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/statistics/prices`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: row.provider, model: row.model, cost4: reset ? null : drafts[key] }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await load();
      onChanged();
    } catch {
      setError(t("usage.loadError"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="statistics-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="statistics-modal panel" role="dialog" aria-modal="true" aria-label={t("pws.pricing")}>
        <div className="statistics-modal-head">
          <div><h2>{t("pws.pricing")}</h2><p className="muted">{t("pws.costDisclaimer")}</p></div>
          <button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>
        </div>
        {error && <div className="notice notice-err">{error}</div>}
        <div className="statistics-price-note muted"><code>USD / 1M Token</code></div>
        <div className="tbl-wrap statistics-price-table-wrap">
          <table className="tbl statistics-price-table"><thead><tr>
            <th>{t("logs.col.provider")}</th>
            <th>{t("models.contextModel")}</th>
            <th>{t("logs.tokens.input")}</th>
            <th>{t("logs.tokens.cacheRead")}</th>
            <th>{t("logs.tokens.cacheWrite")}</th>
            <th>{t("logs.tokens.output")}</th>
            <th>{t("pws.stats.source")}</th>
            <th />
          </tr></thead><tbody>{rows.map(row => {
            const key = `${row.provider}\u0000${row.model}`;
            const draft = drafts[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
            return <tr key={key}>
              <td>{formatProviderDisplayName(row.provider, t)}</td>
              <td className="mono">{modelLabel(row.model)}</td>
              {(["input", "cacheRead", "cacheWrite", "output"] as const).map(field => (
                <td key={field}>
                  <input className="input statistics-price-input" type="number" min="0" step="0.01" value={draft[field]} onChange={event => change(key, field, event.target.value)} />
                </td>
              ))}
              <td><span className={`statistics-price-source${row.custom ? " custom" : ""}`}>{priceSourceLabel(t, row)}</span></td>
              <td className="statistics-price-actions">
                <button type="button" className="btn btn-primary" disabled={saving === key} onClick={() => void persist(row)}>
                  {saving === key ? t("common.saving") : t("common.save")}
                </button>
                {row.custom && (
                  <button type="button" className="btn" disabled={saving === key} onClick={() => void persist(row, true)}>
                    {t("pws.jsonRestore")}
                  </button>
                )}
              </td>
            </tr>;
          })}</tbody></table>
        </div>
      </div>
    </div>
  );
}

export default function Statistics({ apiBase = API_BASE_DEFAULT }: { apiBase?: string }) {
  const { locale } = useI18n();
  const t = useT();
  const initialNow = useMemo(() => Date.now(), []);
  const [from, setFrom] = useState(() => initialNow - 7 * DAY_MS);
  const [to, setTo] = useState(initialNow);
  const [provider, setProvider] = useState("");
  const [account, setAccount] = useState("");
  const [model, setModel] = useState("");
  const [data, setData] = useState<StatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const currentSequence = ++sequence.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: String(from), to: String(to) });
    if (provider) params.set("provider", provider);
    if (account) params.set("account", account);
    if (model) params.set("model", model);
    try {
      const res = await fetch(`${apiBase}/api/statistics?${params}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const next = await res.json() as StatisticsResponse;
      if (sequence.current === currentSequence) setData(next);
    } catch {
      if (sequence.current === currentSequence) setError(t("usage.loadError"));
    } finally {
      if (sequence.current === currentSequence) setLoading(false);
    }
  }, [account, apiBase, from, model, provider, t, to]);

  useEffect(() => { void load(); }, [load]);

  const allLabel = t("logs.filter.surface.all");
  const providerOptions = useMemo(() => [
    { value: "", label: allLabel },
    ...(data?.filters.providers ?? []).map(value => ({ value, label: formatProviderDisplayName(value, t) })),
  ], [allLabel, data?.filters.providers, t]);
  const accountOptions = useMemo(() => [
    { value: "", label: allLabel },
    ...(data?.filters.accounts ?? []).map(value => ({ value, label: value })),
  ], [allLabel, data?.filters.accounts]);
  const modelOptions = useMemo(() => [
    { value: "", label: allLabel },
    ...(data?.filters.models ?? []).map(value => ({ value, label: modelLabel(value) })),
  ], [allLabel, data?.filters.models]);

  const visibleQuotas = useMemo(() => (data?.quotas ?? []).filter(row =>
    (!provider || row.provider === provider) && (!account || row.account === account)
  ), [account, data?.quotas, provider]);

  const summary = data?.summary;
  const previous = data?.previousSummary;

  return (
    <div className="statistics-page">
      <div className="statistics-header">
        <div><h1>{t("pws.statsTitle")}</h1><p className="muted">{t("usage.subtitle")}</p></div>
        <div className="statistics-toolbar">
          <input
            className="input statistics-date-input"
            type="datetime-local"
            aria-label={t("storage.col.oldest")}
            value={dateTimeLocal(from)}
            onChange={event => { const next = parseLocalInput(event.target.value); if (next !== null) setFrom(next); }}
          />
          <span className="muted" aria-hidden="true">→</span>
          <input
            className="input statistics-date-input"
            type="datetime-local"
            aria-label={t("storage.col.newest")}
            value={dateTimeLocal(to)}
            onChange={event => { const next = parseLocalInput(event.target.value); if (next !== null) setTo(next); }}
          />
          <Select value={provider} options={providerOptions} onChange={value => { setProvider(value); setAccount(""); setModel(""); }} label={t("logs.col.provider")} />
          <Select value={account} options={accountOptions} onChange={value => { setAccount(value); setModel(""); }} label={t("auth.adminAccountLabel")} />
          <Select value={model} options={modelOptions} onChange={setModel} label={t("models.contextModel")} />
          <button type="button" className="btn" onClick={() => setPriceOpen(true)}>{t("pws.pricing")}</button>
          <button type="button" className="btn" onClick={() => void load()}>{t("startup.refresh")}</button>
        </div>
      </div>

      {error && <div className="notice notice-err">{error}</div>}
      {loading && !data ? <div className="panel statistics-loading muted">{t("common.loading")}</div> : data && summary && previous ? (
        <>
          <div className="statistics-metrics">
            <MetricCard
              label={t("usage.col.requests")}
              value={summary.requests.toLocaleString(locale)}
              comparison={formatDelta(delta(summary.requests, previous.requests))}
            />
            <MetricCard
              label={t("logs.tokens.input")}
              value={formatTokens(summary.inputTokens, locale)}
              comparison={formatDelta(delta(summary.inputTokens, previous.inputTokens))}
            >
              <div className="statistics-input-breakdown">
                <span><i className="statistics-swatch hit" />{t("logs.tokens.cacheRead")} <strong>{formatTokens(summary.cacheReadInputTokens, locale)}</strong></span>
                <span><i className="statistics-swatch create" />{t("logs.tokens.cacheWrite")} <strong>{formatTokens(summary.cacheCreationInputTokens, locale)}</strong></span>
              </div>
            </MetricCard>
            <MetricCard
              label={t("logs.tokens.output")}
              value={formatTokens(summary.outputTokens, locale)}
              comparison={formatDelta(delta(summary.outputTokens, previous.outputTokens))}
            />
            <MetricCard
              label={t("logs.tokens.reasoning")}
              value={formatTokens(summary.reasoningOutputTokens, locale)}
              comparison={formatDelta(delta(summary.reasoningOutputTokens, previous.reasoningOutputTokens))}
            />
            <MetricCard
              label={t("usage.cost.total")}
              value={formatEstimatedUsdValue(summary.estimatedCostUsd, locale)}
              comparison={formatDelta(delta(summary.estimatedCostUsd, previous.estimatedCostUsd))}
            />
          </div>

          <div className="statistics-main-grid">
            <UsageTrend points={data.trend} granularity={data.granularity} locale={locale} t={t} />
            <QuotaTable rows={visibleQuotas} locale={locale} t={t} />
          </div>

          <ModelTable rows={data.models} locale={locale} t={t} />
        </>
      ) : null}

      <PriceModal apiBase={apiBase} open={priceOpen} onClose={() => setPriceOpen(false)} onChanged={() => void load()} t={t} />
    </div>
  );
}
