/**
 * Shared button installation functions for both main character sheets
 * and supporting character sheets.
 */

import { MODULE_ID } from "../../constants.js";
import { t } from "../../i18n.js";
import { getModuleSocket } from "../../socket.js";
import { getCurrentMissionLogIdForUser, isLogUsed } from "../../mission.js";
import {
  DIRECTIVE_VALUE_ID_PREFIX,
  getDirectiveSnapshotForLog,
  getMissionDirectives,
  makeDirectiveKeyFromText,
  sanitizeDirectiveText,
  setDirectiveChallenged,
} from "../../directives.js";
import {
  escapeHTML,
  mergeValueStateArray,
  normalizeValueStateArray,
  isValueInvokedState,
} from "../../values.js";
import {
  gainDetermination,
  spendDetermination,
  promptCallbackForActorAsGM,
  applyNonArcMilestoneBenefit,
} from "../../callbackFlow.js";
import { openNewMilestoneArcDialog } from "./newMilestoneArcDialog.js";
import { isTraitScar, isTraitFatigue } from "./itemFlags.js";
import { getUserIdForCharacterActor } from "./sheetUtils.js";
import { promptUseValueChoice } from "./useValueDialog.js";
import {
  findFatiguedTrait,
  showAttributeSelectionDialog,
  hasFatiguedAttributeChosen,
} from "../stressHook.js";

/**
 * Helper function that checks if any invoked directive exists for callback eligibility.
 * Mirrors the logic in socket.js for supporting characters which don't have logs.
 */
function _hasEligibleCallbackTargetWithAnyInvokedDirective(
  actor,
  currentMissionLogId,
) {
  try {
    if (!actor || actor.type !== "character") return false;

    const missionLogId = currentMissionLogId ? String(currentMissionLogId) : "";
    if (!missionLogId) return true;

    const callbackTargetIds = new Set();
    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      if (log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true) continue;
      const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? {};
      const fromLogId = String(link?.fromLogId ?? "");
      if (fromLogId) callbackTargetIds.add(fromLogId);
    }

    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      const logId = String(log.id ?? "");
      if (!logId) continue;
      if (logId === missionLogId) continue;
      if (callbackTargetIds.has(logId)) continue;
      if (isLogUsed(log)) continue;

      const states = log.system?.valueStates ?? {};
      for (const [id, state] of Object.entries(states)) {
        if (!String(id).startsWith(DIRECTIVE_VALUE_ID_PREFIX)) continue;
        const stateArray = normalizeValueStateArray(state);
        if (stateArray.some((s) => isValueInvokedState(String(s)))) {
          return true;
        }
      }
    }

    return false;
  } catch (_) {
    return true;
  }
}

/**
 * Marks the fatigued attribute checkbox/label as disabled on the character sheet.
 * Also cleans up orphaned flags if no trait exists but flags are set.
 *
 * @param {HTMLElement} root - The sheet's root element
 * @param {Actor} actor - The character actor
 */
export function installFatigueAttributeMarking(root, actor) {
  try {
    const fatiguedTrait = findFatiguedTrait(actor);
    const fatiguedAttribute = actor.getFlag?.(MODULE_ID, "fatiguedAttribute");

    // Clean up orphaned flags if no trait exists but flags are set
    if (!fatiguedTrait && fatiguedAttribute) {
      console.log(
        `${MODULE_ID} | Cleaning up orphaned fatigue flags for ${actor.name}`,
      );
      void actor.unsetFlag?.(MODULE_ID, "fatiguedAttribute");
      void actor.unsetFlag?.(MODULE_ID, "fatiguedTraitUuid");
    }

    if (fatiguedTrait && fatiguedAttribute) {
      // Find the attribute checkbox and label and mark them as fatigued
      const attrCheckbox = root.querySelector(
        `input.selector.attribute[name="system.attributes.${fatiguedAttribute}.selected"]`,
      );
      if (attrCheckbox) {
        attrCheckbox.classList.add("sta-fatigued-attribute");
        attrCheckbox.disabled = true;
        attrCheckbox.title =
          "This attribute is fatigued - all tasks using it automatically fail.";

        // Find the label - it's the .list-entry sibling in the same .row-right parent
        const rowParent = attrCheckbox.closest(".row-right");
        const attrLabel = rowParent?.querySelector(".list-entry");
        if (attrLabel) {
          attrLabel.classList.add("sta-fatigued-attribute-label");
          attrLabel.title =
            "This attribute is fatigued - all tasks using it automatically fail.";
        }
      }
    }
  } catch (_) {
    // ignore
  }
}

