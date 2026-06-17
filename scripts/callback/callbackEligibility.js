// Shared callback-target eligibility helpers.
// this is used by both the callback prompt UI and manual log-link controls.

import { isNoValueUsedId } from "../directives/directives.js";
import { MODULE_ID } from "../core/constants.js";
import {
  getValueItems,
  getValueStateArray,
  isValueInvokedState,
} from "../values/values.js";
import { isLogUsed } from "../missions/mission.js";
import {
  getCompletedArcEndLogIds,
  getPrimaryValueIdForLog,
} from "../log/logMetadata.js";

/**
 * Returns whether a target log can be associated with a given value for a callback.
 *
 * Rules:
 * - If no value is selected, do not restrict.
 * - "No Value Used" logs cannot form callback chains.
 * - Arc-completing logs cannot be callback targets (see isCompletedArcEnd — callers must
 *   exclude these before this function is reached; the parameter is retained for compatibility).
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

  // Arc-completing logs are excluded at the call sites before reaching here.
  void isCompletedArcEnd;

  const targetPrimary = targetPrimaryValueId
    ? String(targetPrimaryValueId)
    : "";
  if (!targetPrimary) return true;

  // "No Value Used" targets cannot be part of a callback chain.
  if (isNoValueUsedId(targetPrimary)) return false;

  return targetPrimary === vId;
}

/**
 * Returns true if this specific log is unconditionally ineligible as a callback
 * target — regardless of which value is being used.
 *
 * Conditions:
 *  1. The log completes an arc (arc-end logs are consumed and cannot be re-used).
 *  2. The log is already marked "used" (native Foundry used flag).
 *  3. The log is already pointed to by another log's callback link.
 *
 * Value-dependent incompatibility (primary value mismatch) is NOT checked here
 * because that depends on context.
 */
export function isLogUnconditionallyIneligibleAsCallbackTarget(actor, log) {
  try {
    if (!actor || !log) return false;
    const logId = String(log.id ?? "");
    if (!logId) return false;

    // 1. Arc-end logs.
    const completedArcEndLogIds = getCompletedArcEndLogIds(actor);
    if (completedArcEndLogIds.has(logId)) return true;

    // 2. Native "used" flag.
    if (isLogUsed(log)) return true;

    // 3. Already a callback target (another log points to it).
    for (const item of actor.items ?? []) {
      if (item?.type !== "log") continue;
      if (
        item.system?.callbackLinkDisabled === true ||
        item.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true
      )
        continue;
      const link =
        item.system?.callbackLink ??
        item.getFlag?.(MODULE_ID, "callbackLink") ??
        {};
      if (String(link?.fromLogId ?? "") === logId) return true;
    }

    return false;
  } catch (err) {
    console.warn(
      `${MODULE_ID} | isLogUnconditionallyIneligibleAsCallbackTarget: unexpected error`,
      err,
    );
    return false;
  }
}

export function hasEligibleCallbackTargetForValueId(
  actor,
  currentMissionLogId,
  valueId,
) {
  try {
    if (!actor || actor.type !== "character") return false;

    const vId = valueId ? String(valueId) : "";
    if (!vId) return false;

    // If we can't resolve the mission log id, preserve previous behavior (allow prompting).
    // This avoids false negatives when the mission context isn't set.
    const missionLogId = currentMissionLogId ? String(currentMissionLogId) : "";
    if (!missionLogId) return true;

    // Logs that are already used as a callback target (someone points to them) are not eligible.
    const callbackTargetIds = new Set();
    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      if (
        log.system?.callbackLinkDisabled === true ||
        log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true
      )
        continue;
      const link =
        log.system?.callbackLink ??
        log.getFlag?.(MODULE_ID, "callbackLink") ??
        {};
      const fromLogId = String(link?.fromLogId ?? "");
      if (fromLogId) callbackTargetIds.add(fromLogId);
    }

    const completedArcEndLogIds = getCompletedArcEndLogIds(actor);
    const valueItems = getValueItems(actor);

    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      const logId = String(log.id ?? "");
      if (!logId) continue;
      if (logId === missionLogId) continue;
      if (callbackTargetIds.has(logId)) continue;
      if (isLogUsed(log)) continue;

      // Arc-completing logs cannot be callback targets.
      if (completedArcEndLogIds.has(logId)) continue;

      const stateArray = getValueStateArray(log, vId);
      const invokedStates = stateArray.filter((s) => isValueInvokedState(s));
      if (invokedStates.length === 0) continue;

      const primary = getPrimaryValueIdForLog(actor, log, valueItems);
      const chainOk = isCallbackTargetCompatibleWithValue({
        valueId: vId,
        targetPrimaryValueId: primary,
        isCompletedArcEnd: completedArcEndLogIds.has(logId),
      });
      if (!chainOk) continue;

      return true;
    }

    return false;
  } catch (err) {
    // Preserve previous behavior (allow prompting) if this check fails unexpectedly.
    console.warn(
      `${MODULE_ID} | hasEligibleCallbackTargetForValueId: unexpected error`,
      err,
    );
    return true;
  }
}
