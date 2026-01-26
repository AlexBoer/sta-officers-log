import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import { escapeHTML } from "../../data/values.js";
import {
  ATTRIBUTE_KEYS,
  DISCIPLINE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
} from "../../core/gameConstants.js";
import { _getFirstExistingNumeric } from "../../callbackFlow/dialogs.js";
import { applyNonArcMilestoneBenefitInternal } from "../../callbackFlow/benefits.js";

/**
 * Installs caps/limits on the supporting character benefit buttons in the
 * GM's "Improve Supporting Character" dialog.
 *
 * @param {HTMLElement} root - The root element of the dialog
 */
export function installSupportingBenefitCaps(root) {
  if (!root) return;
  if (root.dataset.staSupportingBenefitCapsBound === "1") return;
  root.dataset.staSupportingBenefitCapsBound = "1";

  const getNumeric = (obj, path) => {
    const v = foundry.utils.getProperty(obj, path);
    if (v === 0 || v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const select = root.querySelector('select[name="supportingActorId"]');
  if (!(select instanceof HTMLSelectElement)) return;

  const findActionButton = (action) =>
    root.querySelector(
      `button[data-action="${action}"], footer button[data-action="${action}"]`,
    );

  const setDisabled = (action, disabled) => {
    const btn = findActionButton(action);
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.disabled = Boolean(disabled);
    btn.classList.toggle("is-disabled", Boolean(disabled));
    btn.setAttribute("aria-disabled", disabled ? "true" : "false");
  };

  const isAnyAttributeBelowCap = (actor, cap) => {
    for (const k of ATTRIBUTE_KEYS) {
      const v =
        getNumeric(actor, `system.attribute.${k}.value`) ??
        getNumeric(actor, `system.attributes.${k}.value`);
      if (v == null) continue;
      if (v < cap) return true;
    }
    return false;
  };

  const isAnyDisciplineBelowCap = (actor, cap) => {
    for (const k of DISCIPLINE_KEYS) {
      const v = getNumeric(actor, `system.disciplines.${k}.value`);
      if (v == null) continue;
      if (v < cap) return true;
    }
    return false;
  };

  const update = () => {
    const actorId = String(select.value ?? "");
    const a = actorId ? (game.actors?.get?.(actorId) ?? null) : null;
    if (!a) {
      setDisabled("attr", true);
      setDisabled("disc", true);
      setDisabled("focus", true);
      setDisabled("talent", true);
      return;
    }

    // Caps per request
    const attrCap = 12;
    const discCap = 5;
    const maxFocuses = 6;
    const maxTalents = 4;

    const focusCount = (a.items ?? []).filter(
      (i) => i?.type === "focus",
    ).length;
    const talentCount = (a.items ?? []).filter(
      (i) => i?.type === "talent" || i?.type === "shipTalent",
    ).length;

    const canIncreaseAttr = isAnyAttributeBelowCap(a, attrCap);
    const canIncreaseDisc = isAnyDisciplineBelowCap(a, discCap);

    setDisabled("attr", !canIncreaseAttr);
    setDisabled("disc", !canIncreaseDisc);
    setDisabled("focus", focusCount >= maxFocuses);
    setDisabled("talent", talentCount >= maxTalents);
  };

  select.addEventListener("change", update);
  update();
}

/**
 * Auto-check the next unchecked checkbox for an improvement type.
 * If all are checked, disable the button.
 */
async function checkAndAutoCheckNext(actor, improvementType, button) {
  if (!actor || !button) return;

  try {
    const checkboxes = button
      .closest(".supporting-char-grid")
      ?.querySelector(
        `.row[data-improvement-type="${improvementType}"] .inputs`,
      )
      ?.querySelectorAll("input[type='checkbox']");

    if (!checkboxes) return;

    // Find the first unchecked box and check it
    let allWillBeChecked = true;
    let foundUncheckedBox = false;

    for (const cb of checkboxes) {
      if (!cb.checked) {
        const flagName = cb.getAttribute("name");
        if (flagName && !foundUncheckedBox) {
          try {
            const updates = {};
            updates[flagName] = true;
            await actor.update(updates);
            foundUncheckedBox = true;
          } catch (_) {
            // ignore
          }
        } else if (!foundUncheckedBox) {
          // Another unchecked box that we didn't update
          allWillBeChecked = false;
        }
      }
    }

    // Disable button if all checkboxes will now be checked
    if (foundUncheckedBox && allWillBeChecked) {
      // Wait a tick for actor to update
      await new Promise((resolve) => setTimeout(resolve, 10));
      button.classList.add("is-disabled");
      button.tabIndex = -1;
    }
  } catch (_) {
    // ignore
  }
}

/**
 * Handle "New Value" improvement button
 */
async function handleNewValue(actor, button) {
  try {
    // Create a new value item
    const created = await actor.createEmbeddedDocuments("Item", [
      {
        name: t("sta-officers-log.dialog.chooseMilestoneBenefit.arcAddValue"),
        type: "value",
      },
    ]);

    if (created && created[0]?.sheet?.render) {
      created[0].sheet.render(true);
    }

    // Auto-check next checkbox
    await checkAndAutoCheckNext(actor, "newvalue", button);
  } catch (_) {
    // ignore
  }
}

/**
 * Handle "Improve Attribute" improvement button
 * Uses a dropdown dialog, only disables attributes at max (12)
 */
async function handleImproveAttribute(actor, button) {
  try {
    // Build dropdown options for each attribute
    const optionsHtml =
      '<option value="" selected></option>' +
      ATTRIBUTE_KEYS.map((k) => {
        const paths = [
          `system.attribute.${k}.value`,
          `system.attributes.${k}.value`,
        ];
        const { value } = _getFirstExistingNumeric(actor, paths);
        const atMax = Number(value ?? 0) >= 12; // 12 is the maximum for supporting characters
        const dis = atMax ? " disabled" : "";
        const suffix = atMax
          ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.max")})`
          : "";
        const label = ATTRIBUTE_LABELS[k] ?? k;
        return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(
          suffix,
        )}</option>`;
      }).join("");

    let picked;
    while (true) {
      picked = await foundry.applications.api.DialogV2.wait({
        window: {
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          classes: ["choose-benefit"],
        },
        content: `
          <div data-sta-callbacks-dialog="choose-benefit"></div>
          <div class="form-group">
            <label>${escapeHTML(t("sta-officers-log.dialog.chooseMilestoneBenefit.pickAttribute"))}</label>
            <div class="form-fields">
              <select name="attributeKey">${optionsHtml}</select>
            </div>
          </div>
        `,
        buttons: [
          {
            action: "select",
            label: "Select",
            default: true,
            callback: (_event, button) => {
              return button.form?.elements?.attributeKey?.value ?? "";
            },
          },
          {
            action: "cancel",
            label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
          },
        ],
        rejectClose: false,
        modal: false,
      });
      if (picked === "cancel" || picked == null) return;
      if (String(picked) === "") continue;
      break;
    }

    const key = String(picked);
    const paths = [
      `system.attribute.${key}.value`,
      `system.attributes.${key}.value`,
    ];
    const { path, value } = _getFirstExistingNumeric(actor, paths);

    if (!path) {
      ui.notifications?.error(
        t("sta-officers-log.dialog.chooseMilestoneBenefit.pathMissing"),
      );
      return;
    }

    if (value >= 12) {
      ui.notifications?.warn(
        t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyMax"),
      );
      return;
    }

    await actor.update({ [path]: Math.min(12, value + 1) });
    // Auto-check next checkbox
    await checkAndAutoCheckNext(actor, "attribute", button);
  } catch (err) {
    console.error(`${MODULE_ID} | handleImproveAttribute failed`, err);
  }
}

/**
 * Handle "Improve Department" improvement button
 * Uses a dropdown dialog, only disables departments at max (5)
 */
async function handleImproveDepartment(actor, button) {
  try {
    // Build dropdown options for each discipline/department
    const optionsHtml =
      '<option value="" selected></option>' +
      DISCIPLINE_KEYS.map((k) => {
        const paths = [`system.disciplines.${k}.value`];
        const { value } = _getFirstExistingNumeric(actor, paths);
        const atMax = Number(value ?? 0) >= 5; // 5 is the maximum for supporting characters
        const dis = atMax ? " disabled" : "";
        const suffix = atMax
          ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.max")})`
          : "";
        const label = DISCIPLINE_LABELS[k] ?? k;
        return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(
          suffix,
        )}</option>`;
      }).join("");

    let picked;
    while (true) {
      picked = await foundry.applications.api.DialogV2.wait({
        window: {
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          classes: ["choose-benefit"],
        },
        content: `
          <div data-sta-callbacks-dialog="choose-benefit"></div>
          <div class="form-group">
            <label>${escapeHTML(t("sta-officers-log.dialog.chooseMilestoneBenefit.pickDiscipline"))}</label>
            <div class="form-fields">
              <select name="disciplineKey">${optionsHtml}</select>
            </div>
          </div>
        `,
        buttons: [
          {
            action: "select",
            label: "Select",
            default: true,
            callback: (_event, button) => {
              return button.form?.elements?.disciplineKey?.value ?? "";
            },
          },
          {
            action: "cancel",
            label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
          },
        ],
        rejectClose: false,
        modal: false,
      });
      if (picked === "cancel" || picked == null) return;
      if (String(picked) === "") continue;
      break;
    }

    const key = String(picked);
    const paths = [`system.disciplines.${key}.value`];
    const { path, value } = _getFirstExistingNumeric(actor, paths);

    if (!path) {
      ui.notifications?.error(
        t("sta-officers-log.dialog.chooseMilestoneBenefit.pathMissing"),
      );
      return;
    }

    if (value >= 5) {
      ui.notifications?.warn(
        t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyMax"),
      );
      return;
    }

    await actor.update({ [path]: Math.min(5, value + 1) });
    // Auto-check next checkbox
    await checkAndAutoCheckNext(actor, "department", button);
  } catch (err) {
    console.error(`${MODULE_ID} | handleImproveDepartment failed`, err);
  }
}

/**
 * Handle "New Focus" improvement button
 */
async function handleNewFocus(actor, button) {
  try {
    // Call the benefit function with the actor
    const result = await applyNonArcMilestoneBenefitInternal(actor, {
      initialAction: "focus",
    });

    if (result?.applied) {
      // Auto-check next checkbox
      await checkAndAutoCheckNext(actor, "focus", button);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | handleNewFocus failed`, err);
  }
}

/**
 * Handle "New Talent" improvement button
 */
async function handleNewTalent(actor, button) {
  try {
    // Call the benefit function with the actor
    const result = await applyNonArcMilestoneBenefitInternal(actor, {
      initialAction: "talent",
    });

    if (result?.applied) {
      // Auto-check next checkbox
      await checkAndAutoCheckNext(actor, "talent", button);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | handleNewTalent failed`, err);
  }
}

/**
 * Install interactive buttons for supporting character improvements
 * on the character sheet's Development tab.
 *
 * @param {HTMLElement} root - The root element of the character sheet
 * @param {Actor} actor - The character actor
 */
export function installSupportingCharImprovementButtons(root, actor) {
  if (!root || !actor || actor.type !== "character") return;

  try {
    const grid = root.querySelector(".supporting-char-grid");
    if (!grid) return;

    // Define the improvements to handle - ordered to match template
    const improvements = [
      {
        improvementType: "newvalue",
        handler: handleNewValue,
        labelKey: "sta.actor.milestone.suppnewvalue",
        checkboxNames: [
          "flags.sta.milestone.newvalue1",
          "flags.sta.milestone.newvalue2",
          "flags.sta.milestone.newvalue3",
          "flags.sta.milestone.newvalue4",
        ],
      },
      {
        improvementType: "attribute",
        handler: handleImproveAttribute,
        labelKey: "sta.actor.milestone.suppattribute",
        checkboxNames: ["flags.sta.milestone.attribute"],
      },
      {
        improvementType: "department",
        handler: handleImproveDepartment,
        labelKey: "sta.actor.milestone.suppdept",
        checkboxNames: ["flags.sta.milestone.department"],
      },
      {
        improvementType: "focus",
        handler: handleNewFocus,
        labelKey: "sta.actor.milestone.suppfocus",
        checkboxNames: [
          "flags.sta.milestone.focus1",
          "flags.sta.milestone.focus2",
          "flags.sta.milestone.focus3",
        ],
      },
      {
        improvementType: "talent",
        handler: handleNewTalent,
        labelKey: "sta.actor.milestone.supptalent",
        checkboxNames: [
          "flags.sta.milestone.talent1",
          "flags.sta.milestone.talent2",
          "flags.sta.milestone.talent3",
          "flags.sta.milestone.talent4",
        ],
      },
    ];

    // Get all rows in the grid
    const rows = grid.querySelectorAll(".row");

    // Process each row and match it to the improvement type by its checkboxes
    for (const row of rows) {
      const inputs = row.querySelector(".inputs");
      const labelDiv = row.querySelector(".label");
      if (!labelDiv || !inputs) continue;

      // Find which improvement this row corresponds to by checking checkbox names
      let matchingImprovement = null;
      for (const improvement of improvements) {
        const checkboxes = inputs.querySelectorAll("input[type='checkbox']");
        const allCheckboxNamesMatch =
          checkboxes.length === improvement.checkboxNames.length &&
          Array.from(checkboxes).every((cb, idx) => {
            const expectedName = improvement.checkboxNames[idx];
            return cb.getAttribute("name") === expectedName;
          });

        if (allCheckboxNamesMatch) {
          matchingImprovement = improvement;
          break;
        }
      }

      if (!matchingImprovement) continue;

      // Add data attribute to row for reference
      row.setAttribute(
        "data-improvement-type",
        matchingImprovement.improvementType,
      );

      // Create button to replace label
      const btn = document.createElement("span");
      btn.className = `sta-supp-${matchingImprovement.improvementType}-btn sta-inline-sheet-btn`;
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;
      btn.setAttribute(
        "data-improvement-type",
        matchingImprovement.improvementType,
      );
      btn.title = t(matchingImprovement.labelKey);
      btn.textContent = t(matchingImprovement.labelKey);

      // Create click handler
      const onAction = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        if (btn.classList.contains("is-disabled")) return;

        try {
          await matchingImprovement.handler(actor, btn);
        } catch (err) {
          console.error(
            `${MODULE_ID} | improvement button handler failed`,
            err,
          );
        }
      };

      btn.addEventListener("click", onAction);
      btn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") onAction(ev);
      });

      // Replace label content with button
      labelDiv.textContent = "";
      labelDiv.appendChild(btn);

      // Check if button should be disabled (all checkboxes checked)
      const checkboxes = inputs.querySelectorAll("input[type='checkbox']");
      let allChecked = true;
      for (const cb of checkboxes) {
        if (!cb.checked) {
          allChecked = false;
          break;
        }
      }

      if (allChecked) {
        btn.classList.add("is-disabled");
        btn.tabIndex = -1;
      }
    }
  } catch (_) {
    // ignore
  }
}
