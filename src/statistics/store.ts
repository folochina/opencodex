import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { getConfigDir } from "../config";
import { recordOwnedConfigPath } from "../lib/config-ownership";

export const STATISTICS_BUCKET_MS = 5 * 60_000;
const STATISTICS_DB_VERSION = 1;
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

export interface StatisticsCursor {
  sourceIdentity: string | null;
  cursorRequestId: string | null;
  lastSeenTimestamp: number;
  recentRequestIds: string[];
}

export interface StatisticsBucketQuery {
  from: number;
  to: number;
  provider?: string;
  account?: string;
  model?: string;
}

export interface StatisticsDimensions {
  providers: string[];
  accounts: string[];
  models: string[];
}

let database: Database | null = null;
let databasePath: string | null = null;

function statisticsDbPath(configDir = getConfigDir()): string {
  return join(configDir, "statistics-v1.sqlite");
}

function openDatabase(): Database {
  const path = statisticsDbPath();
  if (database && databasePath === path) return database;
  if (database) {
    try { database.close(); } catch { /* best effort */ }
    database = null;
  }

  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* platform best effort */ }
  recordOwnedConfigPath(dir, path);

  const db = new Database(path, { create: true });
  try { chmodSync(path, 0o600); } catch { /* platform best effort */ }
  db.exec("PRAGMA journal_mode=DELETE;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS statistics_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      source_identity TEXT,
      cursor_request_id TEXT,
      last_seen_timestamp INTEGER NOT NULL DEFAULT 0,
      recent_request_ids TEXT NOT NULL DEFAULT '[]'
    );
    INSERT OR IGNORE INTO statistics_meta (
      id, version, source_identity, cursor_request_id, last_seen_timestamp, recent_request_ids
    ) VALUES (1, ${STATISTICS_DB_VERSION}, NULL, NULL, 0, '[]');

    CREATE TABLE IF NOT EXISTS statistics_bucket_5m (
      bucket_start INTEGER NOT NULL,
      provider TEXT NOT NULL,
      account TEXT NOT NULL,
      model TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket_start, provider, account, model)
    );
    CREATE INDEX IF NOT EXISTS statistics_bucket_provider_time
      ON statistics_bucket_5m (provider, bucket_start);
    CREATE INDEX IF NOT EXISTS statistics_bucket_account_time
      ON statistics_bucket_5m (account, bucket_start);
    CREATE INDEX IF NOT EXISTS statistics_bucket_model_time
      ON statistics_bucket_5m (model, bucket_start);
  `);

  const meta = db.query("SELECT version FROM statistics_meta WHERE id = 1").get() as { version?: number } | null;
  if (meta?.version !== STATISTICS_DB_VERSION) {
    db.close();
    throw new Error("unsupported statistics database version");
  }

  database = db;
  databasePath = path;
  return db;
}

function parseRecentRequestIds(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(-STATISTICS_CURSOR_RECENT_IDS)
      : [];
  } catch {
    return [];
  }
}

export function readStatisticsCursor(): StatisticsCursor {
  const row = openDatabase().query(`
    SELECT source_identity AS sourceIdentity,
           cursor_request_id AS cursorRequestId,
           last_seen_timestamp AS lastSeenTimestamp,
           recent_request_ids AS recentRequestIds
      FROM statistics_meta
     WHERE id = 1
  `).get() as {
    sourceIdentity: string | null;
    cursorRequestId: string | null;
    lastSeenTimestamp: number;
    recentRequestIds: string;
  } | null;
  return {
    sourceIdentity: row?.sourceIdentity ?? null,
    cursorRequestId: row?.cursorRequestId ?? null,
    lastSeenTimestamp: typeof row?.lastSeenTimestamp === "number" ? row.lastSeenTimestamp : 0,
    recentRequestIds: parseRecentRequestIds(row?.recentRequestIds),
  };
}

export function statisticsBucketCount(): number {
  const row = openDatabase().query("SELECT COUNT(*) AS count FROM statistics_bucket_5m").get() as { count?: number } | null;
  return typeof row?.count === "number" ? row.count : 0;
}

export function commitStatisticsSync(buckets: StatisticsBucket[], cursor: StatisticsCursor): void {
  const db = openDatabase();
  const upsert = db.query(`
    INSERT INTO statistics_bucket_5m (
      bucket_start, provider, account, model, requests, attempts,
      input_tokens, cache_read_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bucket_start, provider, account, model) DO UPDATE SET
      requests = requests + excluded.requests,
      attempts = attempts + excluded.attempts,
      input_tokens = input_tokens + excluded.input_tokens,
      cache_read_input_tokens = cache_read_input_tokens + excluded.cache_read_input_tokens,
      cache_creation_input_tokens = cache_creation_input_tokens + excluded.cache_creation_input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      reasoning_output_tokens = reasoning_output_tokens + excluded.reasoning_output_tokens
  `);
  const updateMeta = db.query(`
    UPDATE statistics_meta
       SET source_identity = ?,
           cursor_request_id = ?,
           last_seen_timestamp = ?,
           recent_request_ids = ?
     WHERE id = 1
  `);

  db.run("BEGIN IMMEDIATE");
  try {
    for (const row of buckets) {
      upsert.run(
        row.bucketStart,
        row.provider,
        row.account,
        row.model,
        row.requests,
        row.attempts,
        row.inputTokens,
        row.cacheReadInputTokens,
        row.cacheCreationInputTokens,
        row.outputTokens,
        row.reasoningOutputTokens,
      );
    }
    updateMeta.run(
      cursor.sourceIdentity,
      cursor.cursorRequestId,
      cursor.lastSeenTimestamp,
      JSON.stringify(cursor.recentRequestIds.slice(-STATISTICS_CURSOR_RECENT_IDS)),
    );
    db.run("COMMIT");
  } catch (error) {
    try { db.run("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

function queryWhere(query: StatisticsBucketQuery): { sql: string; params: Array<string | number> } {
  const clauses = ["bucket_start >= ?", "bucket_start < ?"];
  const params: Array<string | number> = [query.from, query.to];
  if (query.provider) { clauses.push("provider = ?"); params.push(query.provider); }
  if (query.account) { clauses.push("account = ?"); params.push(query.account); }
  if (query.model) { clauses.push("model = ?"); params.push(query.model); }
  return { sql: clauses.join(" AND "), params };
}

const BUCKET_SELECT = `
  provider,
  account,
  model,
  SUM(requests) AS requests,
  SUM(attempts) AS attempts,
  SUM(input_tokens) AS inputTokens,
  SUM(cache_read_input_tokens) AS cacheReadInputTokens,
  SUM(cache_creation_input_tokens) AS cacheCreationInputTokens,
  SUM(output_tokens) AS outputTokens,
  SUM(reasoning_output_tokens) AS reasoningOutputTokens
