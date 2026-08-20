import { useCallback, useEffect, useMemo, useState } from "react";
import { formatProviderDisplayName } from "../provider-icons";
import { formatTokens } from "../format-tokens";
import { formatEstimatedUsdValue } from "../intl-formatters";
import { modelLabel } from "../model-display";
import { useI18n, useT, type TFn } from "../i18n/shared";
import { statisticsText, type StatisticsTextKey } from "../statistics-i18n";
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

type CostProviderRow = {
  provider: string;
  estimatedCostUsd: number;
  shareRatio: number;
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
  costsByProvider: CostProviderRow[];
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

function quotaLabel(t: (key: StatisticsTextKey) => string, quota: QuotaRow): string {
  if (quota.quotaType === "five-hour") return t("fiveHour");
  if (quota.quotaType === "weekly") return t("weekly");
  if (quota.quotaType === "monthly") return t("monthly");
  return quota.label || t("custom");
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
  const positive = comparison.includes("+");
  const negative = comparison.includes("-");
  return (
    <div className="statistics-metric panel">
      <div className="statistics-metric-label muted">{label}</div>
      <div className="statistics-metric-value">{value}</div>
      {children}
      <div className={`statistics-metric-delta${positive ? " is-up" : negative ? " is-down" : ""}`}>
        {comparison}
      </div>
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
  t: (key: StatisticsTextKey) => string;
}) {
  const width = 900;
  const height = 292;
  const pad = { left: 48, right: 52, top: 26, bottom: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxTokens = Math.max(1, ...points.map(p => p.inputTokens + p.outputTokens));
  const maxRequests = Math.max(1, ...points.map(p => p.requests));
  const step = points.length > 0 ? plotW / points.length : plotW;
  const barW = Math.max(4, Math.min(34, step * 0.56));
  const requestPath = points.map((point, index) => {
    const x = pad.left + step * index + step / 2;
    const y = pad.top + plotH - (point.requests / maxRequests) * plotH;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <section className="panel statistics-trend-panel">
      <div className="statistics-panel-head">
        <h3>{t("trend")}</h3>
        <span className="muted statistics-granularity">
          {t("granularity")}: {t(granularity === "5m" ? "granularity5m" : granularity === "1h" ? "granularity1h" : "granularity1d")}
        </span>
      </div>
      <div className="statistics-legend" aria-hidden="true">
        <span><i className="statistics-swatch input" />{t("input")}</span>
        <span><i className="statistics-swatch hit" />{t("cacheHit")}</span>
        <span><i className="statistics-swatch create" />{t("cacheCreate")}</span>
        <span><i className="statistics-swatch output" />{t("output")}</span>
        <span><i className="statistics-line-swatch" />{t("requests")}</span>
      </div>
      {points.length === 0 ? <div className="statistics-empty muted">{t("noData")}</div> : (
        <svg className="statistics-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("trend")}>
          {[0, 0.25, 0.5, 0.75, 1].map(level => {
            const y = pad.top + plotH - plotH * level;
            return <line key={level} x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="statistics-grid-line" />;
          })}
          {points.map((point, index) => {
            const x = pad.left + step * index + (step - barW) / 2;
            const inputH = (point.inputTokens / maxTokens) * plotH;
            const outputH = (point.outputTokens / maxTokens) * plotH;
            const cacheReadH = Math.min(inputH, (point.cacheReadInputTokens / maxTokens) * plotH);
            const cacheWriteH = Math.min(Math.max(0, inputH - cacheReadH), (point.cacheCreationInputTokens / maxTokens) * plotH);
            const otherInputH = Math.max(0, inputH - cacheReadH - cacheWriteH);
            const baseY = pad.top + plotH;
            const labelEvery = Math.max(1, Math.ceil(points.length / 8));
            return (
              <g key={point.bucketStart}>
                <rect x={x} y={baseY - otherInputH} width={barW} height={otherInputH} className="statistics-bar-input" rx="2" />
                <rect x={x} y={baseY - otherInputH - cacheReadH} width={barW} height={cacheReadH} className="statistics-bar-hit" rx="2" />
                <rect x={x} y={baseY - inputH} width={barW} height={cacheWriteH} className="statistics-bar-create" rx="2" />
                <rect x={x + barW * 0.7} y={baseY - outputH} width={Math.max(3, barW * 0.3)} height={outputH} className="statistics-bar-output" rx="2" />
                <title>{`${formatTrendLabel(point.bucketStart, granularity, locale)} · ${t("input")}: ${formatTokens(point.inputTokens, locale)} · ${t("cacheHit")}: ${formatTokens(point.cacheReadInputTokens, locale)} · ${t("cacheCreate")}: ${formatTokens(point.cacheCreationInputTokens, locale)} · ${t("output")}: ${formatTokens(point.outputTokens, locale)} · ${t("requests")}: ${point.requests}`}</title>
                {index % labelEvery === 0 && (
                  <text x={x + barW / 2} y={height - 12} textAnchor="middle" className="statistics-axis-label">
                    {formatTrendLabel(point.bucketStart, granularity, locale)}
                  </text>
                )}
              </g>
            );
          })}
          {requestPath && <path d={requestPath} className="statistics-request-path" />}
        </svg>
      )}
    </section>
  );
}

function QuotaTable({
  rows,
  locale,
  t,
  providerT,
}: {
  rows: QuotaRow[];
  locale: string;
  t: (key: StatisticsTextKey) => string;
  providerT: TFn;
}) {
  return (
    <section className="panel statistics-quota-panel">
      <div className="statistics-panel-head"><h3>{t("quota")}</h3></div>
      {rows.length === 0 ? <div className="statistics-empty muted">{t("noData")}</div> : (
        <div className="tbl-wrap statistics-table-wrap">
          <table className="tbl statistics-table">
            <thead><tr>
              <th>{t("providerAccount")}</th>
              <th>{t("quotaType")}</th>
              <th>{t("periodStart")}</th>
              <th>{t("periodEnd")}</th>
              <th>{t("usedPercent")}</th>
              <th>{t("tokenAmount")}<small>{t("usedEstimatedTotal")}</small></th>
              <th>{t("costAmount")}<small>{t("usedEstimatedTotal")}</small></th>
            </tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${row.provider}-${row.account}-${row.quotaType}-${row.periodEnd}-${index}`}>
                <td>
                  <strong>{formatProviderDisplayName(row.provider, providerT)}</strong>
                  {row.account !== "default" && <small>{row.account}</small>}
                </td>
                <td><span className={`statistics-quota-badge ${row.quotaType}`}>{quotaLabel(t, row)}</span></td>
                <td className="mono">{formatDateTime(row.periodStart, locale)}</td>
                <td className="mono">{formatDateTime(row.periodEnd, locale)}</td>
                <td>
                  <div className="statistics-percent-cell">
                    <strong>{Math.round(row.usedPercent)}%</strong>
                    <span className="statistics-progress"><i style={{ width: `${Math.max(0, Math.min(100, row.usedPercent))}%` }} /></span>
                  </div>
                </td>
                <td className="mono">{formatTokens(row.usedTokens, locale)} / {row.estimatedTotalTokens === null ? "—" : formatTokens(row.estimatedTotalTokens, locale)}</td>
                <td className="mono">{formatEstimatedUsdValue(row.usedCostUsd, locale)} / {row.estimatedTotalCostUsd === null ? "—" : formatEstimatedUsdValue(row.estimatedTotalCostUsd, locale)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ModelTable({
  rows,
  locale,
  t,
  providerT,
}: {
  rows: ModelRow[];
  locale: string;
  t: (key: StatisticsTextKey) => string;
  providerT: TFn;
}) {
  return (
    <section className="panel statistics-model-panel">
      <div className="statistics-panel-head"><h3>{t("modelTop")}</h3></div>
      <div className="tbl-wrap statistics-table-wrap">
        <table className="tbl statistics-table statistics-model-table">
          <thead><tr>
            <th>{t("rank")}</th><th>{t("providerModel")}</th><th className="num">{t("modelRequests")}</th>
            <th className="num statistics-input-column">{t("input")}</th><th className="num">{t("output")}</th><th className="num">{t("cost")}</th>
          </tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={`${row.provider}-${row.account}-${row.model}`}>
              <td>{index + 1}</td>
              <td>
                <strong>{formatProviderDisplayName(row.provider, providerT)} / {modelLabel(row.model)}</strong>
                {row.account !== "default" && <small>{row.account}</small>}
              </td>
              <td className="num">{row.requests.toLocaleString(locale)}</td>
              <td className="num statistics-input-cell">
                <strong>{formatTokens(row.inputTokens, locale)}</strong>
                <small>
                  <span>{t("cacheHit")}: {formatTokens(row.cacheReadInputTokens, locale)}</span>
                  <span>{t("cacheCreate")}: {formatTokens(row.cacheCreationInputTokens, locale)}</span>
                </small>
              </td>
              <td className="num mono">{formatTokens(row.outputTokens, locale)}</td>
              <td className="num mono">{formatEstimatedUsdValue(row.estimatedCostUsd, locale)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function TokenComposition({ summary, locale, t }: { summary: Summary; locale: string; t: (key: StatisticsTextKey) => string }) {
  const read = summary.cacheReadInputTokens;
  const write = summary.cacheCreationInputTokens;
  const input = Math.max(0, summary.inputTokens - read - write);
  const output = summary.outputTokens;
  const parts = [
    { key: "input", label: t("input"), value: input },
    { key: "hit", label: t("cacheHit"), value: read },
    { key: "create", label: t("cacheCreate"), value: write },
    { key: "output", label: t("output"), value: output },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  let offset = 0;
  return (
    <section className="panel statistics-composition-panel">
      <div className="statistics-panel-head"><h3>{t("tokenComposition")}</h3></div>
      <div className="statistics-donut-row">
        <svg viewBox="0 0 120 120" className="statistics-donut" aria-label={t("tokenComposition")}>
          <circle cx="60" cy="60" r="42" className="statistics-donut-track" />
          {parts.map(part => {
            const ratio = total > 0 ? part.value / total : 0;
            const circumference = Math.PI * 2 * 42;
            const dash = ratio * circumference;
            const item = <circle key={part.key} cx="60" cy="60" r="42" className={`statistics-donut-seg ${part.key}`} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset * circumference} />;
            offset += ratio;
            return item;
          })}
          <text x="60" y="56" textAnchor="middle" className="statistics-donut-value">{formatTokens(total, locale)}</text>
          <text x="60" y="72" textAnchor="middle" className="statistics-donut-label">Token</text>
        </svg>
        <div className="statistics-donut-legend">{parts.map(part => (
          <div key={part.key}>
            <i className={`statistics-swatch ${part.key}`} />
            <span>{part.label}</span>
            <strong>{formatTokens(part.value, locale)}</strong>
            <small>{total > 0 ? pct(part.value / total) : "0%"}</small>
          </div>
        ))}</div>
      </div>
    </section>
  );
}

function CostOverview({
  rows,
  locale,
  t,
  providerT,
}: {
  rows: CostProviderRow[];
  locale: string;
  t: (key: StatisticsTextKey) => string;
  providerT: TFn;
}) {
  return (
    <section className="panel statistics-cost-panel">
      <div className="statistics-panel-head"><h3>{t("costOverview")}</h3></div>
      {rows.length === 0 ? <div className="statistics-empty muted">{t("noData")}</div> : (
        <div className="statistics-cost-list">{rows.map(row => (
          <div key={row.provider} className="statistics-cost-row">
            <span>{formatProviderDisplayName(row.provider, providerT)}</span>
            <div className="statistics-cost-track"><i style={{ width: `${Math.max(2, row.shareRatio * 100)}%` }} /></div>
            <strong>{formatEstimatedUsdValue(row.estimatedCostUsd, locale)}</strong>
            <small>{pct(row.shareRatio)}</small>
          </div>
        ))}</div>
      )}
    </section>
  );
}

function PriceModal({
  apiBase,
  open,
  onClose,
  t,
  providerT,
}: {
  apiBase: string;
  open: boolean;
  onClose: () => void;
  t: (key: StatisticsTextKey) => string;
  providerT: TFn;
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
    void load().catch(() => setError(t("loadFailed")));
  }, [load, open, t]);

  if (!open) return null;

  const change = (key: string, field: keyof PriceDraft, value: string) => {
    const parsed = Number(value);
    setDrafts(current => ({
      ...current,
      [key]: {
        ...current[key]!,
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
    } catch {
      setError(t("loadFailed"));
    } finally {
      setSaving(null);
    }
  };

  const sourceLabel = (row: PriceRow) => row.source === "unpriced"
    ? t("unpriced")
    : row.custom ? t("customPrice") : t("officialPrice");

  return (
    <div className="statistics-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="statistics-modal panel" role="dialog" aria-modal="true" aria-label={t("priceTitle")}>
        <div className="statistics-modal-head">
          <div><h2>{t("priceTitle")}</h2><p className="muted">{t("priceSubtitle")}</p></div>
          <button type="button" className="btn" onClick={onClose}>{t("close")}</button>
        </div>
        {error && <div className="notice notice-err">{error}</div>}
        <div className="statistics-price-note muted">{t("perMillion")}</div>
        <div className="tbl-wrap statistics-price-table-wrap">
          <table className="tbl statistics-price-table">
            <thead><tr>
              <th>{t("provider")}</th><th>{t("model")}</th><th>{t("priceInput")}</th><th>{t("priceCacheRead")}</th><th>{t("priceCacheWrite")}</th><th>{t("priceOutput")}</th><th>{t("priceSource")}</th><th />
            </tr></thead>
            <tbody>{rows.map(row => {
              const key = `${row.provider}\u0000${row.model}`;
              const draft = drafts[key] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
              return <tr key={key}>
                <td>{formatProviderDisplayName(row.provider, providerT)}</td>
                <td className="mono">{modelLabel(row.model)}</td>
                {(["input", "cacheRead", "cacheWrite", "output"] as const).map(field => (
                  <td key={field}>
                    <input className="input statistics-price-input" type="number" min="0" step="0.01" value={draft[field]} onChange={event => change(key, field, event.target.value)} />
                  </td>
                ))}
                <td><span className={`statistics-price-source${row.custom ? " custom" : ""}`}>{sourceLabel(row)}</span></td>
                <td className="statistics-price-actions">
                  <button type="button" className="btn btn-primary" disabled={saving === key} onClick={() => void persist(row)}>{saving === key ? t("saving") : t("save")}</button>
                  {row.custom && <button type="button" className="btn" disabled={saving === key} onClick={() => void persist(row, true)}>{t("resetOfficial")}</button>}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Statistics({ apiBase = API_BASE_DEFAULT }: { apiBase?: string }) {
  const { locale } = useI18n();
  const providerT = useT();
  const t = useCallback((key: StatisticsTextKey) => statisticsText(locale, key), [locale]);
  const [from, setFrom] = useState(() => Date.now() - 7 * DAY_MS);
  const [to, setTo] = useState(() => Date.now());
  const [provider, setProvider] = useState("");
  const [account, setAccount] = useState("");
  const [model, setModel] = useState("");
  const [data, setData] = useState<StatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: String(from), to: String(to) });
    if (provider) params.set("provider", provider);
    if (account) params.set("account", account);
    if (model) params.set("model", model);
    try {
      const res = await fetch(`${apiBase}/api/statistics?${params}`);
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json() as StatisticsResponse);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [account, apiBase, from, model, provider, t, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const providerOptions = useMemo(() => [
    { value: "", label: t("allProviders") },
    ...(data?.filters.providers ?? []).map(value => ({ value, label: formatProviderDisplayName(value, providerT) })),
  ], [data?.filters.providers, providerT, t]);
  const accountOptions = useMemo(() => [
    { value: "", label: t("providerAccount") },
    ...(data?.filters.accounts ?? []).filter(value => value !== "default").map(value => ({ value, label: value })),
  ], [data?.filters.accounts, t]);
  const modelOptions = useMemo(() => [
    { value: "", label: t("model") },
    ...(data?.filters.models ?? []).map(value => ({ value, label: modelLabel(value) })),
  ], [data?.filters.models, t]);

  const summary = data?.summary;
  const previous = data?.previousSummary;
  const compare = (current: number, prior: number) => `${t("previousPeriod")} ${formatDelta(delta(current, prior))}`;

  return (
    <div className="statistics-page">
      <div className="statistics-header">
        <div><h1>{t("title")}</h1><p className="muted">{t("subtitle")}</p></div>
        <div className="statistics-toolbar">
          <input className="input statistics-date-input" type="datetime-local" value={dateTimeLocal(from)} onChange={event => { const next = parseLocalInput(event.target.value); if (next !== null) setFrom(next); }} />
          <span className="muted">→</span>
          <input className="input statistics-date-input" type="datetime-local" value={dateTimeLocal(to)} onChange={event => { const next = parseLocalInput(event.target.value); if (next !== null) setTo(next); }} />
          <Select value={provider} options={providerOptions} onChange={value => { setProvider(value); setAccount(""); }} label={t("provider")} />
          <Select value={account} options={accountOptions} onChange={setAccount} label={t("providerAccount")} />
          <Select value={model} options={modelOptions} onChange={setModel} label={t("model")} />
          <button type="button" className="btn" onClick={() => setPriceOpen(true)}>{t("priceConfig")}</button>
          <button type="button" className="btn" onClick={() => void load()}>{t("refresh")}</button>
        </div>
      </div>
      <div className="statistics-refresh-note muted">{t("autoRefresh")}</div>

      {error && <div className="notice notice-err">{error}</div>}
      {loading && !data ? <div className="panel statistics-loading muted">{t("title")}…</div> : summary && previous && data ? (
        <>
          <div className="statistics-metrics">
            <MetricCard label={t("requests")} value={summary.requests.toLocaleString(locale)} comparison={compare(summary.requests, previous.requests)} />
            <MetricCard label={t("inputTokens")} value={formatTokens(summary.inputTokens, locale)} comparison={compare(summary.inputTokens, previous.inputTokens)}>
              <div className="statistics-input-breakdown" title={t("inputRelation")}>
                <span><i className="statistics-swatch hit" />{t("cacheHitInput")} <strong>{formatTokens(summary.cacheReadInputTokens, locale)}</strong></span>
                <span><i className="statistics-swatch create" />{t("cacheCreateInput")} <strong>{formatTokens(summary.cacheCreationInputTokens, locale)}</strong></span>
              </div>
            </MetricCard>
            <MetricCard label={t("outputTokens")} value={formatTokens(summary.outputTokens, locale)} comparison={compare(summary.outputTokens, previous.outputTokens)} />
            <MetricCard label={t("cacheHitRate")} value={pct(summary.cacheHitRatio)} comparison={compare(summary.cacheHitRatio, previous.cacheHitRatio)} />
            <MetricCard label={t("totalCost")} value={formatEstimatedUsdValue(summary.estimatedCostUsd, locale)} comparison={compare(summary.estimatedCostUsd, previous.estimatedCostUsd)} />
          </div>

          <div className="statistics-main-grid">
            <UsageTrend points={data.trend} granularity={data.granularity} locale={locale} t={t} />
            <QuotaTable rows={data.quotas} locale={locale} t={t} providerT={providerT} />
          </div>

          <div className="statistics-bottom-grid">
            <ModelTable rows={data.models} locale={locale} t={t} providerT={providerT} />
            <TokenComposition summary={summary} locale={locale} t={t} />
            <CostOverview rows={data.costsByProvider} locale={locale} t={t} providerT={providerT} />
          </div>
        </>
      ) : null}

      <PriceModal apiBase={apiBase} open={priceOpen} onClose={() => setPriceOpen(false)} t={t} providerT={providerT} />
    </div>
  );
}
