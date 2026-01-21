import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";

export const FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING =
  "focusPickerCustomCompendium";

export function parseCompendiumPackKeys(rawValue) {
  const raw = rawValue ?? "";

  // Backwards compatible: setting is stored as a String but we accept
  // comma-separated values ("module.packA, module.packB").
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0),
      ),
    );
  }

  return Array.from(
    new Set(
      String(raw)
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    ),
  );
}

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
    const keys = parseCompendiumPackKeys(
      game.settings.get(MODULE_ID, FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING) ??
        "",
    );
    return keys[0] ?? "";
  } catch (_) {
    return "";
  }
}

export function getFocusPickerCustomCompendiumKeys() {
  try {
    return parseCompendiumPackKeys(
      game.settings.get(MODULE_ID, FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING) ??
        "",
    );
  } catch (_) {
    return [];
  }
}

export const TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING =
  "talentPickerCustomCompendium";

export const TALENT_PICKER_CUSTOM_FOLDER_FILTER_SETTING =
  "talentPickerCustomCompendiumFolderFilter";

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

  game.settings.register(
    MODULE_ID,
    TALENT_PICKER_CUSTOM_FOLDER_FILTER_SETTING,
    {
      name: t(
        "sta-officers-log.settings.talentPickerCustomCompendiumFolderFilter.name",
      ),
      hint: t(
        "sta-officers-log.settings.talentPickerCustomCompendiumFolderFilter.hint",
      ),
      scope: "world",
      config: true,
      restricted: true,
      type: Boolean,
      default: false,
    },
  );
}

export function getTalentPickerCustomCompendiumKey() {
  try {
    const keys = parseCompendiumPackKeys(
      game.settings.get(MODULE_ID, TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING) ??
        "",
    );
    return keys[0] ?? "";
  } catch (_) {
    return "";
  }
}

export function getTalentPickerCustomCompendiumKeys() {
  try {
    return parseCompendiumPackKeys(
      game.settings.get(MODULE_ID, TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING) ??
        "",
    );
  } catch (_) {
    return [];
  }
}

export function getTalentPickerCustomFolderFilterEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, TALENT_PICKER_CUSTOM_FOLDER_FILTER_SETTING),
    );
  } catch (_) {
    return false;
  }
}
