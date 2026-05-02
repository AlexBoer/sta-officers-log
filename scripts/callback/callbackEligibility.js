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
      if (log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true) continue;
      const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? {};
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
  } catch (_) {
    // Preserve previous behavior if this check fails unexpectedly.
    return true;
  }
}
