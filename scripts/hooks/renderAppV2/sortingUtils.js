/**
 * Shared utilities for sorting logs by creation time and custom sort order.
 * These functions are used in multiple places to maintain consistent sorting logic.
 */

import { MODULE_ID } from "../../core/constants.js";

/**
 * Extract the created time key from a log item for sorting purposes.
 * Uses custom date flag first if set, then falls back to actual creation time.
 * Combines creation time, custom sort order, and ID as tiebreakers.
 * @param {object} log - The log item
 * @returns {object} Object with createdKey, sortKey, and idKey for comparison
 */
export function getCreatedKey(log) {
  // Check for custom date first (stored as YYYY-MM-DD string)
  let createdKey = Number.MAX_SAFE_INTEGER;
  try {
    const customDate = log?.flags?.[MODULE_ID]?.customDate;
    if (customDate && typeof customDate === "string") {
      // Parse YYYY-MM-DD to timestamp (midnight UTC)
      const parsed = Date.parse(customDate + "T00:00:00Z");
      if (Number.isFinite(parsed)) {
        createdKey = parsed;
      }
    }
  } catch (_) {
    // ignore
  }

  // Fall back to actual creation time if no custom date
  if (createdKey === Number.MAX_SAFE_INTEGER) {
    const createdRaw =
      log?._stats?.createdTime ?? log?._source?._stats?.createdTime ?? null;
    const created = Number(createdRaw);
    if (Number.isFinite(created)) {
      createdKey = created;
    }
  }

  const sortRaw = Number(log?.sort ?? 0);
  const sortKey = Number.isFinite(sortRaw) ? sortRaw : 0;

  const idKey = String(log?.id ?? "");
  return { createdKey, sortKey, idKey };
}

/**
 * Compare two created-time keys for sorting.
 * Compares by creation time first, then sort order, then ID.
 * @param {object} a - First key object from getCreatedKey
 * @param {object} b - Second key object from getCreatedKey
 * @returns {number} Comparison result for sorting
 */
export function compareKeys(a, b) {
  if (a.createdKey !== b.createdKey) return a.createdKey - b.createdKey;
  if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
  return String(a.idKey).localeCompare(String(b.idKey));
}
