/**
 * Custom Spend Options
 *
 * World settings for acclaim spend options and reprimand spend options.
 * Each category is stored as an Array of objects
 * `{ action, name, cost, description }` and surfaced through an ApplicationV2
 * settings menu. The built-in entries are included in the editable lists,
 * so GMs can edit or remove them directly.
 *
 * Award options are handled separately (see acclaim/awardTalents.js) and are
 * sourced from Award-type Talent items in the configured compendiums.
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
import { openAwardTalentSelector } from "./awardTalentSelectorApp.js";

/* ------------------------------------------------------------------ */
/*  Setting keys                                                       */
/* ------------------------------------------------------------------ */

export const CUSTOM_ACCLAIM_OPTIONS_SETTING = "customAcclaimOptions";
export const CUSTOM_REPRIMAND_OPTIONS_SETTING = "customReprimandOptions";
export const DISABLED_ACCLAIM_DEFAULTS_SETTING =
  "disabledAcclaimDefaultActions";
export const DISABLED_REPRIMAND_DEFAULTS_SETTING =
  "disabledReprimandDefaultActions";
export const CUSTOM_SPEND_OPTIONS_VERSION_SETTING = "customSpendOptionsVersion";

const CURRENT_SPEND_OPTIONS_VERSION = 4;

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
  const cost = Math.max(0, parseInt(option?.cost, 10) || 0);
  const rawMax = option?.costMax;
  const hasMax =
    rawMax !== null && rawMax !== undefined && String(rawMax).trim() !== "";
  let costMax = null;
  if (hasMax) {
    const parsedMax = Math.max(0, parseInt(rawMax, 10) || 0);
    if (parsedMax < cost) {
      console.warn(
        `${MODULE_ID} | Spend option "${option?.name ?? "Unknown"}" has a max cost (${parsedMax}) lower than its min cost (${cost}); ignoring the max.`,
      );
    } else if (parsedMax > cost) {
      costMax = parsedMax;
    }
  }

  return {
    action: String(option?.action ?? "").trim(),
    name: String(option?.name ?? "").trim(),
    cost,
    costMax,
    description: String(option?.description ?? "").trim(),
    enabled: option?.enabled !== false,
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

// Custom rows are the only thing stored under CUSTOM_*_OPTIONS_SETTING;
// built-in defaults always come from getDefault*Options() and are never
// persisted, so clearing the setting can never bring defaults back.
function _getCustomRows(category) {
  const config = _getSpendOptionCategoryConfig(category);
  return _cloneOptions(_getStoredOptions(config.key));
}

async function _saveCustomRows(category, rows) {
  const config = _getSpendOptionCategoryConfig(category);
  const saved = _prepareSaveOptions(rows, config.prefix);
  await game.settings.set(MODULE_ID, config.key, saved);
  return saved;
}

function _getDisabledDefaultActions(category) {
  const config = _getSpendOptionCategoryConfig(category);
  try {
    const raw = game.settings.get(MODULE_ID, config.disabledDefaultsKey) ?? [];
    return new Set(
      Array.isArray(raw)
        ? raw.map((a) => String(a ?? "").trim()).filter(Boolean)
        : [],
    );
  } catch (_) {
    return new Set();
  }
}

async function _setDefaultActionEnabled(category, action, enabled) {
  const config = _getSpendOptionCategoryConfig(category);
  const disabled = _getDisabledDefaultActions(category);
  if (enabled) disabled.delete(action);
  else disabled.add(action);
  await game.settings.set(
    MODULE_ID,
    config.disabledDefaultsKey,
    Array.from(disabled),
  );
}

// Combined rows for the editor UI: built-in defaults (with their enabled
// state from the disabled-actions setting) followed by custom rows.
function _getAllSpendOptionRows(category) {
  const config = _getSpendOptionCategoryConfig(category);
  const disabledDefaults = _getDisabledDefaultActions(category);
  const defaults = config.defaultsFn().map((option) => ({
    ...option,
    enabled: !disabledDefaults.has(option.action),
    isBuiltIn: true,
  }));
  const custom = _getCustomRows(category).map((option) => ({
    ...option,
    isBuiltIn: false,
  }));
  return [...defaults, ...custom];
}

// One-time migration (v3 -> v4): the old model stored built-in rows
// alongside custom ones and re-added defaults whenever the list was fully
// cleared. Strip any rows matching a default action so only genuine custom
// rows remain; built-ins are now always enabled unless explicitly disabled.
async function _migrateStoredOptions(key, defaultsFn) {
  const stored = _getStoredOptions(key);
  if (stored.length === 0) return false;

  const defaultActions = new Set(defaultsFn().map((option) => option.action));
  const customOnly = _cloneOptions(stored).filter(
    (option) => !defaultActions.has(option.action),
  );

  const optionsEqual = foundry.utils.equals ?? foundry.utils.objectsEqual;
  if (optionsEqual(stored, customOnly)) return false;

  await game.settings.set(MODULE_ID, key, customOnly);
  return true;
}

export async function migrateCustomSpendOptions() {
  if (!game.user?.isGM) return;
  if (_getStoredVersion() >= CURRENT_SPEND_OPTIONS_VERSION) return;

  await _migrateStoredOptions(
    CUSTOM_ACCLAIM_OPTIONS_SETTING,
    getDefaultAcclaimOptions,
  );
  await _migrateStoredOptions(
    CUSTOM_REPRIMAND_OPTIONS_SETTING,
    getDefaultReprimandOptions,
  );

  await game.settings.set(
    MODULE_ID,
    CUSTOM_SPEND_OPTIONS_VERSION_SETTING,
    CURRENT_SPEND_OPTIONS_VERSION,
  );
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
        <label>${config.fieldMaxCostLabel}</label>
        <input type="number" name="costMax" min="0" value="${_escapeHtml(award?.costMax != null ? String(award.costMax) : "")}" placeholder="${config.fieldMaxCostPlaceholder}" />
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
    case "reprimand":
      return {
        key: CUSTOM_REPRIMAND_OPTIONS_SETTING,
        disabledDefaultsKey: DISABLED_REPRIMAND_DEFAULTS_SETTING,
        defaultsFn: getDefaultReprimandOptions,
        prefix: "customReprimand",
        title: "Reprimand Spend Editor",
        createLabel: "Create Reprimand Option",
        emptyLabel: "No reprimand spend options have been created yet.",
        saveLabel: "Reprimand spend option saved.",
        removedLabel: "Reprimand spend option removed.",
        removeConfirm: "Remove this reprimand spend option?",
        fieldNameLabel: "Option Name",
        fieldCostLabel: "Cost",
        fieldMaxCostLabel: "Max Cost (optional)",
        fieldMaxCostPlaceholder: "Same as Cost",
        fieldDescriptionLabel: "Description",
        saveOptionLabel: "Save Option",
      };
    case "acclaim":
    default:
      return {
        key: CUSTOM_ACCLAIM_OPTIONS_SETTING,
        disabledDefaultsKey: DISABLED_ACCLAIM_DEFAULTS_SETTING,
        defaultsFn: getDefaultAcclaimOptions,
        prefix: "customAcclaim",
        title: "Acclaim Spend Editor",
        createLabel: "Create Acclaim Option",
        emptyLabel: "No acclaim spend options have been created yet.",
        saveLabel: "Acclaim spend option saved.",
        removedLabel: "Acclaim spend option removed.",
        removeConfirm: "Remove this acclaim spend option?",
        fieldNameLabel: "Option Name",
        fieldCostLabel: "Cost",
        fieldMaxCostLabel: "Max Cost (optional)",
        fieldMaxCostPlaceholder: "Same as Cost",
        fieldDescriptionLabel: "Description",
        saveOptionLabel: "Save Option",
      };
  }
}

