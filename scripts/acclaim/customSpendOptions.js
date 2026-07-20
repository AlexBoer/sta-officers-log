/**
 * Custom Spend Options
 *
 * World settings for awards, acclaim spend options, and reprimand spend
 * options. Each category is stored as an Array of objects
 * `{ action, name, cost, description }` and surfaced through an ApplicationV2
 * settings menu. The built-in entries are included in the editable lists,
 * so GMs can edit or remove them directly.
 *
 * Line format in the editor textarea:
 *   Action | Name | Cost | Description
 * Legacy custom rows without an action id are also accepted as:
 *   Name | Cost | Description
 *
 * @module data/customSpendOptions
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";

/* ------------------------------------------------------------------ */
/*  Setting keys                                                       */
/* ------------------------------------------------------------------ */

export const CUSTOM_AWARDS_SETTING = "customAwards";
export const CUSTOM_ACCLAIM_OPTIONS_SETTING = "customAcclaimOptions";
export const CUSTOM_REPRIMAND_OPTIONS_SETTING = "customReprimandOptions";
export const CUSTOM_SPEND_OPTIONS_VERSION_SETTING = "customSpendOptionsVersion";

const CURRENT_SPEND_OPTIONS_VERSION = 2;

const DEFAULT_AWARD_ACTIONS = [
  "awardPikeMedal",
  "awardCochraneMedal",
  "awardGrankiteOrder",
  "awardKaragiteOrder",
  "awardLegionOfHonor",
  "awardPalmLeaf",
  "awardStarCross",
  "awardConspicuousGallantry",
  "awardDecorationGallantry",
  "awardMedalOfHonor",
  "awardSurgeonsDecoration",
];

const DEFAULT_ACCLAIM_ACTIONS = [
  "commendAnother",
  "elevation",
  "gainFavor",
  "increaseReputation",
  "promotion",
  "status",
];

const DEFAULT_REPRIMAND_ACTIONS = [
  "courtMartial",
  "demotion",
  "detention",
  "gainAntipathy",
  "reduceReputation",
  "shameByAssociation",
  "status",
  "strippedOfAward",
];

function _withActions(rows, actions, extra = {}) {
  return rows.map((row, index) => ({
    ...extra,
    ...row,
    action: String(row?.action ?? actions[index] ?? "").trim(),
  }));
}

function _sanitizeOption(option) {
  return {
    action: String(option?.action ?? "").trim(),
    name: String(option?.name ?? "").trim(),
    cost: Math.max(0, parseInt(option?.cost, 10) || 0),
    description: String(option?.description ?? "").trim(),
  };
}

