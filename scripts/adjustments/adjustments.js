import {
  isValueInvokedState,
  normalizeValueStateArray,
} from "../values/values.js";
import {
  isDirectiveValueId,
  isNoValueUsedId,
} from "../directives/directives.js";
import { getAllowSavingAdjustments } from "./adjustmentSettings.js";

export const ADJUSTMENT_PENDING = "pending";
export const ADJUSTMENT_APPLYING = "applying";
export const ADJUSTMENT_APPLIED = "applied";
export const ADJUSTMENT_DECLINED = "declined";
export const ADJUSTMENT_EXPIRED = "expired";

function getAdjustmentStatus(logItem) {
  return String(logItem?.system?.adjustmentStatus ?? "");
}

function getLogAdjustmentState(logItem) {
  return {
    showAdjustmentButton:
      logItem?.system?.showAdjustmentButton === true,
    adjustmentStatus: getAdjustmentStatus(logItem),
  };
}

function logHasAnyUsedValue(logItem) {
  const valueStates = logItem?.system?.valueStates ?? {};
  return Object.entries(valueStates).some(([valueId, rawState]) => {
    if (isDirectiveValueId(valueId) || isNoValueUsedId(valueId)) return false;
    return normalizeValueStateArray(rawState).some(isValueInvokedState);
  });
}

export function hasEligibleAdjustment(logItem) {
  return (
    logItem?.type === "log" &&
    getAdjustmentStatus(logItem) === ADJUSTMENT_PENDING &&
    logItem.system?.showAdjustmentButton === true &&
    logHasAnyUsedValue(logItem)
  );
}

// A log still in progress will become eligible when its mission ends.
export function hasUpcomingAdjustment(logItem) {
  const status = getAdjustmentStatus(logItem);
  return (
    logItem?.type === "log" &&
    (status === "" || status === ADJUSTMENT_PENDING) &&
    logHasAnyUsedValue(logItem)
  );
}

export function captureAdjustmentStates(actors, currentLogIds = {}) {
  const snapshots = [];
  for (const actor of actors ?? []) {
    if (actor?.type !== "character") continue;
    const currentLogId = String(currentLogIds[actor.id] ?? "");
    for (const logItem of actor.items ?? []) {
      if (logItem.type !== "log") continue;
      if (
        getAdjustmentStatus(logItem) !== ADJUSTMENT_PENDING &&
        getAdjustmentStatus(logItem) !== ADJUSTMENT_APPLYING &&
        logItem.id !== currentLogId
      ) {
        continue;
      }
      snapshots.push({
        actorId: actor.id,
        logId: logItem.id,
        ...getLogAdjustmentState(logItem),
      });
    }
  }
  return snapshots;
}

export async function finalizeAdjustmentOffers(actors, currentLogIds = {}) {
  const actorList = Array.from(actors ?? []).filter(
    (actor) => actor?.type === "character",
  );

  if (!getAllowSavingAdjustments()) {
    for (const actor of actorList) {
      for (const logItem of actor.items ?? []) {
        if (
          logItem.type === "log" &&
          (getAdjustmentStatus(logItem) === ADJUSTMENT_PENDING ||
            getAdjustmentStatus(logItem) === ADJUSTMENT_APPLYING)
        ) {
          await logItem.update({
            "system.showAdjustmentButton": false,
            "system.adjustmentStatus": ADJUSTMENT_EXPIRED,
          });
        }
      }
    }
  }

  for (const actor of actorList) {
    const logId = String(currentLogIds[actor.id] ?? "");
    const logItem = logId ? actor.items.get(logId) : null;
    if (!logItem || logItem.type !== "log") continue;
    if (!logHasAnyUsedValue(logItem)) continue;

    const status = getAdjustmentStatus(logItem);
    if (
      status === ADJUSTMENT_APPLIED ||
      status === ADJUSTMENT_DECLINED
    ) {
      continue;
    }
    await logItem.update({
      "system.showAdjustmentButton": true,
      "system.adjustmentStatus": ADJUSTMENT_PENDING,
    });
  }
}

export async function restoreAdjustmentStates(snapshots) {
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const actor = game.actors?.get?.(String(snapshot?.actorId ?? ""));
    const logItem = actor?.items?.get?.(String(snapshot?.logId ?? ""));
    if (!logItem || logItem.type !== "log") continue;
    const currentStatus = getAdjustmentStatus(logItem);
    if (
      currentStatus === ADJUSTMENT_APPLIED ||
      currentStatus === ADJUSTMENT_DECLINED ||
      currentStatus === ADJUSTMENT_APPLYING
    ) {
      continue;
    }
    await logItem.update({
      "system.showAdjustmentButton":
        snapshot.showAdjustmentButton === true,
      "system.adjustmentStatus": String(snapshot.adjustmentStatus ?? ""),
    });
  }
}

export async function completeAdjustment(logItem, status) {
  if (status !== ADJUSTMENT_DECLINED) {
    throw new Error("Unsupported completed adjustment status.");
  }
  await reserveAdjustment(logItem);
  try {
    await logItem.update({
      "system.showAdjustmentButton": false,
      "system.adjustmentStatus": status,
    });
  } catch (error) {
    await releaseAdjustment(logItem);
    throw error;
  }
}

export async function reserveAdjustment(logItem) {
  if (!hasEligibleAdjustment(logItem)) {
    throw new Error("This adjustment offer is no longer available.");
  }
  await logItem.update({
    "system.showAdjustmentButton": false,
    "system.adjustmentStatus": ADJUSTMENT_APPLYING,
  });
}

export async function releaseAdjustment(logItem) {
  if (
    !logItem ||
    logItem.type !== "log" ||
    getAdjustmentStatus(logItem) !== ADJUSTMENT_APPLYING
  ) {
    return;
  }
  await logItem.update({
    "system.showAdjustmentButton": true,
    "system.adjustmentStatus": ADJUSTMENT_PENDING,
  });
}
