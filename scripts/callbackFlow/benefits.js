import { t } from "../i18n.js";
import { escapeHTML } from "../values.js";
import { getGroupShipActorId } from "../mission.js";
import {
  ATTRIBUTE_KEYS,
  DISCIPLINE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
  SHIP_SYSTEM_KEYS,
  SHIP_DEPARTMENT_KEYS,
  SHIP_SYSTEM_LABELS,
  SHIP_DEPARTMENT_LABELS,
  _getFirstExistingNumeric,
  _getStaSelectionFlag,
  _promptArcBenefitType,
  _promptBenefitType,
  _promptManualMilestoneInstructions,
  _promptSelectAndText,
  _promptSelect,
  _promptTwoSelect,
  _promptText,
  _setStaSelectionFlag,
} from "./dialogs.js";

import { promptFocusChoiceFromCompendium } from "./focusPickerDialog.js";
import {
  promptTalentChoiceFromCompendium,
  promptShipTalentChoiceFromCompendium,
} from "./talentPickerDialog.js";
import { promptShipTalentSwapDialog } from "./shipTalentSwapDialog.js";

async function _createItem(actor, itemData) {
  const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
  return created ?? null;
}

function _localizeStaLabel(labelOrKey) {
  const raw = String(labelOrKey ?? "");
  if (!raw) return "";
  try {
    if (raw.startsWith("sta.")) return game.i18n?.localize?.(raw) ?? raw;
  } catch (_) {
    // ignore
  }
  return raw;
}

function _getGroupShipActor() {
  const id = getGroupShipActorId?.() ?? "";
  if (!id) return null;
  return game.actors?.get?.(id) ?? null;
}

function _isSupportingActor(actor) {
  const sheetClass =
    actor?.getFlag?.("core", "sheetClass") ??
    foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
    "";
  return String(sheetClass) === "sta.STASupportingSheet2e";
}

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
    String(x?.name ?? "").localeCompare(String(y?.name ?? ""))
  );
  return eligible;
}

async function _handleShipPermissionFallback({
  actor,
  ship,
  descriptionKey,
  instruction,
  label,
  flagPath,
  manualAction,
  extraPayload = {},
}) {
  const res = await _promptManualMilestoneInstructions({
    title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
    html: `
            <p><strong>${t(descriptionKey)}</strong></p>
            <p><strong>Group Ship:</strong> ${escapeHTML(ship.name ?? "")}</p>
            <p>You don't have permission to update the Group Ship.</p>
            <p>${escapeHTML(instruction)}</p>
            <p><strong>${escapeHTML(label)}</strong></p>
            <p><em>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.manualConfirmHint"
              )
            )}</em></p>
          `,
  });

  if (res === "back") {
    return { status: "back" };
  }
  if (!res || res === "cancel") {
    return { status: "cancel" };
  }
  if (res === "confirm") {
    await _setStaSelectionFlag(actor, flagPath, true);
    return {
      status: "confirm",
      result: {
        applied: true,
        action: manualAction,
        shipId: ship.id,
        ...extraPayload,
      },
    };
  }
  return { status: "cancel" };
}