`;

export function readStatisticsTotals(query: StatisticsBucketQuery): StatisticsBucket[] {
  const where = queryWhere(query);
  return openDatabase().query(`
    SELECT 0 AS bucketStart, ${BUCKET_SELECT}
      FROM statistics_bucket_5m
     WHERE ${where.sql}
     GROUP BY provider, account, model
     ORDER BY provider, account, model
  `).all(...where.params) as StatisticsBucket[];
}

export function readStatisticsTrendRows(query: StatisticsBucketQuery, bucketMs: number): StatisticsBucket[] {
  const where = queryWhere(query);
  return openDatabase().query(`
    SELECT CAST(bucket_start / ? AS INTEGER) * ? AS bucketStart, ${BUCKET_SELECT}
      FROM statistics_bucket_5m
     WHERE ${where.sql}
     GROUP BY bucketStart, provider, account, model
     ORDER BY bucketStart, provider, account, model
  `).all(bucketMs, bucketMs, ...where.params) as StatisticsBucket[];
}

export function readStatisticsEarliestBucket(provider: string, account?: string): number | null {
  const row = account
    ? openDatabase().query(`
        SELECT MIN(bucket_start) AS bucketStart
          FROM statistics_bucket_5m
         WHERE provider = ? AND account = ?
      `).get(provider, account) as { bucketStart: number | null } | null
    : openDatabase().query(`
        SELECT MIN(bucket_start) AS bucketStart
          FROM statistics_bucket_5m
         WHERE provider = ?
      `).get(provider) as { bucketStart: number | null } | null;
  return typeof row?.bucketStart === "number" ? row.bucketStart : null;
}

function distinctValues(column: "provider" | "account" | "model"): string[] {
  const rows = openDatabase().query(`SELECT DISTINCT ${column} AS value FROM statistics_bucket_5m ORDER BY ${column}`).all() as { value: string }[];
  return rows.map(row => row.value);
}

export function readStatisticsDimensions(): StatisticsDimensions {
  return {
    providers: distinctValues("provider"),
    accounts: distinctValues("account"),
    models: distinctValues("model"),
  };
}

export function readStatisticsProviderModels(): Array<{ provider: string; model: string }> {
  return openDatabase().query(`
    SELECT DISTINCT provider, model
      FROM statistics_bucket_5m
     ORDER BY provider, model
  `).all() as Array<{ provider: string; model: string }>;
}

export function resetStatisticsDatabaseForTests(): void {
  if (database) {
    try { database.close(); } catch { /* best effort */ }
  }
  database = null;
  databasePath = null;
}
