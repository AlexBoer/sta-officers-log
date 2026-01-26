/**
 * Item Flags & Checkboxes
 *
 * Flag utilities and UI controls for trait (scar/fatigue) and value (trauma) items.
 * Provides both the data layer (get/set flags) and the UI layer (checkboxes on sheets).
 */

import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import {
  isValueTrauma,
  setValueTraumaFlag,
  getValueItems,
} from "../../data/values.js";

// ─────────────────────────────────────────────────────────────────────────────
// Trait Flag Constants & Utilities
// ─────────────────────────────────────────────────────────────────────────────

const TRAIT_SCAR_FLAG = "isScar";
const TRAIT_FATIGUE_FLAG = "isFatigue";

export function isTraitScar(item) {
  if (!item || item.type !== "trait") return false;
  try {
    return Boolean(item.getFlag?.(MODULE_ID, TRAIT_SCAR_FLAG));
  } catch (_) {
    return false;
  }
}

export async function setTraitScarFlag(item, value) {
  if (!item || item.type !== "trait") return;
  await item.setFlag(MODULE_ID, TRAIT_SCAR_FLAG, Boolean(value));
}

export function isTraitFatigue(item) {
  if (!item || item.type !== "trait") return false;
  try {
    return Boolean(item.getFlag?.(MODULE_ID, TRAIT_FATIGUE_FLAG));
  } catch (_) {
    return false;
  }
}