/**
 * Installs "Use Scar" buttons on trait entries that are marked as scars.
 *
 * @param {HTMLElement} root - The sheet's root element
 * @param {Actor} actor - The character actor
 * @param {Object} options - Configuration options
 * @param {boolean} options.isSupportingCharacter - If true, skip log/callback logic
 * @param {Function} options.onComplete - Optional callback after button action completes
 */
export function installUseScarButtons(root, actor, options = {}) {
  const { isSupportingCharacter = false, onComplete } = options;

  const traitEntries = root.querySelectorAll(
    'div.section.traits li.row.entry[data-item-type="trait"]',
  );

  for (const entry of traitEntries) {
    if (entry.querySelector(".sta-use-scar-btn")) continue;

    const itemId = entry?.dataset?.itemId;
    const traitItem = itemId ? actor.items.get(itemId) : null;
    if (!traitItem) continue;

    const isScar = isTraitScar(traitItem);
    if (!isScar) continue; // Only show button for scars

    // Locate the item-name input where we'll insert the button after
    const itemNameInput = entry.querySelector("input.item-name");
    if (!itemNameInput) continue;

    const useBtn = document.createElement("span");
    useBtn.className = "sta-use-scar-btn sta-inline-sheet-btn";
    useBtn.title = t("sta-officers-log.traits.useScarTooltip");
    useBtn.textContent = t("sta-officers-log.traits.useScar");
    useBtn.setAttribute("role", "button");
    useBtn.tabIndex = 0;

    // Check if scar has already been used
    const scarUsed = traitItem.getFlag?.(MODULE_ID, "isScarUsed");
    if (scarUsed) {
      useBtn.classList.add("is-disabled");
      useBtn.setAttribute("aria-disabled", "true");
      useBtn.disabled = true;
    }

    const onUseScar = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (scarUsed) return; // Don't allow clicking if already used

      const moduleSocket = getModuleSocket();
      if (!moduleSocket) {
        ui.notifications?.error(
          t("sta-officers-log.errors.socketNotAvailable"),
        );
        return;
      }

      useBtn.disabled = true;

      try {
        const result = await moduleSocket.executeAsGM(
          "requestScarUseApproval",
          {
            requestingUserId: game.user.id,
            actorUuid: actor.uuid,
            actorName: actor.name,
            traitItemId: traitItem.id,
            traitName: traitItem.name,
            isSupportingCharacter, // Pass the flag to skip log/callback operations
          },
        );

        if (result?.approved) {
          ui.notifications?.info(
            t("sta-officers-log.dialog.useValue.approved"),
          );
          // Mark scar as used
          await traitItem.setFlag(MODULE_ID, "isScarUsed", true);
          useBtn.classList.add("is-disabled");
          useBtn.setAttribute("aria-disabled", "true");
          useBtn.disabled = true;
        } else {
          ui.notifications?.warn(t("sta-officers-log.dialog.useValue.denied"));
          useBtn.disabled = false;
        }
      } catch (err) {
        console.error("sta-officers-log | Use Scar approval failed", err);
        ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
        useBtn.disabled = false;
      } finally {
        if (typeof onComplete === "function") onComplete();
      }
    };

    useBtn.addEventListener("click", onUseScar);
    useBtn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") onUseScar(ev);
    });

    // Insert button after item-name and before quantity
    itemNameInput.insertAdjacentElement("afterend", useBtn);
  }
}

