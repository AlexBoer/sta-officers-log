/**
 * Value Trauma Checkbox (Sheet Enhancement)
 *
 * Installs a trauma checkbox on value item sheets, allowing users
 * to toggle the trauma flag and update the value's icon accordingly.
 */

import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import { getValueItems } from "../values.js";
import { isValueTrauma, setValueTraumaFlag } from "./trauma.js";

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
