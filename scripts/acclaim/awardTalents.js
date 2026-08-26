/**
 * Award Talents
 *
 * Award-type talents (system.talenttype.typeenum === "award") found in
 * configured talent compendiums are the source of truth for the "Awards"
 * options offered in the Spend Acclaim dialog. A world setting stores which
 * of those talents the GM has enabled; only enabled talents are offered to
 * players, and choosing one copies the talent item directly onto the
 * character sheet instead of creating a freeform award entry.
 *
 * @module acclaim/awardTalents
 */

import { MODULE_ID } from "../core/constants.js";
import {
  getTalentPickerCustomCompendiumKeys,
  getTalentPickerIncludeBuiltinEnabled,
} from "../settings/pickerSettings.js";
import {
  TALENT_BASE_PACKS,
  SHIP_TALENT_BASE_PACKS,
  formatTalentRequirementLabel,
} from "../milestones/talentPickerDialog.js";

export const ENABLED_AWARD_TALENTS_SETTING = "enabledAwardTalentUuids";

export function registerAwardTalentSettings() {
  game.settings.register(MODULE_ID, ENABLED_AWARD_TALENTS_SETTING, {
    name: "Enabled Award Talents",
    hint: "UUIDs of Award-type talents enabled for the Spend Acclaim dialog.",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });
}

export function getEnabledAwardTalentUuids() {
  try {
    const raw =
      game.settings.get(MODULE_ID, ENABLED_AWARD_TALENTS_SETTING) ?? [];
    return Array.isArray(raw)
      ? raw.map((u) => String(u ?? "").trim()).filter(Boolean)
      : [];
  } catch (_) {
    return [];
  }
}

export async function setEnabledAwardTalentUuids(uuids) {
  const clean = Array.from(
    new Set(
      (Array.isArray(uuids) ? uuids : [])
        .map((u) => String(u ?? "").trim())
        .filter(Boolean),
    ),
  );
  await game.settings.set(MODULE_ID, ENABLED_AWARD_TALENTS_SETTING, clean);
  return clean;
}

function _awardCostFromItemData(itemData) {
  const raw = itemData?.flags?.[MODULE_ID]?.awardCost ?? {};
  const min = Number.isFinite(Number(raw?.min))
    ? Math.max(0, Number(raw.min))
    : 0;
  const hasMax = Number.isFinite(Number(raw?.max));
  const maxCandidate = hasMax ? Math.max(0, Number(raw.max)) : min;

  if (hasMax && maxCandidate < min) {
    console.warn(
      `${MODULE_ID} | Award talent "${itemData?.name ?? "Unknown"}" has a max cost (${maxCandidate}) lower than its min cost (${min}); treating max as ${min}.`,
    );
  }

  return { min, max: Math.max(min, maxCandidate) };
}

function _descriptionFromItemData(itemData) {
  const raw = itemData?.system?.description ?? "";
  if (typeof raw === "string") return raw;
  return String(raw?.value ?? "");
}

// formatTalentRequirementLabel() already prefixes structured requirements
// with their own category label (e.g. "Condition: ...") and falls back to
// the bare talent type ("Award") when no requirement is configured; strip
// the former to avoid a doubled label and treat the latter as "no condition".
function _formatAwardCondition(itemData) {
  const raw =
    formatTalentRequirementLabel(itemData?.system?.talenttype, itemData) ?? "";
  const stripped = raw.replace(/^condition:\s*/i, "").trim();
  if (!stripped || stripped.toLowerCase() === "award") return "";
  return stripped;
}

async function _collectAwardTalentPackKeys() {
  const keys = new Set();
  if (getTalentPickerIncludeBuiltinEnabled()) {
    for (const key of TALENT_BASE_PACKS) keys.add(key);
    for (const key of SHIP_TALENT_BASE_PACKS) keys.add(key);
  }
  for (const key of getTalentPickerCustomCompendiumKeys()) {
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

// Resolves a talent uuid to its award-entry shape, or null if it is missing,
// not a Talent item, or not typed as "award".
async function _resolveAwardTalentEntry(uuid) {
  let doc = null;
  try {
    doc = await fromUuid(uuid);
  } catch (_) {
    return null;
  }
  if (!doc || doc.documentName !== "Item" || doc.type !== "talent") return null;

  const typeenum = String(doc.system?.talenttype?.typeenum ?? "")
    .trim()
    .toLowerCase();
  if (typeenum !== "award") return null;

  const itemData = doc.toObject();
  const { min, max } = _awardCostFromItemData(itemData);
  const condition = _formatAwardCondition(itemData);

  return {
    uuid,
    name: doc.name,
    img: doc.img,
    description: _descriptionFromItemData(itemData),
    condition,
    costMin: min,
    costMax: max,
  };
}

// Some compendiums return index entries without a uuid; reconstruct it from
// the pack key + _id so downstream loads still work.
function _resolveEntryUuid(entry, packKey) {
  const existing = String(entry?.uuid ?? "").trim();
  if (existing) return existing;
  const id = String(entry?._id ?? "").trim();
  const key = String(packKey ?? "").trim();
  return id && key ? `Compendium.${key}.Item.${id}` : null;
}

/**
 * Loads every Award-type talent found across the configured talent
 * compendiums (built-in STA packs plus any custom compendiums configured in
 * the Talent Picker compendium settings).
 *
 * @returns {Promise<Array<{uuid:string,name:string,img:string,description:string,condition:string,costMin:number,costMax:number}>>}
 */
export async function loadAwardTalentEntries() {
  const packKeys = await _collectAwardTalentPackKeys();
  const uuids = new Set();

  for (const key of packKeys) {
    const pack = game.packs?.get?.(key);
    if (!pack) continue;
    try {
      await pack.getIndex({ fields: ["name", "type", "uuid"] });
    } catch (_) {
      continue;
    }
    for (const entry of pack.index?.values?.() ?? []) {
      if (String(entry?.type ?? "").toLowerCase() !== "talent") continue;
      const uuid = _resolveEntryUuid(entry, key);
      if (uuid) uuids.add(uuid);
    }
  }

  const entries = await Promise.all(
    Array.from(uuids).map((uuid) => _resolveAwardTalentEntry(uuid)),
  );

  return entries
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang));
}

/**
 * Builds the Spend Acclaim dialog option list for the talents the GM has
 * enabled. Options carry the talent's uuid so choosing one can copy the
 * talent item directly onto the actor.
 *
 * @returns {Promise<Array<{action:string,label:string,desc:string,condition:string,cost:number,costMin:number,costMax:number,isAward:true,uuid:string,img:string}>>}
 */
export async function getEnabledAwardOptions() {
  const enabledUuids = getEnabledAwardTalentUuids();
  if (!enabledUuids.length) return [];

  const entries = await Promise.all(
    enabledUuids.map((uuid) => _resolveAwardTalentEntry(uuid)),
  );

  return entries.filter(Boolean).map((entry) => ({
    action: entry.uuid,
    label: entry.name,
    desc: entry.description,
    condition: entry.condition,
    cost: entry.costMin,
    costMin: entry.costMin,
    costMax: entry.costMax,
    isAward: true,
    uuid: entry.uuid,
    img: entry.img,
  }));
}
