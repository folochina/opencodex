import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../config";
import { listCodexAuthAccountsSnapshot } from "../codex/auth-api";
import { baseProviderLabel } from "../providers/label";
import { isCanonicalOpenAiForwardProvider, OPENAI_CODEX_PROVIDER_ID } from "../providers/openai-tiers";
import { providerCodexAccountMode } from "../providers/registry";
import {
  fetchProviderQuotaReports,
  type ProviderQuota,
  type ProviderQuotaReport,
} from "../providers/quota";
import {
  calculateCost,
  resolveMatchedPrice,
  type CostBreakdown,
  type MatchedPrice,
} from "../usage/cost";
import {
  readUsageEntries,
  readUsageSnapshotForManagement,
  usageLogIdentityKey,
  type PersistedUsageEntry,
} from "../usage/log";
import type { OcxConfig, OcxUsage } from "../types";

export const STATISTICS_BUCKET_MS = 5 * 60_000;
const STATISTICS_SCHEMA_VERSION = 1;
const STATISTICS_CURSOR_RECENT_IDS = 512;

export interface StatisticsBucket {
  bucketStart: number;
  provider: string;
  account: string;
  model: string;
  requests: number;
  attempts: number;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface PersistedStatisticsStore {
  version: 1;
  sourceIdentity: string | null;
  cursorRequestId: string | null;
  lastSeenTimestamp: number;
  recentRequestIds: string[];
  rows: StatisticsBucket[];
}

export type StatisticsGranularity = "5m" | "1h" | "1d";

export interface StatisticsSummary {
  requests: number;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheHitRatio: number;
  estimatedCostUsd: number;
}

export interface StatisticsTrendPoint extends StatisticsSummary {
  bucketStart: number;
}

export interface StatisticsModelRow extends StatisticsSummary {
  provider: string;
  account: string;
  model: string;
  shareRatio: number;
}

export interface StatisticsCostProviderRow {
  provider: string;
  estimatedCostUsd: number;
  shareRatio: number;
}

export interface StatisticsQuotaRow {
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
}

export interface StatisticsPriceRow {
  provider: string;
  model: string;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  source: MatchedPrice["source"] | "unpriced";
  custom: boolean;
}

export interface StatisticsQuery {
  from: number;
  to: number;
  provider?: string;
  account?: string;
  model?: string;
}

export interface StatisticsResponse {
  generatedAt: number;
  from: number;
  to: number;
  granularity: StatisticsGranularity;
  summary: StatisticsSummary;
  previousSummary: StatisticsSummary;
  trend: StatisticsTrendPoint[];
  models: StatisticsModelRow[];
  costsByProvider: StatisticsCostProviderRow[];
  quotas: StatisticsQuotaRow[];
  filters: {
    providers: string[];
    accounts: string[];
    models: string[];
  };
}

let loaded: PersistedStatisticsStore | null = null;
let syncFlight: Promise<PersistedStatisticsStore> | null = null;

function statisticsPath(configDir = getConfigDir()): string {
  return join(configDir, "statistics-v1.json");
}

function blankStore(): PersistedStatisticsStore {
  return {
    version: STATISTICS_SCHEMA_VERSION,
    sourceIdentity: null,
    cursorRequestId: null,
    lastSeenTimestamp: 0,
    recentRequestIds: [],
    rows: [],
  };
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeBucket(raw: unknown): StatisticsBucket | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!finiteNonNegative(row.bucketStart)
    || typeof row.provider !== "string" || !row.provider
    || typeof row.account !== "string" || !row.account
    || typeof row.model !== "string" || !row.model) return null;
  for (const key of [
    "requests",
    "attempts",
    "inputTokens",
    "cacheReadInputTokens",
    "cacheCreationInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
  ] as const) {
    if (!finiteNonNegative(row[key])) return null;
  }
  return row as unknown as StatisticsBucket;
}

