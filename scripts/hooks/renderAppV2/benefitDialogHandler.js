/**
 * Benefit Dialog Handler
 *
 * Handles rendering enhancements for the milestone benefit selection dialog,
 * including vertical button layout and supporting character benefit caps.
 */

import { installSupportingBenefitCaps } from "./supportingCharImprovements.js";

/**
 * Handle DialogV2 benefit dialog rendering.
 * Forces vertical benefit button layout by wrapping footer buttons.
 *
 * @param {HTMLElement} root - The root element of the dialog.
 * @returns {boolean} Whether this was a benefit dialog (and processing should stop).
 */
export function handleBenefitDialogRender(root) {
  // We use an in-content marker because DialogV2 window classes are not always
  // applied in a way that is easy to target with CSS.
  if (!root?.querySelector?.('[data-sta-callbacks-dialog="choose-benefit"]')) {
    return false;
  }

  const footer =
    root.querySelector("footer.form-footer") ??
    root.querySelector(".form-footer") ??
    null;

  if (footer && !footer.querySelector(".sta-callbacks-vertical-footer")) {
    const wrapper = document.createElement("div");
    wrapper.className = "sta-callbacks-vertical-footer";
    while (footer.firstChild) wrapper.appendChild(footer.firstChild);
    footer.appendChild(wrapper);
  }

  // Supporting-character benefit picker: dynamically disable buttons when caps are reached.
  if (root.querySelector?.('[data-sta-callbacks-supporting-benefit="1"]')) {
    installSupportingBenefitCaps(root);
  }

  return true;
}
