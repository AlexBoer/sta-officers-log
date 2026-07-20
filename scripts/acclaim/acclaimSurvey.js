/**
 * Acclaim Survey Settings
 *
 * World setting for storing acclaim survey questions that GMs can configure.
 * Questions are stored one per line, similar to mission directives.
 * Supports two sets: Positive Influences and Negative Influences.
 *
 * @module data/acclaimSurvey
 */

import { MODULE_ID } from "../core/constants.js";
import { applyKlingonMode, t } from "../core/i18n.js";

export const ACCLAIM_POSITIVE_QUESTIONS_SETTING = "acclaimPositiveQuestions";
export const ACCLAIM_NEGATIVE_QUESTIONS_SETTING = "acclaimNegativeQuestions";
export const ACCLAIM_SURVEY_ENABLED_SETTING = "acclaimSurveyEnabled";

/** Default positive influence questions (STA 2e rulebook). */
const DEFAULT_POSITIVE_QUESTIONS = [
  "Was your mission successful?",
  "Did you positively use one or more of the mission's Directives?",
  "Did you obey the orders given to you by your superiors?",
  "Did you prevent combat from occurring, or avoid escalating hostilities?",
  "Did you establish common ground or peaceful cooperation with those who were newly encountered or who were previously hostile to you?",
  "Did you directly contribute to saving the lives of innocent people or your fellow crew?",
  "Did you take all reasonable action to render aid to those in urgent need or distress?",
];

/** Default negative influence questions (STA 2e rulebook). */
const DEFAULT_NEGATIVE_QUESTIONS = [
  "Was your mission a failure?",
  "Did you challenge one of the mission's Directives?",
  "Were you disobedient to your superiors?",
  "Were personnel under your command killed during the mission?",
  "Did you employ force to any ends other than the defense of self, ship, crew, or innocent life?",
  "Did you employ lethal force during the mission?",
  "Did you take any unnecessary risks during the mission?",
  "Did you cause, or allow through inaction, innocent lives to be lost during the mission?",
  "Did you lie, cheat, threaten, or coerce others to achieve objectives during the mission?",
  "Did you permit a colleague or subordinate to act unethically or illegally during the performance of their duties?",
];

/**
 * Check if the acclaim survey feature is enabled.
 *
 * @returns {boolean} Whether the acclaim survey is enabled.
 */
export function isAcclaimSurveyEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, ACCLAIM_SURVEY_ENABLED_SETTING),
    );
  } catch (_) {
    return false;
  }
}

/**
 * Get the current positive influence questions.
 *
 * @returns {string[]} Array of positive influence questions.
 */
export function getAcclaimPositiveQuestions() {
  try {
    const raw =
      game.settings.get(MODULE_ID, ACCLAIM_POSITIVE_QUESTIONS_SETTING) ?? [];
    const arr = Array.isArray(raw) ? raw : [];
    const result = arr.map((s) => applyKlingonMode(String(s))).filter(Boolean);
    return result.length > 0
      ? result
      : DEFAULT_POSITIVE_QUESTIONS.map((s) => applyKlingonMode(s));
  } catch (_) {
    return DEFAULT_POSITIVE_QUESTIONS.map((s) => applyKlingonMode(s));
  }
}

/**
 * Get the current negative influence questions.
 *
 * @returns {string[]} Array of negative influence questions.
 */
export function getAcclaimNegativeQuestions() {
  try {
    const raw =
      game.settings.get(MODULE_ID, ACCLAIM_NEGATIVE_QUESTIONS_SETTING) ?? [];
    const arr = Array.isArray(raw) ? raw : [];
    const result = arr.map((s) => applyKlingonMode(String(s))).filter(Boolean);
    return result.length > 0
      ? result
      : DEFAULT_NEGATIVE_QUESTIONS.map((s) => applyKlingonMode(s));
  } catch (_) {
    return DEFAULT_NEGATIVE_QUESTIONS.map((s) => applyKlingonMode(s));
  }
}

/**
 * Set the positive influence questions.
 *
 * @param {string[]} list - Array of questions.
 */
export async function setAcclaimPositiveQuestions(list) {
  const arr = Array.isArray(list) ? list : [];
  const cleaned = [];

  for (const x of arr) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    cleaned.push(s);
  }

  await game.settings.set(
    MODULE_ID,
    ACCLAIM_POSITIVE_QUESTIONS_SETTING,
    cleaned,
  );
}

/**
 * Set the negative influence questions.
 *
 * @param {string[]} list - Array of questions.
 */