function loadStatisticsStore(): PersistedStatisticsStore {
  if (loaded) return loaded;
  const path = statisticsPath();
  if (!existsSync(path)) return (loaded = blankStore());
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PersistedStatisticsStore>;
    if (parsed.version !== STATISTICS_SCHEMA_VERSION || !Array.isArray(parsed.rows)) {
      return (loaded = blankStore());
    }
    const recentRequestIds = Array.isArray(parsed.recentRequestIds)
      ? parsed.recentRequestIds.filter((value): value is string => typeof value === "string").slice(-STATISTICS_CURSOR_RECENT_IDS)
      : [];
    loaded = {
      version: STATISTICS_SCHEMA_VERSION,
      sourceIdentity: typeof parsed.sourceIdentity === "string" ? parsed.sourceIdentity : null,
      cursorRequestId: typeof parsed.cursorRequestId === "string" ? parsed.cursorRequestId : null,
      lastSeenTimestamp: finiteNonNegative(parsed.lastSeenTimestamp) ? parsed.lastSeenTimestamp : 0,
      recentRequestIds,
      rows: parsed.rows.map(normalizeBucket).filter((row): row is StatisticsBucket => row !== null),
    };
    return loaded;
  } catch {
    return (loaded = blankStore());
  }
}

function persistStatisticsStore(store: PersistedStatisticsStore): void {
  atomicWriteFile(statisticsPath(), JSON.stringify(store));
}

function cacheReadTokens(usage: OcxUsage): number {
  const creation = usage.cacheCreationInputTokens;
  if (typeof usage.cacheReadInputTokens === "number") return usage.cacheReadInputTokens;
  if (typeof usage.cachedInputTokens === "number" && typeof creation === "number") {
    if (usage.cachedInputTokens + creation <= usage.inputTokens) return usage.cachedInputTokens;
    return Math.max(0, usage.cachedInputTokens - creation);
  }
  return usage.cachedInputTokens ?? 0;
}

interface StatisticsAttribution {
  provider: string;
  account: string;
  model: string;
  usage?: OcxUsage;
  logicalRequest: boolean;
}

function entryAttributions(entry: PersistedUsageEntry): StatisticsAttribution[] {
  if (!entry.attempts?.length) {
    return [{
      provider: baseProviderLabel(entry.provider),
      account: entry.accountLogLabel ?? "default",
      model: entry.resolvedModel ?? entry.model,
      ...(entry.usage ? { usage: entry.usage } : {}),
      logicalRequest: true,
    }];
  }
  const last = entry.attempts.length - 1;
  return entry.attempts.map((attempt, index) => ({
    provider: baseProviderLabel(attempt.provider),
    account: attempt.accountLogLabel ?? entry.accountLogLabel ?? "default",
    model: attempt.model,
    ...(attempt.usage ? { usage: attempt.usage } : {}),
    logicalRequest: index === last,
  }));
}

function rowKey(row: Pick<StatisticsBucket, "bucketStart" | "provider" | "account" | "model">): string {
  return `${row.bucketStart}\u0000${row.provider}\u0000${row.account}\u0000${row.model}`;
}

function addEntry(rows: Map<string, StatisticsBucket>, entry: PersistedUsageEntry): void {
  const bucketStart = Math.floor(entry.timestamp / STATISTICS_BUCKET_MS) * STATISTICS_BUCKET_MS;
  for (const attribution of entryAttributions(entry)) {
    const seed: StatisticsBucket = {
      bucketStart,
      provider: attribution.provider,
      account: attribution.account,
      model: attribution.model,
      requests: 0,
      attempts: 0,
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    };
    const key = rowKey(seed);
    const row = rows.get(key) ?? seed;
    row.attempts += 1;
    if (attribution.logicalRequest) row.requests += 1;
    if (attribution.usage) {
      row.inputTokens += attribution.usage.inputTokens;
      row.cacheReadInputTokens += cacheReadTokens(attribution.usage);
      row.cacheCreationInputTokens += attribution.usage.cacheCreationInputTokens ?? 0;
      row.outputTokens += attribution.usage.outputTokens;
      row.reasoningOutputTokens += attribution.usage.reasoningOutputTokens ?? 0;
    }
    rows.set(key, row);
  }
}

