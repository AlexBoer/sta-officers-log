import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";

export const WORLD_ALLOW_SAVING_ADJUSTMENTS_SETTING =
  "allowSavingAdjustments";

export function getAllowSavingAdjustments() {
  try {
    return game.settings.get(
      MODULE_ID,
      WORLD_ALLOW_SAVING_ADJUSTMENTS_SETTING,
    ) !== false;
  } catch (error) {
    console.error(
      `${MODULE_ID} | failed to read Allow Saving Adjustments setting`,
      error,
    );
    return true;
  }
}

export function registerAdjustmentSettings() {
  game.settings.register(
    MODULE_ID,
    WORLD_ALLOW_SAVING_ADJUSTMENTS_SETTING,
    {
      name: t("sta-officers-log.settings.allowSavingAdjustments.name"),
      hint: t("sta-officers-log.settings.allowSavingAdjustments.hint"),
      scope: "world",
      config: true,
      restricted: true,
      type: Boolean,
      default: true,
    },
  );
}
