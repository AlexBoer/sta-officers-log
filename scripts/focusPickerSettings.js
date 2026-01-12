import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";

export const FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING =
  "focusPickerCustomCompendium";

export function registerFocusPickerSettings() {
  game.settings.register(MODULE_ID, FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING, {
    name: t("sta-officers-log.settings.focusPickerCustomCompendium.name"),
    hint: t("sta-officers-log.settings.focusPickerCustomCompendium.hint"),
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "",
  });
}

export function getFocusPickerCustomCompendiumKey() {
  try {
    return String(
      game.settings.get(MODULE_ID, FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING) ?? ""
    ).trim();
  } catch (_) {
    return "";
  }
}

export const TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING =
  "talentPickerCustomCompendium";

export function registerTalentPickerSettings() {
  game.settings.register(MODULE_ID, TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING, {
    name: t("sta-officers-log.settings.talentPickerCustomCompendium.name"),
    hint: t("sta-officers-log.settings.talentPickerCustomCompendium.hint"),
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "",
  });
}

export function getTalentPickerCustomCompendiumKey() {
  try {
    return String(
      game.settings.get(MODULE_ID, TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING) ??
        ""
    ).trim();
  } catch (_) {
    return "";
  }
}
