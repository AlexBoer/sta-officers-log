/**
 * Milestone Benefits
 *
 * Main entry points for applying milestone benefits (Arc, Normal, Spotlight).
 * Delegates to handler functions in benefitHandlers.js for individual actions.
 */

import { t } from "../core/i18n.js";
import { escapeHTML } from "../data/values.js";
import {
  _promptArcBenefitType,
  _promptBenefitType,
  _promptManualMilestoneInstructions,
} from "./dialogs.js";

import { formatChosenBenefitLabel } from "./benefitLabels.js";

import {
  getGroupShipActor,
  canEditShip,
  handleArcRemoveTrauma,
  handleArcAttribute,
  handleArcDiscipline,
  handleArcValue,
  handleArcShipSystem,
  handleArcShipDepartment,
  handleArcShipTalent,
  handleAttribute,
  handleDiscipline,
  handleFocus,
  handleTalent,
} from "./benefitHandlers.js";

import {
  handleShipSystemSwap,
  handleShipDepartmentSwap,
  handleShipTalentSwap,
} from "./shipSwapHandlers.js";

function _getEligibleSupportingCharacters() {
  const all = Array.from(game.actors?.contents ?? game.actors ?? []);
  const eligible = [];

  for (const a of all) {
    if (!a) continue;

    const sheetClass =
      a.getFlag?.("core", "sheetClass") ??
      foundry.utils.getProperty(a, "flags.core.sheetClass") ??
      "";
    if (String(sheetClass) !== "sta.STASupportingSheet2e") continue;

    const canEdit = (() => {
      try {
        if (game.user?.isGM) return true;
        if (typeof a.testUserPermission === "function")
          return a.testUserPermission(game.user, "OWNER");
        return Boolean(a.isOwner);
      } catch (_) {
        return Boolean(a?.isOwner);
      }
    })();

    if (!canEdit) continue;
    eligible.push(a);
  }

  eligible.sort((x, y) =>
    String(x?.name ?? "").localeCompare(String(y?.name ?? "")),
  );
  return eligible;
}

export async function applyArcMilestoneBenefit(
  actor,
  { initialAction = null, traumaValueId = null } = {},
) {
  const isSingleAction = initialAction != null;
  let pendingAction = initialAction != null ? String(initialAction) : null;

  while (true) {
    const action = pendingAction ?? (await _promptArcBenefitType());
    pendingAction = null;
    if (!action || action === "cancel") return { applied: false };

    // Handle removeTrauma action
    if (action === "removeTrauma") {
      return handleArcRemoveTrauma(actor, traumaValueId);
    }

    if (action === "attr") {
      return handleArcAttribute(actor);
    }

    if (action === "disc") {
      return handleArcDiscipline(actor);
    }

    if (action === "value") {
      return handleArcValue(actor);
    }

    if (action === "shipSystem") {
      const result = await handleArcShipSystem(actor, isSingleAction);
      if (result.back) {
        if (isSingleAction) return { applied: false, back: true };
        continue;
      }
      return result;
    }

    if (action === "shipDepartment") {
      const result = await handleArcShipDepartment(actor, isSingleAction);
      if (result.back) {
        if (isSingleAction) return { applied: false, back: true };
        continue;
      }
      return result;
    }

    if (action === "shipTalent") {
      const result = await handleArcShipTalent(actor, isSingleAction);
      if (result.back) {
        if (isSingleAction) return { applied: false, back: true };
        continue;
      }
      return result;
    }
  }
}

export async function applyNonArcMilestoneBenefit(actor, options = {}) {
  return applyNonArcMilestoneBenefitInternal(actor, options);
}

