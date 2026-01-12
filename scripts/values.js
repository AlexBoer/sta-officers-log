import { MODULE_ID, VALUE_ICON_COUNT, valueIconPath } from "./constants.js";
import { t, tf } from "./i18n.js";

export const STA_DEFAULT_ICON =
  "systems/sta/assets/icons/VoyagerCombadgeIcon.png";

function _isDefaultOrBlankImg(img) {
  const s = String(img ?? "");
  return !s || s === STA_DEFAULT_ICON;
}

export function escapeHTML(s) {
  return foundry.utils.escapeHTML(String(s ?? ""));
}

export function getValueItems(actor) {
  // STA commonly uses type "value"
  const values = actor.items.filter((i) => i.type === "value");
  return values;
}

export function getValueIconPathForValueId(actor, valueId) {
  // Map a valueId to V1..V8 based on the actor's sorted Value order
  const values = getValueItems(actor)
    .slice()
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));

  const idx = values.findIndex((v) => v.id === valueId);
  if (idx === -1) return null;

  const n = Math.min(idx + 1, VALUE_ICON_COUNT);
  return valueIconPath(n);
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

    const valueItem = primaryValueId ? actor.items.get(primaryValueId) : null;
    const desiredImg =
      valueItem?.type === "value" && valueItem?.img
        ? String(valueItem.img)
        : STA_DEFAULT_ICON;

    if (desiredImg && String(log.img ?? "") !== desiredImg) {
      logUpdates.push({ _id: log.id, img: desiredImg });
    }
  }

  if (logUpdates.length) {
    await actor.updateEmbeddedDocuments("Item", logUpdates);
  }

  ui.notifications.info(
    tf("sta-officers-log.notifications.labeledValues", {
      count: updates.length,
      actor: actor.name,
    })
  );
}

export function testValueIconPath(actor, valueId) {
  const path = getValueIconPathForValueId(actor, valueId);
  console.log(
    "sta-officers-log | value icon path",
    valueId,
    path ?? "(not set)"
  );
  return path;
}