export async function setAcclaimNegativeQuestions(list) {
  const arr = Array.isArray(list) ? list : [];
  const cleaned = [];

  for (const x of arr) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    cleaned.push(s);
  }

  await game.settings.set(
    MODULE_ID,
    ACCLAIM_NEGATIVE_QUESTIONS_SETTING,
    cleaned,
  );
}

// --- Settings menu ---

// v13+ ApplicationV2 + HandlebarsApplicationMixin
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AcclaimSurveySettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-acclaim-survey-settings`,
    tag: "form",
    window: {
      title: "sta-officers-log.settings.acclaimSurvey.menuTitle",
      contentClasses: ["standard-form"],
    },
    position: {
      width: 560,
      height: "auto",
    },
    form: {
      closeOnSubmit: true,
      handler: AcclaimSurveySettingsApp.#onSubmit,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/acclaim-survey-settings.hbs`,
    },
  };

  async _prepareContext(_options) {
    const positiveList = getAcclaimPositiveQuestions();
    const negativeList = getAcclaimNegativeQuestions();
    return {
      positiveQuestionsText: positiveList.join("\n"),
      negativeQuestionsText: negativeList.join("\n"),
    };
  }

  static async #onSubmit(_event, form, formData) {
    const rawPositive = String(formData.object?.positiveQuestionsText ?? "");
    const positiveLines = rawPositive
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const rawNegative = String(formData.object?.negativeQuestionsText ?? "");
    const negativeLines = rawNegative
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean);

    await setAcclaimPositiveQuestions(positiveLines);
    await setAcclaimNegativeQuestions(negativeLines);

    ui.notifications?.info?.(
      t("sta-officers-log.settings.acclaimSurvey.saved") ||
        "Acclaim survey questions saved.",
    );
  }
}

/**
 * Register the acclaim survey world setting and settings menu.
 */
export function registerAcclaimSurveySettings() {
  // World setting: Enable/disable acclaim survey
  game.settings.register(MODULE_ID, ACCLAIM_SURVEY_ENABLED_SETTING, {
    name: t("sta-officers-log.settings.acclaimSurvey.enabledName"),
    hint: t("sta-officers-log.settings.acclaimSurvey.enabledHint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      try {
        // Force existing STA character sheets to redraw
        for (const actor of game.actors ?? []) {
          try {
            if (actor.sheet?.rendered) actor.sheet.render(true);
          } catch (_) {
            // sheet may have closed
          }
        }
      } catch (_) {
        // safe to fail silently
      }
    },
  });

  game.settings.register(MODULE_ID, ACCLAIM_POSITIVE_QUESTIONS_SETTING, {
    name: "Acclaim Positive Influence Questions",
    hint: "Internal list of positive influence questions.",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(
      new foundry.data.fields.StringField(),
    ),
    default: [
      "Was your mission successful?",
      "Did you positively use one or more of the mission's Directives?",
      "Did you obey the orders given to you by your superiors?",
      "Did you prevent combat from occurring, or avoid escalating hostilities?",
      "Did you establish common ground or peaceful cooperation with those who were newly encountered or who were previously hostile to you?",
      "Did you directly contribute to saving the lives of innocent people or your fellow crew?",
      "Did you take all reasonable action to render aid to those in urgent need or distress?",
    ],
  });

  game.settings.register(MODULE_ID, ACCLAIM_NEGATIVE_QUESTIONS_SETTING, {
    name: "Acclaim Negative Influence Questions",
    hint: "Internal list of negative influence questions.",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(
      new foundry.data.fields.StringField(),
    ),
    default: [
      "Was your mission a failure?",
      "Did you challenge one of the mission's Directives?",
      "Were you disobedient to your superiors?",
      "Were personnel under your command killed during the mission?",
      "Did you employ force to any ends other than the defense of self, ship, crew, or innocent life?",
      "Did you employ lethal force during the mission?",
      "Did you take any unnecessary risks during the mission?",
      "Did you cause, or allow through inaction, innocent lives to be lost during the mission?",
      "Did you lie, cheat, threaten, or coerce others to achieve objectives during the mission?",
      "Did you permit a colleague or subordinate to act unethically or illegally during the performance of their duties?",
    ],
  });

  game.settings.registerMenu(MODULE_ID, "acclaimSurveyMenu", {
    name:
      t("sta-officers-log.settings.acclaimSurvey.name") ||
      "Acclaim Survey Questions",
    label:
      t("sta-officers-log.settings.acclaimSurvey.label") || "Edit Questions",
    hint:
      t("sta-officers-log.settings.acclaimSurvey.hint") ||
      "Define the survey questions shown when rolling acclaim.",
    icon: "fa-solid fa-clipboard-question",
    type: AcclaimSurveySettingsApp,
    restricted: true,
  });
}