function _makeCustomAction(prefix, name, index) {
  const base = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  const suffix =
    typeof foundry?.utils?.randomID === "function"
      ? foundry.utils.randomID().slice(0, 6)
      : String(Date.now()).slice(-6);
  return `${prefix}_${index}_${base || "option"}_${suffix}`;
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

export function getDefaultAwardsOptions() {
  const rows = [
    {
      name:
        t("sta-officers-log.reputationSpend.awardPikeMedal") ||
        "Christopher Pike Medal of Valor",
      cost: 4,
      description:
        t("sta-officers-log.reputationSpend.awardPikeMedalDesc") ||
        "<strong>Cost 4.</strong> Requires command/leadership officer who led crew through several difficult missions with personal danger on at least two. <em>Benefit:</em> Once per mission, when using the Direct task, treat your d20 as if it rolled a 1.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardCochraneMedal") ||
        "Cochrane Medal of Excellence",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.awardCochraneMedalDesc") ||
        "<strong>Cost 3.</strong> Must have significantly contributed to science or engineering (discovery, solution to a long-standing problem). <em>Benefit:</em> (See rulebook for details.)",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardGrankiteOrder") ||
        "Grankite Order of Tactics",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.awardGrankiteOrderDesc") ||
        "<strong>Cost 3.</strong> Awarded for exceptional tactical acumen. <em>Benefit:</em> Once per mission, when creating a strategy/tactic trait, automatically add a level of Potency to it.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardKaragiteOrder") ||
        "Karagite Order of Heroism",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.awardKaragiteOrderDesc") ||
        "<strong>Cost 3.</strong> Must have faced extreme danger and defended a Federation world/outpost. <em>Benefit:</em> Once per mission, Avoid an Injury for free — or spend 2 Momentum (Immediate) + complication to ignore one ship breach.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardLegionOfHonor") ||
        "Legion of Honor",
      cost: 4,
      description:
        t("sta-officers-log.reputationSpend.awardLegionOfHonorDesc") ||
        "<strong>Cost 4.</strong> No conditions. <em>Benefit:</em> Once per mission, gain 2 bonus Momentum on a successful task (not saveable), or ignore a single complication before its effect is announced.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardPalmLeaf") ||
        "Palm Leaf of Peace Mission",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.awardPalmLeafDesc") ||
        "<strong>Cost 3.</strong> Mission must have involved securing peace or signing a peace treaty; all characters in that mission are eligible. <em>Benefit:</em> Once per mission, auto-succeed a Persuade task to prevent violence by spending Momentum equal to Difficulty.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardStarCross") || "Star Cross",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.awardStarCrossDesc") ||
        "<strong>Cost 3.</strong> No conditions. <em>Benefit:</em> Once per mission, before a task where a focus applies, double your focus range — score 2 successes for dice equal to or less than twice your department rating.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardConspicuousGallantry") ||
        "Citation for Conspicuous Gallantry",
      cost: 2,
      description:
        t("sta-officers-log.reputationSpend.awardConspicuousGallantryDesc") ||
        "<strong>Cost 2.</strong> Must have succeeded at a heroic, risky, or daring action. <em>Benefit:</em> Once per mission, when paying for Immediate Momentum by adding Threat, roll 1d20; if ≤ Daring, remove 1 Threat.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardDecorationGallantry") ||
        "Decoration of Gallantry",
      cost: 2,
      description:
        t("sta-officers-log.reputationSpend.awardDecorationGallantryDesc") ||
        "<strong>Cost 2.</strong> Must have faced an extremely difficult/dangerous situation and triumphed. <em>Benefit:</em> Once per mission, when suffering an Injury, halve its Severity before avoiding it.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardMedalOfHonor") ||
        "Starfleet Medal of Honor",
      cost: 5,
      description:
        t("sta-officers-log.reputationSpend.awardMedalOfHonorDesc") ||
        "<strong>Cost 5.</strong> No conditions. May be earned multiple times. <em>Benefit:</em> Once per mission (per medal), gain 2 bonus Momentum on a successful task (not saveable, max once per task).",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.awardSurgeonsDecoration") ||
        "Surgeons' Decoration",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.awardSurgeonsDecorationDesc") ||
        "<strong>Cost 3.</strong> Must be a Medical officer who acted above and beyond to save patients or alleviate a medical crisis. <em>Benefit:</em> Once per mission, reduce the Difficulty of a single Medical task by 2 (min 1).",
    },
  ];

  return _withActions(rows, DEFAULT_AWARD_ACTIONS, { isAward: true });
}

