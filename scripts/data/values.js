import {
  MODULE_ID,
  VALUE_ICON_COUNT,
  valueIconPath,
  traumaIconPath,
  STA_DEFAULT_ICON_FALLBACK,
  STA_DEFAULT_ICON_LEGACY,
  getStaDefaultIcon,
} from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import { syncAllMilestoneIconsOnActor } from "./milestoneIcons.js";
import { directiveIconPath, isDirectiveValueId } from "./directives.js";

// Kept for backward compatibility with older code paths.
// Prefer using getStaDefaultIcon() when setting new icons.
export const STA_DEFAULT_ICON = STA_DEFAULT_ICON_FALLBACK;

export { getStaDefaultIcon };

function _isDefaultOrBlankImg(img) {
  const s = String(img ?? "");
  const cur = getStaDefaultIcon();
  return (
    !s ||
    s === cur ||
    s === STA_DEFAULT_ICON_FALLBACK ||
    s === STA_DEFAULT_ICON_LEGACY ||
    s === "icons/svg/item-bag.svg"
  );
}

export function escapeHTML(s) {
  return foundry.utils.escapeHTML(String(s ?? ""));
}

export function getValueItems(actor) {
  // STA commonly uses type "value"
  const values = actor.items.filter((i) => i.type === "value");
  return values;
}

// STA v2.4.6 stores log.system.valueStates[valueId] as an array of strings.
// Older versions stored a single string.
export function normalizeValueStateArray(raw) {
  if (Array.isArray(raw)) return raw.map((v) => String(v)).filter(Boolean);
  if (typeof raw === "string") {
    const s = raw.trim();
    return s ? [s] : [];
  }
  return [];
}

export function getValueStateArray(logOrSystem, valueId) {
  const system = logOrSystem?.system ? logOrSystem.system : logOrSystem;
  const states = system?.valueStates ?? {};
  const raw = states?.[String(valueId)];
  const arr = normalizeValueStateArray(raw);
  return arr.length ? arr : ["unused"];
}

export function isValueInvokedState(state) {
  return state === "positive" || state === "negative" || state === "challenged";
}

export function mergeValueStateArray(existingRaw, stateToAdd) {
  const next = String(stateToAdd ?? "").trim();
  if (!next || next === "unused") return ["unused"];

  const arr = normalizeValueStateArray(existingRaw).filter(
    (s) => s !== "unused",
  );
  if (!arr.includes(next)) arr.push(next);
  return arr.length ? arr : [next];
}

// ─────────────────────────────────────────────────────────────────────────────
// Value Challenged State (merged from valueChallenged.js)
// ─────────────────────────────────────────────────────────────────────────────

export async function setValueChallenged(valueItem, challenged) {
  if (!valueItem) return;
  const sys = valueItem.system ?? {};

  if (Object.prototype.hasOwnProperty.call(sys, "challenged")) {
    await valueItem.update({ "system.challenged": Boolean(challenged) });
    return;
  }

  // Some STA sheets appear to implement this as a strike-through toggle.
  if (Object.prototype.hasOwnProperty.call(sys, "used")) {
    await valueItem.update({ "system.used": Boolean(challenged) });
    return;
  }

  // Fallback: store a module flag so the state isn't lost.
  await valueItem.setFlag(MODULE_ID, "challenged", Boolean(challenged));
}

