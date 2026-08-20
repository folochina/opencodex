import type { Locale } from "./i18n/shared";

export type StatisticsTextKey =
  | "title"
  | "subtitle"
  | "priceConfig"
  | "refresh"
  | "allProviders"
  | "requests"
  | "inputTokens"
  | "inputRelation"
  | "cacheHitInput"
  | "cacheCreateInput"
  | "outputTokens"
  | "cacheHitRate"
  | "totalCost"
  | "previousPeriod"
  | "trend"
  | "granularity"
  | "granularity5m"
  | "granularity1h"
  | "granularity1d"
  | "quota"
  | "providerAccount"
  | "quotaType"
  | "periodStart"
  | "periodEnd"
  | "usedPercent"
  | "tokenAmount"
  | "costAmount"
  | "usedEstimatedTotal"
  | "modelTop"
  | "rank"
  | "providerModel"
  | "modelRequests"
  | "input"
  | "cacheHit"
  | "cacheCreate"
  | "output"
  | "cost"
  | "tokenComposition"
  | "costOverview"
  | "fiveHour"
  | "weekly"
  | "monthly"
  | "custom"
  | "priceTitle"
  | "priceSubtitle"
  | "provider"
  | "model"
  | "priceInput"
  | "priceCacheRead"
  | "priceCacheWrite"
  | "priceOutput"
  | "priceSource"
  | "officialPrice"
  | "customPrice"
  | "unpriced"
  | "perMillion"
  | "save"
  | "resetOfficial"
  | "close"
  | "noData"
  | "loadFailed"
  | "saving"
  | "autoRefresh";

type Catalog = Record<StatisticsTextKey, string>;

const en: Catalog = {
  title: "Statistics",
  subtitle: "Usage, quota, and cost signals in one view.",
  priceConfig: "Price settings",
  refresh: "Refresh",
  allProviders: "All providers",
  requests: "Requests",
  inputTokens: "Input tokens",
  inputRelation: "Input includes cache hit and cache creation",
  cacheHitInput: "Hit (cache input)",
  cacheCreateInput: "Create (cache write)",
  outputTokens: "Output tokens",
  cacheHitRate: "Cache hit rate",
  totalCost: "Total cost (USD)",
  previousPeriod: "vs previous period",
  trend: "Usage trend",
  granularity: "Auto granularity",
  granularity5m: "5 minutes",
  granularity1h: "Hourly",
  granularity1d: "Daily",
  quota: "Quota overview (current period)",
  providerAccount: "Provider / account",
  quotaType: "Quota",
  periodStart: "Period start",
  periodEnd: "Period end",
  usedPercent: "Used",
  tokenAmount: "Tokens",
  costAmount: "Amount (USD)",
  usedEstimatedTotal: "used / estimated total",
  modelTop: "Provider / model usage Top 10",
  rank: "Rank",
  providerModel: "Provider / model",
  modelRequests: "Requests",
  input: "Input",
  cacheHit: "Hit (cache input)",
  cacheCreate: "Create (cache write)",
  output: "Output",
  cost: "Cost (USD)",
  tokenComposition: "Token composition",
  costOverview: "Cost overview (USD)",
  fiveHour: "5-hour",
  weekly: "Weekly",
  monthly: "Monthly",
  custom: "Custom",
  priceTitle: "Price settings",
  priceSubtitle: "Costs are calculated at display time. Stored statistics contain tokens only.",
  provider: "Provider",
  model: "Model",
  priceInput: "Input",
  priceCacheRead: "Cache read",
  priceCacheWrite: "Cache write",
  priceOutput: "Output",
  priceSource: "Source",
  officialPrice: "Official/default",
  customPrice: "Custom",
  unpriced: "Unpriced",
  perMillion: "USD / 1M tokens",
  save: "Save",
  resetOfficial: "Use official price",
  close: "Close",
  noData: "No statistics for this range.",
  loadFailed: "Statistics could not be loaded.",
  saving: "Saving…",
  autoRefresh: "Auto refresh: 60s",
};

