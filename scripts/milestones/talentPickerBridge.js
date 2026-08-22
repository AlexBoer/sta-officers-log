import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import {
  getNormalizedTalentRequirements,
  humanizeRequirementValue,
  normalizeRequirementString,
  resolveAttributeKey,
  resolveDisciplineKey,
} from "../core/talentRequirements.js";
import { ATTRIBUTE_LABELS, DISCIPLINE_LABELS } from "../core/gameConstants.js";
import {
  doesActorMeetTalentRequirements,
  _inferRequiredSpeciesFromTalent as inferRequiredSpeciesFromTalent,
} from "./talentPickerDialog.js";

// Talent types never offered as an advancement choice (mirrors talentPickerDialog).
const NEVER_PICKABLE_TYPES = new Set([
  "role",
  "speciesability",
  "npc",
  "award",
]);
const CHARACTER_EXCLUDED_TYPES = new Set([
  ...NEVER_PICKABLE_TYPES,
  "starship",
  "starshipservicerecord",
  "starshipspecialrule",
]);

// Collects a talent's type identifiers from every schema path STA / officers-log use.
function _talentTypeSet(talent) {
  return new Set(
    [
      talent?.talenttype?.typeenum,
      talent?.talenttype?.type,
      talent?.item?.system?.type,
      talent?.item?.system?.talenttype?.typeenum,
      talent?.item?.system?.talenttype?.type,
    ]
      .map((v) => normalizeRequirementString(v))
      .filter(Boolean),
  );
}

// Talent types that belong to a starship (the only ones offered in a ship swap).
const STARSHIP_TALENT_TYPES = new Set(["starship", "systems"]);

// Valid ship system keys (used to validate "systems" requirement filter values).
const STA_SYSTEM_KEYS = new Set([
  "communications",
  "computers",
  "engines",
  "sensors",
  "structure",
  "weapons",
]);