export function getDefaultAcclaimOptions() {
  const rows = [
    {
      name:
        t("sta-officers-log.reputationSpend.acclaimCommendAnother") ||
        "Commend Another",
      cost: 1,
      description:
        t("sta-officers-log.reputationSpend.acclaimCommendAnotherDesc") ||
        "Commanding officer spends 1 Acclaim to commend another main character, granting them one extra positive influence on their reputation roll (before they roll).",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.acclaimElevation") || "Elevation",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.acclaimElevationDesc") ||
        "A non-commissioned officer receives a battlefield commission and becomes an officer. If the commanding officer refuses, no Acclaim is spent.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.acclaimGainFavor") || "Gain Favor",
      cost: 1,
      description:
        t("sta-officers-log.reputationSpend.acclaimGainFavorDesc") ||
        "Obtain a favor from a non-enemy NPC encountered during the adventure. Base cost 1; +1 if not Starfleet, +1 if they command a starship or similar, +2 if admiral/ambassador/high-ranking.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.acclaimIncreaseReputation") ||
        "Increase Reputation",
      cost: 0,
      description:
        t("sta-officers-log.reputationSpend.acclaimIncreaseReputationDesc") ||
        "Increase Reputation by 1. Costs Acclaim equal to the new Reputation value (e.g. 3→4 costs 4). Once per adventure.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.acclaimPromotion") || "Promotion",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.acclaimPromotionDesc") ||
        "Promoted to a higher rank. If the commanding officer refuses, no Acclaim is spent. A commander cannot promote above commander; a captain cannot promote above captain.",
    },
    {
      name: t("sta-officers-log.reputationSpend.acclaimStatus") || "Status",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.acclaimStatusDesc") ||
        "Create an additional trait reflecting achievements, recognition, or special status — or remove a negative/detrimental trait. Commanding officers may add a trait to their ship instead.",
    },
  ];

  return _withActions(rows, DEFAULT_ACCLAIM_ACTIONS);
}

export function getDefaultReprimandOptions() {
  const rows = [
    {
      name:
        t("sta-officers-log.reputationSpend.reprimandCourtMartial") ||
        "Court-Martial",
      cost: 5,
      description:
        t("sta-officers-log.reputationSpend.reprimandCourtMartialDesc") ||
        "Arrested and placed on trial. You have the right to legal counsel, and proceedings should be resolved in-game. The court determines guilt or innocence and passes sentence, which can include dishonorable discharge and incarceration.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.reprimandDemotion") || "Demotion",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.reprimandDemotionDesc") ||
        "Accept demotion from your current rank by one step (e.g. commander to lieutenant commander, or lieutenant to lieutenant junior grade).",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.reprimandDetention") || "Detention",
      cost: 2,
      description:
        t("sta-officers-log.reputationSpend.reprimandDetentionDesc") ||
        "Stripped of duties and locked away for a short duration. A character in detention cannot be used; you must use a supporting character during the next mission.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.reprimandGainAntipathy") ||
        "Gain Antipathy",
      cost: 1,
      description:
        t("sta-officers-log.reputationSpend.reprimandGainAntipathyDesc") ||
        "Declare an allied NPC from the adventure regards you poorly. Costs 1 normally; +1 if the NPC commands a starship, or +2 if the NPC is an admiral, general, or high-ranking figure.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.reprimandReduceReputation") ||
        "Reduce Reputation",
      cost: 0,
      description:
        t("sta-officers-log.reputationSpend.reprimandReduceReputationDesc") ||
        "Reduce your Reputation by 1. Costs Reprimands equal to the Reputation you previously held (e.g. 3→2 costs 3). Once per adventure.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.reprimandShameByAssociation") ||
        "Shame by Association",
      cost: 2,
      description:
        t("sta-officers-log.reputationSpend.reprimandShameByAssociationDesc") ||
        "Commanding officer only. Stain the reputation of others aboard your ship — counts as one extra negative influence on each other main character's reputation roll. Must be done before they roll.",
    },
    {
      name: t("sta-officers-log.reputationSpend.reprimandStatus") || "Status",
      cost: 3,
      description:
        t("sta-officers-log.reputationSpend.reprimandStatusDesc") ||
        "Create a trait reflecting dishonor, cowardice, or disgrace — or remove a positive trait. Commanding officers may add a trait to their ship instead.",
    },
    {
      name:
        t("sta-officers-log.reputationSpend.reprimandStrippedOfAward") ||
        "Stripped of Award",
      cost: 1,
      description:
        t("sta-officers-log.reputationSpend.reprimandStrippedOfAwardDesc") ||
        "Remove one or more of your awards to remove Reprimands. Each award removed uses Reprimands equal to that award's cost.",
    },
  ];

  return _withActions(rows, DEFAULT_REPRIMAND_ACTIONS);
}

