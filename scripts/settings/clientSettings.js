import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";

export const CLIENT_SHEET_ENHANCEMENTS_SETTING = "enableSheetEnhancements";
export const CLIENT_SHOW_LOG_USED_TOGGLE_SETTING = "showLogUsedToggle";
export const CLIENT_HIDE_CHALLENGED_TOGGLE_SETTING = "hideChallengedToggle";
export const CLIENT_CHARACTER_LOG_MAX_HEIGHT_SETTING = "characterLogMaxHeight";
export const CLIENT_CHARACTER_MILESTONE_MAX_HEIGHT_SETTING =
  "characterMilestoneMaxHeight";
export const CLIENT_SUP_ADVANCEMENT_MAX_HEIGHT_SETTING =
  "supAdvancementMaxHeight";
export const CLIENT_ENABLE_FLOWCHART_VIEW_SETTING = "enableFlowchartView";
export const CLIENT_ENABLE_LCARS_MODE_SETTING = "enableLcarsMode";
export const WORLD_ENABLE_TRAUMA_RULES_SETTING = "enableTraumaRules";
export const WORLD_ENABLE_SCAR_RULES_SETTING = "enableScarRules";
export const WORLD_ENABLE_MISSION_LOG_JOURNALS_SETTING =
  "enableMissionLogJournals";
export const WORLD_TRAITS_MODE_SETTING = "traitsMode";
export const WORLD_SIMPLE_TRAITS_SETTING = "simpleTraits";
export const TRAITS_MODE_ITEM = "item";
export const TRAITS_MODE_SIMPLE = "simple";
export const SIMPLE_TRAIT_MAX_LEN = 200;

function _stripHtml(input) {
  const raw = String(input ?? "");
  try {
    const div = document.createElement("div");
    div.innerHTML = raw;
    return String(div.textContent ?? "");
  } catch (_err) {
    return raw.replace(/<[^>]*>/g, " ");
  }
}

export function sanitizeSimpleTraitText(input) {
  let s = _stripHtml(input);
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length > SIMPLE_TRAIT_MAX_LEN) s = s.slice(0, SIMPLE_TRAIT_MAX_LEN);
  return s;
}

function _normalizeSimpleTraitsList(list) {
  const arr = Array.isArray(list) ? list : [];
  const cleaned = [];
  const seen = new Set();

  for (const x of arr) {
    const s = sanitizeSimpleTraitText(x);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(s);
  }

  return cleaned;
}

