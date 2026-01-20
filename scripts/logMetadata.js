import {
  getValueItems,
  getValueStateArray,
  isValueInvokedState,
} from "./values.js";
import { MODULE_ID } from "./constants.js";
import { isLogUsed } from "./mission.js";
import { isCallbackTargetCompatibleWithValue } from "./callbackEligibility.js";

export function getMilestoneChildLogIds(milestone) {
  const system = milestone?.system ?? {};
  const childKeys = Object.keys(system).filter((k) => /^child[A-Z]$/.test(k));
  childKeys.sort();
  return childKeys
    .map((k) => String(system?.[k] ?? ""))
    .filter((v) => v && v !== "-");
}

export function getCompletedArcEndLogIds(actor, logItemsById = null) {
  const ends = new Set();

  try {
    const maybeById =
      logItemsById instanceof Map
        ? logItemsById
        : new Map(
            Array.from(actor?.items ?? [])
              .filter((i) => i?.type === "log")
              .map((l) => [String(l.id), l])
          );

    for (const log of maybeById.values()) {
      const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      if (arcInfo?.isArc === true) ends.add(String(log.id));
    }
  } catch (_) {
    // ignore
  }

  return ends;
}

export function getPrimaryValueIdForLog(actor, log, valueItems = null) {
  try {
    if (!actor || actor.type !== "character") return "";
    if (!log || log.type !== "log") return "";

    // 1) Explicit primary selection on the log sheet.
    const explicit = String(log.getFlag?.(MODULE_ID, "primaryValueId") ?? "");
    if (explicit) return explicit;

    // 2) Value used for the callback link (strong signal of chain value).
    const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
    const linkVal = link?.valueId ? String(link.valueId) : "";
    if (linkVal) return linkVal;

    // 3) Arc completion info (only present on the arc-ending log).
    const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
    const arcVal = arcInfo?.valueId ? String(arcInfo.valueId) : "";
    if (arcVal) return arcVal;
    
    // If we reach here, the log has no stable primary value recorded.
    void valueItems;
    void getValueItems;
    return "";
  } catch (_) {
    return "";
  }
}

export function hasEligibleCallbackTargetForValueId(
  actor,
  currentMissionLogId,
  valueId
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