/**
 * Installs "Choose Attribute" buttons on fatigue traits that haven't had an attribute chosen.
 *
 * @param {HTMLElement} root - The sheet's root element
 * @param {Actor} actor - The character actor
 * @param {Object} options - Configuration options
 * @param {Function} options.onComplete - Optional callback after button action completes
 */
export function installChooseAttributeButtons(root, actor, options = {}) {
  const { onComplete } = options;

  const traitEntries = root.querySelectorAll(
    'div.section.traits li.row.entry[data-item-type="trait"]',
  );

  for (const entry of traitEntries) {
    if (entry.querySelector(".sta-choose-attribute-btn")) continue;

    const itemId = entry?.dataset?.itemId;
    const traitItem = itemId ? actor.items.get(itemId) : null;
    if (!traitItem) continue;

    const isFatigue = isTraitFatigue(traitItem);
    if (!isFatigue) continue; // Only show button for fatigue traits

    // Only show button if attribute hasn't been chosen yet
    const attributeChosen = hasFatiguedAttributeChosen(traitItem, actor);
    if (attributeChosen) continue;

    // Locate the item-name input where we'll insert the button after
    const itemNameInput = entry.querySelector("input.item-name");
    if (!itemNameInput) continue;

    const chooseBtn = document.createElement("span");
    chooseBtn.className = "sta-choose-attribute-btn sta-inline-sheet-btn";
    chooseBtn.title = t("sta-officers-log.traits.chooseAttributeTooltip");
    chooseBtn.textContent = t("sta-officers-log.traits.chooseAttribute");
    chooseBtn.setAttribute("role", "button");
    chooseBtn.tabIndex = 0;

    const onChooseAttribute = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      chooseBtn.disabled = true;

      try {
        await showAttributeSelectionDialog(traitItem, actor);
        if (typeof onComplete === "function") onComplete();
      } catch (err) {
        console.error("sta-officers-log | Choose Attribute failed", err);
        chooseBtn.disabled = false;
      }
    };

    chooseBtn.addEventListener("click", onChooseAttribute);
    chooseBtn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") onChooseAttribute(ev);
    });

    // Insert button after item-name (and any existing scar button)
    const existingScarBtn = entry.querySelector(".sta-use-scar-btn");
    if (existingScarBtn) {
      existingScarBtn.insertAdjacentElement("afterend", chooseBtn);
    } else {
      itemNameInput.insertAdjacentElement("afterend", chooseBtn);
    }
  }
}

/**
 * Installs a "Use Directive" button in the values section title.
 *
 * @param {HTMLElement} root - The sheet's root element
 * @param {Actor} actor - The character actor
 * @param {Object} options - Configuration options
 * @param {boolean} options.isSupportingCharacter - If true, skip log/callback logic
 * @param {Function} options.onComplete - Optional callback after button action completes
 */
