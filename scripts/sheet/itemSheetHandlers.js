/**
 * Item Sheet Handlers
 *
 * Handles rendering enhancements for item sheets (milestone, log, trait, value),
 * including milestone associations, log chain links, and flag checkboxes.
 */

import { getActorFromAppOrItem, getItemFromApp } from "./sheetUtils.js";
import {
  filterMilestoneAssociatedLogOptions,
  hideAssociatedLogDropdowns,
} from "../milestones/milestoneLinks.js";
import { installInlineLogChainLinkControls } from "../log/logLinkControls.js";
import { installLogMetaCollapsible } from "../log/logMetaCollapsible.js";
import { installTraitScarCheckbox } from "../scars/scarFlags.js";
import { installValueTraumaCheckbox } from "../values/trauma/traumaCheckbox.js";
import { installTalentSecondRequirement } from "./talentSecondRequirement.js";
import { installTalentNpcSpeciesRequirement } from "./talentNpcSpeciesRequirement.js";
import { installTalentStarshipType } from "./talentStarshipType.js";

/**
 * Handle item sheet rendering enhancements.
 *
 * Applies the appropriate enhancements based on item type:
 * - **Milestone sheets**: Filters associated log options
 * - **Log sheets**: Installs chain link controls and collapsible metadata
 * - **Trait sheets**: Adds scar checkbox
 * - **Value sheets**: Adds trauma checkbox
 *
 * @param {Application} app - The application being rendered.
 * @param {HTMLElement} root - The root element of the sheet.
 */
export async function handleItemSheetRender(app, root) {
  // Milestone/Log item sheets: enforce associations and allow manual linking.
  try {
    const item = getItemFromApp(app);
    if (item?.type === "milestone") {
      const actor = getActorFromAppOrItem(app, item);
      if (actor?.type === "character") {
        // Keep the dropdown filtering logic (still needed for underlying functionality)
        filterMilestoneAssociatedLogOptions(root, actor, item);
        // Hide dropdowns and show simple "From: <log name>" text instead
        hideAssociatedLogDropdowns(root, actor, item);
      }
    } else if (item?.type === "log") {
      // Skip injection for OfficersLogSheet — it handles everything natively.
      if (app?.constructor?.name === "OfficersLogSheet") return;

      const actor = getActorFromAppOrItem(app, item);
      if (actor?.type === "character") {
        installInlineLogChainLinkControls(root, actor, item);
      }

      // Log item sheet UX: show Name + Description first, collapse the rest.
      await installLogMetaCollapsible(root, item);
    }
  } catch (_) {
    // ignore
  }

  // Trait/Value item sheets: add flag checkboxes.
  try {
    const item = getItemFromApp(app);
    if (item?.type === "trait") {
      installTraitScarCheckbox(root, item);
    } else if (item?.type === "value") {
      installValueTraumaCheckbox(root, item);
    } else if (item?.type === "talent") {
      installTalentStarshipType(root, item);
      installTalentSecondRequirement(root, item);
      installTalentNpcSpeciesRequirement(root, item);
    }
  } catch (_) {
    // ignore
  }
}
