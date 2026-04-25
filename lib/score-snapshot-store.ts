/**
 * BTLR Score Snapshot Store
 * Patent Pending — Proprietary
 *
 * Persists score snapshots for trend tracking, audit, and regression detection.
 * Works in three layers:
 *   1. In-memory ring buffer (always active — no I/O cost)
 *   2. localStorage (browser sessions — survives page refresh)
 *   3. Supabase (optional — for cross-device history and analytics)
 *
 * The store is write-only from scoring. Reads are for audit/debug.
 * Score computation is NEVER blocked by store failures.
 */

import type { ScoreSnapshot } from "./score-audit";

// ─────────────────────────────────────────────────────────────────
// IN-MEMORY RING BUFFER
// Holds the last 50 snapshots per session — zero persistence cost
// ─────────────────────────────────────────────────────────────────
const MAX_MEMORY_SNAPSHOTS = 50;
const _memoryStore: ScoreSnapshot[] = [];

function pushToMemory(snapshot: ScoreSnapshot): void {
  _memoryStore.push(snapshot);
  if (_memoryStore.length > MAX_MEMORY_SNAPSHOTS) {
    _memoryStore.shift(); // evict oldest
  }
}

/** Returns all in-memory snapshots (newest last) */
export function getMemorySnapshots(): readonly ScoreSnapshot[] {
  return [..._memoryStore];
}

/** Returns the most recent snapshot for a given property */
export function getLatestSnapshot(propertyId: string | number): ScoreSnapshot | null {
  for (let i = _memoryStore.length - 1; i >= 0; i--) {
    if (_memoryStore[i].property_id === propertyId) return _memoryStore[i];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// LOCALSTORAGE LAYER
// Persists the last 20 snapshots per property across page refreshes
// ─────────────────────────────────────────────────────────────────
const LS_KEY = "btlr_score_snapshots";
const MAX_LS_SNAPSHOTS = 20;

function readFromLocalStorage(): ScoreSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScoreSnapshot[];
  } catch {
    return [];
  }
}

function writeToLocalStorage(snapshots: ScoreSnapshot[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snapshots));
  } catch {
    // localStorage full — silently ignore, never block scoring
  }
}

function pushToLocalStorage(snapshot: ScoreSnapshot): void {
  const existing = readFromLocalStorage();
  existing.push(snapshot);
  // Keep only last MAX_LS_SNAPSHOTS per property to avoid unbounded growth
  const propertyId = snapshot.property_id;
  const forThisProp = existing.filter(s => s.property_id === propertyId);
  const forOther    = existing.filter(s => s.property_id !== propertyId);
  const trimmed = [...forOther, ...forThisProp.slice(-MAX_LS_SNAPSHOTS)];
  writeToLocalStorage(trimmed);
}

/** Returns stored snapshots for a property from localStorage */
export function getStoredSnapshots(propertyId: string | number): ScoreSnapshot[] {
  return readFromLocalStorage().filter(s => s.property_id === propertyId);
}

// ─────────────────────────────────────────────────────────────────
// SUPABASE LAYER (optional, non-blocking)
// Async fire-and-forget — scoring never waits for DB writes
// Table: score_snapshots (created by SUPABASE_SCORE_HISTORY.sql)
// ─────────────────────────────────────────────────────────────────
let _supabaseClient: { from: Function } | null = null;

export function configureSupabaseStore(client: { from: Function }): void {
  _supabaseClient = client;
}

async function pushToSupabase(snapshot: ScoreSnapshot): Promise<void> {
  if (!_supabaseClient) return;
  try {
    const { error } = await (_supabaseClient.from("score_snapshots") as {
      insert: (data: object) => Promise<{ error: { message: string } | null }>
    }).insert({
      snapshot_id:     snapshot.snapshot_id,
      property_id:     snapshot.property_id,
      computed_at:     snapshot.computed_at,
      engine_version:  snapshot.engine_version,
      input_hash:      snapshot.input_hash,
      input_item_count: snapshot.input_item_count,
      final_score:     snapshot.final_score,
      score_band:      snapshot.score_band,
      readiness_score: snapshot.readiness_score,
      safety_score:    snapshot.safety_score,
      maintenance_score: snapshot.maintenance_score,
      confidence_score: snapshot.confidence_score,
      data_completeness: snapshot.data_completeness,
      score_narrative: snapshot.score_narrative,
      // Store full audit detail as JSONB
      normalized_inputs: snapshot.normalized_inputs,
      deductions:        snapshot.deductions,
      resolved_items:    snapshot.resolved_items,
      category_scores:   snapshot.category_scores,
      flags_active:      snapshot.flags_active,
    });
    if (error) {
      console.warn("[score-snapshot-store] Supabase write failed (non-fatal):", error.message);
    }
  } catch (err) {
    console.warn("[score-snapshot-store] Supabase write threw (non-fatal):", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// MAIN WRITE ENTRY POINT
// ─────────────────────────────────────────────────────────────────
/**
 * Persists a score snapshot to all configured stores.
 * NEVER throws — all errors are caught so scoring is never blocked.
 */
export function persistSnapshot(snapshot: ScoreSnapshot): void {
  try {
    pushToMemory(snapshot);
    pushToLocalStorage(snapshot);
    // Fire-and-forget to Supabase — don't await
    pushToSupabase(snapshot).catch(() => {
      // silently ignore — Supabase is optional
    });
  } catch (err) {
    // Absolute last resort — log and continue
    console.warn("[score-snapshot-store] persistSnapshot error (non-fatal):", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// REGRESSION DETECTOR
// Compares the current snapshot against the previous one for the
// same property and flags if the score changed unexpectedly.
// ─────────────────────────────────────────────────────────────────
export interface RegressionResult {
  detected: boolean;
  previous_score?: number;
  current_score: number;
  delta: number;
  same_inputs: boolean;
  message: string;
}

const REGRESSION_THRESHOLD = 2; // flag if score changed by >2 points with same inputs

export function checkForRegression(snapshot: ScoreSnapshot): RegressionResult {
  const previous = getLatestSnapshot(snapshot.property_id);
  if (!previous || previous.snapshot_id === snapshot.snapshot_id) {
    return {
      detected: false,
      current_score: snapshot.final_score,
      delta: 0,
      same_inputs: false,
      message: "No previous snapshot to compare",
    };
  }

  const delta = Math.abs(snapshot.final_score - previous.final_score);
  const sameInputs = snapshot.input_hash === previous.input_hash;

  // Regression = same inputs but different score (indicates a scoring logic change)
  const detected = sameInputs && delta > REGRESSION_THRESHOLD;

  return {
    detected,
    previous_score: previous.final_score,
    current_score: snapshot.final_score,
    delta,
    same_inputs: sameInputs,
    message: detected
      ? `⚠️ REGRESSION: Same inputs produced score ${previous.final_score} → ${snapshot.final_score} (delta ${delta}). Engine version: ${previous.engine_version} → ${snapshot.engine_version}`
      : sameInputs
      ? `Score unchanged for same inputs: ${snapshot.final_score} ✓`
      : `Score changed: ${previous.final_score} → ${snapshot.final_score} (inputs also changed — expected)`,
  };
}
