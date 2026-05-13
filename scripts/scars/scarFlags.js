/**
 * Scar Flag Utilities & Checkboxes
 *
 * Flag utilities and UI controls for trait scar items.
 * Provides both the data layer (get/set flags) and the UI layer (checkboxes on sheets).
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";

// ─────────────────────────────────────────────────────────────────────────────
// Trait Flag Constants & Utilities
// ─────────────────────────────────────────────────────────────────────────────

const TRAIT_SCAR_FLAG = "isScar";

export function isTraitScar(item) {
  if (!item || item.type !== "trait") return false;
  try {
    return (
      item.system?.isScar === true ||
      item.getFlag?.(MODULE_ID, TRAIT_SCAR_FLAG) === true
    );
  } catch (_) {
    return false;
  }
}

export async function setTraitScarFlag(item, value) {
  if (!item || item.type !== "trait") return;
  await item.update({ "system.isScar": Boolean(value) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trait Scar/Fatigued Checkboxes (Sheet Enhancement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Installs scar/used/fatigued checkboxes on trait item sheets.
 *
 * @param {HTMLElement} root - The root element of the item sheet
 * @param {Item} item - The trait item being rendered
 */
export function installTraitScarCheckbox(root, item) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "trait") return;
    // Only show scar/used checkboxes for traits owned by a character
    if (!item.parent || item.parent.type !== "character") return;

    const quantityInput = root.querySelector('input[name="system.quantity"]');
    if (!(quantityInput instanceof HTMLInputElement)) return;
    const quantityRow = quantityInput.closest("div.row");
    if (!(quantityRow instanceof HTMLElement)) return;

    const existingControl = quantityRow.querySelector(
      ".sta-trait-scar-control",
    );
    const tooltipText =
      t("sta-officers-log.traits.scarTooltip") ?? "Mark this trait as a Scar.";
    const labelText = t("sta-officers-log.traits.scarLabel") ?? "Scar";
    const usedTooltipText =
      t("sta-officers-log.traits.usedTooltip") ?? "Mark this Scar as used.";
    const usedLabelText = t("sta-officers-log.traits.usedLabel") ?? "Used";

    let checkbox;
    if (existingControl instanceof HTMLElement) {
      checkbox = existingControl.querySelector(".sta-trait-scar-checkbox");
      if (checkbox instanceof HTMLInputElement) {
        checkbox.checked = isTraitScar(item);
      }
      const usedSwitch = existingControl.querySelector(
        ".sta-trait-used-switch",
      );
      if (usedSwitch instanceof HTMLInputElement) {
        usedSwitch.checked =
          item.system?.isScarUsed === true ||
          item.getFlag?.(MODULE_ID, "isScarUsed") === true;
      }
      return;
    }

    const control = document.createElement("div");
    control.className = "sta-trait-scar-control";

    const labelWrapper = document.createElement("label");
    labelWrapper.className = "checkbox sta-trait-scar-field";
    labelWrapper.title = tooltipText;

    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "sta-trait-scar-checkbox";
    checkbox.checked = isTraitScar(item);
    checkbox.title = tooltipText;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = labelText;

    labelWrapper.appendChild(checkbox);
    labelWrapper.appendChild(labelSpan);
    control.appendChild(labelWrapper);

    // Add the "Used" toggle switch
    const usedLabelWrapper = document.createElement("label");
    usedLabelWrapper.className = "checkbox sta-trait-used-field";
    usedLabelWrapper.title = usedTooltipText;

    const usedSwitch = document.createElement("input");
    usedSwitch.type = "checkbox";
    usedSwitch.className = "sta-trait-used-switch";
    usedSwitch.checked =
      item.system?.isScarUsed === true ||
      item.getFlag?.(MODULE_ID, "isScarUsed") === true;
    usedSwitch.title = usedTooltipText;

    const usedLabelSpan = document.createElement("span");
    usedLabelSpan.textContent = usedLabelText;

    usedLabelWrapper.appendChild(usedSwitch);
    usedLabelWrapper.appendChild(usedLabelSpan);
    control.appendChild(usedLabelWrapper);

    quantityRow.appendChild(control);

    const onChange = async () => {
      checkbox.disabled = true;
      try {
        await setTraitScarFlag(item, checkbox.checked);
      } catch (err) {
        console.error(`${MODULE_ID} | trait scar toggle failed`, err);
        checkbox.checked = isTraitScar(item);
      } finally {
        checkbox.disabled = false;
      }
    };

    const onUsedChange = async () => {
      usedSwitch.disabled = true;
      try {
        await item.update({ "system.isScarUsed": usedSwitch.checked });
      } catch (err) {
        console.error(`${MODULE_ID} | trait used toggle failed`, err);
        usedSwitch.checked =
          item.system?.isScarUsed === true ||
          item.getFlag?.(MODULE_ID, "isScarUsed") === true;
      } finally {
        usedSwitch.disabled = false;
      }
    };

    checkbox.addEventListener("change", onChange);
    usedSwitch.addEventListener("change", onUsedChange);
  } catch (_) {
    // ignore
  }
}