export async function applyNonArcMilestoneBenefitInternal(
  actor,
  { initialAction = null } = {},
) {
  const isSingleAction = initialAction != null;
  let pendingAction = initialAction != null ? String(initialAction) : null;

  while (true) {
    const action = pendingAction ?? (await _promptBenefitType());
    pendingAction = null;
    if (!action || action === "cancel") return { applied: false };

    if (action === "supporting") {
      const supportingActors = _getEligibleSupportingCharacters();
      if (!supportingActors.length) {
        ui.notifications?.warn?.(
          "No editable Supporting Characters found. Make sure the actor uses the STA Supporting Sheet and that you have Owner permissions.",
        );
        return { applied: false };
      }

      const optionsHtml = supportingActors
        .map((a, idx) => {
          const sel = idx === 0 ? " selected" : "";
          return `<option value="${escapeHTML(a.id)}"${sel}>${escapeHTML(
            a.name ?? a.id,
          )}</option>`;
        })
        .join("");

      while (true) {
        const res = await foundry.applications.api.DialogV2.wait({
          window: {
            title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
            classes: ["choose-benefit"],
          },
          content: `
            <div data-sta-callbacks-dialog="choose-benefit"></div>
            <div data-sta-callbacks-supporting-benefit="1"></div>
            <p><strong>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.giveToSupportingCharacter",
              ),
            )}</strong></p>
            <div class="form-group">
              <label>Supporting Character</label>
              <div class="form-fields">
                <select name="supportingActorId">${optionsHtml}</select>
              </div>
            </div>
            <p>Choose which benefit to apply.</p>
          `,
          buttons: [
            {
              action: "attr",
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.increaseAttribute",
              ),
              default: true,
              callback: (_event, button) => ({
                supportingActorId:
                  button.form?.elements?.supportingActorId?.value ?? "",
                benefitAction: "attr",
              }),
            },
            {
              action: "disc",
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.increaseDiscipline",
              ),
              callback: (_event, button) => ({
                supportingActorId:
                  button.form?.elements?.supportingActorId?.value ?? "",
                benefitAction: "disc",
              }),
            },
            {
              action: "focus",
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.addFocus",
              ),
              callback: (_event, button) => ({
                supportingActorId:
                  button.form?.elements?.supportingActorId?.value ?? "",
                benefitAction: "focus",
              }),
            },
            {
              action: "talent",
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.addTalent",
              ),
              callback: (_event, button) => ({
                supportingActorId:
                  button.form?.elements?.supportingActorId?.value ?? "",
                benefitAction: "talent",
              }),
            },
            {
              action: "back",
              label: t("sta-officers-log.dialog.chooseMilestoneBenefit.back"),
            },
            {
              action: "cancel",
              label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
            },
          ],
          rejectClose: false,
          modal: false,
        });

        if (!res || res === "cancel") return { applied: false };
        if (res === "back") {
          if (isSingleAction) return { applied: false, back: true };
          break;
        }

        const supportingActorId = String(res.supportingActorId ?? "");
        const benefitAction = String(res.benefitAction ?? "");
        if (!supportingActorId || !benefitAction) continue;

        const supportingActor = game.actors?.get?.(supportingActorId) ?? null;
        if (!supportingActor) {
          ui.notifications?.warn?.(
            "That Supporting Character no longer exists.",
          );
          continue;
        }

        const appliedToSupporting = await applyNonArcMilestoneBenefit(
          supportingActor,
          { initialAction: benefitAction },
        );
        if (!appliedToSupporting?.applied) return { applied: false };

        return {
          applied: true,
          action: "supporting",
          supportingActorId,
          supportingActorName: supportingActor.name ?? "",
          supportingApplied: appliedToSupporting,
        };
      }

      continue;
    }

    if (action === "ship") {
      const ship = getGroupShipActor();
      if (!ship) {
        ui.notifications?.warn?.(
          "No Group Ship selected. Configure it in Module Settings.",
        );
        return { applied: false };
      }

      if (!canEditShip(ship)) {
        const res = await _promptManualMilestoneInstructions({
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          html: `
            <p><strong>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.changeShipStats",
              ),
            )}</strong></p>
            <p><strong>Group Ship:</strong> ${escapeHTML(ship.name ?? "")}</p>
            <p>You don't have permission to update the Group Ship.</p>
            <p>Ask the GM to apply one of these refits:</p>
            <ul>
              <li><strong>Swap Ship Systems (-1/+1):</strong> decrease 1 system by 1 (min 0) and increase a different system by 1.</li>
              <li><strong>Swap Ship Departments (-1/+1):</strong> decrease 1 department by 1 (min 0) and increase a different department by 1.</li>
              <li><strong>Replace a Ship Talent:</strong> remove 1 talent and add a new talent.</li>
            </ul>
            <p><em>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.manualConfirmHint",
              ),
            )}</em></p>
          `,
        });

        if (res === "back") {
          if (isSingleAction) return { applied: false, back: true };
          continue;
        }
        if (!res || res === "cancel") return { applied: false };
        if (res === "confirm") {
          return { applied: true, action: "shipManual", shipId: ship.id };
        }
        return { applied: false };
      }

      while (true) {
        const shipAction = await foundry.applications.api.DialogV2.wait({
          window: {
            title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
            classes: ["choose-benefit"],
          },
          content: `
            <div data-sta-callbacks-dialog="choose-benefit"></div>
            <p><strong>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.changeShipStats",
              ),
            )}</strong></p>
            <p><strong>Group Ship:</strong> ${escapeHTML(ship.name ?? "")}</p>
            <p>Choose what to decrease/remove and what to increase/add.</p>
          `,
          buttons: [
            {
              action: "systemSwap",
              label: "Swap Ship Systems (-1/+1)",
              default: true,
            },
            {
              action: "deptSwap",
              label: "Swap Ship Departments (-1/+1)",
            },
            {
              action: "talentSwap",
              label: "Replace a Ship Talent",
            },
            {
              action: "back",
              label: t("sta-officers-log.dialog.chooseMilestoneBenefit.back"),
            },
            {
              action: "cancel",
              label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
            },
          ],
          rejectClose: false,
          modal: false,
        });

        if (!shipAction || shipAction === "cancel") return { applied: false };
        if (shipAction === "back") {
          if (isSingleAction) return { applied: false, back: true };
          break;
        }

        if (shipAction === "systemSwap") {
          return handleShipSystemSwap(ship);
        }

        if (shipAction === "deptSwap") {
          return handleShipDepartmentSwap(ship);
        }

        if (shipAction === "talentSwap") {
          const result = await handleShipTalentSwap(ship);
          if (result.back) continue;
          return result;
        }

        return { applied: false };
      }

      // Back to the milestone benefit menu.
      if (isSingleAction) return { applied: false, back: true };
      continue;
    }

    if (action === "attr") {
      return handleAttribute(actor);
    }

    if (action === "disc") {
      return handleDiscipline(actor);
    }

    if (action === "focus") {
      return handleFocus(actor);
    }

    if (action === "talent") {
      return handleTalent(actor);
    }
  }
}

export { formatChosenBenefitLabel };