function _cloneOptions(list) {
  if (!Array.isArray(list)) return [];
  return list.map((o) => _sanitizeOption(o)).filter((o) => o.name.length > 0);
}

function _getStoredOptions(key) {
  try {
    const raw = game.settings.get(MODULE_ID, key) ?? [];
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

function _getStoredVersion() {
  try {
    return Number(
      game.settings.get(MODULE_ID, CUSTOM_SPEND_OPTIONS_VERSION_SETTING) ?? 0,
    );
  } catch (_) {
    return 0;
  }
}

function _isMigrated() {
  return _getStoredVersion() >= CURRENT_SPEND_OPTIONS_VERSION;
}

function _normalizeStoredOptions(stored, fallbackPrefix) {
  return _cloneOptions(stored)
    .map((option, index) => ({
      ...option,
      action:
        option.action || _makeCustomAction(fallbackPrefix, option.name, index),
    }))
    .filter((option) => option.name.length > 0);
}

function _isSameOptionList(raw, defaults) {
  if (!Array.isArray(raw) || !Array.isArray(defaults)) return false;
  if (raw.length !== defaults.length) return false;

  return raw.every((option, index) => {
    const sanitized = _sanitizeOption(option);
    const baseline = _sanitizeOption(defaults[index]);
    return (
      String(option?.action ?? "").trim() === baseline.action &&
      sanitized.name === baseline.name &&
      sanitized.cost === baseline.cost &&
      sanitized.description === baseline.description
    );
  });
}

function _hasAnyDefaultActions(rows, defaults) {
  if (!Array.isArray(rows) || !Array.isArray(defaults)) return false;
  const defaultActions = new Set(defaults.map((option) => option.action));
  return rows.some((row) =>
    defaultActions.has(String(row?.action ?? "").trim()),
  );
}

function _getEffectiveOptions(key, defaultsFn, fallbackPrefix) {
  const stored = _getStoredOptions(key);
  const defaults = defaultsFn();

  if (stored.length === 0) return defaults;

  const normalizedStored = _normalizeStoredOptions(stored, fallbackPrefix);

  if (_hasAnyDefaultActions(normalizedStored, defaults)) {
    return normalizedStored;
  }

  if (_isSameOptionList(stored, defaults)) {
    return defaults;
  }

  return [...defaults, ...normalizedStored];
}

/* ------------------------------------------------------------------ */
/*  Parsing helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse a single pipe-delimited line into an option object.
 *
 * Format:
 *   Action | Name | Cost | Description
 * or, for legacy/custom entries:
 *   Name | Cost | Description
 *
 * @param {string} line
 * @returns {{ action: string, name: string, cost: number, description: string } | null}
 */
function _parseLine(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return null;

  const parts = trimmed.split("|").map((s) => s.trim());
  if (parts.length >= 4) {
    const action = parts[0] ?? "";
    const name = parts[1] ?? "";
    if (!name) return null;
    const cost = Math.max(0, parseInt(parts[2], 10) || 1);
    const description = parts.slice(3).join("|").trim();
    return { action, name, cost, description };
  }

  const name = parts[0] ?? "";
  if (!name) return null;

  const cost = Math.max(0, parseInt(parts[1], 10) || 1);
  const description = parts.slice(2).join("|").trim();

  return { action: "", name, cost, description };
}

/**
 * Convert an array of option objects back to newline-separated text
 * suitable for the settings textarea.
 *
 * @param {Array<{ action?: string, name: string, cost: number, description: string }>} arr
 * @returns {string}
 */
function _toText(arr) {
  if (!Array.isArray(arr)) return "";
  return arr
    .map((o) => {
      const action = String(o?.action ?? "").trim();
      const parts = action
        ? [action, String(o?.name ?? ""), String(o?.cost ?? 1)]
        : [String(o?.name ?? ""), String(o?.cost ?? 1)];
      if (o?.description) parts.push(o.description);
      return parts.join(" | ");
    })
    .join("\n");
}

/**
 * Parse multi-line text into an array of option objects.
 *
 * @param {string} text
 * @returns {Array<{ action: string, name: string, cost: number, description: string }>}
 */
function _parseText(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map(_parseLine)
    .filter(Boolean);
}

function _prepareSaveOptions(rows, prefix) {
  return _cloneOptions(rows)
    .map((option, index) => ({
      ...option,
      action: option.action || _makeCustomAction(prefix, option.name, index),
    }))
    .filter((option) => option.name.length > 0);
}

function _escapeHtml(value) {
  const text = String(value ?? "");
  if (typeof foundry?.utils?.escapeHTML === "function") {
    return foundry.utils.escapeHTML(text);
  }

  return text.replace(/[&<>'"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function _stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _truncateText(value, maxLength = 140) {
  const text = _stripHtml(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function _getAwardEditorRows() {
  return _getEffectiveOptions(
    CUSTOM_AWARDS_SETTING,
    getDefaultAwardsOptions,
    "customAward",
  );
}

async function _saveAwardEditorRows(rows) {
  const awards = _prepareSaveOptions(rows, "customAward");
  await game.settings.set(MODULE_ID, CUSTOM_AWARDS_SETTING, awards);
  await game.settings.set(
    MODULE_ID,
    CUSTOM_SPEND_OPTIONS_VERSION_SETTING,
    CURRENT_SPEND_OPTIONS_VERSION,
  );
  return awards;
}

function _openAwardEditorDialog(category, { title, award }) {
  const config = _getSpendOptionCategoryConfig(category);
  const isEdit = Boolean(award);
  const formTitle = title || (isEdit ? "Edit Award" : "Create Award");
  const content = `
    <form class="sta-award-editor-dialog">
      <div class="form-group">
        <label>${config.fieldNameLabel}</label>
        <input type="text" name="name" value="${_escapeHtml(award?.name ?? "")}" required />
      </div>
      <div class="form-group">
        <label>${config.fieldCostLabel}</label>
        <input type="number" name="cost" min="0" value="${_escapeHtml(String(award?.cost ?? 1))}" required />
      </div>
      <div class="form-group">
        <label>${config.fieldDescriptionLabel}</label>
        <textarea name="description" rows="8" spellcheck="true">${_escapeHtml(award?.description ?? "")}</textarea>
      </div>
    </form>`;

  return foundry.applications.api.DialogV2.input({
    classes: ["sta-officers-log"],
    window: { title: formTitle },
    content,
    ok: {
      label: config.saveOptionLabel,
    },
    cancel: {
      label:
        t("sta-officers-log.settings.customSpendOptions.awardCancel") ||
        "Cancel",
    },
    modal: false,
    rejectClose: false,
  });
}

function _getSpendOptionCategoryConfig(category) {
  switch (category) {
    case "acclaim":
      return {
        key: CUSTOM_ACCLAIM_OPTIONS_SETTING,
        prefix: "customAcclaim",
        title: "Acclaim Spend Editor",
        createLabel: "Create Acclaim Option",
        emptyLabel: "No acclaim spend options have been created yet.",
        saveLabel: "Acclaim spend option saved.",
        removedLabel: "Acclaim spend option removed.",
        removeConfirm: "Remove this acclaim spend option?",
        fieldNameLabel: "Option Name",
        fieldCostLabel: "Cost",
        fieldDescriptionLabel: "Description",
        saveOptionLabel: "Save Option",
      };
    case "reprimand":
      return {
        key: CUSTOM_REPRIMAND_OPTIONS_SETTING,
        prefix: "customReprimand",
        title: "Reprimand Spend Editor",
        createLabel: "Create Reprimand Option",
        emptyLabel: "No reprimand spend options have been created yet.",
        saveLabel: "Reprimand spend option saved.",
        removedLabel: "Reprimand spend option removed.",
        removeConfirm: "Remove this reprimand spend option?",
        fieldNameLabel: "Option Name",
        fieldCostLabel: "Cost",
        fieldDescriptionLabel: "Description",
        saveOptionLabel: "Save Option",
      };
    case "award":
    default:
      return {
        key: CUSTOM_AWARDS_SETTING,
        prefix: "customAward",
        title: "Award Creation",
        createLabel: "Create Award",
        emptyLabel: "No awards have been created yet.",
        saveLabel: "Award saved.",
        removedLabel: "Award removed.",
        removeConfirm: "Remove this award?",
        fieldNameLabel: "Award Name",
        fieldCostLabel: "Cost",
        fieldDescriptionLabel: "Description",
        saveOptionLabel: "Save Award",
      };
  }
}

function _getSpendOptionRows(category) {
  const config = _getSpendOptionCategoryConfig(category);
  const defaultsFn =
    category === "acclaim"
      ? getDefaultAcclaimOptions
      : category === "reprimand"
        ? getDefaultReprimandOptions
        : getDefaultAwardsOptions;
  return _getEffectiveOptions(config.key, defaultsFn, config.prefix);
}

async function _saveSpendOptionRows(category, rows) {
  const config = _getSpendOptionCategoryConfig(category);
  const saved = _prepareSaveOptions(rows, config.prefix);
  await game.settings.set(MODULE_ID, config.key, saved);
  return saved;
}

/* ------------------------------------------------------------------ */
/*  Getters                                                            */
/* ------------------------------------------------------------------ */

/**
 * Get awards available in the Spend Acclaim dialog.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number, isAward: true }>}
 */
export function getCustomAwards() {
  const defaultActions = new Set(
    getDefaultAwardsOptions().map((option) => option.action),
  );
  return _getEffectiveOptions(
    CUSTOM_AWARDS_SETTING,
    getDefaultAwardsOptions,
    "customAward",
  ).map((o, i) => ({
    action: o.action || `customAward_${i}`,
    label: o.name,
    desc: o.description ?? "",
    cost: o.cost ?? 1,
    isAward: true,
    isCustom: !defaultActions.has(o.action),
  }));
}

/**
 * Get acclaim spend options available in the Spend Acclaim dialog.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number }>}
 */
export function getCustomAcclaimOptions() {
  const defaultActions = new Set(
    getDefaultAcclaimOptions().map((option) => option.action),
  );
  return _getEffectiveOptions(
    CUSTOM_ACCLAIM_OPTIONS_SETTING,
    getDefaultAcclaimOptions,
    "customAcclaim",
  ).map((o, i) => ({
    action: o.action || `customAcclaim_${i}`,
    label: o.name,
    desc: o.description ?? "",
    cost: o.cost ?? 1,
    isCustom: !defaultActions.has(o.action),
  }));
}

/**
 * Get reprimand spend options available in the Spend Reprimands dialog.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number }>}
 */
export function getCustomReprimandOptions() {
  const defaultActions = new Set(
    getDefaultReprimandOptions().map((option) => option.action),
  );
  return _getEffectiveOptions(
    CUSTOM_REPRIMAND_OPTIONS_SETTING,
    getDefaultReprimandOptions,
    "customReprimand",
  ).map((o, i) => ({
    action: o.action || `customReprimand_${i}`,
    label: o.name,
    desc: o.description ?? "",
    cost: o.cost ?? 1,
    isCustom: !defaultActions.has(o.action),
  }));
}

/* ------------------------------------------------------------------ */
/*  Settings menu ApplicationV2                                        */
/* ------------------------------------------------------------------ */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AwardEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.category = options.category || "award";
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-award-editor`,
    tag: "div",
    window: {
      title: "Spend Option Editor",
      contentClasses: ["standard-form"],
    },
    position: {
      width: 760,
      height: "auto",
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/award-editor.hbs`,
    },
  };

  async _prepareContext(_options) {
    const config = _getSpendOptionCategoryConfig(this.category);
    const awards = _getSpendOptionRows(this.category);
    const defaultActions = new Set(
      (this.category === "acclaim"
        ? getDefaultAcclaimOptions()
        : this.category === "reprimand"
          ? getDefaultReprimandOptions()
          : getDefaultAwardsOptions()
      ).map((option) => option.action),
    );

    return {
      editorTitle: config.title,
      editorHint:
        this.category === "acclaim"
          ? "Open the Acclaim Spend Editor to add, edit, or remove options."
          : this.category === "reprimand"
            ? "Open the Reprimand Spend Editor to add, edit, or remove options."
            : "Open the Award Creation dialog to add, edit, or remove awards.",
      createLabel: config.createLabel,
      emptyLabel: config.emptyLabel,
      closeLabel: "Close",
      awards: awards.map((award, index) => ({
        index,
        action: award.action,
        name: award.name,
        cost: award.cost ?? 1,
        costLabel:
          award.action === "increaseReputation" ||
          award.action === "reduceReputation"
            ? "Cost X"
            : `Cost ${award.cost ?? 1}`,
        descriptionPreview: _truncateText(award.description ?? "", 150),
        isBuiltIn: defaultActions.has(award.action),
      })),
      hasAwards: awards.length > 0,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html
      ?.querySelector('[data-action="create-award"]')
      ?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this._openAwardDialog();
      });

    for (const card of html?.querySelectorAll(".sta-award-card") ?? []) {
      card.addEventListener("click", async (event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest('[data-action="remove-award"]')
        ) {
          return;
        }

        const index = parseInt(card.dataset.index ?? "", 10);
        if (!Number.isInteger(index)) return;
        await this._openAwardDialog(index);
      });

      card.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const index = parseInt(card.dataset.index ?? "", 10);
        if (!Number.isInteger(index)) return;
        await this._openAwardDialog(index);
      });
    }

    for (const button of html?.querySelectorAll(
      '[data-action="remove-award"]',
    ) ?? []) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const index = parseInt(button.dataset.index ?? "", 10);
        if (!Number.isInteger(index)) return;

        const awards = _getSpendOptionRows(this.category);
        const award = awards[index];
        if (!award) return;

        const confirmed = window.confirm(
          `${_getSpendOptionCategoryConfig(this.category).removeConfirm}\n\n${award.name}`,
        );
        if (!confirmed) return;

        awards.splice(index, 1);
        await _saveSpendOptionRows(this.category, awards);
        await this.render(true);
        ui.notifications?.info?.(
          _getSpendOptionCategoryConfig(this.category).removedLabel,
        );
      });
    }

    html
      ?.querySelector('[data-action="close-award-editor"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        this.close();
      });
  }

  async _openAwardDialog(index = null) {
    const config = _getSpendOptionCategoryConfig(this.category);
    const awards = _getSpendOptionRows(this.category);
    const award = Number.isInteger(index) ? (awards[index] ?? null) : null;
    const result = await _openAwardEditorDialog(this.category, {
      title: award ? `Edit ${config.title}` : config.title,
      award,
    });

    if (!result) return;

    const name = String(result.name ?? "").trim();
    if (!name) {
      ui.notifications?.warn?.("Option name is required.");
      return;
    }

    const nextAward = {
      action:
        award?.action ||
        _makeCustomAction(config.prefix, name, index ?? awards.length),
      name,
      cost: Math.max(0, parseInt(result.cost, 10) || 0),
      description: String(result.description ?? "").trim(),
    };

    if (Number.isInteger(index)) {
      awards[index] = nextAward;
    } else {
      awards.push(nextAward);
    }

    await _saveSpendOptionRows(this.category, awards);
    await this.render(true);
    ui.notifications?.info?.(
      _getSpendOptionCategoryConfig(this.category).saveLabel,
    );
  }
}

