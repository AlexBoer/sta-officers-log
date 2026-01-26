/**
 * Item Sheet Handlers
 *
 * Handles rendering enhancements for item sheets (milestone, log, trait, value),
 * including milestone associations, log chain links, and flag checkboxes.
 */

import { getActorFromAppOrItem, getItemFromApp } from "./sheetUtils.js";
import { filterMilestoneAssociatedLogOptions } from "./milestoneLinks.js";
import { installInlineLogChainLinkControls } from "./logLinkControls.js";
import { installLogMetaCollapsible } from "./logMetaCollapsible.js";
import {
  installTraitScarCheckbox,
  installValueTraumaCheckbox,
} from "./itemFlags.js";

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
export function handleItemSheetRender(app, root) {
  // Milestone/Log item sheets: enforce associations and allow manual linking.
  try {
    const item = getItemFromApp(app);
    if (item?.type === "milestone") {
      const actor = getActorFromAppOrItem(app, item);
      if (actor?.type === "character") {
        filterMilestoneAssociatedLogOptions(root, actor, item);
      }
    } else if (item?.type === "log") {
      const actor = getActorFromAppOrItem(app, item);
      if (actor?.type === "character") {
        installInlineLogChainLinkControls(root, actor, item);
      }

      // Log item sheet UX: show Name + Description first, collapse the rest.
      installLogMetaCollapsible(root, item);
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
    }
  } catch (_) {
    // ignore
  }
}
