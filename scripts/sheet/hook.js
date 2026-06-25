/**
 * Render Application V2 Hook
 *
 * Main orchestration module for STA Officers Log sheet enhancements.
 * Registers the renderApplicationV2 hook and delegates to specialized
 * modules for each feature area (buttons, dialogs, sorting, etc.).
 *
 * @module sheetHooks/renderAppV2/hook
 */

import { installLabelValuesButton } from "../values/labelValuesButton.js";
import { installLogDeleteConfirmation } from "../log/deleteConfirmation.js";
import {
  areSheetEnhancementsEnabled,
  shouldShowLogUsedToggle,
} from "../settings/clientSettings.js";

import { installCharacterLogListResizer } from "./logListResizer.js";
import { closeStaOfficersLogContextMenu } from "./contextMenu.js";
import {
  installOfficersLogButtonsInStaTracker,
  installMissionDirectivesInStaTracker,
  installTrackerInfoButtonsInStaTracker,
} from "../tracker/trackerIntegration.js";
import {
  installCallbackSourceButtons,
  installMilestoneHighlightButtons,
} from "../log/callbackSourceButtons.js";
import {
  installSupportingAdvancementHeaderButton,
  installSupportingCharImprovementButtons,
} from "../supporting/supportingCharImprovements.js";
import {
  installIntroduceSupportingCharButton,
  installChooseAdvancementButtons,
  isSupervisoryChar,
} from "../supporting/introduceButton.js";
import { handleBenefitDialogRender } from "./benefitDialogHandler.js";
import { handleItemSheetRender } from "./itemSheetHandlers.js";
import { installMissionLogSortButton } from "../log/missionLogSortButton.js";
import { installUnusedLogFilterButton } from "../log/unusedLogFilterButton.js";
import { installUseDirectiveButton } from "../directives/useDirectiveButton.js";
import { installUseScarButtons } from "../scars/traitButtons.js";
import { installUseValueButtons } from "../values/useValue.js";
import { installChooseMilestoneBenefitButtons } from "../milestones/chooseMilestoneBenefit.js";
import { installItemUpdateHooks } from "./itemUpdateHooks.js";
import { installFlowchartButton } from "../flowchart/flowchartButton.js";
import { installAcclaimButtonOverride } from "../acclaim/acclaimButton.js";
import { installCreationInPlayTab } from "../creation/creation-tab.mjs";
import { isUnlinkedTokenActor } from "../core/utils.js";
import { t } from "../core/i18n.js";
import { installIntroducedCrewList } from "../ship/introducedCrewList.js";

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
  installTrackerInfoButtonsInStaTracker(root);
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
  // force vertical benefit button layout by wrapping footer buttons.
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
  return (
    String(sheetClass) === "sta.STASupportingSheet2e" ||
    String(sheetClass) === "sta-utils.LcarsSupportingSheet2e"
  );
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
    !app?.id?.startsWith("STASupportingSheet2e") &&
    !app?.id?.startsWith("STANPCSheet2e") &&
    !app?.id?.startsWith("MobileCharacterSheet2e") &&
    !app?.id?.startsWith("LcarsCharacterSheet2e") &&
    !app?.id?.startsWith("LcarsSupportingSheet2e") &&
    !app?.id?.startsWith("LcarsNPCSheet2e")
  )
    return;

  const actor = app.actor;

  // Add the "Label Values" context menu on any supported STA actor sheet
  // that renders a Values section (main/supporting/NPC variants).
  if (actor) {
    installLabelValuesButton(root, actor, app);
  }

  if (!actor || actor.type !== "character") return;

  // Show a persistent warning banner if this sheet belongs to an unlinked token (GM only).
  try {
    if (game.user?.isGM && isUnlinkedTokenActor(actor)) {
      const existingBanner = root.querySelector(".sta-unlinked-token-banner");
      if (!existingBanner) {
        const banner = document.createElement("div");
        banner.className = "sta-unlinked-token-banner";
        banner.title =
          t("sta-officers-log.unlinkedToken.warningTitle") ??
          "Unlinked Token Warning";
        banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${
          t("sta-officers-log.unlinkedToken.warningMessage") ??
          "This token is not linked to its world actor. Changes (including log entries) will not persist."
        }`;
        root.prepend(banner);
      }
    }
  } catch (_) {
    // non-critical
  }

  // Add flowchart button to Character Logs section (if enabled)
  try {
    installFlowchartButton(root, actor);
  } catch (_) {
    // ignore
  }

  // Install supporting character improvement buttons in development tab
  try {
    if (isSupportingCharacterSheet(actor)) {
      installSupportingCharImprovementButtons(root, actor);
      installSupportingAdvancementHeaderButton(root, actor);
      installIntroduceSupportingCharButton(root, actor);
      installChooseAdvancementButtons(root, actor);
      // Rename "Milestones / Arcs" header to "Advancements" on supporting sheets
      const milestoneTitleEl = root.querySelector(
        ".section.milestones > .title",
      );
      if (milestoneTitleEl) {
        const titleText = milestoneTitleEl.childNodes[0];
        if (titleText?.nodeType === Node.TEXT_NODE) {
          titleText.textContent = "Advancements";
        }
      }
      // Remove the "Is Arc" column header and checkboxes — supporting characters cannot have arcs
      root
        .querySelector(
          ".section.milestones .header.row .two-column-with-roll-secondary",
        )
        ?.remove();
      for (const cb of root.querySelectorAll(
        ".section.milestones li.row.entry input.item-quantity",
      )) {
        cb.remove();
      }
      // Inject supervisory-character checkbox into the biography tab next to the klingon checkbox
      _installSupervisoryCheckbox(root, actor);
    }
  } catch (_) {
    // ignore
  }

  // Add sort button to Character Logs section and apply sorting
  const sortActions = installMissionLogSortButton(root, actor);

  // Add toggle to hide logs with no invoked ValueStates.
  installUnusedLogFilterButton(root, actor, sortActions);

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

  // Milestones: add a button to highlight associated logs.
  try {
    installMilestoneHighlightButtons(root, actor);
  } catch (_) {
    // ignore
  }

  // Logs: replace delete with a confirmation-wrapped delete.
  try {
    installLogDeleteConfirmation(root, actor);
  } catch (_) {
    // ignore
  }

  // Add a section-level "Use Directive" button once.
  installUseDirectiveButton(root, actor, app);

  // Add per-Trait "Use Scar" buttons.
  installUseScarButtons(root, actor, app);

  // Add per-Value "Use Value" buttons.
  installUseValueButtons(root, actor, app);

  // Add a per-Log "Choose Benefit" button for logs which have a pending milestone.
  installChooseMilestoneBenefitButtons(root, actor, app);

  // Replace Roll Acclaim button with custom dialog (main characters only).
  if (!isSupportingCharacterSheet(actor)) {
    try {
      installAcclaimButtonOverride(root, actor, app);
    } catch (_) {
      // ignore
    }
  }

  // Install Creation in Play tab (if the actor has the creationInPlay flag).
  try {
    installCreationInPlayTab(root, actor, app);
  } catch (_) {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supervisory character checkbox
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_ID_FOR_HOOK = "sta-officers-log";

/**
 * Inject a "Supervisory Character" checkbox into the biography tab of a
 * supporting character sheet, placed next to the "Am I Klingon?" checkbox.
 */
function _installSupervisoryCheckbox(root, actor) {
  // Guard: inject once per render
  if (root.querySelector(".sta-supervisory-char-row")) return;

  const klingonDiv = root.querySelector(".amiklingon");
  if (!klingonDiv) return;

  const isChecked = isSupervisoryChar(actor);

  const row = document.createElement("div");
  row.className = "amiklingon sta-supervisory-char-row";

  const label = document.createElement("label");
  label.htmlFor = "sta-supervisory-char-cb";
  label.style.marginRight = "5px";
  label.title = t("sta-officers-log.supporting.supervisoryCharTooltip");
  label.textContent =
    t("sta-officers-log.supporting.supervisoryChar") || "Supervisory Character";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = "sta-supervisory-char-cb";
  cb.className = "checkbox";
  cb.checked = isChecked;
  cb.title = t("sta-officers-log.supporting.supervisoryCharTooltip");

  cb.addEventListener("change", async () => {
    try {
      await actor.setFlag(MODULE_ID_FOR_HOOK, "isSupervisoryChar", cb.checked);
    } catch (err) {
      console.error(
        `${MODULE_ID_FOR_HOOK} | Failed to set supervisory flag`,
        err,
      );
      cb.checked = !cb.checked; // revert on error
    }
  });

  row.appendChild(label);
  row.appendChild(cb);

  // Insert after the klingon row
  klingonDiv.insertAdjacentElement("afterend", row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────────────────

// Guard to prevent duplicate hook installation
let _staRenderApplicationV2HookInstalled = false;

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
  if (_staRenderApplicationV2HookInstalled) return;
  _staRenderApplicationV2HookInstalled = true;

  // Install item update hooks (createItem, updateItem, renderItemSheet, closeItemSheet)
  installItemUpdateHooks();

  Hooks.on("renderApplicationV2", (app, root /* HTMLElement */, context) => {
    // Early exit for non-STA applications to minimize overhead
    const appId = app?.id ?? "";
    const isStaApp =
      appId.startsWith("STACharacterSheet2e") ||
      appId.startsWith("STASupportingSheet2e") ||
      appId.startsWith("STATracker") ||
      appId.startsWith("sta-") ||
      appId.startsWith("MobileCharacterSheet2e") ||
      appId.startsWith("LcarsCharacterSheet2e") ||
      appId.startsWith("LcarsSupportingSheet2e") ||
      appId.startsWith("LcarsStarshipSheet2e") ||
      appId.startsWith("STAStarshipSheet2e") ||
      app?.constructor?.name?.startsWith?.("STA");
    const isDialog =
      app?.constructor?.name === "DialogV2" || appId.startsWith("dialog-");
    const isItemSheet = appId.includes("ItemSheet") || app?.object?.type;

    // Skip entirely if this is clearly not an STA-related application
    if (!isStaApp && !isDialog && !isItemSheet) return;
    // Ensure our custom context menu never survives a rerender.
    try {
      closeStaOfficersLogContextMenu();
    } catch (_) {
      // ignore
    }

    // Always drive CSS flags on STA character sheets, even if sheet enhancements are disabled.
    try {
      if (
        (app?.id?.startsWith?.("STACharacterSheet2e") ||
          app?.id?.startsWith?.("MobileCharacterSheet2e") ||
          app?.id?.startsWith?.("LcarsCharacterSheet2e")) &&
        root?.dataset
      ) {
        root.dataset.staShowLogUsedToggle = shouldShowLogUsedToggle()
          ? "1"
          : "0";
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

    // Handle starship sheet enhancements.
    handleStarshipSheetRender(app, root);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler: Starship Sheets
// ─────────────────────────────────────────────────────────────────────────────

function handleStarshipSheetRender(app, root) {
  if (
    !app?.id?.startsWith("LcarsStarshipSheet2e") &&
    !app?.id?.startsWith("STAStarshipSheet2e")
  )
    return;

  const actor = app.actor;
  if (!actor || actor.type !== "starship") return;

  try {
    installIntroducedCrewList(root, actor);
  } catch (_) {
    // ignore
  }
}
