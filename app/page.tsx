"use client";

import {
  Upload,
  Send,
  CheckCircle,
  XCircle,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Download,
  Zap,
  ArrowUpDown,
  Settings2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type Rec = Record<string, any>;
type Cluster = { type: "EXACT_SSN" | "FUZZY_SSN_TYPO"; records: Rec[] };
type FieldAgreement = {
  score: number;
  status: "agree" | "null" | "conflict";
  weight: number;
  record_val: any;
  canonical_val: any;
  rule: string;
};
type ScoredRecord = Rec & {
  record_confidence: number;
  field_breakdown: Record<string, FieldAgreement>;
};
type ScoredGroup = {
  ssn: string;
  group_avg_confidence: number;
  outlier_record_ids: string[];
  canonical: Rec;
  records: ScoredRecord[];
  requiresReview: boolean;
};
type MergeDecision = "approved" | "rejected" | "pending";
type AuditEntry = {
  timestamp: string;
  ssn_masked: string;
  canonical_record_id: string;
  retired_record_ids: string[];
  source_record_count: number;
  group_avg_confidence: number;
  outlier_record_ids: string[];
  field_decisions: Record<
    string,
    { chosen_value: any; rule: string; group_confidence: number }
  >;
  record_scores: { record_id: string; confidence: number }[];
  decision: "approved" | "rejected";
};
type AppData = {
  records: Rec[];
  clusters: Cluster[];
  batches: Cluster[][];
  fileName: string;
};
type Message = { id: string; text: string; sender: "user" | "ai" };
type Action = {
  id: string;
  timestamp: number;
  type: "approve" | "reject" | "approve_all";
  clusterKey: string;
  previousDecision: MergeDecision;
  auditEntry?: AuditEntry;
};

// ─────────────────────────────────────────────────────────────
// RULE DEFINITIONS
// ─────────────────────────────────────────────────────────────
type RuleKey =
  | "most_frequent"
  | "most_recent"
  | "earliest_entry"
  | "longest_value"
  | "shortest_value"
  | "highest_value"
  | "lowest_value"
  | "fuzzy_match_most_recent"
  | "most_complete";

const RULE_LABELS: Record<RuleKey, string> = {
  most_frequent: "Most frequent",
  most_recent: "Most recent (created_at ↓)",
  earliest_entry: "Earliest entry (created_at ↑)",
  longest_value: "Longest value",
  shortest_value: "Shortest value",
  highest_value: "Highest numeric value",
  lowest_value: "Lowest numeric value",
  fuzzy_match_most_recent: "Fuzzy match + most recent",
  most_complete: "Most complete (non-null preferred)",
};

const RULE_DESCRIPTIONS: Record<RuleKey, string> = {
  most_frequent: "Pick whichever value appears most times across records",
  most_recent: "Pick value from the most recently created record",
  earliest_entry: "Pick value from the oldest/earliest record",
  longest_value: "Pick the longest string value",
  shortest_value: "Pick the shortest non-empty string value",
  highest_value: "Pick the highest numeric value",
  lowest_value: "Pick the lowest numeric value",
  fuzzy_match_most_recent:
    "Normalize address abbreviations, then pick most recent",
  most_complete: "Prefer non-null; among non-nulls pick most frequent",
};

// ─────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────
const DEFAULT_FIELD_WEIGHTS: Record<string, number> = {
  date_of_birth: 0.25,
  last_name: 0.25,
  first_name: 0.2,
  phone_number: 0.1,
  address: 0.1,
  email: 0.1,
};

const DEFAULT_FIELD_RULES: Record<string, RuleKey> = {
  first_name: "most_frequent",
  last_name: "most_frequent",
  date_of_birth: "most_frequent",
  phone_number: "most_frequent",
  email: "most_recent",
  address: "fuzzy_match_most_recent",
};

const SCORED_FIELDS = Object.keys(DEFAULT_FIELD_WEIGHTS);

type FieldRuleConfig = { rule: RuleKey; weight: number };
type RuleConfig = Record<string, FieldRuleConfig>;

function getDefaultRuleConfig(): RuleConfig {
  const cfg: RuleConfig = {};
  for (const f of SCORED_FIELDS) {
    cfg[f] = {
      rule: DEFAULT_FIELD_RULES[f] ?? "most_frequent",
      weight: DEFAULT_FIELD_WEIGHTS[f],
    };
  }
  return cfg;
}

// ─────────────────────────────────────────────────────────────
// ADDRESS NORMALIZATION
// ─────────────────────────────────────────────────────────────
const ADDRESS_ABBRS: Record<string, string> = {
  street: "st",
  "st.": "st",
  avenue: "ave",
  "ave.": "ave",
  av: "ave",
  "av.": "ave",
  boulevard: "blvd",
  "blvd.": "blvd",
  drive: "dr",
  "dr.": "dr",
  road: "rd",
  "rd.": "rd",
  court: "ct",
  "ct.": "ct",
  lane: "ln",
  "ln.": "ln",
  place: "pl",
  "pl.": "pl",
  circle: "cir",
  "cir.": "cir",
  terrace: "ter",
  "ter.": "ter",
  highway: "hwy",
  "hwy.": "hwy",
  parkway: "pkwy",
  "pkwy.": "pkwy",
};
function normAddr(addr: string): string {
  if (!addr) return "";
  return addr
    .toLowerCase()
    .replace(/[.,]/g, "")
    .split(" ")
    .map((t) => ADDRESS_ABBRS[t] ?? t)
    .join(" ")
    .trim();
}

// ─────────────────────────────────────────────────────────────
// RULE APPLICATORS
// ─────────────────────────────────────────────────────────────
function applyRule(field: string, rule: RuleKey, records: Rec[]): any {
  const vals = records.map((r) => r[field]);
  switch (rule) {
    case "most_frequent": {
      const nv = vals.filter(Boolean);
      if (!nv.length) return null;
      const cnt: Record<string, number> = {};
      for (const v of nv) cnt[String(v)] = (cnt[String(v)] ?? 0) + 1;
      return nv.reduce((a, b) => (cnt[String(a)] >= cnt[String(b)] ? a : b));
    }
    case "most_recent": {
      const sorted = [...records].sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      );
      return sorted[0]?.[field] ?? null;
    }
    case "earliest_entry": {
      const sorted = [...records].sort((a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
      );
      return sorted[0]?.[field] ?? null;
    }
    case "longest_value": {
      const nv = vals.filter((v) => v != null && String(v).trim() !== "");
      if (!nv.length) return null;
      return nv.reduce((a, b) =>
        String(a).length >= String(b).length ? a : b,
      );
    }
    case "shortest_value": {
      const nv = vals.filter((v) => v != null && String(v).trim() !== "");
      if (!nv.length) return null;
      return nv.reduce((a, b) =>
        String(a).length <= String(b).length ? a : b,
      );
    }
    case "highest_value": {
      const nv = vals.filter((v) => v != null && !isNaN(Number(v)));
      if (!nv.length) return null;
      return nv.reduce((a, b) => (Number(a) >= Number(b) ? a : b));
    }
    case "lowest_value": {
      const nv = vals.filter((v) => v != null && !isNaN(Number(v)));
      if (!nv.length) return null;
      return nv.reduce((a, b) => (Number(a) <= Number(b) ? a : b));
    }
    case "fuzzy_match_most_recent": {
      const addrGroups: Record<string, Rec[]> = {};
      for (const r of records) {
        const key = normAddr(r[field] ?? "");
        (addrGroups[key] = addrGroups[key] ?? []).push(r);
      }
      const largest =
        Object.values(addrGroups).sort((a, b) => b.length - a.length)[0] ??
        records;
      const sorted = [...largest].sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      );
      return sorted[0]?.[field] ?? null;
    }
    case "most_complete": {
      const nv = vals.filter((v) => v != null && String(v).trim() !== "");
      if (!nv.length) return null;
      const cnt: Record<string, number> = {};
      for (const v of nv) cnt[String(v)] = (cnt[String(v)] ?? 0) + 1;
      return nv.reduce((a, b) => (cnt[String(a)] >= cnt[String(b)] ? a : b));
    }
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────
// CANONICAL + SCORING
// ─────────────────────────────────────────────────────────────
function buildCanonical(records: Rec[], ruleConfig: RuleConfig): Rec {
  const canon: Rec = {};
  for (const field of SCORED_FIELDS) {
    const cfg = ruleConfig[field];
    if (cfg) canon[field] = applyRule(field, cfg.rule, records);
  }
  canon.ssn = records[0].ssn;
  const oldest = [...records].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  )[0];
  canon.record_id = oldest.record_id ?? oldest.id;
  canon.created_at = oldest.created_at;
  return canon;
}

function fieldAgreement(
  recordVal: any,
  canonicalVal: any,
  field: string,
  rule: RuleKey,
): { score: number; status: "agree" | "null" | "conflict" } {
  if (recordVal == null || String(recordVal).trim() === "")
    return { score: 0.5, status: "null" };
  if (rule === "fuzzy_match_most_recent") {
    return normAddr(String(recordVal)) === normAddr(String(canonicalVal ?? ""))
      ? { score: 1.0, status: "agree" }
      : { score: 0.0, status: "conflict" };
  }
  return String(recordVal) === String(canonicalVal ?? "")
    ? { score: 1.0, status: "agree" }
    : { score: 0.0, status: "conflict" };
}

function calcRecordConfidence(
  record: Rec,
  canonical: Rec,
  ruleConfig: RuleConfig,
): { score: number; fields: Record<string, FieldAgreement> } {
  let weightedSum = 0,
    totalWeight = 0;
  const fieldScores: Record<string, FieldAgreement> = {};
  for (const field of SCORED_FIELDS) {
    const cfg = ruleConfig[field];
    if (!cfg) continue;
    const ag = fieldAgreement(record[field], canonical[field], field, cfg.rule);
    fieldScores[field] = {
      ...ag,
      weight: cfg.weight,
      record_val: record[field],
      canonical_val: canonical[field],
      rule: cfg.rule,
    };
    weightedSum += ag.score * cfg.weight;
    totalWeight += cfg.weight;
  }
  return {
    score: totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0,
    fields: fieldScores,
  };
}

function scoreGroup(
  ssn: string,
  records: Rec[],
  ruleConfig: RuleConfig,
): ScoredGroup {
  const canonical = buildCanonical(records, ruleConfig);
  const scoredRecords: ScoredRecord[] = records.map((r) => {
    const conf = calcRecordConfidence(r, canonical, ruleConfig);
    return {
      ...r,
      record_confidence: conf.score,
      field_breakdown: conf.fields,
    };
  });
  const scores = scoredRecords.map((r) => r.record_confidence);
  const groupAvg = Math.round(
    scores.reduce((a, b) => a + b, 0) / scores.length,
  );
  const outliers = scoredRecords
    .filter((r) => r.record_confidence < groupAvg - 10)
    .map((r) => r.record_id ?? r.id);
  return {
    ssn,
    group_avg_confidence: groupAvg,
    outlier_record_ids: outliers,
    canonical,
    records: scoredRecords,
    requiresReview: groupAvg < 80,
  };
}

// ─────────────────────────────────────────────────────────────
// CLUSTERING
// ─────────────────────────────────────────────────────────────
function getCandidateClusters(data: Rec[]): Cluster[] {
  const exactSsnMap = new Map<string, Rec[]>();
  const fuzzyMap = new Map<string, Rec[]>();
  data.forEach((rec) => {
    const ssnKey = rec.ssn ?? "__no_ssn__";
    if (!exactSsnMap.has(ssnKey)) exactSsnMap.set(ssnKey, []);
    exactSsnMap.get(ssnKey)!.push(rec);
    const fuzzyKey = `${rec.first_name?.toLowerCase() ?? ""}-${rec.last_name?.toLowerCase() ?? ""}-${rec.date_of_birth ?? ""}`;
    if (!fuzzyMap.has(fuzzyKey)) fuzzyMap.set(fuzzyKey, []);
    fuzzyMap.get(fuzzyKey)!.push(rec);
  });
  const clusters: Cluster[] = [];
  for (const group of exactSsnMap.values()) {
    if (group.length > 1) clusters.push({ type: "EXACT_SSN", records: group });
  }
  for (const group of fuzzyMap.values()) {
    if (group.length > 1) {
      const allSameSsn = group.every((r) => r.ssn === group[0].ssn);
      if (!allSameSsn)
        clusters.push({ type: "FUZZY_SSN_TYPO", records: group });
    }
  }
  return clusters;
}
function makeBatches(clusters: Cluster[], size = 3): Cluster[][] {
  const b: Cluster[][] = [];
  for (let i = 0; i < clusters.length; i += size)
    b.push(clusters.slice(i, i + size));
  return b;
}
function getFields(records: Rec[]): string[] {
  const keys = new Set<string>();
  records
    .slice(0, 20)
    .forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const priority = [
    "id",
    "record_id",
    "first_name",
    "last_name",
    "ssn",
    "date_of_birth",
    "email",
    "phone_number",
    "address",
  ];
  const sorted = priority.filter((k) => keys.has(k));
  keys.forEach((k) => {
    if (!sorted.includes(k)) sorted.push(k);
  });
  return sorted.slice(0, 9);
}

// ─────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────
function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────
// AI CHAT
// ─────────────────────────────────────────────────────────────
async function callClaude(
  question: string,
  appData: AppData | null,
): Promise<string> {
  const context = appData
    ? `Data summary: ${appData.records.length} records, ${appData.clusters.length} duplicate groups.\nClusters (first 5): ${JSON.stringify(appData.clusters.slice(0, 5))}\nUser question: ${question}`
    : question;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system:
        "You are a data deduplication assistant. Answer concisely in 2-3 sentences.",
      messages: [{ role: "user", content: context }],
    }),
  });
  const data = await response.json();
  return (
    data.content?.find((b: any) => b.type === "text")?.text ?? "No response."
  );
}