export async function applyArcMilestoneBenefit(
  actor,
  { initialAction = null } = {}
) {
  const isSingleAction = initialAction != null;
  let pendingAction = initialAction != null ? String(initialAction) : null;

  while (true) {
    const action = pendingAction ?? (await _promptArcBenefitType());
    pendingAction = null;
    if (!action || action === "cancel") return { applied: false };

    if (action === "attr") {
      const optionsHtml =
        '<option value="" selected></option>' +
        ATTRIBUTE_KEYS.map((k) => {
          const paths = [
            `system.attribute.${k}.value`,
            `system.attributes.${k}.value`,
          ];
          const cur = _getFirstExistingNumeric(actor, paths).value;
          const atMax = Number(cur ?? 0) >= 12;
          const dis = atMax ? " disabled" : "";
          const suffix = atMax
            ? ` (${t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.max"
              )})`
            : "";
          const label = ATTRIBUTE_LABELS[k] ?? k;
          return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(
            suffix
          )}</option>`;
        }).join("");

      let picked;
      while (true) {
        picked = await _promptSelect({
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.pickAttribute"
          ),
          name: "attributeKey",
          optionsHtml,
        });
        if (picked === "cancel" || picked == null) return { applied: false };
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
          t("sta-officers-log.dialog.chooseMilestoneBenefit.pathMissing")
        );
        return { applied: false };
      }
      if (value >= 12) {
        ui.notifications?.warn(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyMax")
        );
        return { applied: false };
      }

      await actor.update({ [path]: Math.min(12, value + 1) });
      return { applied: true, action: "arcAttr", key };
    }

    if (action === "disc") {
      const optionsHtml =
        '<option value="" selected></option>' +
        DISCIPLINE_KEYS.map((k) => {
          const paths = [`system.disciplines.${k}.value`];
          const cur = _getFirstExistingNumeric(actor, paths).value;
          const atMax = Number(cur ?? 0) >= 5;
          const dis = atMax ? " disabled" : "";
          const suffix = atMax
            ? ` (${t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.max"
              )})`
            : "";
          const label = DISCIPLINE_LABELS[k] ?? k;
          return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(
            suffix
          )}</option>`;
        }).join("");

      let picked;
      while (true) {
        picked = await _promptSelect({
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.pickDiscipline"
          ),
          name: "disciplineKey",
          optionsHtml,
        });
        if (picked === "cancel" || picked == null) return { applied: false };
        if (String(picked) === "") continue;
        break;
      }

      const key = String(picked);
      const paths = [`system.disciplines.${key}.value`];
      const { path, value } = _getFirstExistingNumeric(actor, paths);
      if (!path) {
        ui.notifications?.error(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.pathMissing")
        );
        return { applied: false };
      }
      if (value >= 5) {
        ui.notifications?.warn(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyMax")
        );
        return { applied: false };
      }

      await actor.update({ [path]: Math.min(5, value + 1) });
      return { applied: true, action: "arcDisc", key };
    }

    if (action === "value") {
      const created = await _createItem(actor, {
        name: "New Value",
        type: "value",
      });
      return {
        applied: true,
        action: "arcValue",
        name: created?.name ?? "",
        createdItemId: created?.id ?? "",
      };
    }

    if (action === "shipSystem") {
      const ship = _getGroupShipActor();
      if (!ship) {
        ui.notifications?.warn?.(
          "No Group Ship selected. Configure it in Module Settings."
        );
        return { applied: false };
      }

      const optionsHtml = SHIP_SYSTEM_KEYS.map((k, idx) => {
        const improved = _getStaSelectionFlag(actor, `system.${k}`);
        const sel = idx === 0 ? " selected" : "";
        const dis = improved ? " disabled" : "";
        const suffix = improved
          ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.used")})`
          : "";
        const label = SHIP_SYSTEM_LABELS[k] ?? k;
        return `<option value="${k}"${sel}${dis}>${escapeHTML(
          label
        )}${escapeHTML(suffix)}</option>`;
      }).join("");

      const picked = await _promptSelect({
        title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcPickShipSystem"
        ),
        name: "shipSystemKey",
        optionsHtml,
      });
      if (!picked || picked === "cancel") return { applied: false };

      const key = String(picked);
      if (_getStaSelectionFlag(actor, `system.${key}`)) {
        ui.notifications?.warn(
          t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.alreadyImproved"
          )
        );
        return { applied: false };
      }

      const canEditShip = (() => {
        try {
          if (game.user?.isGM) return true;
          if (typeof ship.testUserPermission === "function")
            return ship.testUserPermission(game.user, "OWNER");
          return Boolean(ship.isOwner);
        } catch (_) {
          return Boolean(ship?.isOwner);
        }
      })();

      if (!canEditShip) {
        const label =
          _localizeStaLabel(ship.system?.systems?.[key]?.label) ||
          SHIP_SYSTEM_LABELS[key] ||
          key;
        const manualOutcome = await _handleShipPermissionFallback({
          actor,
          ship,
          descriptionKey:
            "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseShipSystem",
          instruction: "Ask the GM to increase this ship system by 1:",
          label,
          flagPath: `system.${key}`,
          manualAction: "arcShipSystemManual",
          extraPayload: { key },
        });

        if (manualOutcome.status === "back") {
          if (isSingleAction) return { applied: false, back: true };
          continue;
        }
        if (manualOutcome.status === "cancel") return { applied: false };
        if (manualOutcome.status === "confirm") {
          return manualOutcome.result;
        }
        return { applied: false };
      }

      const path = `system.systems.${key}.value`;
      const cur = Number(foundry.utils.getProperty(ship, path) ?? 0);
      const next = (Number.isFinite(cur) ? cur : 0) + 1;

      try {
        await ship.update({ [path]: next });
      } catch (err) {
        console.error(
          "sta-officers-log | arc ship system update failed",
          err
        );
        ui.notifications?.error?.("Failed to update the Group Ship.");
        return { applied: false };
      }

      await _setStaSelectionFlag(actor, `system.${key}`, true);
      return { applied: true, action: "arcShipSystem", key, shipId: ship.id };
    }

    if (action === "shipDepartment") {
      const ship = _getGroupShipActor();
      if (!ship) {
        ui.notifications?.warn?.(
          "No Group Ship selected. Configure it in Module Settings."
        );
        return { applied: false };
      }

      const optionsHtml = SHIP_DEPARTMENT_KEYS.map((k, idx) => {
        const improved = _getStaSelectionFlag(actor, `department.${k}`);
        const sel = idx === 0 ? " selected" : "";
        const dis = improved ? " disabled" : "";
        const suffix = improved
          ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.used")})`
          : "";
        const label = SHIP_DEPARTMENT_LABELS[k] ?? k;
        return `<option value="${k}"${sel}${dis}>${escapeHTML(
          label
        )}${escapeHTML(suffix)}</option>`;
      }).join("");

      const picked = await _promptSelect({
        title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcPickShipDepartment"
        ),
        name: "shipDepartmentKey",
        optionsHtml,
      });
      if (!picked || picked === "cancel") return { applied: false };

      const key = String(picked);
      if (_getStaSelectionFlag(actor, `department.${key}`)) {
        ui.notifications?.warn(
          t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.alreadyImproved"
          )
        );
        return { applied: false };
      }

      const canEditShip = (() => {
        try {
          if (game.user?.isGM) return true;
          if (typeof ship.testUserPermission === "function")
            return ship.testUserPermission(game.user, "OWNER");
          return Boolean(ship.isOwner);
        } catch (_) {
          return Boolean(ship?.isOwner);
        }
      })();

      if (!canEditShip) {
        const label =
          _localizeStaLabel(ship.system?.departments?.[key]?.label) ||
          SHIP_DEPARTMENT_LABELS[key] ||
          key;
        const manualOutcome = await _handleShipPermissionFallback({
          actor,
          ship,
          descriptionKey:
            "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseShipDepartment",
          instruction: "Ask the GM to increase this ship department by 1:",
          label,
          flagPath: `department.${key}`,
          manualAction: "arcShipDepartmentManual",
          extraPayload: { key },
        });

        if (manualOutcome.status === "back") {
          if (isSingleAction) return { applied: false, back: true };
          continue;
        }
        if (manualOutcome.status === "cancel") return { applied: false };
        if (manualOutcome.status === "confirm") {
          return manualOutcome.result;
        }
        return { applied: false };
      }

      const path = `system.departments.${key}.value`;
      const cur = Number(foundry.utils.getProperty(ship, path) ?? 0);
      const next = Math.min(5, (Number.isFinite(cur) ? cur : 0) + 1);

      try {
        await ship.update({ [path]: next });
      } catch (err) {
        console.error(
          "sta-officers-log | arc ship department update failed",
          err
        );
        ui.notifications?.error?.("Failed to update the Group Ship.");
        return { applied: false };
      }

      await _setStaSelectionFlag(actor, `department.${key}`, true);
      return {
        applied: true,
        action: "arcShipDepartment",
        key,
        shipId: ship.id,
      };
    }

    if (action === "shipTalent") {
      const ship = _getGroupShipActor();
      if (!ship) {
        ui.notifications?.warn?.(
          "No Group Ship selected. Configure it in Module Settings."
        );
        return { applied: false };
      }

      const chosen = await promptShipTalentChoiceFromCompendium({
        actor: ship,
      });
      if (!chosen) return { applied: false };

      const canEditShip = (() => {
        try {
          if (game.user?.isGM) return true;
          if (typeof ship.testUserPermission === "function")
            return ship.testUserPermission(game.user, "OWNER");
          return Boolean(ship.isOwner);
        } catch (_) {
          return Boolean(ship?.isOwner);
        }
      })();

      if (!canEditShip) {
        const res = await _promptManualMilestoneInstructions({
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          html: `
            <p><strong>${t(
              "sta-officers-log.dialog.chooseMilestoneBenefit.arcAddShipTalent"
            )}</strong></p>
            <p><strong>Group Ship:</strong> ${escapeHTML(ship.name ?? "")}</p>
            <p>You don't have permission to update the Group Ship.</p>
            <p>Ask the GM to add this ship talent:</p>
            <p><strong>${escapeHTML(chosen.name)}</strong></p>
            <p><em>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.manualConfirmHint"
              )
            )}</em></p>
          `,
        });
        if (res === "back") {
          if (isSingleAction) return { applied: false, back: true };
          continue;
        }
        if (!res || res === "cancel") return { applied: false };
        if (res === "confirm") {
          return {
            applied: true,
            action: "arcShipTalentManual",
            name: chosen.name,
            shipId: ship.id,
          };
        }
        return { applied: false };
      }

      const type = (ship.items ?? []).some((i) => i?.type === "shipTalent")
        ? "shipTalent"
        : "talent";

      try {
        const sourceShipTalent = chosen.item
          ? foundry.utils.deepClone(chosen.item)
          : {};
        delete sourceShipTalent._id;
        const shipTalentData = {
          ...sourceShipTalent,
          type,
          name: chosen.name ?? sourceShipTalent.name ?? "",
          img:
            chosen.img ??
            sourceShipTalent.img ??
            sourceShipTalent.image ??
            null,
        };
        const created = await _createItem(ship, shipTalentData);
        return {
          applied: true,
          action: "arcShipTalent",
          name: created?.name ?? chosen.name,
          createdItemId: created?.id ?? "",
          sourceUuid: chosen.uuid ?? "",
          shipId: ship.id,
        };
      } catch (err) {
        console.error("sta-officers-log | arc ship talent add failed", err);
        ui.notifications?.error?.("Failed to update the Group Ship.");
        return { applied: false };
      }
    }
  }
}