function addEntries(store: PersistedStatisticsStore, entries: PersistedUsageEntry[]): boolean {
  if (entries.length === 0) return false;
  const rows = new Map(store.rows.map(row => [rowKey(row), { ...row }]));
  const recent = new Set(store.recentRequestIds);
  let changed = false;
  for (const entry of entries) {
    if (recent.has(entry.requestId)) continue;
    addEntry(rows, entry);
    changed = true;
    recent.add(entry.requestId);
    store.recentRequestIds.push(entry.requestId);
    if (store.recentRequestIds.length > STATISTICS_CURSOR_RECENT_IDS) {
      const removed = store.recentRequestIds.shift();
      if (removed) recent.delete(removed);
    }
    store.cursorRequestId = entry.requestId;
    store.lastSeenTimestamp = Math.max(store.lastSeenTimestamp, entry.timestamp);
  }
  if (!changed) return false;
  store.rows = [...rows.values()].sort((a, b) => a.bucketStart - b.bucketStart
    || a.provider.localeCompare(b.provider)
    || a.account.localeCompare(b.account)
    || a.model.localeCompare(b.model));
  return true;
}

async function syncStatisticsStoreInner(): Promise<PersistedStatisticsStore> {
  const store = loadStatisticsStore();
  const snapshot = await readUsageSnapshotForManagement();
  const identity = usageLogIdentityKey(snapshot.revision);
  if (!snapshot.revision || snapshot.entries.length === 0) return store;

  const initialBackfill = store.sourceIdentity === null
    && store.cursorRequestId === null
    && store.rows.length === 0;
  const identityChanged = store.sourceIdentity !== identity;
  let source = initialBackfill ? readUsageEntries() : snapshot.entries;
  let startIndex = -1;
  if (!initialBackfill && store.sourceIdentity === identity && store.cursorRequestId) {
    startIndex = source.findIndex(entry => entry.requestId === store.cursorRequestId);
    if (startIndex < 0) {
      // The cursor can fall out of the bounded management window after a long idle
      // period. Pay the full-ledger cost once to catch up, then return to incremental
      // bounded reads on subsequent refreshes.
      source = readUsageEntries();
      startIndex = source.findIndex(entry => entry.requestId === store.cursorRequestId);
    }
  }

  if (!initialBackfill && identityChanged) {
    // A replaced/rotated ledger is a new source. Preserve already aggregated history,
    // but admit only rows newer than the last observed request timestamp. The bounded
    // request-id overlap below prevents copied tails from being counted twice.
    source = source.filter(entry => entry.timestamp >= store.lastSeenTimestamp);
    startIndex = -1;
  }

  const nextEntries = startIndex >= 0 ? source.slice(startIndex + 1) : source;
  const changed = addEntries(store, nextEntries);
  store.sourceIdentity = identity;
  // Idle dashboard refreshes stay read-only. Rewriting a growing aggregate every
  // 60 seconds would make the statistics page itself a source of storage churn.
  if (changed || identityChanged) persistStatisticsStore(store);
  return store;
}

export async function syncStatisticsStore(): Promise<PersistedStatisticsStore> {
  if (syncFlight) return syncFlight;
  syncFlight = syncStatisticsStoreInner().finally(() => { syncFlight = null; });
  return syncFlight;
}

function emptySummary(): StatisticsSummary {
  return {
    requests: 0,
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cacheHitRatio: 0,
    estimatedCostUsd: 0,
  };
}

function rowMatches(row: StatisticsBucket, query: StatisticsQuery): boolean {
  return row.bucketStart >= query.from
    && row.bucketStart < query.to
    && (!query.provider || row.provider === query.provider)
    && (!query.account || row.account === query.account)
    && (!query.model || row.model === query.model);
}

function priceFor(row: Pick<StatisticsBucket, "provider" | "model">): MatchedPrice | null {
  return resolveMatchedPrice(row.provider, row.model);
}

function rowCost(row: StatisticsBucket): { price: MatchedPrice | null; cost: CostBreakdown | null } {
  const price = priceFor(row);
  if (!price) return { price: null, cost: null };
  const cacheRead = Math.max(0, row.cacheReadInputTokens);
  const cacheWrite = Math.max(0, row.cacheCreationInputTokens);
  const input = Math.max(0, row.inputTokens - cacheRead - cacheWrite);
  return {
    price,
    cost: calculateCost({ input, output: row.outputTokens, cacheRead, cacheWrite }, price.cost4),
  };
}