function _isRoleTalent(talent) {
  if (_talentTypeSet(talent).has("role")) return true;

  const img = String(talent?.img ?? "").toLowerCase();
  if (/\/roles?\//.test(img)) return true;
  const file = img.split("/").pop() ?? "";
  const base = file.replace(/\.[a-z0-9]+$/i, "").replace(/^talent[-_]/, "");
  return /(^|[-_])role([-_]|$)/.test(base);
}

function _staUtilsTalentPicker() {
  if (!game.modules?.get?.("sta-utils")?.active) return null;
  const fn = game.staUtils?.talentPicker;
  return typeof fn === "function" ? fn : null;
}

export function isTalentBrowserPickerAvailable() {
  return Boolean(_staUtilsTalentPicker());
}

function _formatClause(category, clause) {
  const value = String(clause?.value ?? "").trim();
  if (!value) return "";
  const min = Number(clause?.minimum);
  const withMin = (label) =>
    Number.isFinite(min) && min > 0 ? `${label} ${min}+` : label;

  if (category === "attribute") {
    const key = resolveAttributeKey(value);
    return withMin(
      (key && ATTRIBUTE_LABELS[key]) ||
        humanizeRequirementValue(value) ||
        value,
    );
  }
  if (category === "discipline") {
    const key = resolveDisciplineKey(value);
    return withMin(
      (key && DISCIPLINE_LABELS[key]) ||
        humanizeRequirementValue(value) ||
        value,
    );
  }
  if (category === "systems") {
    return withMin(humanizeRequirementValue(value) || value);
  }
  if (category === "type") {
    const norm = normalizeRequirementString(value);
    if (norm === "npc") return "NPC";
    if (norm === "character") return "Character";
    if (norm === "starship") return "Starship";
  }
  return humanizeRequirementValue(value) || value;
}

function _buildRequirementLines(requirements) {
  const requiresPrefix = t(
    "sta-officers-log.dialog.talentPicker.requiresPrefix",
  );
  const requirementParts = [];
  const conditionParts = [];

  for (const entry of requirements) {
    const category = normalizeRequirementString(entry?.category);
    const clauses = Array.isArray(entry?.clauses) ? entry.clauses : [];

    if (category === "condition") {
      for (const clause of clauses) {
        const text = String(clause?.value ?? "").trim();
        if (text) conditionParts.push(text);
      }
      continue;
    }

    const joiner =
      String(entry?.operator ?? "OR").toUpperCase() === "AND"
        ? " and "
        : " or ";
    const parts = clauses
      .map((c) => _formatClause(category, c))
      .filter(Boolean);
    if (parts.length) requirementParts.push(parts.join(joiner));
  }

  // Requirements and conditions share one comma-separated line (conditions last).
  const allParts = [...requirementParts, ...conditionParts];
  if (!allParts.length) return [];
  return [{ text: `${requiresPrefix} ${allParts.join(", ")}` }];
}

function _buildFacets(requirements) {
  const categories = new Set();
  const clauses = [];
  for (const entry of requirements) {
    const category = normalizeRequirementString(entry?.category);
    if (!category) continue;
    categories.add(category);
    for (const clause of Array.isArray(entry?.clauses) ? entry.clauses : []) {
      const value = normalizeRequirementString(clause?.value);
      if (!value) continue;
      // Keep numeric-category filters clean: only list real attributes/departments/
      // systems so a mis-entered species value can't pollute those dropdowns.
      if (category === "attribute" && !resolveAttributeKey(value)) continue;
      if (category === "discipline" && !resolveDisciplineKey(value)) continue;
      if (category === "systems" && !STA_SYSTEM_KEYS.has(value)) continue;
      const minimum = Number(clause?.minimum);
      clauses.push({
        category,
        value,
        minimum: Number.isFinite(minimum) ? minimum : 0,
      });
    }
  }
  return { categories: Array.from(categories), clauses };
}

function _sourceLabelFromUuid(uuid) {
  const raw = String(uuid ?? "");
  if (!raw.startsWith("Compendium.")) return "";
  const parts = raw.slice("Compendium.".length).split(".");
  if (parts.length < 2) return "";
  const collection = `${parts[0]}.${parts[1]}`;
  const pack = game.packs?.get?.(collection);
  return String(pack?.title ?? pack?.metadata?.label ?? collection);
}

function _descriptionText(item) {
  const description = item?.system?.description;
  const raw =
    typeof description === "string" ? description : (description?.value ?? "");
  const html = String(raw ?? "");
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return String(tmp.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function _analyzeTalent(actor, talent) {
  const requirements = getNormalizedTalentRequirements(talent, {
    inferSpecies: inferRequiredSpeciesFromTalent,
  });
  const requirementLines = _buildRequirementLines(requirements);
  const facets = _buildFacets(requirements);
  const summary = requirementLines.map((line) => line.text).join("; ");

  return {
    uuid: String(talent?.uuid ?? talent?.name ?? ""),
    name: String(talent?.name ?? ""),
    img: talent?.img ?? null,
    source: _sourceLabelFromUuid(talent?.uuid),
    eligible: doesActorMeetTalentRequirements(actor, talent),
    requirementLines,
    descriptionText: _descriptionText(talent?.item),
    filter: facets,
    data: {
      name: talent?.name ?? "",
      img: talent?.img ?? null,
      uuid: talent?.uuid ?? null,
      item: talent?.item ?? null,
      talenttype: talent?.talenttype ?? null,
      requirementSummary: summary,
    },
  };
}

async function _postGmNotice(actor, data) {
  try {
    const recipients =
      ChatMessage.getWhisperRecipients?.("GM")?.map((u) => u.id) ??
      game.users?.filter?.((u) => u.isGM)?.map((u) => u.id) ??
      [];
    const message = tf("sta-officers-log.dialog.talentPicker.gmNotice", {
      actor:
        actor?.name ?? t("sta-officers-log.dialog.talentPicker.aCharacter"),
      talent: data?.name ?? "",
      requirements: data?.requirementSummary ?? "",
    });
    await ChatMessage.create({
      content: `<div class="sta-officers-log sta-talent-picker-gm-notice">${message}</div>`,
      whisper: recipients,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to post GM notice for ineligible talent`,
      err,
    );
  }
}

// Whispers the GM when a non-standard talent (species ability / starship special
// rule / service record) is chosen.
async function _postNonStandardNotice(actor, data, toggleGroup) {
  try {
    const recipients =
      ChatMessage.getWhisperRecipients?.("GM")?.map((u) => u.id) ??
      game.users?.filter?.((u) => u.isGM)?.map((u) => u.id) ??
      [];
    const kindKey =
      {
        speciesability: "speciesAbility",
        starshipspecialrule: "starshipSpecialRule",
        starshipservicerecord: "starshipServiceRecord",
      }[toggleGroup] ?? toggleGroup;
    const kind = t(
      `sta-officers-log.dialog.talentPicker.nonStandardKind.${kindKey}`,
    );
    const message = tf(
      "sta-officers-log.dialog.talentPicker.nonStandardNotice",
      {
        actor:
          actor?.name ?? t("sta-officers-log.dialog.talentPicker.aCharacter"),
        talent: data?.name ?? "",
        kind,
      },
    );
    await ChatMessage.create({
      content: `<div class="sta-officers-log sta-talent-picker-gm-notice">${message}</div>`,
      whisper: recipients,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to post GM notice for non-standard talent`,
      err,
    );
  }
}

// Attempts the browser-styled picker. Returns:
//   { fallback: true }                 → sta-utils unavailable, use legacy picker
//   { chosen: null }                   → user cancelled
//   { chosen: { custom: true } }       → user chose "Create Custom Talent"
//   { chosen: <legacy talent shape> }  → selected talent
export async function runTalentBrowserPicker({
  actor = null,
  pickerKind = "character",
  talents = [],
  allowCustom = true,
} = {}) {
  const talentPicker = _staUtilsTalentPicker();
  if (!talentPicker) return { fallback: true };

  const prepared = [];
  for (const talent of Array.isArray(talents) ? talents : []) {
    try {
      const types = _talentTypeSet(talent);
      let toggleGroup = null;
      if (pickerKind === "ship") {
        // Ship: standard starship talents, plus optional special rules / service records.
        if (types.has("starshipspecialrule"))
          toggleGroup = "starshipspecialrule";
        else if (types.has("starshipservicerecord"))
          toggleGroup = "starshipservicerecord";
        else if (![...types].some((ty) => STARSHIP_TALENT_TYPES.has(ty)))
          continue;
      } else {
        if (_isRoleTalent(talent)) continue;
        // Character: standard talents, plus optional species abilities.
        if (types.has("speciesability")) toggleGroup = "speciesability";
        else if ([...types].some((ty) => CHARACTER_EXCLUDED_TYPES.has(ty)))
          continue;
      }
      const item = _analyzeTalent(actor, talent);
      item.toggleGroup = toggleGroup;
      prepared.push(item);
    } catch (err) {
      // Skip a single problematic talent rather than failing the whole picker.
      console.error(
        `${MODULE_ID} | failed to prepare talent for picker`,
        talent?.name,
        err,
      );
    }
  }

  const heading =
    pickerKind === "ship"
      ? t("sta-officers-log.dialog.talentPicker.shipHeading")
      : t("sta-officers-log.dialog.talentPicker.characterHeading");

  const toggles =
    pickerKind === "ship"
      ? [
          {
            key: "starshipspecialrule",
            label: t(
              "sta-officers-log.dialog.talentPicker.showStarshipSpecialRules",
            ),
          },
          {
            key: "starshipservicerecord",
            label: t(
              "sta-officers-log.dialog.talentPicker.showStarshipServiceRecords",
            ),
          },
        ]
      : [
          {
            key: "speciesability",
            label: t(
              "sta-officers-log.dialog.talentPicker.showSpeciesAbilities",
            ),
          },
        ];

  const result = await talentPicker({
    title: heading,
    heading,
    actorName: actor?.name ?? "",
    talents: prepared,
    allowCustom: allowCustom !== false,
    toggles,
    onIneligibleChosen: (data) => _postGmNotice(actor, data),
    onFlaggedChosen: (data, group) =>
      _postNonStandardNotice(actor, data, group),
  });

  if (!result) return { chosen: null };
  if (result.custom) return { chosen: { custom: true } };
  return { chosen: result.talent ?? null };
}