const zh: Catalog = {
  title: "统计",
  subtitle: "统一查看用量、当前周期配额与成本关键指标。",
  priceConfig: "价格配置",
  refresh: "刷新",
  allProviders: "全部提供方",
  requests: "请求数",
  inputTokens: "输入 Token",
  inputRelation: "输入包含命中（缓存输入）与创建（缓存写入）",
  cacheHitInput: "命中（缓存输入）",
  cacheCreateInput: "创建（缓存写入）",
  outputTokens: "输出 Token",
  cacheHitRate: "缓存命中率",
  totalCost: "总成本 (USD)",
  previousPeriod: "较前一周期",
  trend: "用量趋势",
  granularity: "自动粒度",
  granularity5m: "5 分钟",
  granularity1h: "按小时",
  granularity1d: "按天",
  quota: "配额概览（当前周期）",
  providerAccount: "提供方 / 账号",
  quotaType: "配额类型",
  periodStart: "周期开始",
  periodEnd: "周期结束",
  usedPercent: "已用百分比",
  tokenAmount: "Token 总量",
  costAmount: "金额总量 (USD)",
  usedEstimatedTotal: "已用 / 当前周期预计总量",
  modelTop: "提供方 / 模型用量 Top 10",
  rank: "排名",
  providerModel: "提供方 / 模型",
  modelRequests: "请求数",
  input: "输入",
  cacheHit: "命中（缓存输入）",
  cacheCreate: "创建（缓存写入）",
  output: "输出",
  cost: "成本 (USD)",
  tokenComposition: "Token 构成",
  costOverview: "成本概览 (USD)",
  fiveHour: "5 小时额度",
  weekly: "周额度",
  monthly: "月额度",
  custom: "自定义额度",
  priceTitle: "价格配置",
  priceSubtitle: "成本仅在展示时按统计量 × 当前价格计算，统计数据本身不保存价格。",
  provider: "提供方",
  model: "模型",
  priceInput: "输入",
  priceCacheRead: "缓存命中",
  priceCacheWrite: "缓存创建",
  priceOutput: "输出",
  priceSource: "价格来源",
  officialPrice: "官方 / 默认",
  customPrice: "自定义",
  unpriced: "未定价",
  perMillion: "USD / 100万 Token",
  save: "保存",
  resetOfficial: "恢复官方价格",
  close: "关闭",
  noData: "当前时间范围暂无统计数据。",
  loadFailed: "统计数据加载失败。",
  saving: "保存中…",
  autoRefresh: "自动刷新：60 秒",
};

const zhTW: Catalog = {
  ...en,
  title: "統計",
  subtitle: "統一查看用量、目前週期配額與成本關鍵指標。",
  priceConfig: "價格設定",
  refresh: "重新整理",
  allProviders: "全部供應商",
  requests: "請求數",
  inputTokens: "輸入 Token",
  inputRelation: "輸入包含命中（快取輸入）與建立（快取寫入）",
  cacheHitInput: "命中（快取輸入）",
  cacheCreateInput: "建立（快取寫入）",
  outputTokens: "輸出 Token",
  cacheHitRate: "快取命中率",
  totalCost: "總成本 (USD)",
  previousPeriod: "較前一週期",
  trend: "用量趨勢",
  granularity: "自動粒度",
  granularity5m: "5 分鐘",
  granularity1h: "每小時",
  granularity1d: "每日",
  quota: "配額概覽（目前週期）",
  providerAccount: "供應商 / 帳號",
  quotaType: "配額類型",
  periodStart: "週期開始",
  periodEnd: "週期結束",
  usedPercent: "已用百分比",
  tokenAmount: "Token 總量",
  costAmount: "金額總量 (USD)",
  usedEstimatedTotal: "已用 / 目前週期預估總量",
  modelTop: "供應商 / 模型用量 Top 10",
  rank: "排名",
  providerModel: "供應商 / 模型",
  modelRequests: "請求數",
  input: "輸入",
  cacheHit: "命中（快取輸入）",
  cacheCreate: "建立（快取寫入）",
  output: "輸出",
  cost: "成本 (USD)",
  tokenComposition: "Token 組成",
  costOverview: "成本概覽 (USD)",
  fiveHour: "5 小時額度",
  weekly: "週額度",
  monthly: "月額度",
  custom: "自訂額度",
  priceTitle: "價格設定",
  priceSubtitle: "成本只在顯示時依統計量 × 目前價格計算，統計資料本身不儲存價格。",
  provider: "供應商",
  model: "模型",
  priceInput: "輸入",
  priceCacheRead: "快取命中",
  priceCacheWrite: "快取建立",
  priceOutput: "輸出",
  priceSource: "價格來源",
  officialPrice: "官方 / 預設",
  customPrice: "自訂",
  unpriced: "未定價",
  perMillion: "USD / 100萬 Token",
  save: "儲存",
  resetOfficial: "恢復官方價格",
  close: "關閉",
  noData: "目前時間範圍沒有統計資料。",
  loadFailed: "統計資料載入失敗。",
  saving: "儲存中…",
  autoRefresh: "自動重新整理：60 秒",
};

// The Statistics surface is isolated from the compile-checked main TKey catalog so
// it can land without widening every existing locale object in one feature PR. Every
// supported Locale is still represented here; non-Chinese catalogs intentionally use
// the English source until dedicated translations are contributed.
const catalogs: Record<Locale, Catalog> = {
  en,
  de: en,
  fr: en,
  ko: en,
  zh,
  "zh-TW": zhTW,
  ru: en,
  ja: en,
  tr: en,
};

export function statisticsText(locale: Locale, key: StatisticsTextKey): string {
  return catalogs[locale][key];
}