// ─────────────────────────────────────────────────────────────
// CONFIDENCE BADGE
// ─────────────────────────────────────────────────────────────
function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 85
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : score >= 65
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${color}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {score}% · {score >= 85 ? "High" : score >= 65 ? "Medium" : "Low"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// RULE CONFIG PANEL
// ─────────────────────────────────────────────────────────────
function RuleConfigPanel({
  ruleConfig,
  onChange,
}: {
  ruleConfig: RuleConfig;
  onChange: (cfg: RuleConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const totalWeight = Object.values(ruleConfig).reduce(
    (s, c) => s + c.weight,
    0,
  );
  const weightOk = Math.abs(totalWeight - 1) < 0.001;
  const customCount = Object.entries(ruleConfig).filter(
    ([f, c]) =>
      c.rule !== (DEFAULT_FIELD_RULES[f] ?? "most_frequent") ||
      Math.abs(c.weight - (DEFAULT_FIELD_WEIGHTS[f] ?? 0)) > 0.001,
  ).length;

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Settings2 className="w-4 h-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Field Rule Configuration
          </span>
          {customCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              {customCount} custom
            </span>
          )}
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${weightOk ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}
          >
            Σw = {totalWeight.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange(getDefaultRuleConfig());
            }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors px-2 py-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            <RotateCcw className="w-3 h-3" /> Reset all
          </button>
          {open ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </div>
      </button>

      {open && (
        <div className="bg-white dark:bg-zinc-900/40">
          <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
            <span className="text-xs text-zinc-400">Legend:</span>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />{" "}
              Custom rule/weight
            </span>
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <span className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 inline-block" />{" "}
              Default
            </span>
          </div>

          <div className="grid grid-cols-[10px_150px_1fr_110px_70px] gap-2 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
            <span />
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Field
            </span>
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Selection Rule
            </span>
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide text-center">
              Weight (0–1)
            </span>
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide text-center">
              Reset
            </span>
          </div>

          <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
            {Object.entries(ruleConfig).map(([field, cfg]) => {
              const isDefaultRule =
                cfg.rule === (DEFAULT_FIELD_RULES[field] ?? "most_frequent");
              const isDefaultWeight =
                Math.abs(cfg.weight - (DEFAULT_FIELD_WEIGHTS[field] ?? 0)) <
                0.001;
              const isDefault = isDefaultRule && isDefaultWeight;
              return (
                <div
                  key={field}
                  className={`grid grid-cols-[10px_150px_1fr_110px_70px] gap-2 items-center px-4 py-2 transition-colors ${!isDefault ? "bg-violet-50/40 dark:bg-violet-950/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${!isDefault ? "bg-violet-400" : "bg-zinc-200 dark:bg-zinc-700"}`}
                  />
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {field}
                  </span>

                  <select
                    value={cfg.rule}
                    title={RULE_DESCRIPTIONS[cfg.rule]}
                    onChange={(e) =>
                      onChange({
                        ...ruleConfig,
                        [field]: { ...cfg, rule: e.target.value as RuleKey },
                      })
                    }
                    className={`text-xs px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors ${!isDefaultRule ? "border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/20 text-violet-800 dark:text-violet-200" : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"}`}
                  >
                    {(Object.keys(RULE_LABELS) as RuleKey[]).map((r) => (
                      <option key={r} value={r}>
                        {RULE_LABELS[r]}
                      </option>
                    ))}
                  </select>

                  <div className="flex flex-col gap-1">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={cfg.weight}
                      onChange={(e) => {
                        const v = Math.max(
                          0,
                          Math.min(1, parseFloat(e.target.value) || 0),
                        );
                        onChange({
                          ...ruleConfig,
                          [field]: { ...cfg, weight: v },
                        });
                      }}
                      className={`w-full text-xs px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 text-center transition-colors ${!isDefaultWeight ? "border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/20 text-violet-800 dark:text-violet-200 font-medium" : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"}`}
                    />
                  </div>

                  <div className="flex justify-center">
                    {!isDefault ? (
                      <button
                        onClick={() =>
                          onChange({
                            ...ruleConfig,
                            [field]: {
                              rule:
                                DEFAULT_FIELD_RULES[field] ?? "most_frequent",
                              weight: DEFAULT_FIELD_WEIGHTS[field] ?? 0.1,
                            },
                          })
                        }
                        className="text-xs text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 transition-colors px-1.5 py-0.5 rounded hover:bg-violet-50 dark:hover:bg-violet-900/20 whitespace-nowrap"
                      >
                        ↩ reset
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-700">
                        —
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            {!weightOk && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                ⚠ Weights sum to {totalWeight.toFixed(2)} — scores normalised
                automatically
              </span>
            )}
            {weightOk && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                ✓ Weights sum to 1.00
              </span>
            )}
            <span className="text-xs text-zinc-400">
              Changes apply live — all scores recalculate instantly
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MERGE PANEL
// ─────────────────────────────────────────────────────────────
function MergePanel({
  cluster,
  onApprove,
  onReject,
  decision,
  ruleConfig,
}: {
  cluster: Cluster;
  onApprove: (sg: ScoredGroup, overrides: Record<string, any>) => void;
  onReject: (sg: ScoredGroup) => void;
  decision: MergeDecision;
  ruleConfig: RuleConfig;
}) {
  const sg = useMemo(
    () =>
      scoreGroup(cluster.records[0]?.ssn ?? "??", cluster.records, ruleConfig),
    [cluster, ruleConfig],
  );
  const [expanded, setExpanded] = useState(false);
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, any>>({});
  const fields = getFields(cluster.records);
  const scoreFields = Object.keys(ruleConfig);

  const getFieldOptions = (field: string): any[] => {
    const seen = new Set<string>();
    const opts: any[] = [];
    for (const r of sg.records) {
      const v = r[field];
      if (
        v !== undefined &&
        v !== null &&
        String(v).trim() !== "" &&
        !seen.has(String(v))
      ) {
        seen.add(String(v));
        opts.push(v);
      }
    }
    return opts;
  };
  const getEffectiveVal = (field: string) =>
    fieldOverrides[field] !== undefined
      ? fieldOverrides[field]
      : sg.canonical[field];

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-all duration-200 ${
        decision === "approved"
          ? "border-emerald-300 dark:border-emerald-700"
          : decision === "rejected"
            ? "border-red-200 dark:border-red-800 opacity-60"
            : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${cluster.type === "EXACT_SSN" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}
        >
          {cluster.type === "EXACT_SSN" ? "Exact SSN" : "Fuzzy match"}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {cluster.records.length} records
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-600">·</span>
        <ConfidenceBadge score={sg.group_avg_confidence} />
        {sg.requiresReview && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
            ⚠ Review
          </span>
        )}
        {Object.keys(fieldOverrides).length > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            ✎ {Object.keys(fieldOverrides).length} override
            {Object.keys(fieldOverrides).length > 1 ? "s" : ""}
          </span>
        )}
        {decision === "approved" && (
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Approved
          </span>
        )}
        {decision === "rejected" && (
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 flex items-center gap-1">
            <XCircle className="w-3 h-3" /> Rejected
          </span>
        )}
        {decision === "pending" && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => onApprove(sg, fieldOverrides)}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <CheckCircle className="w-3 h-3" /> Approve merge
            </button>
            <button
              onClick={() => onReject(sg)}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <XCircle className="w-3 h-3" /> Reject
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-b border-zinc-100 dark:border-zinc-800">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30">
              {fields.map((f) => (
                <th
                  key={f}
                  className="text-left px-3 py-2 text-zinc-500 dark:text-zinc-400 font-medium whitespace-nowrap"
                >
                  {f}
                </th>
              ))}
              <th className="text-left px-3 py-2 text-zinc-500 dark:text-zinc-400 font-medium whitespace-nowrap">
                confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {sg.records.map((rec, ri) => {
              const rid = rec.record_id ?? rec.id;
              const isOutlier = sg.outlier_record_ids.includes(rid);
              return (
                <tr
                  key={ri}
                  className={`border-b last:border-b-0 border-zinc-100 dark:border-zinc-800 ${isOutlier ? "bg-orange-50/50 dark:bg-orange-900/10" : ""}`}
                >
                  {fields.map((f) => {
                    const val = rec[f] !== undefined ? String(rec[f]) : "—";
                    const prevVal =
                      ri > 0 ? String(sg.records[ri - 1][f] ?? "") : null;
                    const isIdField = f === "id" || f === "record_id";
                    const isDiff = ri > 0 && val !== prevVal && !isIdField;
                    return (
                      <td
                        key={f}
                        className={`px-3 py-2 whitespace-nowrap ${isDiff ? "text-red-600 dark:text-red-400 font-medium" : "text-zinc-800 dark:text-zinc-200"}`}
                      >
                        {val}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <ConfidenceBadge score={rec.record_confidence} />
                      {isOutlier && (
                        <span
                          className="text-orange-500 text-xs"
                          title="Outlier"
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border-t border-emerald-200 dark:border-emerald-900/40">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100/40 dark:hover:bg-emerald-900/20 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Proposed canonical · {sg.group_avg_confidence}% confidence
            {Object.keys(fieldOverrides).length > 0 &&
              " · manual overrides applied"}
          </span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-emerald-700 dark:text-emerald-500 mb-3">
              Retaining oldest record_id:{" "}
              <span className="font-mono font-medium">
                {sg.canonical.record_id}
              </span>
              {" · "}Select a value from the dropdown to override the
              auto-selected canonical.
            </p>
            <div className="grid gap-2">
              {scoreFields.map((field) => {
                const cfg = ruleConfig[field];
                const options = getFieldOptions(field);
                const effectiveVal = getEffectiveVal(field);
                const isOverridden = fieldOverrides[field] !== undefined;
                const isCustomRule =
                  cfg?.rule !== (DEFAULT_FIELD_RULES[field] ?? "most_frequent");
                const isCustomWeight =
                  Math.abs(
                    (cfg?.weight ?? 0) - (DEFAULT_FIELD_WEIGHTS[field] ?? 0),
                  ) > 0.001;
                const allStatuses = sg.records.map(
                  (r) => r.field_breakdown[field]?.status,
                );
                const agreeCount = allStatuses.filter(
                  (s) => s === "agree",
                ).length;
                const conflictCount = allStatuses.filter(
                  (s) => s === "conflict",
                ).length;
                const nullCount = allStatuses.filter(
                  (s) => s === "null",
                ).length;
                const fieldScore = Math.round(
                  (sg.records.reduce(
                    (sum, r) => sum + (r.field_breakdown[field]?.score ?? 0.5),
                    0,
                  ) /
                    sg.records.length) *
                    100,
                );

                return (
                  <div
                    key={field}
                    className={`flex items-start gap-3 py-2 px-3 bg-white dark:bg-zinc-900/60 rounded-lg border ${
                      isOverridden
                        ? "border-blue-300 dark:border-blue-700"
                        : isCustomRule || isCustomWeight
                          ? "border-violet-200 dark:border-violet-800"
                          : "border-emerald-200 dark:border-emerald-900/40"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {field}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-mono text-[10px] ${isCustomRule ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}
                        >
                          {RULE_LABELS[cfg?.rule ?? "most_frequent"]}
                        </span>
                        <span
                          className={`text-xs ${isCustomWeight ? "text-violet-600 dark:text-violet-400 font-semibold" : "text-zinc-400"}`}
                        >
                          w={cfg?.weight ?? 0}
                        </span>
                        {(isCustomRule || isCustomWeight) && !isOverridden && (
                          <span className="text-[10px] text-violet-500 font-medium">
                            ✦ custom rule
                          </span>
                        )}
                        {isOverridden && (
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-0.5">
                            ✎ overridden
                            <button
                              onClick={() =>
                                setFieldOverrides((prev) => {
                                  const n = { ...prev };
                                  delete n[field];
                                  return n;
                                })
                              }
                              className="ml-1 text-blue-400 hover:text-red-500 transition-colors"
                              title="Reset to auto"
                            >
                              ×
                            </button>
                          </span>
                        )}
                      </div>
                      <select
                        value={String(effectiveVal ?? "")}
                        onChange={(e) => {
                          const chosen = options.find(
                            (o) => String(o) === e.target.value,
                          );
                          const autoVal = sg.canonical[field];
                          if (String(chosen) === String(autoVal ?? "")) {
                            setFieldOverrides((prev) => {
                              const n = { ...prev };
                              delete n[field];
                              return n;
                            });
                          } else {
                            setFieldOverrides((prev) => ({
                              ...prev,
                              [field]: chosen ?? e.target.value,
                            }));
                          }
                        }}
                        className={`w-full text-xs px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors ${
                          isOverridden
                            ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 font-medium"
                            : "border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 font-semibold"
                        }`}
                      >
                        {options.length === 0 && (
                          <option value="">— null —</option>
                        )}
                        {options.map((opt, i) => (
                          <option key={i} value={String(opt)}>
                            {String(opt)}
                            {String(opt) === String(sg.canonical[field] ?? "")
                              ? " (auto)"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0 pt-6">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${fieldScore >= 85 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : fieldScore >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"}`}
                      >
                        {fieldScore}%
                      </span>
                      <div className="flex gap-1 text-xs">
                        {agreeCount > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ✓{agreeCount}
                          </span>
                        )}
                        {conflictCount > 0 && (
                          <span className="text-red-500">✗{conflictCount}</span>
                        )}
                        {nullCount > 0 && (
                          <span className="text-zinc-400">–{nullCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AUDIT LOG PANEL
// ─────────────────────────────────────────────────────────────
function AuditLogPanel({
  entries,
  allRecords,
  clusters,
  onUndo,
}: {
  entries: AuditEntry[];
  allRecords: Rec[];
  clusters: Cluster[];
  onUndo?: (entry: AuditEntry) => void;
}) {
  const handleExportAll = () => {
    const approvedEntries = entries.filter((e) => e.decision === "approved");
    const retiredIds = new Set(
      approvedEntries.flatMap((e) => e.retired_record_ids),
    );
    const mergedClients = allRecords.filter(
      (r) => !retiredIds.has(r.record_id ?? r.id),
    );
    const duplicatesRemoved = allRecords.filter((r) =>
      retiredIds.has(r.record_id ?? r.id),
    );
    downloadJSON(mergedClients, "merged_clients.json");
    setTimeout(
      () => downloadJSON(duplicatesRemoved, "duplicates_removed.json"),
      300,
    );
    setTimeout(() => downloadJSON(entries, "audit_log.json"), 600);
  };

  if (!entries.length)
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-600">
        <ClipboardList className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">No merge actions taken yet.</p>
      </div>
    );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {entries.length} decision{entries.length > 1 ? "s" : ""} recorded
        </p>
        <button
          onClick={handleExportAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
        >
          <Download className="w-3 h-3" /> Export all 3 files
        </button>
      </div>
      {entries.map((entry, i) => (
        <div
          key={i}
          className={`border rounded-xl p-4 text-xs space-y-2 ${entry.decision === "approved" ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20" : "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20"}`}
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-medium ${entry.decision === "approved" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
              >
                {entry.decision === "approved" ? "✓ Merged" : "✗ Rejected"}
              </span>
              <span className="font-mono text-zinc-500">
                {entry.ssn_masked}
              </span>
              <ConfidenceBadge score={entry.group_avg_confidence} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
              {onUndo && (
                <button
                  onClick={() => onUndo(entry)}
                  className="p-1 text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  title="Undo this action"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {entry.decision === "approved" && (
            <>
              <div className="text-zinc-600 dark:text-zinc-400">
                Canonical:{" "}
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {entry.canonical_record_id}
                </span>
                {" · "}
                Retired:{" "}
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {entry.retired_record_ids.join(", ")}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {Object.entries(entry.field_decisions).map(([field, fd]) => (
                  <div
                    key={field}
                    className={`bg-white dark:bg-zinc-900/60 rounded-lg px-2 py-1 border ${fd.rule === "manual_override" ? "border-blue-200 dark:border-blue-800" : fd.rule !== (DEFAULT_FIELD_RULES[field] ?? "most_frequent") ? "border-violet-200 dark:border-violet-800" : "border-zinc-200 dark:border-zinc-700"}`}
                  >
                    <div className="text-zinc-400 truncate">{field}</div>
                    <div className="font-medium text-zinc-700 dark:text-zinc-300 truncate">
                      {String(fd.chosen_value ?? "—")}
                    </div>
                    <div
                      className={`text-[10px] italic truncate ${fd.rule === "manual_override" ? "text-blue-500" : fd.rule !== (DEFAULT_FIELD_RULES[field] ?? "most_frequent") ? "text-violet-500" : "text-zinc-400"}`}
                    >
                      {fd.rule}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────
function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const getPages = (): (number | "…")[] => {
    if (totalPages <= 7)
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (currentPage > 3) pages.push("…");
    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(totalPages - 1, currentPage + 1);
      i++
    )
      pages.push(i);
    if (currentPage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
    return pages;
  };
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ‹
      </button>
      {getPages().map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1.5 py-1 text-xs text-zinc-400">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p as number)}
            className={`min-w-[28px] px-2 py-1 text-xs rounded-lg border transition-colors ${currentPage === p ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            {p}
          </button>
        ),
      )}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ›
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BATCH OUTPUT
// ─────────────────────────────────────────────────────────────
type SortDir = "asc" | "desc" | null;

function BatchOutput({ appData }: { appData: AppData }) {
  const { records, clusters } = appData;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [decisions, setDecisions] = useState<Record<string, MergeDecision>>({});
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"clusters" | "audit">("clusters");
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [ruleConfig, setRuleConfig] = useState<RuleConfig>(
    getDefaultRuleConfig(),
  );
  const [actionHistory, setActionHistory] = useState<Action[]>([]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const clusterKey = (c: Cluster) =>
    `${c.type}-${c.records[0]?.ssn ?? c.records[0]?.id ?? c.records[0]?.record_id}`;

  const buildAuditEntry = (
    c: Cluster,
    sg: ScoredGroup,
    overrides: Record<string, any>,
    decision: "approved" | "rejected",
  ): AuditEntry => {
    const retired = sg.records.filter(
      (r) => (r.record_id ?? r.id) !== sg.canonical.record_id,
    );
    const ssn = String(sg.ssn);
    const effectiveCanonical = { ...sg.canonical, ...overrides };
    return {
      timestamp: new Date().toISOString(),
      ssn_masked: "***-**-" + ssn.slice(-4),
      canonical_record_id: sg.canonical.record_id,
      retired_record_ids:
        decision === "approved" ? retired.map((r) => r.record_id ?? r.id) : [],
      source_record_count: sg.records.length,
      group_avg_confidence: sg.group_avg_confidence,
      outlier_record_ids: sg.outlier_record_ids,
      field_decisions:
        decision === "approved"
          ? Object.fromEntries(
              Object.keys(ruleConfig).map((f) => [
                f,
                {
                  chosen_value: effectiveCanonical[f],
                  rule:
                    overrides[f] !== undefined
                      ? "manual_override"
                      : (ruleConfig[f]?.rule ?? "most_frequent"),
                  group_confidence: sg.group_avg_confidence,
                },
              ]),
            )
          : {},
      record_scores: sg.records.map((r) => ({
        record_id: r.record_id ?? r.id,
        confidence: r.record_confidence,
      })),
      decision,
    };
  };

  const addToHistory = (
    type: Action["type"],
    clusterKey: string,
    previousDecision: MergeDecision,
    auditEntry?: AuditEntry,
  ) => {
    const newAction: Action = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      type,
      clusterKey,
      previousDecision,
      auditEntry,
    };
    setActionHistory((prev) => [newAction, ...prev].slice(0, 50)); // Keep last 50 actions
  };

  const handleUndo = (entry: AuditEntry) => {
    // Find which cluster this entry belongs to
    const cluster = clusters.find((c) => {
      const key = clusterKey(c);
      const sg = scoreGroup(c.records[0]?.ssn ?? "??", c.records, ruleConfig);
      return sg.canonical.record_id === entry.canonical_record_id;
    });

    if (!cluster) return;

    const key = clusterKey(cluster);
    
    // Remove from decisions (set back to pending)
    setDecisions((prev) => {
      const newDecisions = { ...prev };
      delete newDecisions[key];
      return newDecisions;
    });

    // Remove from audit log
    setAuditLog((prev) => prev.filter((e) => e.timestamp !== entry.timestamp));

    // Add undo action to history
    addToHistory("approve", key, "approved");
  };

  const handleApprove = (
    c: Cluster,
    sg: ScoredGroup,
    overrides: Record<string, any>,
  ) => {
    const key = clusterKey(c);
    const previousDecision = decisions[key] ?? "pending";
    setDecisions((d) => ({ ...d, [key]: "approved" }));
    const auditEntry = buildAuditEntry(c, sg, overrides, "approved");
    setAuditLog((l) => [auditEntry, ...l]);
    addToHistory("approve", key, previousDecision, auditEntry);
  };

  const handleReject = (c: Cluster, sg: ScoredGroup) => {
    const key = clusterKey(c);
    const previousDecision = decisions[key] ?? "pending";
    setDecisions((d) => ({ ...d, [key]: "rejected" }));
    const auditEntry = buildAuditEntry(c, sg, {}, "rejected");
    setAuditLog((l) => [auditEntry, ...l]);
    addToHistory("reject", key, previousDecision, auditEntry);
  };

  const handleApproveAll100 = () => {
    const newDecisions = { ...decisions };
    const newEntries: AuditEntry[] = [];
    const approvedKeys: string[] = [];
    
    for (const c of clusters) {
      const key = clusterKey(c);
      if (newDecisions[key] && newDecisions[key] !== "pending") continue;
      const sg = scoreGroup(c.records[0]?.ssn ?? "??", c.records, ruleConfig);
      if (sg.group_avg_confidence === 100) {
        newDecisions[key] = "approved";
        const auditEntry = buildAuditEntry(c, sg, {}, "approved");
        newEntries.push(auditEntry);
        approvedKeys.push(key);
      }
    }
    
    setDecisions(newDecisions);
    setAuditLog((l) => [...newEntries, ...l]);
    
    // Add a single action for the batch approve
    if (approvedKeys.length > 0) {
      addToHistory("approve_all", approvedKeys.join(","), "pending");
    }
  };

  const filteredClusters = useMemo(() => {
    let result = clusters.filter((cluster) => {
      if (!debouncedSearch.trim()) return true;
      const q = debouncedSearch.trim().toLowerCase();
      return cluster.records.some((rec) =>
        Object.values(rec).some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    });
    if (sortDir !== null) {
      result = [...result].sort((a, b) => {
        const sgA = scoreGroup(
          a.records[0]?.ssn ?? "??",
          a.records,
          ruleConfig,
        );
        const sgB = scoreGroup(
          b.records[0]?.ssn ?? "??",
          b.records,
          ruleConfig,
        );
        return sortDir === "asc"
          ? sgA.group_avg_confidence - sgB.group_avg_confidence
          : sgB.group_avg_confidence - sgA.group_avg_confidence;
      });
    }
    return result;
  }, [clusters, debouncedSearch, sortDir, ruleConfig]);

  const allBatches: Cluster[][] = [];
  for (let i = 0; i < filteredClusters.length; i += 3)
    allBatches.push(filteredClusters.slice(i, i + 3));
  const totalPages = Math.max(1, Math.ceil(allBatches.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedBatches = allBatches.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const globalBatchOffset = (safePage - 1) * pageSize;

  const approvedCount = Object.values(decisions).filter(
    (d) => d === "approved",
  ).length;
  const rejectedCount = Object.values(decisions).filter(
    (d) => d === "rejected",
  ).length;
  const pendingCount = clusters.length - approvedCount - rejectedCount;
  
  const count100 = clusters.filter((c) => {
    const key = clusterKey(c);
    if (decisions[key] && decisions[key] !== "pending") return false;
    const sg = scoreGroup(c.records[0]?.ssn ?? "??", c.records, ruleConfig);
    return sg.group_avg_confidence === 100;
  }).length;

  const canUndo = actionHistory.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-zinc-200 dark:border-zinc-800 px-6 pt-4 gap-1 shrink-0">
        {(["clusters", "audit"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${activeTab === tab ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-50" : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}
          >
            {tab === "clusters"
              ? "Duplicate groups"
              : `Audit log${auditLog.length > 0 ? ` (${auditLog.length})` : ""}`}
          </button>
        ))}
      </div>

      {activeTab === "audit" ? (
        <div className="flex-1 overflow-y-auto">
          <AuditLogPanel
            entries={auditLog}
            allRecords={records}
            clusters={clusters}
            onUndo={handleUndo}
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: "Total records", value: records.length, color: "" },
                { label: "Dup groups", value: clusters.length, color: "" },
                {
                  label: "Pending",
                  value: pendingCount,
                  color: "text-zinc-900 dark:text-zinc-50",
                },
                {
                  label: "Approved",
                  value: approvedCount,
                  color: "text-emerald-600 dark:text-emerald-400",
                },
                {
                  label: "Rejected",
                  value: rejectedCount,
                  color: "text-red-500 dark:text-red-400",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-zinc-100 dark:bg-zinc-800 rounded-xl p-3"
                >
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {label}
                  </p>
                  <p
                    className={`text-xl font-semibold mt-0.5 ${color || "text-zinc-900 dark:text-zinc-50"}`}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <RuleConfigPanel
              ruleConfig={ruleConfig}
              onChange={(cfg) => {
                setRuleConfig(cfg);
                setCurrentPage(1);
              }}
            />

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => {
                  setSortDir((p) =>
                    p === null ? "desc" : p === "desc" ? "asc" : null,
                  );
                  setCurrentPage(1);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${sortDir !== null ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                <ArrowUpDown className="w-3 h-3" />
                Confidence
                {sortDir === "asc" ? " ↑" : sortDir === "desc" ? " ↓" : ""}
              </button>
              {count100 > 0 && (
                <button
                  onClick={handleApproveAll100}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  <Zap className="w-3 h-3" /> Approve all 100% ({count100})
                </button>
              )}
              <div className="relative flex-1 max-w-xs">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search records..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:border-blue-500"
                />
                {search && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setCurrentPage(1);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-sm leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              {canUndo && (
                <button
                  onClick={() => {
                    const lastAction = actionHistory[0];
                    if (lastAction.type === "approve_all") {
                      // For approve all, we need to revert all approved clusters
                      const keys = lastAction.clusterKey.split(",");
                      setDecisions((prev) => {
                        const newDecisions = { ...prev };
                        keys.forEach(key => {
                          delete newDecisions[key];
                        });
                        return newDecisions;
                      });
                      setAuditLog((prev) => 
                        prev.filter(e => !keys.some(key => 
                          e.canonical_record_id === key.split("-")[1]
                        ))
                      );
                    } else {
                      // For single actions, revert the last action
                      const key = lastAction.clusterKey;
                      setDecisions((prev) => {
                        const newDecisions = { ...prev };
                        if (lastAction.previousDecision === "pending") {
                          delete newDecisions[key];
                        } else {
                          newDecisions[key] = lastAction.previousDecision;
                        }
                        return newDecisions;
                      });
                      if (lastAction.auditEntry) {
                        setAuditLog((prev) => 
                          prev.filter(e => e.timestamp !== lastAction.auditEntry?.timestamp)
                        );
                      }
                    }
                    setActionHistory((prev) => prev.slice(1));
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors"
                >
                  <Undo2 className="w-3 h-3" /> Undo last action
                </button>
              )}
            </div>

            {pagedBatches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-600">
                <p className="text-sm">No clusters match your search.</p>
              </div>
            ) : (
              pagedBatches.map((batch, pageLocalIdx) => {
                const globalBatchIdx = globalBatchOffset + pageLocalIdx;
                return (
                  <div key={globalBatchIdx}>
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
                      Batch {globalBatchIdx + 1} — {batch.length} group
                      {batch.length > 1 ? "s" : ""}
                    </div>
                    <div className="space-y-4">
                      {batch.map((cluster, ci) => {
                        const key = clusterKey(cluster);
                        return (
                          <MergePanel
                            key={ci}
                            cluster={cluster}
                            decision={decisions[key] ?? "pending"}
                            ruleConfig={ruleConfig}
                            onApprove={(sg, overrides) =>
                              handleApprove(cluster, sg, overrides)
                            }
                            onReject={(sg) => handleReject(cluster, sg)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {allBatches.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center justify-between bg-white dark:bg-black shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Batches {(safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, allBatches.length)} of{" "}
                  {allBatches.length}
                </span>
                <span className="text-zinc-300 dark:text-zinc-700 text-xs">
                  |
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Per page
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="text-xs border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-blue-500"
                  >
                    {[1, 3, 5, 10, 20, 50].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Pagination
                currentPage={safePage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [appData, setAppData] = useState<AppData | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "0",
      text: "Upload a file and I'll help you analyze the duplicates.",
      sender: "ai",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const onDrop = async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    const file = acceptedFiles[0];
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target?.result as string);
        const records: Rec[] = Array.isArray(raw) ? raw : [raw];
        const clusters = getCandidateClusters(records);
        setAppData({
          records,
          clusters,
          batches: makeBatches(clusters),
          fileName: file.name,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            text: `Loaded ${records.length} records — found ${clusters.length} duplicate group(s). Configure field rules before approving, or use "Approve all 100%" to instantly merge high-confidence groups.`,
            sender: "ai",
          },
        ]);
      } catch {
        alert("Please upload a valid JSON file.");
      } finally {
        setUploading(false);
      }
    };
    reader.readAsText(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/json": [".json"] },
  });

  const handleSendMessage = async () => {
    const text = inputValue.trim();
    if (!text || aiLoading) return;
    setInputValue("");
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), text, sender: "user" },
    ]);
    setAiLoading(true);
    try {
      const reply = await callClaude(text, appData);
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), text: reply, sender: "ai" },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: "Error reaching AI. Check your network.",
          sender: "ai",
        },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="flex flex-1 h-[calc(100vh-64px)] bg-white dark:bg-black">
      <div className="sticky top-0 left-0 max-h-screen w-64 border-r border-zinc-200 dark:border-zinc-800 p-6 flex flex-col gap-6 overflow-y-auto">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Upload Files
          </h3>
          <div
            {...getRootProps()}
            className={`flex flex-col items-center justify-center w-full p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${isDragActive ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500"}`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-8 h-8 text-zinc-400 dark:text-zinc-500 mb-2" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {uploading ? "Processing..." : "Click to upload"}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                JSON files only
              </p>
            </div>
          </div>
        </div>
        {appData && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
            <p className="font-medium text-zinc-700 dark:text-zinc-300 truncate">
              {appData.fileName}
            </p>
            <p>{appData.records.length} records</p>
            <p>{appData.clusters.length} duplicate groups</p>
          </div>
        )}
        <div className="text-xs text-zinc-400 dark:text-zinc-600 space-y-1 border-t border-zinc-200 dark:border-zinc-800 pt-4">
          <p className="font-medium text-zinc-500 dark:text-zinc-500">
            Exports (from Audit Log)
          </p>
          <p>· merged_clients.json</p>
          <p>· duplicates_removed.json</p>
          <p>· audit_log.json</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-zinc-200 dark:border-zinc-800 p-6 shrink-0">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Duplicate Detection System
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1 text-sm">
            Configure rules · score confidence · review & merge
          </p>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          {appData ? (
            <BatchOutput appData={appData} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-4">📁</div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  No files uploaded yet
                </h2>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Upload a JSON file from the sidebar to get started
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-h-screen sticky top-0 right-0 w-80 border-l border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 dark:border-zinc-800 p-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            AI Assistant
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Ask questions about your data
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-xs px-4 py-2 rounded-xl text-sm ${msg.sender === "user" ? "bg-blue-600 text-white rounded-br-none" : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 rounded-bl-none border border-zinc-200 dark:border-zinc-700"}`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {aiLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl rounded-bl-none px-4 py-2">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Ask a question..."
              disabled={aiLoading}
              className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <button
              onClick={handleSendMessage}
              disabled={aiLoading}
              className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}