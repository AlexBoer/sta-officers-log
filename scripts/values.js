import {
  MODULE_ID,
  VALUE_ICON_COUNT,
  valueIconPath,
  STA_DEFAULT_ICON_FALLBACK,
  STA_DEFAULT_ICON_LEGACY,
  getStaDefaultIcon,
} from "./constants.js";
import { t, tf } from "./i18n.js";
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
    (s) => s !== "unused"
  );
  if (!arr.includes(next)) arr.push(next);
  return arr.length ? arr : [next];
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
    const newImg = valueIconPath(n);
    return { _id: item.id, img: newImg };
  });

  await actor.updateEmbeddedDocuments("Item", updates);

  // Sync mission log icons to their Primary Value.
  // Rule: log primaryValueId -> copy Value.img; if missing/invalid -> default icon.
  const logs = actor.items.filter((i) => i.type === "log");
  const logUpdates = [];

  for (const log of logs) {
    const primaryValueId = String(
      log.getFlag?.(MODULE_ID, "primaryValueId") ?? ""
    );

    if (primaryValueId && isDirectiveValueId(primaryValueId)) {
      const desiredImg = directiveIconPath();
      if (desiredImg && String(log.img ?? "") !== desiredImg) {
        logUpdates.push({ _id: log.id, img: desiredImg });
      }
      continue;
    }

    const valueItem = primaryValueId ? actor.items.get(primaryValueId) : null;
    const desiredImg =
      valueItem?.type === "value" && valueItem?.img
        ? String(valueItem.img)
        : getStaDefaultIcon();

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
    })
  );
}