export function openAwardEditor(category = "award") {
  return new AwardEditorApp({ category }).render(true);
}

export class CustomSpendOptionsSettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-custom-spend-options-settings`,
    tag: "form",
    window: {
      title: "sta-officers-log.settings.customSpendOptions.menuTitle",
      contentClasses: ["standard-form"],
    },
    position: {
      width: 620,
      height: "auto",
    },
    form: {
      closeOnSubmit: true,
      handler: CustomSpendOptionsSettingsApp.#onSubmit,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/custom-spend-options-settings.hbs`,
    },
  };

  async _prepareContext(_options) {
    return {
      awardEditorHint:
        t("sta-officers-log.settings.customSpendOptions.awardEditorHint") ||
        "Open the Award Creation dialog to add, edit, or remove awards.",
      acclaimEditorHint:
        t("sta-officers-log.settings.customSpendOptions.acclaimEditorHint") ||
        "Open the Acclaim Spend Editor to add, edit, or remove options.",
      reprimandEditorHint:
        t("sta-officers-log.settings.customSpendOptions.reprimandEditorHint") ||
        "Open the Reprimand Spend Editor to add, edit, or remove options.",
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    html
      ?.querySelector('[data-action="open-award-editor"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        openAwardEditor();
      });
    html
      ?.querySelector('[data-action="open-acclaim-editor"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        openAwardEditor("acclaim");
      });
    html
      ?.querySelector('[data-action="open-reprimand-editor"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        openAwardEditor("reprimand");
      });
  }

  static async #onSubmit(_event, form, formData) {
    ui.notifications?.info?.(
      t("sta-officers-log.settings.customSpendOptions.saved") ||
        "Awards and spend options saved.",
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Register the three world settings and the settings menu entry.
 */
export function registerCustomSpendOptionsSettings() {
  const fieldType = new foundry.data.fields.ArrayField(
    new foundry.data.fields.SchemaField({
      action: new foundry.data.fields.StringField({
        required: false,
        initial: "",
      }),
      name: new foundry.data.fields.StringField(),
      cost: new foundry.data.fields.NumberField({ integer: true, min: 0 }),
      description: new foundry.data.fields.StringField(),
    }),
  );

  game.settings.register(MODULE_ID, CUSTOM_AWARDS_SETTING, {
    name: "Awards",
    hint: "Editable awards for the acclaim spend dialog.",
    scope: "world",
    config: false,
    type: fieldType,
    default: getDefaultAwardsOptions(),
  });

  game.settings.register(MODULE_ID, CUSTOM_ACCLAIM_OPTIONS_SETTING, {
    name: "Acclaim Spend Options",
    hint: "Editable acclaim spend options.",
    scope: "world",
    config: false,
    // Re-create field type for each setting to avoid shared state issues
    type: new foundry.data.fields.ArrayField(
      new foundry.data.fields.SchemaField({
        action: new foundry.data.fields.StringField({
          required: false,
          initial: "",
        }),
        name: new foundry.data.fields.StringField(),
        cost: new foundry.data.fields.NumberField({ integer: true, min: 0 }),
        description: new foundry.data.fields.StringField(),
      }),
    ),
    default: getDefaultAcclaimOptions(),
  });

  game.settings.register(MODULE_ID, CUSTOM_REPRIMAND_OPTIONS_SETTING, {
    name: "Reprimand Spend Options",
    hint: "Editable reprimand spend options.",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(
      new foundry.data.fields.SchemaField({
        action: new foundry.data.fields.StringField({
          required: false,
          initial: "",
        }),
        name: new foundry.data.fields.StringField(),
        cost: new foundry.data.fields.NumberField({ integer: true, min: 0 }),
        description: new foundry.data.fields.StringField(),
      }),
    ),
    default: getDefaultReprimandOptions(),
  });

  game.settings.register(MODULE_ID, CUSTOM_SPEND_OPTIONS_VERSION_SETTING, {
    name: "Custom Spend Options Version",
    hint: "Internal migration marker for editable spend options.",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });

  game.settings.registerMenu(MODULE_ID, "customSpendOptionsMenu", {
    name:
      t("sta-officers-log.settings.customSpendOptions.name") ||
      "Awards & Spend Options",
    label:
      t("sta-officers-log.settings.customSpendOptions.label") ||
      "Edit Awards & Spend Options",
    hint:
      t("sta-officers-log.settings.customSpendOptions.hint") ||
      "Edit awards, acclaim spend options, and reprimand spend options.",
    icon: "fa-solid fa-trophy",
    type: CustomSpendOptionsSettingsApp,
    restricted: true,
  });
}