export function installUseDirectiveButton(root, actor, options = {}) {
  const { isSupportingCharacter = false, onComplete } = options;

  const titleEl = root?.querySelector?.("div.section.values > div.title");
  if (!titleEl) return;
  if (titleEl.querySelector(".sta-use-directive-btn")) return;

  titleEl.classList.add("sta-values-title-with-button");

  const dirBtn = document.createElement("a");
  dirBtn.className = "sta-use-directive-btn";
  dirBtn.title = t("sta-officers-log.values.useDirectiveTooltip");
  dirBtn.innerHTML = `${t(
    "sta-officers-log.values.useDirective",
  )} <i class="fa-solid fa-flag"></i>`;

  dirBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const det = Number(actor.system?.determination?.value ?? 0);

    let currentMissionLogId = null;
    let currentLog = null;
    let directives;

    if (isSupportingCharacter) {
      // Supporting characters: use getMissionDirectives() directly (no log snapshot)
      directives = getMissionDirectives();
    } else {
      // Main characters: use per-log snapshot if available
      const missionUserId = game.user.isGM
        ? getUserIdForCharacterActor(actor)
        : game.user.id;
      currentMissionLogId = missionUserId
        ? getCurrentMissionLogIdForUser(missionUserId)
        : null;

      currentLog = currentMissionLogId
        ? actor.items.get(String(currentMissionLogId))
        : null;

      // Prefer per-log snapshot (permanently copied at mission start)
      const snapshot = currentLog ? getDirectiveSnapshotForLog(currentLog) : [];
      directives = snapshot.length ? snapshot : getMissionDirectives();
    }

    const byKey = new Map();
    for (const d of directives) {
      const text = sanitizeDirectiveText(d);
      if (!text) continue;
      const key = makeDirectiveKeyFromText(text);
      if (!key) continue;
      byKey.set(key, text);
    }

    const directiveOptions = [];
    for (const [key, text] of byKey.entries()) {
      directiveOptions.push(
        `<option value="${escapeHTML(key)}">${escapeHTML(text)}</option>`,
      );
    }

    const pick = await foundry.applications.api.DialogV2.wait({
      window: { title: t("sta-officers-log.dialog.useDirective.title") },
      content: `
        <div class="form-group">
          <label>${escapeHTML(
            t("sta-officers-log.dialog.useDirective.pick"),
          )}</label>
          <div class="form-fields">
            <select name="directiveKey">
              <option value="" selected disabled></option>
              ${directiveOptions.join("")}
              <option value="__other__">${escapeHTML(
                t("sta-officers-log.dialog.useDirective.other"),
              )}</option>
            </select>
          </div>
        </div>
        <div
          class="form-group"
          data-sta-directive-custom
          style="display: none;"
        >
          <label>${escapeHTML(
            t("sta-officers-log.dialog.useDirective.other"),
          )}</label>
          <div class="form-fields">
            <input
              type="text"
              name="directiveText"
              placeholder="${escapeHTML(
                t("sta-officers-log.dialog.useDirective.otherPlaceholder"),
              )}"
              disabled
            />
          </div>
          <p class="hint">
            ask the GM if your custom Directive is in play before proceeding
          </p>
        </div>
      `,
      render: (event, dialog) => {
        const html = dialog.element;
        const select = html?.querySelector('select[name="directiveKey"]');
        const customGroup = html?.querySelector("[data-sta-directive-custom]");
        const customInput = html?.querySelector('input[name="directiveText"]');
        if (select) {
          select.addEventListener("change", () => {
            const shouldShow = select.value === "__other__";
            if (customGroup)
              customGroup.style.display = shouldShow ? "" : "none";
            if (customInput) {
              customInput.disabled = !shouldShow;
              if (shouldShow) customInput.focus();
            }
          });
        }
      },
      buttons: [
        {
          action: "ok",
          label: t("sta-officers-log.dialog.chooseMilestoneBenefit.ok"),
          default: true,
          callback: (_event, button) => ({
            directiveKey: button.form?.elements?.directiveKey?.value ?? "",
            directiveText: button.form?.elements?.directiveText?.value ?? "",
          }),
        },
        {
          action: "cancel",
          label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
        },
      ],
      rejectClose: false,
      modal: false,
    });

    if (!pick) return;

    const chosenKey = String(pick.directiveKey ?? "");
    const typed = sanitizeDirectiveText(pick.directiveText ?? "");

    const chosenTextRaw =
      chosenKey && chosenKey !== "__other__" ? byKey.get(chosenKey) : typed;
    const chosenText = sanitizeDirectiveText(chosenTextRaw);
    if (!chosenText) {
      ui.notifications?.warn?.(
        t("sta-officers-log.dialog.useDirective.missing"),
      );
      return;
    }

    const directiveKey = makeDirectiveKeyFromText(chosenText);
    const directiveValueId = `${DIRECTIVE_VALUE_ID_PREFIX}${directiveKey}`;

    const choice = await promptUseValueChoice({
      valueName: chosenText,
      canChoosePositive: det > 0,
    });

    if (!choice) return;

    const valueState =
      choice === "positive"
        ? "positive"
        : choice === "challenge"
          ? "challenged"
          : "negative";

    // Helper to record directive usage on log (main characters only)
    const applyLogUsage = async (logDoc) => {
      if (!logDoc || isSupportingCharacter) return;

      // Record invoked directive on the mission log
      const existingRaw =
        logDoc.system?.valueStates?.[String(directiveValueId)];
      await logDoc.update({
        [`system.valueStates.${directiveValueId}`]: mergeValueStateArray(
          existingRaw,
          valueState,
        ),
      });

      // Store a mapping so later UI can display the directive name.
      try {
        const existing = logDoc.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
        const cloned =
          existing && typeof existing === "object"
            ? foundry.utils.deepClone(existing)
            : {};
        cloned[String(directiveKey)] = chosenText;
        await logDoc.setFlag(MODULE_ID, "directiveLabels", cloned);
      } catch (_) {
        // ignore
      }
    };

    if (game.user.isGM) {
      if (valueState === "positive") {
        await spendDetermination(actor);
      } else {
        await gainDetermination(actor);
        if (choice === "challenge") {
          await setDirectiveChallenged(actor, directiveKey, true);
        }
      }

      if (!isSupportingCharacter) {
        await applyLogUsage(currentLog);

        // Prompt callback locally, but apply for owning player's mission context.
        const owningUserId = getUserIdForCharacterActor(actor);
        if (owningUserId) {
          if (
            _hasEligibleCallbackTargetWithAnyInvokedDirective(
              actor,
              currentMissionLogId,
            )
          ) {
            await promptCallbackForActorAsGM(actor, owningUserId, {
              reason: "Directive used",
              defaultValueId: directiveValueId,
              defaultValueState: valueState,
            });
          }
        }
      }

      if (typeof onComplete === "function") onComplete();
      return;
    }

    const moduleSocket = getModuleSocket();
    if (!moduleSocket) {
      ui.notifications?.error(t("sta-officers-log.errors.socketNotAvailable"));
      return;
    }

    if (choice === "positive") {
      await spendDetermination(actor);

      if (!isSupportingCharacter) {
        await applyLogUsage(currentLog);

        // Ask the GM to prompt the player for a callback.
        try {
          if (
            _hasEligibleCallbackTargetWithAnyInvokedDirective(
              actor,
              currentMissionLogId,
            )
          ) {
            await moduleSocket.executeAsGM("promptCallbackForUser", {
              targetUserId: game.user.id,
              reason: "Directive used",
              defaultValueId: directiveValueId,
              defaultValueState: "positive",
            });
          }
        } catch (err) {
          console.error(
            "sta-officers-log | Failed to request callback prompt",
            err,
          );
        }
      }

      if (typeof onComplete === "function") onComplete();
      return;
    }

    // GM approval required for negative and challenge
    try {
      const result = await moduleSocket.executeAsGM(
        "requestDirectiveUseApproval",
        {
          requestingUserId: game.user.id,
          actorUuid: actor.uuid,
          actorName: actor.name,
          directiveKey,
          directiveText: chosenText,
          usage: choice,
          currentMissionLogId: isSupportingCharacter
            ? null
            : currentMissionLogId,
          isSupportingCharacter, // Pass the flag to skip log/callback operations
        },
      );

      if (result?.approved) {
        ui.notifications?.info(t("sta-officers-log.dialog.useValue.approved"));
      } else {
        ui.notifications?.warn(t("sta-officers-log.dialog.useValue.denied"));
      }
    } catch (err) {
      console.error("sta-officers-log | Use Directive approval failed", err);
      ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
    }

    if (typeof onComplete === "function") onComplete();
  });

  titleEl.appendChild(dirBtn);
}

