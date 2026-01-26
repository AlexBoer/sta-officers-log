import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";

export const CLIENT_SHEET_ENHANCEMENTS_SETTING = "enableSheetEnhancements";
export const CLIENT_SHOW_LOG_USED_TOGGLE_SETTING = "showLogUsedToggle";
export const CLIENT_CHARACTER_LOG_MAX_HEIGHT_SETTING = "characterLogMaxHeight";
export const CLIENT_CHARACTER_MILESTONE_MAX_HEIGHT_SETTING =
  "characterMilestoneMaxHeight";
export const WORLD_ENABLE_TRAUMA_RULES_SETTING = "enableTraumaRules";
export const WORLD_ENABLE_SCAR_RULES_SETTING = "enableScarRules";

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

  game.settings.register(MODULE_ID, CLIENT_SHOW_LOG_USED_TOGGLE_SETTING, {
    name: t("sta-officers-log.settings.showLogUsedToggle.name"),
    hint: t("sta-officers-log.settings.showLogUsedToggle.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      try {
        // Force existing STA character sheets to redraw so the CSS toggle applies immediately.
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
    },
  });

  // Character sheet: allow resizing the Character Log list height via drag handle.
  game.settings.register(MODULE_ID, CLIENT_CHARACTER_LOG_MAX_HEIGHT_SETTING, {
    name: "Character Log Height",
    hint: "Height (px) for the Character Log scroll area; updated by dragging the divider.",
    scope: "client",
    config: false,
    type: Number,
    default: 150,
    onChange: () => {
      try {
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
    },
  });

  // Character sheet: allow resizing the Milestones list height via drag handle.
  game.settings.register(
    MODULE_ID,
    CLIENT_CHARACTER_MILESTONE_MAX_HEIGHT_SETTING,
    {
      name: "Character Milestones Height",
      hint: "Height (px) for the Milestones scroll area; updated by dragging the divider.",
      scope: "client",
      config: false,
      type: Number,
      default: 150,
      onChange: () => {
        try {
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
      },
    },
  );

  // World setting: Enable Trauma rules (23rd Century Campaign Guide)
  game.settings.register(MODULE_ID, WORLD_ENABLE_TRAUMA_RULES_SETTING, {
    name: t("sta-officers-log.settings.enableTraumaRules.name"),
    hint: t("sta-officers-log.settings.enableTraumaRules.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      try {
        // Force existing STA character sheets to redraw
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
    },
  });

  // World setting: Enable Scar rules (23rd Century Campaign Guide)
  game.settings.register(MODULE_ID, WORLD_ENABLE_SCAR_RULES_SETTING, {
    name: t("sta-officers-log.settings.enableScarRules.name"),
    hint: t("sta-officers-log.settings.enableScarRules.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      try {
        // Force existing STA character sheets to redraw
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
    },
  });
}

/**
 * Client-level toggle for whether this module should modify the STA character sheet UI.
 * Defaults to enabled.
 */
export function areSheetEnhancementsEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, CLIENT_SHEET_ENHANCEMENTS_SETTING),
    );
  } catch (_) {
    return true;
  }
}

export function shouldShowLogUsedToggle() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, CLIENT_SHOW_LOG_USED_TOGGLE_SETTING),
    );
  } catch (_) {
    return false;
  }
}

export function getCharacterLogMaxHeightSetting() {
  try {
    const n = Number(
      game.settings.get(MODULE_ID, CLIENT_CHARACTER_LOG_MAX_HEIGHT_SETTING),
    );
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

export function getCharacterMilestoneMaxHeightSetting() {
  try {
    const n = Number(
      game.settings.get(
        MODULE_ID,
        CLIENT_CHARACTER_MILESTONE_MAX_HEIGHT_SETTING,
      ),
    );
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

export function areTraumaRulesEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, WORLD_ENABLE_TRAUMA_RULES_SETTING),
    );
  } catch (_) {
    return false;
  }
}

export function areScarRulesEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, WORLD_ENABLE_SCAR_RULES_SETTING),
    );
  } catch (_) {
    return false;
  }
}