async function _refreshTraitsUi() {
  try {
    const { rerenderStaTracker } = await import("../directives/directives.js");
    await rerenderStaTracker();
  } catch (_) {
    // tracker rerender is best-effort
  }

  try {
    game.staUtils?.refreshTraitsDialog?.();
  } catch (_) {
    // traits dialog refresh is best-effort
  }
}

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
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // sheet may have closed
          }
        }
      } catch (_) {
        // ui.windows not available yet
      }

      try {
        ui.controls?.initialize?.();
      } catch (_) {
        // controls may not be ready
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
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // sheet could be mid-render
          }
        }
      } catch (_) {
        // windows object may be empty
      }
    },
  });

  game.settings.register(MODULE_ID, CLIENT_HIDE_CHALLENGED_TOGGLE_SETTING, {
    name: t("sta-officers-log.settings.hideChallengedToggle.name"),
    hint: t("sta-officers-log.settings.hideChallengedToggle.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      try {
        // Force existing STA character sheets to redraw so the CSS toggle applies immediately.
        for (const app of Object.values(ui?.windows ?? {})) {
          try {
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // skip if sheet was destroyed
          }
        }
      } catch (_) {
        // safe to fail silently
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
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // sheet no longer exists
          }
        }
      } catch (_) {
        // non-critical rerender
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
              if (
                app?.id?.startsWith?.("STACharacterSheet2e") ||
                app?.id?.startsWith?.("LcarsCharacterSheet2e")
              )
                app.render?.(true);
            } catch (_) {
              // app may have been closed
            }
          }
        } catch (_) {
          // continue if windows inaccessible
        }
      },
    },
  );

  // Supporting character: allow resizing the Mission Introductions list height via drag handle.
  game.settings.register(MODULE_ID, CLIENT_SUP_ADVANCEMENT_MAX_HEIGHT_SETTING, {
    name: "Supporting Char Advancement Height",
    hint: "Height (px) for the Mission Introductions scroll area on supporting character sheets; updated by dragging the divider.",
    scope: "client",
    config: false,
    type: Number,
    default: 150,
    onChange: () => {
      try {
        for (const app of Object.values(ui?.windows ?? {})) {
          try {
            if (
              app?.id?.startsWith?.("STASupportingSheet2e") ||
              app?.id?.startsWith?.("LcarsSupportingSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // app may have been closed
          }
        }
      } catch (_) {
        // continue if windows inaccessible
      }
    },
  });

  // Client setting: Enable interactive flowchart view for mission logs
  game.settings.register(MODULE_ID, CLIENT_ENABLE_FLOWCHART_VIEW_SETTING, {
    name: t("sta-officers-log.settings.enableFlowchartView.name"),
    hint: t("sta-officers-log.settings.enableFlowchartView.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      try {
        // Force existing STA character sheets to redraw so flowchart button appears/disappears.
        for (const app of Object.values(ui?.windows ?? {})) {
          try {
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // sheet may have closed
          }
        }
      } catch (_) {
        // safe to fail silently
      }
    },
  });

  // Client setting: LCARS Mode — apply LCARS-inspired styling to all module dialogs
  // Hidden from the settings UI when sta-utils is active (sta-utils owns the toggle).
  game.settings.register(MODULE_ID, CLIENT_ENABLE_LCARS_MODE_SETTING, {
    name: t("sta-officers-log.settings.enableLcarsMode.name"),
    hint: t("sta-officers-log.settings.enableLcarsMode.hint"),
    scope: "client",
    config: false, // LCARS is controlled exclusively via sta-utils; never shown here
    type: Boolean,
    default: false,
    onChange: (enabled) => {
      // When sta-utils is active it manages this body class; skip to avoid conflicts.
      if (game.modules.get("sta-utils")?.active) return;
      try {
        document.body.classList.toggle("sta-officers-lcars-active", !!enabled);
      } catch (_) {
        // body may not be available
      }
      try {
        // Force existing STA character sheets to redraw so LCARS styling applies.
        for (const app of Object.values(ui?.windows ?? {})) {
          try {
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // sheet may have closed
          }
        }
      } catch (_) {
        // safe to fail silently
      }
    },
  });

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
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // sheet might be gone
          }
        }
      } catch (_) {
        // rerender is best-effort
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
            if (
              app?.id?.startsWith?.("STACharacterSheet2e") ||
              app?.id?.startsWith?.("LcarsCharacterSheet2e")
            )
              app.render?.(true);
          } catch (_) {
            // closed sheets can't rerender
          }
        }
      } catch (_) {
        // fail gracefully
      }
    },
  });

  // World setting: Auto-generate Mission Log journals from character log items
  game.settings.register(MODULE_ID, WORLD_ENABLE_MISSION_LOG_JOURNALS_SETTING, {
    name: t("sta-officers-log.settings.enableMissionLogJournals.name"),
    hint: t("sta-officers-log.settings.enableMissionLogJournals.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: async (enabled) => {
      if (!enabled) return; // turning off: leave journals as-is
      try {
        const { syncAllJournals } = await import("../journal/index.js");
        syncAllJournals();
      } catch (err) {
        console.error(`${MODULE_ID} | syncAllJournals (onChange) failed`, err);
      }
    },
  });

  game.settings.register(MODULE_ID, WORLD_TRAITS_MODE_SETTING, {
    name: t("sta-officers-log.settings.traitsMode.name"),
    hint: t("sta-officers-log.settings.traitsMode.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [TRAITS_MODE_ITEM]: t("sta-officers-log.settings.traitsMode.item"),
      [TRAITS_MODE_SIMPLE]: t("sta-officers-log.settings.traitsMode.simple"),
    },
    default: TRAITS_MODE_ITEM,
    restricted: true,
    onChange: () => {
      _refreshTraitsUi();
    },
  });

  game.settings.register(MODULE_ID, WORLD_SIMPLE_TRAITS_SETTING, {
    name: t("sta-officers-log.settings.simpleTraits.name"),
    hint: t("sta-officers-log.settings.simpleTraits.hint"),
    scope: "world",
    config: false,
    type: Array,
    default: [],
    restricted: true,
    onChange: () => {
      _refreshTraitsUi();
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

export function getSupAdvancementMaxHeightSetting() {
  try {
    const n = Number(
      game.settings.get(MODULE_ID, CLIENT_SUP_ADVANCEMENT_MAX_HEIGHT_SETTING),
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

export function shouldHideChallengedToggle() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, CLIENT_HIDE_CHALLENGED_TOGGLE_SETTING),
    );
  } catch (_) {
    return true;
  }
}

export function isFlowchartViewEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, CLIENT_ENABLE_FLOWCHART_VIEW_SETTING),
    );
  } catch (_) {
    return false;
  }
}

export function isLcarsModeEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, CLIENT_ENABLE_LCARS_MODE_SETTING),
    );
  } catch (_) {
    return false;
  }
}

export function getTraitsMode() {
  try {
    const mode = String(
      game.settings.get(MODULE_ID, WORLD_TRAITS_MODE_SETTING) ??
        TRAITS_MODE_ITEM,
    );
    return mode === TRAITS_MODE_SIMPLE ? TRAITS_MODE_SIMPLE : TRAITS_MODE_ITEM;
  } catch (_) {
    return TRAITS_MODE_ITEM;
  }
}

export function areSimpleTraitsEnabled() {
  return getTraitsMode() === TRAITS_MODE_SIMPLE;
}

export function getSimpleTraits() {
  try {
    const raw = game.settings.get(MODULE_ID, WORLD_SIMPLE_TRAITS_SETTING) ?? [];
    return _normalizeSimpleTraitsList(raw);
  } catch (_) {
    return [];
  }
}

export async function setSimpleTraits(list) {
  const cleaned = _normalizeSimpleTraitsList(list);
  await game.settings.set(MODULE_ID, WORLD_SIMPLE_TRAITS_SETTING, cleaned);
}