/* ------------------------------------------------------------------ */
/*  Getters                                                            */
/* ------------------------------------------------------------------ */

function _getEnabledSpendOptions(category) {
  const config = _getSpendOptionCategoryConfig(category);
  return _getAllSpendOptionRows(category)
    .filter((option) => option.enabled !== false)
    .map((option, index) => ({
      action: option.action || `${config.prefix}_${index}`,
      label: option.name,
      desc: option.description ?? "",
      cost: option.cost ?? 1,
      costMax: Number.isFinite(option.costMax) ? option.costMax : null,
      isCustom: !option.isBuiltIn,
    }));
}

/**
 * Get acclaim spend options available in the Spend Acclaim dialog.
 * Disabled options (built-in or custom) are excluded entirely.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number }>}
 */
export function getCustomAcclaimOptions() {
  return _getEnabledSpendOptions("acclaim");
}

/**
 * Get reprimand spend options available in the Spend Reprimands dialog.
 * Disabled options (built-in or custom) are excluded entirely.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number }>}
 */
export function getCustomReprimandOptions() {
  return _getEnabledSpendOptions("reprimand");
}

/* ------------------------------------------------------------------ */
/*  Settings menu ApplicationV2                                        */
/* ------------------------------------------------------------------ */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AwardEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.category = options.category || "acclaim";
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
    const rows = _getAllSpendOptionRows(this.category);

    return {
      editorTitle: config.title,
      editorHint:
        this.category === "acclaim"
          ? "Open the Acclaim Spend Editor to add, edit, or remove options."
          : "Open the Reprimand Spend Editor to add, edit, or remove options.",
      createLabel: config.createLabel,
      emptyLabel: config.emptyLabel,
      closeLabel: "Close",
      awards: rows.map((row) => ({
        action: row.action,
        name: row.name,
        cost: row.cost ?? 1,
        costLabel:
          row.action === "increaseReputation" ||
          row.action === "reduceReputation"
            ? "Cost X"
            : Number.isFinite(row.costMax) && row.costMax > (row.cost ?? 0)
              ? `Cost ${row.cost ?? 0}\u2013${row.costMax}`
              : `Cost ${row.cost ?? 1}`,
        descriptionPreview: _truncateText(row.description ?? "", 150),
        isBuiltIn: row.isBuiltIn,
        enabled: row.enabled !== false,
      })),
      hasAwards: rows.length > 0,
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

    for (const card of html?.querySelectorAll(".sta-award-card-main") ?? []) {
      const activate = async () =>
        this._onCardActivate(card.dataset.awardAction);
      card.addEventListener("click", activate);
      card.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        await activate();
      });
    }

    for (const checkbox of html?.querySelectorAll(".sta-award-card-enable") ??
      []) {
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", async (event) => {
        event.stopPropagation();
        await this._setActionEnabled(
          checkbox.dataset.awardAction,
          checkbox.checked,
        );
      });
    }

    for (const button of html?.querySelectorAll(
      '[data-action="remove-award"]',
    ) ?? []) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this._removeCustomAward(button.dataset.awardAction);
      });
    }

    html
      ?.querySelector('[data-action="close-award-editor"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        this.close();
      });
  }

  async _onCardActivate(action) {
    const row = _getAllSpendOptionRows(this.category).find(
      (r) => r.action === action,
    );
    if (!row) return;

    if (row.isBuiltIn) {
      ui.notifications?.info?.(
        t("sta-officers-log.settings.customSpendOptions.builtInReadOnly") ||
          "Built-in options can only be enabled or disabled, not edited.",
      );
      return;
    }

    await this._openAwardDialog(action);
  }

  async _setActionEnabled(action, enabled) {
    if (!action) return;
    const row = _getAllSpendOptionRows(this.category).find(
      (r) => r.action === action,
    );
    if (!row) return;

    if (row.isBuiltIn) {
      await _setDefaultActionEnabled(this.category, action, enabled);
    } else {
      const custom = _getCustomRows(this.category);
      const index = custom.findIndex((r) => r.action === action);
      if (index < 0) return;
      custom[index] = { ...custom[index], enabled };
      await _saveCustomRows(this.category, custom);
    }

    await this.render(true);
  }

  async _removeCustomAward(action) {
    if (!action) return;
    const custom = _getCustomRows(this.category);
    const index = custom.findIndex((r) => r.action === action);
    if (index < 0) return;
    const award = custom[index];

    const config = _getSpendOptionCategoryConfig(this.category);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["sta-officers-log"],
      window: { title: config.removeConfirm },
      content: `<p>${_escapeHtml(award.name)}</p>`,
      yes: { label: "Remove" },
      no: {
        label:
          t("sta-officers-log.settings.customSpendOptions.awardCancel") ||
          "Cancel",
      },
      rejectClose: false,
      modal: true,
    });
    if (!confirmed) return;

    custom.splice(index, 1);
    await _saveCustomRows(this.category, custom);
    await this.render(true);
    ui.notifications?.info?.(config.removedLabel);
  }

  async _openAwardDialog(action = null) {
    const config = _getSpendOptionCategoryConfig(this.category);
    const custom = _getCustomRows(this.category);
    const index = action ? custom.findIndex((r) => r.action === action) : -1;
    const award = index >= 0 ? custom[index] : null;
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
        award?.action || _makeCustomAction(config.prefix, name, custom.length),
      name,
      cost: Math.max(0, parseInt(result.cost, 10) || 0),
      costMax:
        String(result.costMax ?? "").trim() === ""
          ? null
          : Math.max(0, parseInt(result.costMax, 10) || 0),
      description: String(result.description ?? "").trim(),
      enabled: award?.enabled ?? true,
    };

    if (index >= 0) {
      custom[index] = nextAward;
    } else {
      custom.push(nextAward);
    }

    await _saveCustomRows(this.category, custom);
    await this.render(true);
    ui.notifications?.info?.(
      _getSpendOptionCategoryConfig(this.category).saveLabel,
    );
  }
}