export async function setTraitFatigueFlag(item, value) {
  if (!item || item.type !== "trait") return;
  await item.setFlag(MODULE_ID, TRAIT_FATIGUE_FLAG, Boolean(value));
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
        usedSwitch.checked = item.getFlag?.(MODULE_ID, "isScarUsed") ?? false;
      }
      const fatiguedSwitch = existingControl.querySelector(
        ".sta-trait-fatigued-switch",
      );
      if (fatiguedSwitch instanceof HTMLInputElement) {
        fatiguedSwitch.checked = isTraitFatigue(item);
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
    usedSwitch.checked = item.getFlag?.(MODULE_ID, "isScarUsed") ?? false;
    usedSwitch.title = usedTooltipText;

    const usedLabelSpan = document.createElement("span");
    usedLabelSpan.textContent = usedLabelText;

    usedLabelWrapper.appendChild(usedSwitch);
    usedLabelWrapper.appendChild(usedLabelSpan);
    control.appendChild(usedLabelWrapper);

    // Add divider before Fatigued checkbox
    const divider = document.createElement("span");
    divider.className = "sta-trait-checkbox-divider";
    divider.textContent = "|";
    control.appendChild(divider);

    // Add the "Fatigued" toggle switch
    const fatiguedTooltipText =
      t("sta-officers-log.traits.fatiguedTooltip") ??
      "Mark this trait as a Fatigued trait (auto-created when stress is maxed).";
    const fatiguedLabelText =
      t("sta-officers-log.traits.fatiguedLabel") ?? "Fatigued";

    const fatiguedLabelWrapper = document.createElement("label");
    fatiguedLabelWrapper.className = "checkbox sta-trait-fatigued-field";
    fatiguedLabelWrapper.title = fatiguedTooltipText;

    const fatiguedSwitch = document.createElement("input");
    fatiguedSwitch.type = "checkbox";
    fatiguedSwitch.className = "sta-trait-fatigued-switch";
    fatiguedSwitch.checked = isTraitFatigue(item);
    fatiguedSwitch.title = fatiguedTooltipText;

    const fatiguedLabelSpan = document.createElement("span");
    fatiguedLabelSpan.textContent = fatiguedLabelText;

    fatiguedLabelWrapper.appendChild(fatiguedSwitch);
    fatiguedLabelWrapper.appendChild(fatiguedLabelSpan);
    control.appendChild(fatiguedLabelWrapper);

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
        await item.setFlag(MODULE_ID, "isScarUsed", usedSwitch.checked);
      } catch (err) {
        console.error(`${MODULE_ID} | trait used toggle failed`, err);
        usedSwitch.checked = item.getFlag?.(MODULE_ID, "isScarUsed") ?? false;
      } finally {
        usedSwitch.disabled = false;
      }
    };

    const onFatiguedChange = async () => {
      fatiguedSwitch.disabled = true;
      try {
        await setTraitFatigueFlag(item, fatiguedSwitch.checked);
      } catch (err) {
        console.error(`${MODULE_ID} | trait fatigued toggle failed`, err);
        fatiguedSwitch.checked = isTraitFatigue(item);
      } finally {
        fatiguedSwitch.disabled = false;
      }
    };

    checkbox.addEventListener("change", onChange);
    usedSwitch.addEventListener("change", onUsedChange);
    fatiguedSwitch.addEventListener("change", onFatiguedChange);
  } catch (_) {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Value Trauma Checkbox (Sheet Enhancement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Installs a trauma checkbox on value item sheets.
 *
 * @param {HTMLElement} root - The root element of the item sheet
 * @param {Item} item - The value item being rendered
 */
export function installValueTraumaCheckbox(root, item) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "value") return;

    const nameInput = root.querySelector('input[name="name"]');
    if (!(nameInput instanceof HTMLInputElement)) return;
    const nameRow = nameInput.closest("div.row");
    if (!(nameRow instanceof HTMLElement)) return;

    const existingControl = nameRow.querySelector(".sta-value-trauma-control");
    const tooltipText =
      t("sta-officers-log.values.traumaTooltip") ??
      "Mark this Value as Trauma.";
    const labelText = t("sta-officers-log.values.traumaLabel") ?? "Trauma";

    let checkbox;
    if (existingControl instanceof HTMLElement) {
      checkbox = existingControl.querySelector(".sta-value-trauma-checkbox");
      if (checkbox instanceof HTMLInputElement) {
        checkbox.checked = isValueTrauma(item);
      }
      return;
    }

    const control = document.createElement("div");
    control.className = "sta-value-trauma-control";

    const labelWrapper = document.createElement("label");
    labelWrapper.className = "checkbox sta-value-trauma-field";
    labelWrapper.title = tooltipText;

    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "sta-value-trauma-checkbox";
    checkbox.checked = isValueTrauma(item);
    checkbox.title = tooltipText;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = labelText;

    labelWrapper.appendChild(checkbox);
    labelWrapper.appendChild(labelSpan);
    control.appendChild(labelWrapper);

    nameRow.appendChild(control);

    const onChange = async () => {
      checkbox.disabled = true;
      try {
        await setValueTraumaFlag(item, checkbox.checked);

        // Update the value's icon from V# to T# or vice versa
        try {
          const actor = item.parent;
          if (actor && actor.type === "character") {
            // Get the value's current position in the sorted list
            const values = getValueItems(actor);
            const sorted = values
              .slice()
              .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
            const idx = sorted.findIndex(
              (v) => String(v.id) === String(item.id),
            );

            if (idx >= 0) {
              const n = Math.min(idx + 1, 8); // VALUE_ICON_COUNT = 8
              // After toggling, isValueTrauma will return the new state
              const newIsTrauma = checkbox.checked;
              const newIconPath = newIsTrauma
                ? `modules/${MODULE_ID}/assets/ValueIcons/T${n}.webp`
                : `modules/${MODULE_ID}/assets/ValueIcons/V${n}.webp`;

              if (String(item.img ?? "") !== newIconPath) {
                await item.update({ img: newIconPath });
              }
            }
          }
        } catch (iconErr) {
          console.warn(`${MODULE_ID} | failed to update value icon`, iconErr);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | value trauma toggle failed`, err);
        checkbox.checked = isValueTrauma(item);
      } finally {
        checkbox.disabled = false;
      }
    };

    checkbox.addEventListener("change", onChange);
  } catch (_) {
    // ignore
  }
}