export async function applyNonArcMilestoneBenefit(actor, options = {}) {
  return applyNonArcMilestoneBenefitInternal(actor, options);
}

export async function applyNonArcMilestoneBenefitInternal(
  actor,
  { initialAction = null } = {}
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
          "No editable Supporting Characters found. Make sure the actor uses the STA Supporting Sheet and that you have Owner permissions."
        );
        return { applied: false };
      }

      const optionsHtml = supportingActors
        .map((a, idx) => {
          const sel = idx === 0 ? " selected" : "";
          return `<option value="${escapeHTML(a.id)}"${sel}>${escapeHTML(
            a.name ?? a.id
          )}</option>`;
        })
        .join("");

      while (true) {
        const res = await foundry.applications.api.DialogV2.wait({
          window: {
            title: t(
              "sta-officers-log.dialog.chooseMilestoneBenefit.title"
            ),
            classes: ["choose-benefit"],
          },
          content: `
            <div data-sta-callbacks-dialog="choose-benefit"></div>
            <div data-sta-callbacks-supporting-benefit="1"></div>
            <p><strong>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.giveToSupportingCharacter"
              )
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
                "sta-officers-log.dialog.chooseMilestoneBenefit.increaseAttribute"
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
                "sta-officers-log.dialog.chooseMilestoneBenefit.increaseDiscipline"
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
                "sta-officers-log.dialog.chooseMilestoneBenefit.addFocus"
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
                "sta-officers-log.dialog.chooseMilestoneBenefit.addTalent"
              ),
              callback: (_event, button) => ({
                supportingActorId:
                  button.form?.elements?.supportingActorId?.value ?? "",
                benefitAction: "talent",
              }),
            },
            {
              action: "back",
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.back"
              ),
            },
            {
              action: "cancel",
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.cancel"
              ),
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
            "That Supporting Character no longer exists."
          );
          continue;
        }

        const appliedToSupporting = await applyNonArcMilestoneBenefit(
          supportingActor,
          { initialAction: benefitAction }
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
      const ship = _getGroupShipActor();
      if (!ship) {
        ui.notifications?.warn?.(
          "No Group Ship selected. Configure it in Module Settings."
        );
        return { applied: false };
      }

      const canEditShip = (() => {
        try {
          if (game.user?.isGM) return true;
          if (typeof ship.testUserPermission === "function")
            return ship.testUserPermission(game.user, "OWNER");
          return Boolean(ship.isOwner);
        } catch (_) {
          return Boolean(ship?.isOwner);
        }
      })();

      if (!canEditShip) {
        const res = await _promptManualMilestoneInstructions({
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          html: `
            <p><strong>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.changeShipStats"
              )
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
                "sta-officers-log.dialog.chooseMilestoneBenefit.manualConfirmHint"
              )
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
            title: t(
              "sta-officers-log.dialog.chooseMilestoneBenefit.title"
            ),
            classes: ["choose-benefit"],
          },
          content: `
            <div data-sta-callbacks-dialog="choose-benefit"></div>
            <p><strong>${escapeHTML(
              t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.changeShipStats"
              )
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
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.back"
              ),
            },
            {
              action: "cancel",
              label: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.cancel"
              ),
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
          const sysObj = ship.system?.systems ?? {};
          const keys = Object.keys(sysObj);
          const systemKeys = keys.length ? keys : SHIP_SYSTEM_KEYS;

          const option = (k, selected) => {
            const label =
              _localizeStaLabel(sysObj?.[k]?.label) ||
              SHIP_SYSTEM_LABELS[k] ||
              k;
            const sel = selected ? " selected" : "";
            return `<option value="${escapeHTML(k)}"${sel}>${escapeHTML(
              label
            )}</option>`;
          };

          while (true) {
            const options1Html =
              '<option value="" selected></option>' +
              systemKeys.map((k) => option(k, false)).join("");
            const options2Html = options1Html;

            const res = await _promptTwoSelect({
              title: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.title"
              ),
              label1: "Decrease system (-1)",
              name1: "dec",
              options1Html,
              label2: "Increase system (+1)",
              name2: "inc",
              options2Html,
            });
            if (!res || res === "cancel") return { applied: false };

            const dec = String(res.dec ?? "");
            const inc = String(res.inc ?? "");
            if (!dec || !inc) continue;
            if (dec === inc) {
              ui.notifications?.warn?.("Pick two different systems.");
              continue;
            }

            const decPath = `system.systems.${dec}.value`;
            const incPath = `system.systems.${inc}.value`;
            const decCur = Number(
              foundry.utils.getProperty(ship, decPath) ?? 0
            );
            const incCur = Number(
              foundry.utils.getProperty(ship, incPath) ?? 0
            );

            const updates = {
              [decPath]: Math.max(
                0,
                (Number.isFinite(decCur) ? decCur : 0) - 1
              ),
              [incPath]: Math.min(
                5,
                (Number.isFinite(incCur) ? incCur : 0) + 1
              ),
            };

            try {
              await ship.update(updates);
            } catch (err) {
              console.error(
                "sta-officers-log | ship system swap failed",
                err
              );
              ui.notifications?.error?.("Failed to update the Group Ship.");
              return { applied: false };
            }

            return {
              applied: true,
              action: "shipSystemSwap",
              shipId: ship.id,
              dec,
              inc,
            };
          }
        }

        if (shipAction === "deptSwap") {
          const depObj = ship.system?.departments ?? {};
          const keys = Object.keys(depObj);
          const deptKeys = keys.length ? keys : SHIP_DEPARTMENT_KEYS;

          const option = (k, selected) => {
            const label =
              _localizeStaLabel(depObj?.[k]?.label) ||
              SHIP_DEPARTMENT_LABELS[k] ||
              k;
            const sel = selected ? " selected" : "";
            return `<option value="${escapeHTML(k)}"${sel}>${escapeHTML(
              label
            )}</option>`;
          };

          while (true) {
            const options1Html =
              '<option value="" selected></option>' +
              deptKeys.map((k) => option(k, false)).join("");
            const options2Html = options1Html;

            const res = await _promptTwoSelect({
              title: t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.title"
              ),
              label1: "Decrease department (-1)",
              name1: "dec",
              options1Html,
              label2: "Increase department (+1)",
              name2: "inc",
              options2Html,
            });
            if (!res || res === "cancel") return { applied: false };

            const dec = String(res.dec ?? "");
            const inc = String(res.inc ?? "");
            if (!dec || !inc) continue;
            if (dec === inc) {
              ui.notifications?.warn?.("Pick two different departments.");
              continue;
            }

            const decPath = `system.departments.${dec}.value`;
            const incPath = `system.departments.${inc}.value`;
            const decCur = Number(
              foundry.utils.getProperty(ship, decPath) ?? 0
            );
            const incCur = Number(
              foundry.utils.getProperty(ship, incPath) ?? 0
            );

            const updates = {
              [decPath]: Math.max(
                0,
                (Number.isFinite(decCur) ? decCur : 0) - 1
              ),
              [incPath]: (Number.isFinite(incCur) ? incCur : 0) + 1,
            };

            try {
              await ship.update(updates);
            } catch (err) {
              console.error(
                "sta-officers-log | ship department swap failed",
                err
              );
              ui.notifications?.error?.("Failed to update the Group Ship.");
              return { applied: false };
            }

            return {
              applied: true,
              action: "shipDepartmentSwap",
              shipId: ship.id,
              dec,
              inc,
            };
          }
        }

        if (shipAction === "talentSwap") {
          const talents = (ship.items ?? []).filter(
            (i) => i?.type === "talent" || i?.type === "shipTalent"
          );

          if (!talents.length) {
            const again = await foundry.applications.api.DialogV2.wait({
              window: {
                title: t(
                  "sta-officers-log.dialog.chooseMilestoneBenefit.title"
                ),
                classes: ["choose-benefit"],
              },
              content: `
              <div data-sta-callbacks-dialog="choose-benefit"></div>
              <p>Group Ship has no talents to replace.</p>
              <p>Choose a different refit option.</p>
            `,
              buttons: [
                {
                  action: "back",
                  label: t(
                    "sta-officers-log.dialog.chooseMilestoneBenefit.back"
                  ),
                  default: true,
                },
                {
                  action: "cancel",
                  label: t(
                    "sta-officers-log.dialog.chooseMilestoneBenefit.cancel"
                  ),
                },
              ],
              rejectClose: false,
              modal: false,
            });

            if (!again || again === "cancel") return { applied: false };
            continue;
          }

          const swapResult = await promptShipTalentSwapDialog({ ship });
          if (swapResult === "back") {
            continue;
          }
          if (!swapResult) return { applied: false };

          const toRemove = ship.items?.get?.(swapResult.removeId);
          if (!toRemove) {
            ui.notifications?.warn?.("That talent no longer exists.");
            continue;
          }

          try {
            await ship.deleteEmbeddedDocuments("Item", [swapResult.removeId]);
            const type = toRemove.type ?? "talent";
            const sourceShipTalent = swapResult.newTalent?.item
              ? foundry.utils.deepClone(swapResult.newTalent.item)
              : {};
            delete sourceShipTalent._id;
            const shipTalentData = {
              ...sourceShipTalent,
              type,
              name:
                swapResult.newTalent?.name ??
                sourceShipTalent.name ??
                "New Talent",
              img:
                swapResult.newTalent?.img ??
                sourceShipTalent.img ??
                sourceShipTalent.image ??
                null,
            };
            const [created] = await ship.createEmbeddedDocuments("Item", [
              shipTalentData,
            ]);
            return {
              applied: true,
              action: "shipTalentSwap",
              shipId: ship.id,
              removed: toRemove.name ?? "",
              added: created?.name ?? shipTalentData.name ?? "",
            };
          } catch (err) {
            console.error(
              "sta-officers-log | ship talent swap failed",
              err
            );
            ui.notifications?.error?.("Failed to update the Group Ship.");
            return { applied: false };
          }
        }

        return { applied: false };
      }

      // Back to the milestone benefit menu.
      if (isSingleAction) return { applied: false, back: true };
      continue;
    }

    if (action === "attr") {
      const optionsHtml =
        '<option value="" selected></option>' +
        ATTRIBUTE_KEYS.map((k) => {
          const paths = [
            `system.attribute.${k}.value`,
            `system.attributes.${k}.value`,
          ];
          const cur = _getFirstExistingNumeric(actor, paths).value;
          const atMax = Number(cur ?? 0) >= 11;
          const improved = _getStaSelectionFlag(actor, `attributes.${k}`);
          const dis = atMax || improved ? " disabled" : "";
          const suffix = atMax
            ? ` (${t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.max"
              )})`
            : improved
            ? ` (${t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.used"
              )})`
            : "";
          const label = ATTRIBUTE_LABELS[k] ?? k;
          return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(
            suffix
          )}</option>`;
        }).join("");

      let picked;
      while (true) {
        picked = await _promptSelect({
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.pickAttribute"
          ),
          name: "attributeKey",
          optionsHtml,
        });
        if (picked === "cancel" || picked == null) return { applied: false };
        if (String(picked) === "") continue;
        break;
      }

      const key = String(picked);
      if (_getStaSelectionFlag(actor, `attributes.${key}`)) {
        ui.notifications?.warn(
          t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.alreadyImproved"
          )
        );
        return { applied: false };
      }
      const paths = [
        `system.attribute.${key}.value`,
        `system.attributes.${key}.value`,
      ];
      const { path, value } = _getFirstExistingNumeric(actor, paths);
      if (!path) {
        ui.notifications?.error(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.pathMissing")
        );
        return { applied: false };
      }
      if (value >= 11) {
        ui.notifications?.warn(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyMax")
        );
        return { applied: false };
      }

      await actor.update({ [path]: Math.min(11, value + 1) });
      await _setStaSelectionFlag(actor, `attributes.${key}`, true);
      return { applied: true, action: "attr", key };
    }

    if (action === "disc") {
      const optionsHtml =
        '<option value="" selected></option>' +
        DISCIPLINE_KEYS.map((k) => {
          const paths = [`system.disciplines.${k}.value`];
          const cur = _getFirstExistingNumeric(actor, paths).value;
          const atMax = Number(cur ?? 0) >= 4;
          const improved = _getStaSelectionFlag(actor, `discipline.${k}`);
          const dis = atMax || improved ? " disabled" : "";
          const suffix = atMax
            ? ` (${t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.max"
              )})`
            : improved
            ? ` (${t(
                "sta-officers-log.dialog.chooseMilestoneBenefit.used"
              )})`
            : "";
          const label = DISCIPLINE_LABELS[k] ?? k;
          return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(
            suffix
          )}</option>`;
        }).join("");

      let picked;
      while (true) {
        picked = await _promptSelect({
          title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.pickDiscipline"
          ),
          name: "disciplineKey",
          optionsHtml,
        });
        if (picked === "cancel" || picked == null) return { applied: false };
        if (String(picked) === "") continue;
        break;
      }

      const key = String(picked);
      if (_getStaSelectionFlag(actor, `discipline.${key}`)) {
        ui.notifications?.warn(
          t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.alreadyImproved"
          )
        );
        return { applied: false };
      }
      const paths = [`system.disciplines.${key}.value`];
      const { path, value } = _getFirstExistingNumeric(actor, paths);
      if (!path) {
        ui.notifications?.error(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.pathMissing")
        );
        return { applied: false };
      }
      if (value >= 4) {
        ui.notifications?.warn(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyMax")
        );
        return { applied: false };
      }

      await actor.update({ [path]: Math.min(4, value + 1) });
      await _setStaSelectionFlag(actor, `discipline.${key}`, true);
      return { applied: true, action: "disc", key };
    }

    if (action === "focus") {
      if (_isSupportingActor(actor)) {
        const focusCount = (actor.items ?? []).filter(
          (i) => i?.type === "focus"
        ).length;
        if (focusCount >= 6) {
          ui.notifications?.warn?.(
            "Supporting Characters cannot have more than six focuses."
          );
          return { applied: false };
        }
      }

      const chosen = await promptFocusChoiceFromCompendium({
        packKey: "sta.focuses-core",
      });
      if (!chosen) return { applied: false };

      // Custom focus: preserve the previous behavior (blank focus item).
      if (chosen?.custom === true) {
        const created = await _createItem(actor, {
          name: "New Focus",
          type: "focus",
        });
        if (created?.sheet?.render) {
          created.sheet.render(true);
        }
        return {
          applied: true,
          action: "focus",
          name: created?.name ?? "New Focus",
          createdItemId: created?.id ?? "",
          sourceUuid: "",
        };
      }

      const sourceFocusData = chosen.item
        ? foundry.utils.deepClone(chosen.item)
        : {};
      delete sourceFocusData._id;
      const focusData = {
        ...sourceFocusData,
        type: sourceFocusData.type ?? "focus",
        name: chosen.name ?? sourceFocusData.name ?? "New Focus",
        img: chosen.img ?? sourceFocusData.img ?? sourceFocusData.image ?? null,
      };
      const created = await _createItem(actor, focusData);
      return {
        applied: true,
        action: "focus",
        name: created?.name ?? chosen.name,
        createdItemId: created?.id ?? "",
        sourceUuid: chosen.uuid ?? "",
      };
    }

    if (action === "talent") {
      if (_isSupportingActor(actor)) {
        const talentCount = (actor.items ?? []).filter(
          (i) => i?.type === "talent" || i?.type === "shipTalent"
        ).length;
        if (talentCount >= 4) {
          ui.notifications?.warn?.(
            "Supporting Characters cannot have more than four talents."
          );
          return { applied: false };
        }
      }

      const chosen = await promptTalentChoiceFromCompendium({ actor });
      if (!chosen) return { applied: false };

      if (chosen?.custom === true) {
        const created = await _createItem(actor, {
          name: "New Talent",
          type: "talent",
        });
        try {
          created?.sheet?.render?.(true);
        } catch (_) {
          // ignore
        }
        return {
          applied: true,
          action: "talent",
          name: created?.name ?? "New Talent",
          createdItemId: created?.id ?? "",
          sourceUuid: "",
        };
      }

      const sourceTalentData = chosen.item
        ? foundry.utils.deepClone(chosen.item)
        : {};
      delete sourceTalentData._id;
      const talentData = {
        ...sourceTalentData,
        type: sourceTalentData.type ?? "talent",
        name: chosen.name ?? sourceTalentData.name ?? "New Talent",
        img:
          chosen.img ?? sourceTalentData.img ?? sourceTalentData.image ?? null,
      };
      const created = await _createItem(actor, talentData);
      return {
        applied: true,
        action: "talent",
        name: created?.name ?? chosen.name,
        createdItemId: created?.id ?? "",
        sourceUuid: chosen.uuid ?? "",
      };
    }
  }
}

export function formatChosenBenefitLabel(applied) {
  if (!applied || applied.applied !== true) return "";

  switch (applied.action) {
    case "attr":
      return `+1 ${ATTRIBUTE_LABELS[applied.key] ?? applied.key}`;
    case "disc":
      return `+1 ${DISCIPLINE_LABELS[applied.key] ?? applied.key}`;
    case "focus":
      return applied.name ? `Focus: ${applied.name}` : "New Focus";
    case "talent":
      return applied.name ? `Talent: ${applied.name}` : "New Talent";
    case "supporting":
      if (applied.supportingActorName && applied.supportingApplied?.applied) {
        const inner = formatChosenBenefitLabel(applied.supportingApplied);
        return inner
          ? `Supporting: ${applied.supportingActorName} — ${inner}`
          : `Supporting: ${applied.supportingActorName}`;
      }
      return "Supporting Character";
    case "shipSystemSwap":
      return `Ship Systems (-1/+1): ${
        SHIP_SYSTEM_LABELS[applied.dec] ?? applied.dec
      } → ${SHIP_SYSTEM_LABELS[applied.inc] ?? applied.inc}`;
    case "shipDepartmentSwap":
      return `Ship Departments (-1/+1): ${
        SHIP_DEPARTMENT_LABELS[applied.dec] ?? applied.dec
      } → ${SHIP_DEPARTMENT_LABELS[applied.inc] ?? applied.inc}`;
    case "shipTalentSwap":
      return applied.removed || applied.added
        ? `Ship Talent: ${applied.removed || "(remove)"} → ${
            applied.added || "(add)"
          }`
        : "Ship Talent (replaced)";
    case "shipManual":
      return "Ship Refit (ask GM)";

    case "arcAttr":
      return `+1 ${ATTRIBUTE_LABELS[applied.key] ?? applied.key}`;
    case "arcDisc":
      return `+1 ${DISCIPLINE_LABELS[applied.key] ?? applied.key}`;
    case "arcValue":
      return applied.name ? `Value: ${applied.name}` : "New Value";
    case "arcShipSystem":
      return `Ship System +1: ${
        SHIP_SYSTEM_LABELS[applied.key] ?? applied.key
      }`;
    case "arcShipSystemManual":
      return `Ship System +1 (ask GM): ${
        SHIP_SYSTEM_LABELS[applied.key] ?? applied.key
      }`;
    case "arcShipDepartment":
      return `Ship: +1 ${
        SHIP_DEPARTMENT_LABELS[applied.key] ?? applied.key
      }`;
    case "arcShipDepartmentManual":
      return `Ship Department +1 (ask GM to apply): ${
        SHIP_DEPARTMENT_LABELS[applied.key] ?? applied.key
      }`;
    case "arcShipTalent":
      return applied.name
        ? `New Ship Talent: ${applied.name}`
        : "New Ship Talent";
    case "arcShipTalentManual":
      return applied.name
        ? `New Ship Talent (ask GM to apply): ${applied.name}`
        : "New Ship Talent (ask GM to apply)";
    default:
      return String(applied.action ?? "");
  }
}
