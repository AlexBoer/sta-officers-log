import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";

export const CLIENT_SHEET_ENHANCEMENTS_SETTING = "enableSheetEnhancements";
export const CLIENT_MANUAL_CALLBACK_LOG_UPDATES_SETTING =
  "manualCallbackLogUpdates";

export const USER_MANUAL_CALLBACK_LOG_UPDATES_FLAG = "manualCallbackLogUpdates";

export function registerClientSettings() {
  game.settings.register(MODULE_ID, CLIENT_SHEET_ENHANCEMENTS_SETTING, {
    name: t("sta-officers-log.settings.enableSheetEnhancements.name"),
    hint: t("sta-officers-log.settings.enableSheetEnhancements.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      try {
        // Force existing sheets/controls to redraw so injected UI is removed/added.
        for (const app of Object.values(ui?.windows ?? {})) {
          try {
            if (app?.id?.startsWith?.("STACharacterSheet2e"))
              app.render?.(true);
          } catch (_) {
            // ignore
          }
        }
      } catch (_) {
        // ignore
      }

      try {
        ui.controls?.initialize?.();
      } catch (_) {
        // ignore
      }
    },
  });

  game.settings.register(
    MODULE_ID,
    CLIENT_MANUAL_CALLBACK_LOG_UPDATES_SETTING,
    {
      name: t("sta-officers-log.settings.manualCallbackLogUpdates.name"),
      hint: t("sta-officers-log.settings.manualCallbackLogUpdates.hint"),
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
      onChange: async (value) => {
        try {
          await game.user?.setFlag?.(
            MODULE_ID,
            USER_MANUAL_CALLBACK_LOG_UPDATES_FLAG,
            Boolean(value)
          );
        } catch (_) {
          // ignore
        }
      },
    }
  );
}

/**
 * Client-level toggle for whether this module should modify the STA character sheet UI.
 * Defaults to enabled.
 */
export function areSheetEnhancementsEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, CLIENT_SHEET_ENHANCEMENTS_SETTING)
    );
  } catch (_) {
    return true;
  }
}

/**
 * True if the given user's preference is to handle callback log changes manually.
 * This is stored as a User flag so the GM can read it.
 */
export function isUserManualCallbackLogUpdatesEnabled(userId) {
  try {
    const id = userId ? String(userId) : "";
    const user = id ? game.users?.get?.(id) : game.user;
    return (
      user?.getFlag?.(MODULE_ID, USER_MANUAL_CALLBACK_LOG_UPDATES_FLAG) === true
    );
  } catch (_) {
    return false;
  }
}