export function openAwardEditor(category = "acclaim") {
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
      awardTalentSelectorHint:
        t(
          "sta-officers-log.settings.customSpendOptions.awardTalentSelectorHint",
        ) ||
        "Choose which Award-type talents from your compendiums appear as Award options in the Spend Acclaim dialog.",
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
      ?.querySelector('[data-action="open-award-talent-selector"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        openAwardTalentSelector();
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
  game.settings.register(MODULE_ID, CUSTOM_ACCLAIM_OPTIONS_SETTING, {
    name: "Acclaim Spend Options",
    hint: "Custom acclaim spend options (built-in options are not stored here).",
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
        costMax: new foundry.data.fields.NumberField({
          required: false,
          nullable: true,
          integer: true,
          min: 0,
          initial: null,
        }),
        description: new foundry.data.fields.StringField(),
        enabled: new foundry.data.fields.BooleanField({ initial: true }),
      }),
    ),
    default: [],
  });

  game.settings.register(MODULE_ID, CUSTOM_REPRIMAND_OPTIONS_SETTING, {
    name: "Reprimand Spend Options",
    hint: "Custom reprimand spend options (built-in options are not stored here).",
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
        costMax: new foundry.data.fields.NumberField({
          required: false,
          nullable: true,
          integer: true,
          min: 0,
          initial: null,
        }),
        description: new foundry.data.fields.StringField(),
        enabled: new foundry.data.fields.BooleanField({ initial: true }),
      }),
    ),
    default: [],
  });

  game.settings.register(MODULE_ID, DISABLED_ACCLAIM_DEFAULTS_SETTING, {
    name: "Disabled Acclaim Defaults",
    hint: "Built-in acclaim spend options the GM has turned off.",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  game.settings.register(MODULE_ID, DISABLED_REPRIMAND_DEFAULTS_SETTING, {
    name: "Disabled Reprimand Defaults",
    hint: "Built-in reprimand spend options the GM has turned off.",
    scope: "world",
    config: false,
    type: Array,
    default: [],
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
