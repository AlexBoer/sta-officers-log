/**
 * Challenged Toggle Visibility
 *
 * Manages the visibility of the "Chal?" toggle on Value entries based on
 * client settings. When enabled, the toggle is hidden until a value has
 * been challenged (allowing manual reset).
 *
 * @module sheetHooks/renderAppV2/challengedToggleVisibility
 */

import { shouldHideChallengedToggle } from "../../settings/clientSettings.js";

/**
 * Install the data attribute for challenged toggle visibility on character sheets.
 * CSS rules use this attribute to show/hide the toggle based on the setting
 * and the current challenged state (read from fa-toggle-on/fa-toggle-off classes).
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 */
export function installChallengedToggleVisibility(root) {
  if (!root?.dataset) return;

  root.dataset.staHideChallengedToggle = shouldHideChallengedToggle()
    ? "1"
    : "0";
}
