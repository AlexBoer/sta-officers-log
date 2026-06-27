/**
 * Introduce Support Character Button
 *
 * Adds an "Introduce Support Character" button to the left column of
 * Supporting Character sheets (LCARS and standard). Tracks mission-scoped
 * introduction state and provides a per-log "Choose Advancement" button in
 * the development tab.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { escapeHTML } from "../core/utils.js";
import { getGroupShipActor } from "../missions/mission.js";
import { getModuleSocket } from "../core/socket.js";
import {
  ATTRIBUTE_KEYS,
  DISCIPLINE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
} from "../core/gameConstants.js";
import { _getFirstExistingNumeric } from "../milestones/dialogs.js";
import { handleFocus, handleTalent } from "../milestones/benefitHandlers.js";

// ─────────────────────────────────────────────────────────────────────────────
// Improvement checkbox flag paths (keyed to action names used in the dialog)
// These mirror the `name` attributes on the development-tab checkboxes.
// ─────────────────────────────────────────────────────────────────────────────

const IMPROVEMENT_CHECKBOXES = {
  attr: ["flags.sta.milestone.attribute"],
  disc: ["flags.sta.milestone.department"],
  focus: [
    "flags.sta.milestone.focus1",
    "flags.sta.milestone.focus2",
    "flags.sta.milestone.focus3",
  ],
  talent: [
    "flags.sta.milestone.talent1",
    "flags.sta.milestone.talent2",
    "flags.sta.milestone.talent3",
    "flags.sta.milestone.talent4",
  ],
  value: [
    "flags.sta.milestone.newvalue1",
    "flags.sta.milestone.newvalue2",
    "flags.sta.milestone.newvalue3",
    "flags.sta.milestone.newvalue4",
  ],
};

/**
 * Check off the next unchecked improvement box for the given action.
 * Does nothing if all boxes are already checked or the action is unknown.
 *
 * @param {Actor}  actor
 * @param {string} action — one of "attr", "disc", "focus", "talent", "value"
 */
