// Shared callback-target eligibility helpers.
// Intentionally small: this is used by both the callback prompt UI and manual log-link controls.

/**
 * Returns whether a target log can be associated with a given value for callback-chain purposes.
 *
 * Rules:
 * - If no value is selected, do not restrict.
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

  if (isCompletedArcEnd === true) return true;

  const targetPrimary = targetPrimaryValueId
    ? String(targetPrimaryValueId)
    : "";
  if (!targetPrimary) return true;

  return targetPrimary === vId;
}
