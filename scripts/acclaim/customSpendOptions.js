/**
 * Custom Spend Options
 *
 * World settings for GM-defined custom awards, custom acclaim spend
 * options, and custom reprimand spend options.  Each category is stored
 * as an Array of objects `{ name, cost, description }` and surfaced
 * through an ApplicationV2 settings menu.
 *
 * Line format in the editor textarea:
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

/* ------------------------------------------------------------------ */
/*  Parsing helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse a single pipe-delimited line into an option object.
 *
 * Expected format: `Name | Cost | Description`
 * Cost defaults to 1 if omitted or non-numeric.
 *
 * @param {string} line
 * @returns {{ name: string, cost: number, description: string } | null}
 */
function _parseLine(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return null;

  const parts = trimmed.split("|").map((s) => s.trim());
  const name = parts[0] ?? "";
  if (!name) return null;

  const cost = Math.max(0, parseInt(parts[1], 10) || 1);
  const description = parts.slice(2).join("|").trim(); // allow pipes in desc

  return { name, cost, description };
}

/**
 * Convert an array of option objects back to newline-separated text
 * suitable for the settings textarea.
 *
 * @param {Array<{ name: string, cost: number, description: string }>} arr
 * @returns {string}
 */
function _toText(arr) {
  if (!Array.isArray(arr)) return "";
  return arr
    .map((o) => {
      const parts = [o.name ?? "", String(o.cost ?? 1)];
      if (o.description) parts.push(o.description);
      return parts.join(" | ");
    })
    .join("\n");
}

/**
 * Parse multi-line text into an array of option objects.
 *
 * @param {string} text
 * @returns {Array<{ name: string, cost: number, description: string }>}
 */
function _parseText(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map(_parseLine)
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  Getters                                                            */
/* ------------------------------------------------------------------ */

/**
 * Safely retrieve a stored array setting, returning [] on failure.
 * @param {string} key
 * @returns {Array<{ name: string, cost: number, description: string }>}
 */
function _getSetting(key) {
  try {
    const raw = game.settings.get(MODULE_ID, key) ?? [];
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

/**
 * Get custom awards defined by the GM.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number, isAward: true }>}
 */
export function getCustomAwards() {
  return _getSetting(CUSTOM_AWARDS_SETTING).map((o, i) => ({
    action: `customAward_${i}`,
    label: o.name,
    desc: o.description ?? "",
    cost: o.cost ?? 1,
    isAward: true,
    isCustom: true,
  }));
}

/**
 * Get custom acclaim spend options defined by the GM.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number }>}
 */
export function getCustomAcclaimOptions() {
  return _getSetting(CUSTOM_ACCLAIM_OPTIONS_SETTING).map((o, i) => ({
    action: `customAcclaim_${i}`,
    label: o.name,
    desc: o.description ?? "",
    cost: o.cost ?? 1,
    isCustom: true,
  }));
}

/**
 * Get custom reprimand spend options defined by the GM.
 *
 * @returns {Array<{ action: string, label: string, desc: string,
 *                    cost: number }>}
 */
export function getCustomReprimandOptions() {
  return _getSetting(CUSTOM_REPRIMAND_OPTIONS_SETTING).map((o, i) => ({
    action: `customReprimand_${i}`,
    label: o.name,
    desc: o.description ?? "",
    cost: o.cost ?? 1,
    isCustom: true,
  }));
}

/* ------------------------------------------------------------------ */
/*  Settings menu ApplicationV2                                        */
/* ------------------------------------------------------------------ */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
      customAwardsText: _toText(_getSetting(CUSTOM_AWARDS_SETTING)),
      customAcclaimText: _toText(_getSetting(CUSTOM_ACCLAIM_OPTIONS_SETTING)),
      customReprimandText: _toText(
        _getSetting(CUSTOM_REPRIMAND_OPTIONS_SETTING),
      ),
    };
  }

  static async #onSubmit(_event, form, formData) {
    const obj = formData.object ?? {};

    const awards = _parseText(obj.customAwardsText);
    const acclaim = _parseText(obj.customAcclaimText);
    const reprimand = _parseText(obj.customReprimandText);

    await game.settings.set(MODULE_ID, CUSTOM_AWARDS_SETTING, awards);
    await game.settings.set(MODULE_ID, CUSTOM_ACCLAIM_OPTIONS_SETTING, acclaim);
    await game.settings.set(
      MODULE_ID,
      CUSTOM_REPRIMAND_OPTIONS_SETTING,
      reprimand,
    );

    ui.notifications?.info?.(
      t("sta-officers-log.settings.customSpendOptions.saved") ||
        "Custom spend options saved.",
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
      name: new foundry.data.fields.StringField(),
      cost: new foundry.data.fields.NumberField({ integer: true, min: 0 }),
      description: new foundry.data.fields.StringField(),
    }),
  );

  game.settings.register(MODULE_ID, CUSTOM_AWARDS_SETTING, {
    name: "Custom Awards",
    hint: "GM-defined custom awards for the acclaim spend dialog.",
    scope: "world",
    config: false,
    type: fieldType,
    default: [],
  });

  game.settings.register(MODULE_ID, CUSTOM_ACCLAIM_OPTIONS_SETTING, {
    name: "Custom Acclaim Spend Options",
    hint: "GM-defined custom acclaim spend options.",
    scope: "world",
    config: false,
    // Re-create field type for each setting to avoid shared state issues
    type: new foundry.data.fields.ArrayField(
      new foundry.data.fields.SchemaField({
        name: new foundry.data.fields.StringField(),
        cost: new foundry.data.fields.NumberField({ integer: true, min: 0 }),
        description: new foundry.data.fields.StringField(),
      }),
    ),
    default: [],
  });

  game.settings.register(MODULE_ID, CUSTOM_REPRIMAND_OPTIONS_SETTING, {
    name: "Custom Reprimand Spend Options",
    hint: "GM-defined custom reprimand spend options.",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(
      new foundry.data.fields.SchemaField({
        name: new foundry.data.fields.StringField(),
        cost: new foundry.data.fields.NumberField({ integer: true, min: 0 }),
        description: new foundry.data.fields.StringField(),
      }),
    ),
    default: [],
  });

  game.settings.registerMenu(MODULE_ID, "customSpendOptionsMenu", {
    name:
      t("sta-officers-log.settings.customSpendOptions.name") ||
      "Custom Awards & Spend Options",
    label:
      t("sta-officers-log.settings.customSpendOptions.label") ||
      "Edit Custom Options",
    hint:
      t("sta-officers-log.settings.customSpendOptions.hint") ||
      "Define custom awards, acclaim spend options, and reprimand spend options.",
    icon: "fa-solid fa-trophy",
    type: CustomSpendOptionsSettingsApp,
    restricted: true,
  });
}