/**
 * Configuration for supporting character improvement buttons.
 * Maps benefit types to their corresponding checkbox flag paths.
 */
const SUPPORTING_IMPROVEMENT_CONFIG = {
  value: {
    labelKey: "sta-officers-log.supportingImprovements.addValue",
    fallbackLabel: "Add Value",
    checkboxPaths: [
      "flags.sta.milestone.newvalue1",
      "flags.sta.milestone.newvalue2",
      "flags.sta.milestone.newvalue3",
      "flags.sta.milestone.newvalue4",
    ],
  },
  attr: {
    labelKey: "sta-officers-log.supportingImprovements.improveAttribute",
    fallbackLabel: "Improve Attribute",
    checkboxPaths: ["flags.sta.milestone.attribute"],
  },
  disc: {
    labelKey: "sta-officers-log.supportingImprovements.improveDiscipline",
    fallbackLabel: "Improve Discipline",
    checkboxPaths: ["flags.sta.milestone.department"],
  },
  focus: {
    labelKey: "sta-officers-log.supportingImprovements.addFocus",
    fallbackLabel: "Add Focus",
    checkboxPaths: [
      "flags.sta.milestone.focus1",
      "flags.sta.milestone.focus2",
      "flags.sta.milestone.focus3",
    ],
  },
  talent: {
    labelKey: "sta-officers-log.supportingImprovements.addTalent",
    fallbackLabel: "Add Talent",
    checkboxPaths: [
      "flags.sta.milestone.talent1",
      "flags.sta.milestone.talent2",
      "flags.sta.milestone.talent3",
      "flags.sta.milestone.talent4",
    ],
  },
};

