/**
 * Trauma Values & Log Trauma Flags
 *
 * Core trauma-related data functions: checking/setting the trauma flag on values,
 * tracking cumulative positive uses per mission, and remembering whether a log
 * was created while its primary value was a trauma.
 */

import { MODULE_ID } from "../../core/constants.js";
import { getValueItems } from "../values.js";

// ─────────────────────────────────────────────────────────────────────────────
// Trauma Values
// ─────────────────────────────────────────────────────────────────────────────

const TRAUMA_FLAG = "isTrauma";

// Flag to track cumulative positive uses of a Trauma value within the current mission.
// Each positive use increases stress by the cumulative count (1st use = 1, 2nd use = 2, etc.)
const TRAUMA_POSITIVE_USE_COUNT_FLAG = "traumaPositiveUseCount";

export function isValueTrauma(item) {
  if (!item || item.type !== "value") return false;
  try {
    return Boolean(item.getFlag?.(MODULE_ID, TRAUMA_FLAG));
  } catch (_) {
    return false;
  }
}

export async function setValueTraumaFlag(item, value) {
  if (!item || item.type !== "value") return;
  await item.setFlag(MODULE_ID, TRAUMA_FLAG, Boolean(value));
}

/**
 * Gets the number of times this Trauma value has been used positively this mission.
 * @param {Item} item - The value item
 * @returns {number} The cumulative positive use count (0 if not used yet)
 */
export function getTraumaPositiveUseCount(item) {
  if (!item || item.type !== "value") return 0;
  try {
    const count = item.getFlag?.(MODULE_ID, TRAUMA_POSITIVE_USE_COUNT_FLAG);
    const n = Number(count ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Increments the positive use count for a Trauma value and returns the new stress amount.
 * Call this BEFORE applying stress to get the correct cumulative amount.
 * @param {Item} item - The value item (must be a trauma)
 * @returns {Promise<number>} The stress amount to apply (cumulative count after increment)
 */
export async function incrementTraumaPositiveUseCount(item) {
  if (!item || item.type !== "value") return 1;
  try {
    const current = getTraumaPositiveUseCount(item);
    const newCount = current + 1;
    await item.setFlag(MODULE_ID, TRAUMA_POSITIVE_USE_COUNT_FLAG, newCount);
    return newCount;
  } catch (_) {
    return 1;
  }
}

/**
 * Resets the positive use count for a Trauma value (called at mission start).
 * @param {Item} item - The value item
 */
export async function resetTraumaPositiveUseCount(item) {
  if (!item || item.type !== "value") return;
  try {
    await item.unsetFlag(MODULE_ID, TRAUMA_POSITIVE_USE_COUNT_FLAG);
  } catch (_) {
    // ignore
  }
}

/**
 * Resets the positive use count for all Trauma values on all characters.
 * Call this at the start of a new mission.
 */
export async function resetAllTraumaPositiveUseCounts() {
  const resetPromises = [];
  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;
    const values = getValueItems(actor);
    for (const item of values) {
      if (isValueTrauma(item)) {
        resetPromises.push(resetTraumaPositiveUseCount(item));
      }
    }
  }
  await Promise.allSettled(resetPromises);
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Trauma Flag
// ─────────────────────────────────────────────────────────────────────────────

// Flag on log items to remember whether they were created while their primary value was a trauma.
// This ensures logs keep their V# or T# icon prefix even when the value's trauma status changes.
const LOG_CREATED_WITH_TRAUMA_FLAG = "createdWithTrauma";

export function wasLogCreatedWithTrauma(log) {
  if (!log || log.type !== "log") return false;
  try {
    return Boolean(log.getFlag?.(MODULE_ID, LOG_CREATED_WITH_TRAUMA_FLAG));
  } catch (_) {
    return false;
  }
}

export async function setLogCreatedWithTraumaFlag(log, value) {
  if (!log || log.type !== "log") return;
  await log.setFlag(MODULE_ID, LOG_CREATED_WITH_TRAUMA_FLAG, Boolean(value));
}