function summarizeRows(rows: StatisticsBucket[]): StatisticsSummary {
  const summary = emptySummary();
  for (const row of rows) {
    summary.requests += row.requests;
    summary.inputTokens += row.inputTokens;
    summary.cacheReadInputTokens += row.cacheReadInputTokens;
    summary.cacheCreationInputTokens += row.cacheCreationInputTokens;
    summary.outputTokens += row.outputTokens;
    summary.reasoningOutputTokens += row.reasoningOutputTokens;
    summary.estimatedCostUsd += rowCost(row).cost?.total ?? 0;
  }
  summary.cacheHitRatio = summary.inputTokens > 0
    ? summary.cacheReadInputTokens / summary.inputTokens
    : 0;
  return summary;
}

export function statisticsGranularity(from: number, to: number): StatisticsGranularity {
  const span = Math.max(0, to - from);
  if (span <= 60 * 60_000) return "5m";
  if (span <= 24 * 60 * 60_000) return "1h";
  return "1d";
}

function granularityMs(granularity: StatisticsGranularity): number {
  if (granularity === "5m") return STATISTICS_BUCKET_MS;
  if (granularity === "1h") return 60 * 60_000;
  return 24 * 60 * 60_000;
}

function groupTrend(rows: StatisticsBucket[], granularity: StatisticsGranularity): StatisticsTrendPoint[] {
  const size = granularityMs(granularity);
  const groups = new Map<number, StatisticsBucket[]>();
  for (const row of rows) {
    const key = Math.floor(row.bucketStart / size) * size;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, bucketRows]) => ({ bucketStart, ...summarizeRows(bucketRows) }));
}

function topModelRows(rows: StatisticsBucket[], limit = 10): StatisticsModelRow[] {
  const grouped = new Map<string, StatisticsBucket>();
  for (const row of rows) {
    const key = `${row.provider}\u0000${row.account}\u0000${row.model}`;
    const current = grouped.get(key) ?? {
      ...row,
      bucketStart: 0,
      requests: 0,
      attempts: 0,
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    };
    current.requests += row.requests;
    current.attempts += row.attempts;
    current.inputTokens += row.inputTokens;
    current.cacheReadInputTokens += row.cacheReadInputTokens;
    current.cacheCreationInputTokens += row.cacheCreationInputTokens;
    current.outputTokens += row.outputTokens;
    current.reasoningOutputTokens += row.reasoningOutputTokens;
    grouped.set(key, current);
  }
  const total = [...grouped.values()].reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  return [...grouped.values()]
    .map(row => ({
      provider: row.provider,
      account: row.account,
      model: row.model,
      ...summarizeRows([row]),
      shareRatio: total > 0 ? (row.inputTokens + row.outputTokens) / total : 0,
    }))
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
    .slice(0, limit);
}