/**
 * Gets the number of unchecked boxes for a given improvement type.
 *
 * @param {Actor} actor - The supporting character actor
 * @param {string} benefitType - The type of benefit (value, attr, disc, focus, talent)
 * @returns {number} The count of unchecked boxes
 */
function _getUncheckedCount(actor, benefitType) {
  const config = SUPPORTING_IMPROVEMENT_CONFIG[benefitType];
  if (!config) return 0;

  let unchecked = 0;
  for (const path of config.checkboxPaths) {
    const value = foundry.utils.getProperty(actor, path);
    if (!value) unchecked++;
  }
  return unchecked;
}

/**
 * Checks off the next available checkbox for a given improvement type.
 *
 * @param {Actor} actor - The supporting character actor
 * @param {string} benefitType - The type of benefit (value, attr, disc, focus, talent)
 * @returns {Promise<boolean>} True if a checkbox was checked, false if all were already checked
 */
async function _checkNextBox(actor, benefitType) {
  const config = SUPPORTING_IMPROVEMENT_CONFIG[benefitType];
  if (!config) return false;

  for (const path of config.checkboxPaths) {
    const value = foundry.utils.getProperty(actor, path);
    if (!value) {
      // This box is unchecked, check it
      await actor.update({ [path]: true });
      return true;
    }
  }
  return false;
}

/**
 * Installs supporting character improvement buttons to replace the checkbox grid.
 * These buttons trigger the same benefit pickers as main character milestones.
 *
 * @param {HTMLElement} root - The sheet's root element
 * @param {Actor} actor - The supporting character actor
 * @param {Object} options - Configuration options
 * @param {Function} options.onComplete - Optional callback after button action completes
 */
