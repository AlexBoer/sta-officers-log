// Shared callback-target eligibility helpers.
// this is used by both the callback prompt UI and manual log-link controls.

import { isNoValueUsedId } from "./directives.js";

/**
 * Returns whether a target log can be associated with a given value for a callback.
 *
 * Rules:
 * - If no value is selected, do not restrict.
 * - "No Value Used" logs cannot form callback chains.
 * - Always allow completed arc-end logs (they are valid chain boundaries).
 * - If the target log has no known primary value, do not restrict.
 * - Otherwise, the target primary value must match the selected value.
 */
export function isCallbackTargetCompatibleWithValue({
  valueId,
  targetPrimaryValueId,
  isCompletedArcEnd = false,
} = {}) {
  const vId = valueId ? String(valueId) : "";
  if (!vId) return true;

  // "No Value Used" logs cannot form callback chains.
  if (isNoValueUsedId(vId)) return false;

  if (isCompletedArcEnd === true) return true;

  const targetPrimary = targetPrimaryValueId
    ? String(targetPrimaryValueId)
    : "";
  if (!targetPrimary) return true;

  // "No Value Used" targets cannot be part of a callback chain.
  if (isNoValueUsedId(targetPrimary)) return false;

  return targetPrimary === vId;
}