async function _checkNextImprovementBox(actor, action) {
  const flagPaths = IMPROVEMENT_CHECKBOXES[action];
  if (!flagPaths?.length) return;
  for (const fp of flagPaths) {
    if (!foundry.utils.getProperty(actor, fp)) {
      try {
        await actor.update({ [fp]: true });
      } catch (_) {
        // non-critical
      }
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission title helper
// ─────────────────────────────────────────────────────────────────────────────

function _getMissionTitle() {
  try {
    return String(game.settings.get(MODULE_ID, "missionTitle") ?? "").trim();
  } catch (_) {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supervisor flag helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if this supporting character has the supervisory flag set.
 * Supervisors contribute +2 crew support on introduction instead of +1.
 */
export function isSupervisoryChar(actor) {
  return actor?.getFlag?.(MODULE_ID, "isSupervisoryChar") === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crew support helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current {value, max} for the group ship's crew support track.
 * Returns {value: 0, max: 0} if no ship or the fields are missing.
 */
function _getCrewSupportState(ship) {
  const value = Number(ship?.system?.crew?.value ?? 0);
  const max = Number(ship?.system?.crew?.max ?? 0);
  return { value, max };
}

/**
 * Increment the group ship's crew support by `amount` (default 1), capped at max.
 * Uses a GM socket call if the current user does not own the ship.
 */
async function _incrementCrewSupport(ship, amount = 1) {
  if (!ship) return;
  const { value, max } = _getCrewSupportState(ship);
  const newValue = max > 0 ? Math.min(max, value + amount) : value + amount;
  if (newValue === value) return;

  if (ship.isOwner || game.user?.isGM) {
    try {
      await ship.update({ "system.crew.value": newValue });
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to increment crew support`, err);
    }
  } else {
    const sock = getModuleSocket();
    if (!sock) {
      console.warn(
        `${MODULE_ID} | _incrementCrewSupport: no socket, cannot update`,
      );
      return;
    }
    try {
      await sock.executeAsGM("gmSetCrewSupport", {
        shipActorId: ship.id,
        newValue,
      });
    } catch (err) {
      console.error(
        `${MODULE_ID} | Failed to increment crew support via socket`,
        err,
      );
    }
  }
}

/**
 * Decrement the group ship's crew support by 1, minimum 0.
 * Uses a GM socket call if the current user does not own the ship.
 */
async function _decrementCrewSupport(ship) {
  if (!ship) return;
  const { value } = _getCrewSupportState(ship);
  const newValue = Math.max(0, value - 1);
  if (newValue === value) return;

  if (ship.isOwner || game.user?.isGM) {
    try {
      await ship.update({ "system.crew.value": newValue });
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to decrement crew support`, err);
    }
  } else {
    const sock = getModuleSocket();
    if (!sock) {
      console.warn(
        `${MODULE_ID} | _decrementCrewSupport: no socket, cannot update`,
      );
      return;
    }
    try {
      await sock.executeAsGM("gmSetCrewSupport", {
        shipActorId: ship.id,
        newValue,
      });
    } catch (err) {
      console.error(
        `${MODULE_ID} | Failed to decrement crew support via socket`,
        err,
      );
    }
  }
}

/**
 * If the current user is the GM, shows a local dialog.
 * Otherwise sends an async socket request to the GM.
 *
 * @param {Actor} ship   The group ship actor.
 * @param {Actor} actor  The supporting character being introduced.
 * @returns {Promise<boolean>} true if approved.
 */
/**
 * Returns one of:
 *   "approve"         — introduce with advancement (normal)
 *   "no-advancement"  — introduce but skip the pendingSupAdvancement flag
 *   false             — cancel, do not introduce
 *
 * @param {Actor} ship
 * @param {Actor} actor
 * @returns {Promise<"approve"|"no-advancement"|false>}
 */
async function _requestCrewSupportApproval(ship, actor, crewIncrement = 1) {
  const { value, max } = _getCrewSupportState(ship);

  if (game.user?.isGM) {
    // GM confirms locally
    const localContent =
      game.i18n?.format?.("sta-officers-log.supporting.crewSupportMaxContent", {
        actorName: actor.name ?? "",
        value: String(value),
        max: String(max),
        increment: String(crewIncrement),
      }) ??
      `Introducing ${actor.name ?? ""} would bring Crew Support to ${value + crewIncrement}/${max} (over max). Introduce anyway?`;

    const result = await foundry.applications.api.DialogV2.wait({
      classes: ["sta-officers-log"],
      window: {
        title: t("sta-officers-log.supporting.crewSupportMaxTitle"),
      },
      content: `<p>${escapeHTML(localContent)}</p>`,
      buttons: [
        {
          action: "approve",
          label: t("sta-officers-log.supporting.crewSupportApprove"),
          default: true,
        },
        {
          action: "no-advancement",
          label: t("sta-officers-log.supporting.crewSupportNoAdvancement"),
        },
        {
          action: "deny",
          label: t("sta-officers-log.supporting.crewSupportDeny"),
        },
      ],
      rejectClose: false,
      modal: false,
    });
    if (result === "approve") return "approve";
    if (result === "no-advancement") return "no-advancement";
    return false;
  }

  // Player → ask GM via socket
  const sock = getModuleSocket();
  if (!sock) {
    ui.notifications?.warn(
      t("sta-officers-log.errors.socketLibRequired") ||
        "SocketLib is required for this action.",
    );
    return false;
  }

  try {
    ui.notifications?.info(
      t("sta-officers-log.supporting.crewSupportMaxPending"),
    );
    const response = await sock.executeAsGM("requestCrewSupportIntroApproval", {
      actorName: actor.name ?? "",
      requestingUserId: game.user.id,
      crewValue: value,
      crewMax: max,
      crewIncrement,
    });
    const r =
      response?.result ?? (response?.approved === true ? "approve" : false);
    if (r === "approve" || r === "no-advancement") return r;
    return false;
  } catch (err) {
    console.error(`${MODULE_ID} | Crew support approval request failed`, err);
    return false;
  }
}

/**
 * Read the actor's introduction state for the current mission.
 * State is keyed to the current mission title; a title change resets the state.
 *
 * @param {Actor} actor
 * @returns {{ introduced: boolean, logId: string|null }}
 */
function _getIntroductionState(actor) {
  try {
    const state =
      actor.getFlag?.(MODULE_ID, "missionIntroductionState") ?? null;
    if (!state || typeof state !== "object") {
      return { introduced: false, logId: null };
    }
    const currentTitle = _getMissionTitle();
    // State is only valid for the stored mission title.
    // Both values may be empty string (no active mission) — that is intentional.
    if (String(state.missionTitle ?? "") !== currentTitle) {
      return { introduced: false, logId: null };
    }
    return {
      introduced: state.introduced === true,
      logId: state.logId ? String(state.logId) : null,
    };
  } catch (_) {
    return { introduced: false, logId: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Advancement handlers (supporting-character caps)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new Value item on the actor and open its sheet.
 * @returns {Promise<{applied: boolean, label?: string}>}
 */
async function _applyValueAdvancement(actor) {
  try {
    const valueName = t(
      "sta-officers-log.dialog.chooseMilestoneBenefit.arcAddValue",
    );
    const [created] = await actor.createEmbeddedDocuments("Item", [
      { name: valueName, type: "value" },
    ]);
    if (created?.sheet?.render) created.sheet.render(true);
    return { applied: true, label: valueName };
  } catch (err) {
    console.error(`${MODULE_ID} | _applyValueAdvancement failed`, err);
    return { applied: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Advancement type-selection dialog
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if every checkbox flag in IMPROVEMENT_CHECKBOXES[action]
 * is already checked on the actor.
 */
function _isAdvancementExhausted(actor, action) {
  const flagPaths = IMPROVEMENT_CHECKBOXES[action];
  if (!flagPaths?.length) return false;
  return flagPaths.every((fp) => Boolean(foundry.utils.getProperty(actor, fp)));
}

/**
 * Open the "Choose Advancement" dialog for a supporting character.
 * Attr/disc sub-dropdowns are revealed inline when those types are selected.
 * If the user completes an advancement, marks the log item's flag as chosen.
 *
 * @param {Actor} actor
 * @param {Item} logItem  The log item that holds the pendingSupAdvancement flag.
 */
async function _openAdvancementDialog(actor, logItem) {
  const ACTIONS = ["attr", "disc", "focus", "talent", "value"];

  // Build type options
  const typeOptionsHtml =
    `<option value="" selected></option>` +
    ACTIONS.map((action) => {
      const exhausted = _isAdvancementExhausted(actor, action);
      const dis = exhausted ? " disabled" : "";
      const suffix = exhausted
        ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.max")})`
        : "";
      const label = t(
        `sta-officers-log.supporting.advancementDialog.${action}`,
      );
      return `<option value="${action}"${dis}>${escapeHTML(label)}${escapeHTML(suffix)}</option>`;
    }).join("");

  // Build attribute sub-options
  const attrOptionsHtml =
    `<option value="" selected></option>` +
    ATTRIBUTE_KEYS.map((k) => {
      const paths = [
        `system.attribute.${k}.value`,
        `system.attributes.${k}.value`,
      ];
      const { value } = _getFirstExistingNumeric(actor, paths);
      const atMax = Number(value ?? 0) >= 12;
      const dis = atMax ? " disabled" : "";
      const suffix = atMax
        ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.max")})`
        : "";
      const label = ATTRIBUTE_LABELS[k] ?? k;
      return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(suffix)}</option>`;
    }).join("");

  // Build discipline sub-options
  const discOptionsHtml =
    `<option value="" selected></option>` +
    DISCIPLINE_KEYS.map((k) => {
      const { value } = _getFirstExistingNumeric(actor, [
        `system.disciplines.${k}.value`,
      ]);
      const atMax = Number(value ?? 0) >= 5;
      const dis = atMax ? " disabled" : "";
      const suffix = atMax
        ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.max")})`
        : "";
      const label = DISCIPLINE_LABELS[k] ?? k;
      return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(suffix)}</option>`;
    }).join("");

  let dialogResult;
  while (true) {
    try {
      dialogResult = await foundry.applications.api.DialogV2.wait({
        classes: ["sta-officers-log", "choose-benefit"],
        window: {
          title: t("sta-officers-log.supporting.advancementDialog.title"),
        },
        content: `
          <div data-sta-callbacks-dialog="choose-benefit"></div>
          <div class="form-group">
            <label>${escapeHTML(t("sta-officers-log.supporting.advancementDialog.pickType"))}</label>
            <div class="form-fields">
              <select name="advancementType">${typeOptionsHtml}</select>
            </div>
          </div>
          <div class="form-group" id="sta-adv-attr-group" style="display:none">
            <label>${escapeHTML(t("sta-officers-log.dialog.chooseMilestoneBenefit.pickAttribute"))}</label>
            <div class="form-fields">
              <select name="attributeKey">${attrOptionsHtml}</select>
            </div>
          </div>
          <div class="form-group" id="sta-adv-disc-group" style="display:none">
            <label>${escapeHTML(t("sta-officers-log.dialog.chooseMilestoneBenefit.pickDiscipline"))}</label>
            <div class="form-fields">
              <select name="disciplineKey">${discOptionsHtml}</select>
            </div>
          </div>
        `,
        render: (_event, dialog) => {
          const form = dialog.element.querySelector("form") ?? dialog.element;
          const typeSelect = form.querySelector('[name="advancementType"]');
          const attrGroup = form.querySelector("#sta-adv-attr-group");
          const discGroup = form.querySelector("#sta-adv-disc-group");
          if (!typeSelect) return;
          typeSelect.addEventListener("change", () => {
            const v = typeSelect.value;
            if (attrGroup) attrGroup.style.display = v === "attr" ? "" : "none";
            if (discGroup) discGroup.style.display = v === "disc" ? "" : "none";
          });
        },
        buttons: [
          {
            action: "ok",
            label: t("sta-officers-log.dialog.chooseMilestoneBenefit.ok"),
            default: true,
            callback: (_ev, button) => ({
              type: button.form?.elements?.advancementType?.value ?? "",
              attrKey: button.form?.elements?.attributeKey?.value ?? "",
              discKey: button.form?.elements?.disciplineKey?.value ?? "",
            }),
          },
          {
            action: "cancel",
            label: t("sta-officers-log.supporting.advancementDialog.cancel"),
          },
        ],
        rejectClose: false,
        modal: false,
      });
    } catch (_) {
      return; // dialog closed / rejected
    }
    if (dialogResult === "cancel" || dialogResult == null) return;
    const type =
      typeof dialogResult === "object" ? dialogResult.type : dialogResult;
    if (!type) continue; // nothing selected — re-show
    if (type === "attr" && !dialogResult.attrKey) continue;
    if (type === "disc" && !dialogResult.discKey) continue;
    break;
  }

  if (!dialogResult || dialogResult === "cancel") return;
  const picked =
    typeof dialogResult === "object" ? dialogResult.type : dialogResult;
  if (!picked || picked === "cancel") return;

  let result = null;
  try {
    if (picked === "attr") {
      const key = dialogResult.attrKey;
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
      result = { applied: true, key, label: ATTRIBUTE_LABELS[key] ?? key };
    } else if (picked === "disc") {
      const key = dialogResult.discKey;
      const { path, value } = _getFirstExistingNumeric(actor, [
        `system.disciplines.${key}.value`,
      ]);
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
      result = { applied: true, key, label: DISCIPLINE_LABELS[key] ?? key };
    } else if (picked === "focus") {
      result = await handleFocus(actor);
    } else if (picked === "talent") {
      result = await handleTalent(actor);
    } else if (picked === "value") {
      result = await _applyValueAdvancement(actor);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Advancement application failed`, err);
    return;
  }

  if (result?.applied !== true) return;

  // Auto-check the next unchecked improvement box for this action type.
  await _checkNextImprovementBox(actor, picked);

  // Build a human-readable name for the milestone item.
  let milestoneName;
  if (picked === "attr" || picked === "disc") {
    const label = result.label ?? picked;
    milestoneName = `${label} +1`;
  } else if (picked === "focus" || picked === "talent") {
    milestoneName =
      result.name ?? (picked === "focus" ? "New Focus" : "New Talent");
  } else {
    milestoneName =
      result.label ??
      t("sta-officers-log.dialog.chooseMilestoneBenefit.arcAddValue");
  }

  // Create a milestone item to record the advancement.
  // Set childA to the log item so the milestone's highlight button can flash back to it.
  let milestoneId = null;
  try {
    const [ms] = await actor.createEmbeddedDocuments("Item", [
      {
        name: milestoneName,
        type: "milestone",
        system: { childA: logItem.id },
      },
    ]);
    milestoneId = ms?.id ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to create advancement milestone`, err);
  }

  // Mark the log as having the advancement chosen, and store the milestone id.
  try {
    await logItem.setFlag(MODULE_ID, "pendingSupAdvancement", {
      pending: true,
      chosen: true,
      chosenAction: picked,
      milestoneId,
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to mark advancement as chosen`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: introduce button
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inject the "Introduce Support Character" button into the bottom-left column,
 * directly above the attribute block.
 *
 * @param {HTMLElement} root  Sheet root element.
 * @param {Actor}       actor Supporting character actor.
 */
export function installIntroduceSupportingCharButton(root, actor) {
  if (!root || !actor) return;

  // Guard: inject only once per render cycle
  if (root.querySelector(".sta-introduce-btn-wrapper")) return;

  const missionTitle = _getMissionTitle();
  // Only show the button when a mission is active.
  if (!missionTitle) return;

  const bottomLeft = root.querySelector(".bottom-left-column");
  if (!bottomLeft) return;

  const attrBlock = bottomLeft.querySelector(".attribute-block");
  if (!attrBlock) return;

  const { introduced } = _getIntroductionState(actor);

  const wrapper = document.createElement("div");
  wrapper.className = "sta-introduce-btn-wrapper";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sta-introduce-btn";

  if (introduced) {
    const canEdit = (() => {
      try {
        if (game.user?.isGM) return true;
        return Boolean(actor.isOwner);
      } catch (_) {
        return false;
      }
    })();

    const { logId } = _getIntroductionState(actor);
    const introLogItem = logId ? (actor.items.get(logId) ?? null) : null;
    const advFlag = introLogItem?.getFlag?.(MODULE_ID, "pendingSupAdvancement");
    const advChosen = advFlag?.chosen === true;

    const showUndo = Boolean(
      canEdit && introLogItem && (!advChosen || game.user?.isGM),
    );

    if (!advChosen && introLogItem) {
      // Show "Choose Advancement" shortcut — same dialog as the dev-tab button.
      btn.textContent = t("sta-officers-log.supporting.chooseAdvancement");
      btn.title = t("sta-officers-log.supporting.chooseAdvancementTooltip");
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await _openAdvancementDialog(actor, introLogItem);
      });
      wrapper.appendChild(btn);

      // Undo button for owner/GM
      if (showUndo) {
        const undoBtn = document.createElement("button");
        undoBtn.type = "button";
        undoBtn.className = "sta-introduce-undo-btn";
        undoBtn.title = t("sta-officers-log.supporting.unintroduceTooltip");
        undoBtn.innerHTML = '<i class="fas fa-rotate-left"></i>';
        undoBtn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          undoBtn.disabled = true;
          try {
            if (introLogItem) await introLogItem.delete();
            await actor.unsetFlag(MODULE_ID, "missionIntroductionState");
            // Decrement group ship crew support by 1 (min 0)
            const ship = getGroupShipActor();
            if (ship) await _decrementCrewSupport(ship);
          } catch (err) {
            console.error(
              `${MODULE_ID} | Failed to unintroduce supporting character`,
              err,
            );
            undoBtn.disabled = false;
          }
        });
        wrapper.appendChild(undoBtn);
      }
    } else {
      // Advancement already chosen — show disabled "Introduced" label.
      btn.classList.add("sta-introduce-btn--introduced");
      btn.textContent = t("sta-officers-log.supporting.introducedButton");
      btn.title = t("sta-officers-log.supporting.introducedButtonTooltip");
      btn.disabled = true;
      wrapper.appendChild(btn);

      // GMs should always retain undo access, even after advancement is chosen.
      if (showUndo) {
        const undoBtn = document.createElement("button");
        undoBtn.type = "button";
        undoBtn.className = "sta-introduce-undo-btn";
        undoBtn.title = t("sta-officers-log.supporting.unintroduceTooltip");
        undoBtn.innerHTML = '<i class="fas fa-rotate-left"></i>';
        undoBtn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          undoBtn.disabled = true;
          try {
            if (introLogItem) await introLogItem.delete();
            await actor.unsetFlag(MODULE_ID, "missionIntroductionState");
            // Decrement group ship crew support by 1 (min 0)
            const ship = getGroupShipActor();
            if (ship) await _decrementCrewSupport(ship);
          } catch (err) {
            console.error(
              `${MODULE_ID} | Failed to unintroduce supporting character`,
              err,
            );
            undoBtn.disabled = false;
          }
        });
        wrapper.appendChild(undoBtn);
      }
    }
  } else {
    btn.textContent = t("sta-officers-log.supporting.introduceButton");
    btn.title = t("sta-officers-log.supporting.introduceButtonTooltip");

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const title = missionTitle || "New Mission";

      // ── Crew support pre-check ──────────────────────────────────────────
      const ship = getGroupShipActor();
      const crewIncrement = isSupervisoryChar(actor) ? 2 : 1;
      let crewAtMax = false;
      let noAdvancement = false;
      if (ship) {
        const { value, max } = _getCrewSupportState(ship);
        // Prompt if adding crewIncrement would exceed max
        crewAtMax = max > 0 && value >= max;
        const wouldExceed = max > 0 && value + crewIncrement > max;
        if (crewAtMax || wouldExceed) {
          const crewResult = await _requestCrewSupportApproval(
            ship,
            actor,
            crewIncrement,
          );
          if (!crewResult) return; // GM rejected — cancel introduction
          noAdvancement = crewResult === "no-advancement";
          // Mark crewAtMax so we skip the increment (approved at-max means no increment)
          crewAtMax = true;
        }
      }

      // Optimistic UI update
      btn.disabled = true;
      btn.classList.add("sta-introduce-btn--introduced");
      btn.textContent = t("sta-officers-log.supporting.introducedButton");

      try {
        const logData = {
          name: title,
          type: "log",
          system: { showMilestoneArcButton: true },
        };
        if (!noAdvancement) {
          logData.flags = {
            [MODULE_ID]: {
              pendingSupAdvancement: { pending: true, chosen: false },
            },
          };
        }
        const [created] = await actor.createEmbeddedDocuments("Item", [
          logData,
        ]);
        const logId = created?.id ?? null;
        await actor.setFlag(MODULE_ID, "missionIntroductionState", {
          missionTitle: title,
          introduced: true,
          logId,
        });

        // ── Increment crew support (only if GM didn't approve at/over max) ──
        if (ship && !crewAtMax) {
          await _incrementCrewSupport(ship, crewIncrement);
        }

        // Sheet re-renders automatically from the actor update above.
      } catch (err) {
        console.error(
          `${MODULE_ID} | Failed to introduce supporting character`,
          err,
        );
        // Revert visual state on error
        btn.disabled = false;
        btn.classList.remove("sta-introduce-btn--introduced");
        btn.textContent = t("sta-officers-log.supporting.introduceButton");
      }
    });
    wrapper.appendChild(btn);
  }

  bottomLeft.insertBefore(wrapper, attrBlock);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: choose-advancement buttons
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inject a "Mission Introductions" section into the development tab, showing
 * all advancement log entries. Pending (unchosen) entries get a
 * "Choose Advancement" button; chosen entries show a completion label.
 *
 * @param {HTMLElement} root  Sheet root element.
 * @param {Actor}       actor Supporting character actor.
 */
export function installChooseAdvancementButtons(root, actor) {
  if (!root || !actor) return;

  // Guard: inject only once per render cycle
  if (root.querySelector(".sta-sup-advancement-logs")) return;

  // All tab panels are present in the DOM (hidden with CSS), so this lookup
  // works regardless of which tab is currently visible.
  const devTab = root.querySelector('.tab[data-tab="development"]');
  if (!devTab) return;

  // Collect log items with a pending advancement flag
  const advancementLogs = actor.items
    .filter((i) => {
      if (i.type !== "log") return false;
      const flag = i.getFlag?.(MODULE_ID, "pendingSupAdvancement");
      return flag?.pending === true;
    })
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));

  // ── Build section ─────────────────────────────────────────────────────────

  const section = document.createElement("div");
  section.className = "section sta-lcars-section sta-sup-advancement-logs";

  // ── Title row with + create button ───────────────────────────────────────
  const titleEl = document.createElement("div");
  titleEl.className = "title sta-sup-advancement-logs-title";
  titleEl.style.cssText = "display:flex;align-items:center;";

  const titleText = document.createElement("span");
  titleText.style.flex = "1";
  titleText.textContent = t("sta-officers-log.supporting.advancementLogsTitle");
  titleEl.appendChild(titleText);

  const addBtn = document.createElement("a");
  addBtn.className = "control create sta-lcars-create-btn";
  addBtn.title = t("sta-officers-log.supporting.addAdvancementLog");
  addBtn.innerHTML = '<i class="fas fa-plus"></i>';
  addBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const baseName = _getMissionTitle() || "New Mission";
    try {
      await actor.createEmbeddedDocuments("Item", [
        {
          name: baseName,
          type: "log",
          flags: {
            [MODULE_ID]: {
              pendingSupAdvancement: { pending: true, chosen: false },
            },
          },
        },
      ]);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to add advancement log entry`, err);
    }
  });
  titleEl.appendChild(addBtn);
  section.appendChild(titleEl);

  // ── Log-item rows ─────────────────────────────────────────────────────────
  const itemList = document.createElement("div");
  itemList.className = "sta-lcars-items item-list-scrollable";

  for (const logItem of advancementLogs) {
    const flag = logItem.getFlag?.(MODULE_ID, "pendingSupAdvancement") ?? {};
    const chosen = flag.chosen === true;
    const milestoneId = flag.milestoneId ? String(flag.milestoneId) : null;
    const milestone = milestoneId
      ? (actor.items.get(milestoneId) ?? null)
      : null;

    const li = document.createElement("li");
    li.className = "row entry";
    li.dataset.itemId = logItem.id;
    li.dataset.itemType = "log";

    // ── Portrait image (click = open log sheet) ───────────────────────────
    const imgDiv = document.createElement("div");
    imgDiv.className = "image";
    const img = document.createElement("img");
    img.className = "chat";
    img.src = logItem.img || "icons/svg/book.svg";
    img.title = logItem.name ?? "";
    img.style.cursor = "pointer";
    img.addEventListener("click", () => {
      try {
        logItem.sheet?.render(true);
      } catch (_) {}
    });
    imgDiv.appendChild(img);
    li.appendChild(imgDiv);

    // ── Name input (editable; blur/Enter saves) ───────────────────────────
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "item-name";
    nameInput.value = logItem.name ?? "";
    nameInput.dataset.itemId = logItem.id;
    const saveName = async () => {
      const newName = nameInput.value.trim();
      if (newName && newName !== logItem.name) {
        try {
          await logItem.update({ name: newName });
        } catch (_) {}
      }
    };
    nameInput.addEventListener("blur", saveName);
    nameInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        nameInput.blur();
      }
    });
    li.appendChild(nameInput);

    // ── Inline action: Choose Advancement or milestone link ───────────────
    const showAdvBtn =
      !chosen &&
      (logItem.system?.showMilestoneArcButton === true ||
        logItem.getFlag?.(MODULE_ID, "showMilestoneArcButton") === true);

    if (showAdvBtn) {
      const btn = document.createElement("span");
      btn.className = "sta-choose-advancement-btn sta-inline-sheet-btn";
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;
      btn.textContent = t("sta-officers-log.supporting.chooseAdvancement");
      btn.title = t("sta-officers-log.supporting.chooseAdvancementTooltip");
      const onClick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await _openAdvancementDialog(actor, logItem);
      };
      btn.addEventListener("click", onClick);
      btn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onClick(ev);
        }
      });
      li.appendChild(btn);
    } else if (chosen && milestone) {
      // Button that flashes and scrolls to the milestone row in the list below,
      // matching the behaviour of the main-character milestone highlight buttons.
      const escId = (id) => {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
          return CSS.escape(String(id ?? ""));
        return String(id ?? "").replace(/"/g, '\\"');
      };
      const flashRow = (rowEl) => {
        if (!(rowEl instanceof HTMLElement)) return;
        rowEl.classList.remove("sta-callbacks-source-flash");
        void rowEl.offsetWidth;
        rowEl.classList.add("sta-callbacks-source-flash");
        setTimeout(
          () => rowEl.classList.remove("sta-callbacks-source-flash"),
          1100,
        );
      };

      const msBtn = document.createElement("button");
      msBtn.type = "button";
      msBtn.className = "sta-show-milestone-logs-btn";
      msBtn.title = milestone.name;
      msBtn.innerHTML = '<i class="fa-solid fa-diagram-project"></i>';
      msBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const msRow = root.querySelector(
          `div.section.milestones li.row.entry[data-item-type="milestone"][data-item-id="${escId(milestone.id)}"]`,
        );
        if (msRow) {
          flashRow(msRow);
          msRow.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          ui.notifications?.warn?.("Milestone not found in list.");
        }
      });
      li.appendChild(msBtn);
    }

    // ── Controls: edit + delete ───────────────────────────────────────────
    const controls = document.createElement("div");
    controls.className = "control";

    const editA = document.createElement("a");
    editA.className = "edit";
    editA.title = "Open Log";
    editA.innerHTML = '<i class="fas fa-edit"></i>';
    editA.addEventListener("click", () => {
      try {
        logItem.sheet?.render(true);
      } catch (_) {}
    });
    controls.appendChild(editA);

    const deleteA = document.createElement("a");
    deleteA.className = "delete";
    deleteA.title = "Delete";
    deleteA.innerHTML = '<i class="fas fa-trash"></i>';
    deleteA.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: game.i18n?.localize("DOCUMENT.Delete") ?? "Delete" },
          content: `<p>${escapeHTML(game.i18n?.format("AreYouSure") ?? `Delete "${logItem.name}"?`)}</p>`,
          rejectClose: false,
          modal: true,
        });
        if (confirmed) await logItem.delete();
      } catch (_) {}
    });
    controls.appendChild(deleteA);

    li.appendChild(controls);
    itemList.appendChild(li);
  }

  section.appendChild(itemList);

  // Insert before the milestones section so it reads as a distinct header.
  const milestonesSection = devTab.querySelector(".section.milestones");
  if (milestonesSection) {
    devTab.insertBefore(section, milestonesSection);
  } else {
    devTab.insertBefore(section, devTab.firstChild);
  }
}