export function installSupportingImprovementButtons(root, actor, options = {}) {
  const { onComplete } = options;

  if (!root || !actor) return;

  // Find the supporting character improvements grid
  const improvementsGrid = root.querySelector(".supporting-char-grid");
  if (!improvementsGrid) return;

  // Check if already processed
  if (improvementsGrid.dataset.staImprovementsBound === "1") return;
  improvementsGrid.dataset.staImprovementsBound = "1";

  // Find the title element before the grid
  const titleEl = improvementsGrid.previousElementSibling;
  const isTitleMatch =
    titleEl?.classList?.contains("title") ||
    titleEl?.textContent?.includes("Supporting Character Improvements");

  // Create new container for buttons
  const buttonContainer = document.createElement("div");
  buttonContainer.className = "sta-supporting-improvements-buttons";

  // Keep the original grid visible for checkbox tracking (don't hide it)

  const benefitTypes = ["value", "attr", "disc", "focus", "talent"];

  for (const benefitType of benefitTypes) {
    const config = SUPPORTING_IMPROVEMENT_CONFIG[benefitType];
    const label = t(config.labelKey) ?? config.fallbackLabel;
    const uncheckedCount = _getUncheckedCount(actor, benefitType);
    const allChecked = uncheckedCount === 0;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sta-inline-sheet-btn sta-supporting-improvement-btn";
    btn.dataset.benefitType = benefitType;
    btn.textContent = label;
    btn.title = allChecked
      ? (t("sta-officers-log.supportingImprovements.allUsed") ??
        "All improvements of this type have been used")
      : `${label} (${uncheckedCount} remaining)`;

    if (allChecked) {
      btn.classList.add("is-disabled");
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    }

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (btn.disabled) return;

      // Double-check unchecked count
      const currentUnchecked = _getUncheckedCount(actor, benefitType);
      if (currentUnchecked === 0) {
        ui.notifications?.warn?.(
          t("sta-officers-log.supportingImprovements.allUsed") ??
            "All improvements of this type have been used.",
        );
        return;
      }

      btn.disabled = true;

      try {
        let applied;

        if (benefitType === "value") {
          // Create a new value item directly
          const [created] = await actor.createEmbeddedDocuments("Item", [
            { name: "New Value", type: "value" },
          ]);
          if (created) {
            applied = { applied: true, action: "value" };
            try {
              created?.sheet?.render?.(true);
            } catch (_) {
              // ignore
            }
          }
        } else {
          // Use the standard benefit picker for other types
          applied = await applyNonArcMilestoneBenefit(actor, {
            initialAction: benefitType,
          });
        }

        if (applied?.applied) {
          // Check off one of the corresponding boxes
          await _checkNextBox(actor, benefitType);

          // Update button state
          const newUnchecked = _getUncheckedCount(actor, benefitType);
          if (newUnchecked === 0) {
            btn.classList.add("is-disabled");
            btn.disabled = true;
            btn.setAttribute("aria-disabled", "true");
            btn.title =
              t("sta-officers-log.supportingImprovements.allUsed") ??
              "All improvements of this type have been used";
          } else {
            btn.title = `${label} (${newUnchecked} remaining)`;
            btn.disabled = false;
          }

          if (typeof onComplete === "function") onComplete();
        } else {
          btn.disabled = false;
        }
      } catch (err) {
        console.error(
          `${MODULE_ID} | Supporting improvement action failed`,
          err,
        );
        btn.disabled = false;
      }
    });

    buttonContainer.appendChild(btn);
  }

  // Insert the button container after the title (if found) or before the hidden grid
  if (isTitleMatch && titleEl) {
    titleEl.insertAdjacentElement("afterend", buttonContainer);
  } else {
    improvementsGrid.insertAdjacentElement("beforebegin", buttonContainer);
  }
}

/**
 * Replaces the "+" button in the milestone section for supporting characters
 * with a button that opens the New Milestone/Arc dialog.
 *
 * @param {HTMLElement} root - The sheet's root element
 * @param {Actor} actor - The supporting character actor
 */
export function installSupportingMilestoneButton(root, actor) {
  if (!root || !actor) return;

  // Find the milestone section header
  const milestoneSection = root.querySelector("div.section.milestones");
  if (!milestoneSection) return;

  const milestoneHeader = milestoneSection.querySelector("div.header.row.item");
  if (!milestoneHeader) return;

  // Find the original create button
  const originalCreateBtn = milestoneHeader.querySelector(
    'a.control.create[data-action="onItemCreate"][data-type="milestone"]',
  );
  if (!originalCreateBtn) return;

  // Check if already replaced
  if (milestoneHeader.querySelector(".sta-milestone-create-placeholder"))
    return;

  // Remove the original button
  try {
    originalCreateBtn.remove();
  } catch (_) {
    // ignore
  }

  // Create the new button
  const btn = document.createElement("a");
  btn.className = "control sta-milestone-create-placeholder";
  btn.title = "New Milestone / Arc";
  btn.setAttribute("aria-label", "New Milestone / Arc");
  btn.setAttribute("role", "button");
  btn.tabIndex = 0;
  btn.innerHTML = '<i class="fas fa-plus"></i>';

  const onClick = async (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();

    try {
      openNewMilestoneArcDialog(actor);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to open milestone dialog`, err);
    }
  };

  btn.addEventListener("click", onClick);
  btn.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") onClick(ev);
  });

  milestoneHeader.appendChild(btn);
}