function costProviderRows(rows: StatisticsBucket[]): StatisticsCostProviderRow[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    grouped.set(row.provider, (grouped.get(row.provider) ?? 0) + (rowCost(row).cost?.total ?? 0));
  }
  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  return [...grouped.entries()]
    .map(([provider, estimatedCostUsd]) => ({
      provider,
      estimatedCostUsd,
      shareRatio: total > 0 ? estimatedCostUsd / total : 0,
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
}

interface QuotaWindowCandidate {
  type: StatisticsQuotaRow["quotaType"];
  label: string;
  percent: number;
  resetAt?: number;
  durationMs?: number;
}

function knownWindowDurationMs(kind: StatisticsQuotaRow["quotaType"], label: string): number | null {
  if (kind === "five-hour") return 5 * 60 * 60_000;
  if (kind === "weekly") return 7 * 24 * 60 * 60_000;
  if (kind === "monthly") return 30 * 24 * 60 * 60_000;
  const normalized = label.toLowerCase();
  if (/5\s*(?:h|hour)/.test(normalized)) return 5 * 60 * 60_000;
  if (/weekly|7\s*(?:d|day)/.test(normalized)) return 7 * 24 * 60 * 60_000;
  if (/monthly|30\s*(?:d|day)/.test(normalized)) return 30 * 24 * 60 * 60_000;
  return null;
}

function providerQuotaWindows(quota: ProviderQuota): QuotaWindowCandidate[] {
  const rows: QuotaWindowCandidate[] = [];
  if (typeof quota.fiveHourPercent === "number") {
    rows.push({ type: "five-hour", label: "5-hour", percent: quota.fiveHourPercent, resetAt: quota.fiveHourResetAt });
  }
  if (typeof quota.weeklyPercent === "number") {
    rows.push({ type: "weekly", label: "Weekly", percent: quota.weeklyPercent, resetAt: quota.weeklyResetAt });
  }
  if (typeof quota.monthlyPercent === "number") {
    rows.push({ type: "monthly", label: "Monthly", percent: quota.monthlyPercent, resetAt: quota.monthlyResetAt });
  }
  for (const window of quota.customWindows ?? []) {
    rows.push({ type: "custom", label: window.label, percent: window.percent, resetAt: window.resetAt });
  }
  return rows;
}

type CodexAccountQuota = Awaited<ReturnType<typeof listCodexAuthAccountsSnapshot>>["accounts"][number]["quota"];

function codexQuotaWindows(quota: NonNullable<CodexAccountQuota>): QuotaWindowCandidate[] {
  const rows: QuotaWindowCandidate[] = [];
  if (typeof quota.shortPercent === "number") {
    const durationMs = typeof quota.shortWindowSeconds === "number" && Number.isFinite(quota.shortWindowSeconds)
      ? quota.shortWindowSeconds * 1000
      : undefined;
    const isFiveHour = quota.shortWindowSeconds === 5 * 60 * 60;
    rows.push({
      type: isFiveHour ? "five-hour" : "custom",
      label: isFiveHour ? "5-hour" : "Short window",
      percent: quota.shortPercent,
      resetAt: quota.shortResetAt,
      ...(durationMs ? { durationMs } : {}),
    });
  }
  if (typeof quota.weeklyPercent === "number") {
    rows.push({ type: "weekly", label: "Weekly", percent: quota.weeklyPercent, resetAt: quota.weeklyResetAt });
  }
  if (typeof quota.monthlyPercent === "number") {
    rows.push({ type: "monthly", label: "Monthly", percent: quota.monthlyPercent, resetAt: quota.monthlyResetAt });
  }
  return rows;
}

interface QuotaScope {
  provider: string;
  account: string;
  windows: QuotaWindowCandidate[];
}

async function quotaScopes(
  config: OcxConfig,
  reports: ProviderQuotaReport[],
): Promise<QuotaScope[]> {
  const scopes: QuotaScope[] = [];
  const openai = config.providers[OPENAI_CODEX_PROVIDER_ID];
  const codexPool = !!openai
    && openai.disabled !== true
    && isCanonicalOpenAiForwardProvider(openai)
    && providerCodexAccountMode(OPENAI_CODEX_PROVIDER_ID, openai) === "pool";

  let codexAccountScopes = 0;
  if (codexPool) {
    try {
      const snapshot = await listCodexAuthAccountsSnapshot(config, false);
      for (const account of snapshot.accounts) {
        if (!account.logLabel || !account.quota) continue;
        const windows = codexQuotaWindows(account.quota);
        if (windows.length === 0) continue;
        scopes.push({ provider: OPENAI_CODEX_PROVIDER_ID, account: account.logLabel, windows });
        codexAccountScopes += 1;
      }
    } catch {
      // Provider-level quota below remains as a safe fallback when account probing fails.
    }
  }

  for (const report of reports) {
    const provider = baseProviderLabel(report.provider);
    if (provider === OPENAI_CODEX_PROVIDER_ID && codexAccountScopes > 0) continue;
    const windows = providerQuotaWindows(report.quota);
    if (windows.length > 0) scopes.push({ provider, account: "default", windows });
  }
  return scopes;
}

function quotaRows(scopes: QuotaScope[], allRows: StatisticsBucket[], now: number): StatisticsQuotaRow[] {
  const out: StatisticsQuotaRow[] = [];
  for (const scope of scopes) {
    const scopeRows = allRows.filter(row => row.provider === scope.provider
      && (scope.account === "default" || row.account === scope.account));
    const earliest = scopeRows[0]?.bucketStart ?? Number.POSITIVE_INFINITY;
    for (const window of scope.windows) {
      const end = window.resetAt;
      if (typeof end !== "number" || !Number.isFinite(end) || end <= 0) continue;
      const duration = window.durationMs ?? knownWindowDurationMs(window.type, window.label);
      if (!duration) continue;
      const start = end - duration;
      if (start <= 0) continue;
      const cycleRows = scopeRows.filter(row => row.bucketStart >= start && row.bucketStart < Math.min(now, end));
      const summary = summarizeRows(cycleRows);
      const usedTokens = summary.inputTokens + summary.outputTokens;
      const complete = earliest <= Math.floor(start / STATISTICS_BUCKET_MS) * STATISTICS_BUCKET_MS;
      const ratio = Math.max(0, Math.min(100, window.percent)) / 100;
      const extrapolatable = complete && ratio > 0 && (usedTokens > 0 || window.percent === 0);
      out.push({
        provider: scope.provider,
        account: scope.account,
        quotaType: window.type,
        label: window.label,
        periodStart: start,
        periodEnd: end,
        usedPercent: window.percent,
        usedTokens,
        estimatedTotalTokens: extrapolatable ? usedTokens / ratio : null,
        usedCostUsd: summary.estimatedCostUsd,
        estimatedTotalCostUsd: extrapolatable ? summary.estimatedCostUsd / ratio : null,
      });
    }
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider)
    || a.account.localeCompare(b.account)
    || a.periodEnd - b.periodEnd);
}

function validQueryTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export async function buildStatisticsResponse(config: OcxConfig, query: StatisticsQuery): Promise<StatisticsResponse> {
  if (!validQueryTime(query.from) || !validQueryTime(query.to) || query.to <= query.from) {
    throw new RangeError("invalid statistics range");
  }
  const [store, reports] = await Promise.all([
    syncStatisticsStore(),
    fetchProviderQuotaReports(config, false),
  ]);
  const scopes = await quotaScopes(config, reports.reports);
  const currentRows = store.rows.filter(row => rowMatches(row, query));
  const span = query.to - query.from;
  const previousQuery: StatisticsQuery = { ...query, from: query.from - span, to: query.from };
  const previousRows = store.rows.filter(row => rowMatches(row, previousQuery));
  const granularity = statisticsGranularity(query.from, query.to);
  const allRows = store.rows;
  return {
    generatedAt: Date.now(),
    from: query.from,
    to: query.to,
    granularity,
    summary: summarizeRows(currentRows),
    previousSummary: summarizeRows(previousRows),
    trend: groupTrend(currentRows, granularity),
    models: topModelRows(currentRows),
    costsByProvider: costProviderRows(currentRows),
    quotas: quotaRows(scopes, allRows, Date.now()),
    filters: {
      providers: [...new Set(allRows.map(row => row.provider))].sort(),
      accounts: [...new Set(allRows.map(row => row.account))].sort(),
      models: [...new Set(allRows.map(row => row.model))].sort(),
    },
  };
}

export async function statisticsPriceRows(): Promise<StatisticsPriceRow[]> {
  const store = await syncStatisticsStore();
  const keys = new Map<string, { provider: string; model: string }>();
  for (const row of store.rows) {
    keys.set(`${row.provider}\u0000${row.model}`, { provider: row.provider, model: row.model });
  }
  const prices: StatisticsPriceRow[] = [];
  for (const { provider, model } of keys.values()) {
    const price = resolveMatchedPrice(provider, model);
    prices.push({
      provider,
      model,
      input: price?.cost4.input ?? null,
      output: price?.cost4.output ?? null,
      cacheRead: price?.cost4.cacheRead ?? null,
      cacheWrite: price?.cost4.cacheWrite ?? null,
      source: price?.source ?? "unpriced",
      custom: price?.source === "user",
    });
  }
  return prices.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}

export function resetStatisticsStoreForTests(): void {
  loaded = null;
  syncFlight = null;
}
