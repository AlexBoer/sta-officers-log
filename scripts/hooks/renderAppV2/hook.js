/**
 * Render Application V2 Hook
 *
 * Main orchestration module for STA Officers Log sheet enhancements.
 * Registers the renderApplicationV2 hook and delegates to specialized
 * modules for each feature area (buttons, dialogs, sorting, etc.).
 *
 * @module sheetHooks/renderAppV2/hook
 */

import { installLabelValuesButton } from "./labelValuesButton.js";
import { installLogDeleteConfirmation } from "./deleteConfirmation.js";
import {
  areSheetEnhancementsEnabled,
  shouldShowLogUsedToggle,
} from "../../settings/clientSettings.js";
import { installChallengedToggleVisibility } from "./challengedToggleVisibility.js";

import { installCharacterLogListResizer } from "./logListResizer.js";
import { closeStaOfficersLogContextMenu } from "./contextMenu.js";
import {
  installOfficersLogButtonsInStaTracker,
  installMissionDirectivesInStaTracker,
} from "./trackerIntegration.js";
import { installCallbackSourceButtons } from "./callbackSourceButtons.js";
import { installSupportingCharImprovementButtons } from "./supportingCharImprovements.js";
import { handleBenefitDialogRender } from "./benefitDialogHandler.js";
import { handleItemSheetRender } from "./itemSheetHandlers.js";
import { installDicePoolFatigueNotice } from "./dicePoolFatigueNotice.js";
import { installMissionLogSortButton } from "./missionLogSortButton.js";
import { installUseDirectiveButton } from "./useDirectiveButton.js";
import {
  installUseScarButtons,
  installChooseAttributeButtons,
} from "./traitButtons.js";
import { installUseValueButtons } from "./useValue.js";
import { installChooseMilestoneBenefitButtons } from "./chooseMilestoneBenefit.js";
import { installItemUpdateHooks } from "./itemUpdateHooks.js";
import { installFatiguedAttributeDisplay } from "./fatiguedAttributeDisplay.js";

// ─────────────────────────────────────────────────────────────────────────────
// Handler: STA Tracker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle STA Tracker panel rendering.
 * Adds Officers Log buttons (GM only) and Mission Directives section (all users).
 *
 * @param {Application} app - The application being rendered.
 * @param {HTMLElement} root - The root element.
 */
function handleTrackerRender(app, root) {
  installOfficersLogButtonsInStaTracker(app, root);
  installMissionDirectivesInStaTracker(root);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: Dialogs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle dialog rendering (Dice Pool, Benefit dialogs).
 *
 * @param {Application} app - The application being rendered.
 * @param {HTMLElement} root - The root element.
 * @param {object} context - The render context.
 * @returns {boolean} Whether a dialog was handled (and further processing should stop).
 */
function handleDialogRender(app, root, context) {
  // Check if this is a Dice Pool dialog and add fatigue notice if needed
  try {
    installDicePoolFatigueNotice(app, root, context);
  } catch (err) {
    console.warn(
      "sta-officers-log | Failed to check fatigue in Dice Pool dialog",
      err,
    );
  }

  // DialogV2: force vertical benefit button layout by wrapping footer buttons.
  if (handleBenefitDialogRender(root)) {
    return true; // Not a sheet render; stop here.
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: Character Sheets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an actor uses the Supporting Character sheet class.
 *
 * @param {Actor} actor - The actor to check.
 * @returns {boolean} Whether the actor uses the supporting character sheet.
 */
function isSupportingCharacterSheet(actor) {
  const sheetClass =
    actor?.getFlag?.("core", "sheetClass") ??
    foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
    "";
  return String(sheetClass) === "sta.STASupportingSheet2e";
}

/**
 * Handle STA character sheet rendering.
 * Installs all interactive buttons and enhancements for character sheets.
 *
 * @param {Application} app - The application being rendered.
 * @param {HTMLElement} root - The root element.
 */
function handleCharacterSheetRender(app, root) {
  // Only target STA character sheet apps
  if (
    !app?.id?.startsWith("STACharacterSheet2e") &&
    !app?.id?.startsWith("STASupportingSheet2e")
  )
    return;

  const actor = app.actor;
  if (!actor || actor.type !== "character") return;

  // Mark fatigued attribute checkbox as disabled on the character sheet
  try {
    installFatiguedAttributeDisplay(root, actor);
  } catch (_) {
    // ignore
  }

  // Install supporting character improvement buttons in development tab
  try {
    if (isSupportingCharacterSheet(actor)) {
      installSupportingCharImprovementButtons(root, actor);
    }
  } catch (_) {
    // ignore
  }

  // Add sort button to Character Logs section and apply sorting
  installMissionLogSortButton(root, actor);

  // Character sheet UX: allow resizing the Character Log list height.
  try {
    installCharacterLogListResizer(root);
  } catch (_) {
    // ignore
  }

  // Logs: add a show-source icon button to flash the incoming-callback source.
  try {
    installCallbackSourceButtons(root, actor);
  } catch (_) {
    // ignore
  }

  // Logs: replace delete with a confirmation-wrapped delete.
  try {
    installLogDeleteConfirmation(root, actor);
  } catch (_) {
    // ignore
  }

  // Add the "Label Values" button once.
  installLabelValuesButton(root, actor, app);

  // Add a section-level "Use Directive" button once.
  installUseDirectiveButton(root, actor, app);

  // Add per-Trait "Use Scar" and "Choose Attribute" buttons.
  installUseScarButtons(root, actor, app);
  installChooseAttributeButtons(root, actor, app);

  // Add per-Value "Use Value" buttons.
  installUseValueButtons(root, actor, app);

  // Add a per-Log "Choose Benefit" button for logs which have a pending milestone.
  installChooseMilestoneBenefitButtons(root, actor, app);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Install the main renderApplicationV2 hook for STA Officers Log.
 *
 * This function sets up the central hook that intercepts all ApplicationV2 renders
 * in Foundry VTT and delegates to specialized handlers based on the application type.
 *
 * @example
 * // Called once during module initialization in main.js
 * installRenderApplicationV2Hook();
 */
export function installRenderApplicationV2Hook() {
  // Install item update hooks (createItem, updateItem, renderItemSheet, closeItemSheet)
  installItemUpdateHooks();

  Hooks.on("renderApplicationV2", (app, root /* HTMLElement */, context) => {
    // Ensure our custom context menu never survives a rerender.
    try {
      closeStaOfficersLogContextMenu();
    } catch (_) {
      // ignore
    }

    // Always drive CSS flags on STA character sheets, even if sheet enhancements are disabled.
    try {
      if (app?.id?.startsWith?.("STACharacterSheet2e") && root?.dataset) {
        root.dataset.staShowLogUsedToggle = shouldShowLogUsedToggle()
          ? "1"
          : "0";
        installChallengedToggleVisibility(root);
      }
    } catch (_) {
      // ignore
    }

    // Handle STA Tracker panel.
    handleTrackerRender(app, root);

    // Handle dialogs (Dice Pool, Benefit selection).
    if (handleDialogRender(app, root, context)) {
      return; // Dialog was handled; stop here.
    }

    // Everything below requires sheet enhancements to be enabled.
    if (!areSheetEnhancementsEnabled()) return;

    // Handle item sheet enhancements (milestone, log, trait, value).
    handleItemSheetRender(app, root);

    // Handle character sheet enhancements.
    handleCharacterSheetRender(app, root);
  });
}