export function isValueChallenged(valueItem) {
  if (!valueItem) return false;

  const sys = valueItem.system ?? {};
  if (Boolean(sys.challenged)) return true;

  // Some STA sheets represent "challenged" via the strike-through toggle.
  if (Boolean(sys.used)) return true;

  // Fallback flag used by this module.
  try {
    return Boolean(valueItem.getFlag?.(MODULE_ID, "challenged"));
  } catch (_err) {
    return false;
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Icon Path Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the appropriate icon path for a log based on its createdWithTrauma flag
 * and the value's current sort position. The NUMBER comes from the value's position,
 * but the LETTER (V or T) is determined by the log's createdWithTrauma flag.
 *
 * @param {Actor} actor - The actor that owns the log and value
 * @param {string} valueId - The ID of the primary value
 * @param {boolean} createdWithTrauma - Whether the log was created while the value was a trauma
 * @returns {string|null} The icon path (V#.webp or T#.webp) or null if not determinable
 */
export function getLogIconPathForValue(actor, valueId, createdWithTrauma) {
  const id = valueId ? String(valueId) : "";
  if (!id || !actor?.items) return null;

  // Directives are not affected by trauma status
  if (isDirectiveValueId(id)) return directiveIconPath();

  // Find the value's current position in the sorted list
  const values = getValueItems(actor);
  const sorted = values
    .slice()
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));

  const idx = sorted.findIndex((v) => String(v.id) === id);
  if (idx < 0) return null;

  const n = Math.min(idx + 1, VALUE_ICON_COUNT);
  return createdWithTrauma ? traumaIconPath(n) : valueIconPath(n);
}

const _valueIconMapCache = new WeakMap();

function _getValueIconMapForActor(actor) {
  if (!actor?.items) return null;

  const values = getValueItems(actor);

  // Keep signature creation cheap: Values are typically a small set (V1..V8).
  // We only need to rebuild the sorted mapping when ids/sort order changes.
  const signature = values
    .map((v) => `${String(v.id)}:${Number(v.sort ?? 0)}`)
    .join("|");

  const cached = _valueIconMapCache.get(actor);
  if (cached?.signature === signature) return cached.mapById;

  const sorted = values
    .slice()
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));

  const mapById = new Map();
  for (let idx = 0; idx < sorted.length; idx++) {
    const v = sorted[idx];
    const n = Math.min(idx + 1, VALUE_ICON_COUNT);
    mapById.set(String(v.id), valueIconPath(n));
  }

  _valueIconMapCache.set(actor, { signature, mapById });
  return mapById;
}

export function getValueIconPathForValueId(actor, valueId) {
  // Map a valueId to V1..V8 based on the actor's sorted Value order.
  const id = valueId ? String(valueId) : "";
  if (!id) return null;

  // Directives are value-like ids but not actor Items.
  if (isDirectiveValueId(id)) return directiveIconPath();

  const mapById = _getValueIconMapForActor(actor);
  if (!mapById) return null;

  return mapById.get(id) ?? null;
}

export async function labelValuesOnActor(actor) {
  const values = getValueItems(actor)
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (!values.length)
    return ui.notifications.warn(t("sta-officers-log.notifications.noValues"));

  const updates = values.map((item, idx) => {
    const n = Math.min(idx + 1, VALUE_ICON_COUNT); // V1..V8 by sort order
    const newImg = isValueTrauma(item) ? traumaIconPath(n) : valueIconPath(n);
    return { _id: item.id, img: newImg };
  });

  await actor.updateEmbeddedDocuments("Item", updates);

  // Sync mission log icons to their Primary Value.
  // Rule: Use the log's createdWithTrauma flag to determine V# or T# prefix,
  // but update the NUMBER to match the value's current position in the list.
  const logs = actor.items.filter((i) => i.type === "log");
  const logUpdates = [];

  for (const log of logs) {
    const primaryValueId = String(
      log.getFlag?.(MODULE_ID, "primaryValueId") ?? "",
    );

    if (primaryValueId && isDirectiveValueId(primaryValueId)) {
      const desiredImg = directiveIconPath();
      if (desiredImg && String(log.img ?? "") !== desiredImg) {
        logUpdates.push({ _id: log.id, img: desiredImg });
      }
      continue;
    }

    if (!primaryValueId) {
      // No primary value - use default icon
      const desiredImg = getStaDefaultIcon();
      if (desiredImg && String(log.img ?? "") !== desiredImg) {
        logUpdates.push({ _id: log.id, img: desiredImg });
      }
      continue;
    }

    const valueItem = actor.items.get(primaryValueId);
    if (!valueItem || valueItem.type !== "value") {
      // Primary value no longer exists - use default icon
      const desiredImg = getStaDefaultIcon();
      if (desiredImg && String(log.img ?? "") !== desiredImg) {
        logUpdates.push({ _id: log.id, img: desiredImg });
      }
      continue;
    }

    // Use the log's createdWithTrauma flag to determine V# or T# prefix,
    // but the NUMBER comes from the value's current position.
    const createdWithTrauma = wasLogCreatedWithTrauma(log);
    const desiredImg = getLogIconPathForValue(
      actor,
      primaryValueId,
      createdWithTrauma,
    );

    if (desiredImg && String(log.img ?? "") !== desiredImg) {
      logUpdates.push({ _id: log.id, img: desiredImg });
    }
  }

  if (logUpdates.length) {
    await actor.updateEmbeddedDocuments("Item", logUpdates);
  }

  // Keep Milestone icons aligned with their associated/source logs.
  // This matters after value relabeling since logs may have updated icons.
  try {
    await syncAllMilestoneIconsOnActor(actor);
  } catch (_) {
    // ignore
  }

  ui.notifications.info(
    tf("sta-officers-log.notifications.labeledValues", {
      count: updates.length,
      actor: actor.name,
    }),
  );
}
