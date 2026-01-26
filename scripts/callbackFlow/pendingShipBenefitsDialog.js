import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import { getGroupShipActorId } from "../data/mission.js";

function _getBenefitIdentifier(benefit) {
  if (!benefit || typeof benefit !== "object") return "";
  if (benefit.id) return String(benefit.id);
  // Legacy queued benefits (before we added a stable id).
  // Use a best-effort composite key that should be stable across sessions.
  return `${benefit.timestamp ?? 0}:${benefit.shipId ?? ""}:${
    benefit.action ?? ""
  }:${benefit.label ?? ""}`;
}

/**
 * Dialog for GM to review and apply pending ship benefits across all characters.
 * Benefits are queued when players lack OWNER permission on the Group Ship.
 */
export async function openPendingShipBenefitsDialog() {
  if (!game.user?.isGM) {
    return;
  } // Only GMs can open this dialog

  // Collect all pending ship benefits across all character actors
  const pendingBenefits = [];

  // Interate through the ators and look for pending ship benefit flags.
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;

    const benefits = actor.getFlag?.(MODULE_ID, "pendingShipBenefits");
    if (!benefits || !Array.isArray(benefits) || benefits.length === 0)
      continue;

    for (const benefit of benefits) {
      pendingBenefits.push({
        actor,
        actorId: actor.id,
        benefitId: _getBenefitIdentifier(benefit),
        ...benefit,
      });
    }
  }

  if (pendingBenefits.length === 0) {
    return;
  } // No pending benefits to show

  // Sort by timestamp (oldest first)
  pendingBenefits.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const templatePath = `modules/${MODULE_ID}/templates/pending-ship-benefits.hbs`;
  const summaryKey =
    pendingBenefits.length === 1
      ? "sta-officers-log.dialog.pendingShipBenefits.summaryOne"
      : "sta-officers-log.dialog.pendingShipBenefits.summaryMany";
  const items = pendingBenefits.map((benefit) => {
    const dateLabel = benefit.timestamp
      ? new Date(benefit.timestamp).toLocaleString()
      : t("sta-officers-log.dialog.pendingShipBenefits.unknownDate");

    return {
      actorName: benefit.actor?.name ?? "",
      actorId: benefit.actorId ?? "",
      benefitId: benefit.benefitId ?? "",
      dateLabel,
      shipName:
        benefit.shipName ??
        t("sta-officers-log.dialog.pendingShipBenefits.unknownShip"),
      benefitLabel:
        benefit.label ??
        benefit.action ??
        t("sta-officers-log.dialog.pendingShipBenefits.unknownBenefit"),
      instruction: benefit.instruction ?? "",
    };
  });

  const content = await foundry.applications.handlebars.renderTemplate(
    templatePath,
    {
      count: pendingBenefits.length,
      summaryKey,
      items,
    },
  );

  const dialog = new foundry.applications.api.DialogV2({
    window: {
      title: t("sta-officers-log.dialog.pendingShipBenefits.title"),
    },
    content,
    buttons: [
      {
        action: "close",
        label: t("sta-officers-log.dialog.pendingShipBenefits.close"),
        default: true,
      },
    ],
    rejectClose: false,
    modal: true,
  });

  dialog.render(true);

  // Wait for the dialog to be rendered, then attach event listeners
  await new Promise((resolve) => setTimeout(resolve, 100));

  const dialogElement =
    dialog.element?.[0] || document.querySelector(".dialog");
  if (!dialogElement) return;

  // Handle button clicks
  dialogElement.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const actorId = String(button.dataset.actorId ?? "");
    const benefitId = String(button.dataset.benefitId ?? "");

    if (!actorId || !benefitId) return;

    const benefit = pendingBenefits.find(
      (b) =>
        String(b.actorId ?? "") === actorId &&
        String(b.benefitId ?? "") === benefitId,
    );
    const actor = game.actors?.get?.(actorId) ?? benefit?.actor ?? null;
    if (!benefit || !actor) return;

    event.preventDefault();
    event.stopPropagation();

    if (action === "apply") {
      await applyShipBenefit(benefit, actor);
      await removePendingBenefit(actor, benefitId);
      button.closest(".pending-ship-benefit").remove();

      // Update count
      const remaining = dialogElement.querySelectorAll(
        ".pending-ship-benefit",
      ).length;
      if (remaining === 0) {
        dialog.close();
        ui.notifications?.info(
          t("sta-officers-log.notifications.pendingShipBenefitsAllProcessed"),
        );
      }
    } else if (action === "skip") {
      button.closest(".pending-ship-benefit").remove();

      const remaining = dialogElement.querySelectorAll(
        ".pending-ship-benefit",
      ).length;
      if (remaining === 0) {
        dialog.close();
      }
    } else if (action === "remove") {
      await removePendingBenefit(actor, benefitId);
      button.closest(".pending-ship-benefit").remove();

      const remaining = dialogElement.querySelectorAll(
        ".pending-ship-benefit",
      ).length;
      if (remaining === 0) {
        dialog.close();
        ui.notifications?.info(
          t("sta-officers-log.notifications.pendingShipBenefitsAllRemoved"),
        );
      }
    }
  });
}

/**
 * Apply a pending ship benefit to the Group Ship actor
 */
async function applyShipBenefit(benefit, characterActor) {
  try {
    const shipId = benefit.shipId || getGroupShipActorId();
    const ship = shipId ? game.actors?.get(shipId) : null;

    if (!ship) {
      ui.notifications?.error(
        tf("sta-officers-log.errors.pendingShipBenefitsShipNotFound", {
          id: shipId,
        }),
      );
      return;
    }

    // Apply the benefit based on action type
    const action = benefit.action;

    if (action === "shipSystemIncrease") {
      const systemKey = benefit.systemKey;
      if (!systemKey) {
        ui.notifications?.error(
          t(
            "sta-officers-log.errors.pendingShipBenefitsMissingSystemKeyIncrease",
          ),
        );
        return;
      }

      const currentValue = ship.system?.systems?.[systemKey] ?? 0;
      await ship.update({
        [`system.systems.${systemKey}`]: Math.min(currentValue + 1, 5),
      });

      ui.notifications?.info(
        tf(
          "sta-officers-log.notifications.pendingShipBenefitsAppliedSystemIncrease",
          {
            key: systemKey,
            character: characterActor.name,
          },
        ),
      );
    } else if (action === "shipDepartmentIncrease") {
      const departmentKey = benefit.departmentKey;
      if (!departmentKey) {
        ui.notifications?.error(
          t(
            "sta-officers-log.errors.pendingShipBenefitsMissingDepartmentKeyIncrease",
          ),
        );
        return;
      }

      const currentValue = ship.system?.departments?.[departmentKey] ?? 0;
      await ship.update({
        [`system.departments.${departmentKey}`]: Math.min(currentValue + 1, 5),
      });

      ui.notifications?.info(
        tf(
          "sta-officers-log.notifications.pendingShipBenefitsAppliedDepartmentIncrease",
          {
            key: departmentKey,
            character: characterActor.name,
          },
        ),
      );
    } else if (action === "shipSystemSwap") {
      const fromKey = benefit.fromSystemKey;
      const toKey = benefit.toSystemKey;

      if (!fromKey || !toKey) {
        ui.notifications?.error(
          t("sta-officers-log.errors.pendingShipBenefitsMissingSystemKeysSwap"),
        );
        return;
      }

      const fromValue = ship.system?.systems?.[fromKey] ?? 0;
      const toValue = ship.system?.systems?.[toKey] ?? 0;

      await ship.update({
        [`system.systems.${fromKey}`]: Math.max(fromValue - 1, 0),
        [`system.systems.${toKey}`]: Math.min(toValue + 1, 5),
      });

      ui.notifications?.info(
        tf(
          "sta-officers-log.notifications.pendingShipBenefitsAppliedSystemSwap",
          {
            from: fromKey,
            to: toKey,
            character: characterActor.name,
          },
        ),
      );
    } else if (action === "shipDepartmentSwap") {
      const fromKey = benefit.fromDepartmentKey;
      const toKey = benefit.toDepartmentKey;

      if (!fromKey || !toKey) {
        ui.notifications?.error(
          t(
            "sta-officers-log.errors.pendingShipBenefitsMissingDepartmentKeysSwap",
          ),
        );
        return;
      }

      const fromValue = ship.system?.departments?.[fromKey] ?? 0;
      const toValue = ship.system?.departments?.[toKey] ?? 0;

      await ship.update({
        [`system.departments.${fromKey}`]: Math.max(fromValue - 1, 0),
        [`system.departments.${toKey}`]: Math.min(toValue + 1, 5),
      });

      ui.notifications?.info(
        tf(
          "sta-officers-log.notifications.pendingShipBenefitsAppliedDepartmentSwap",
          {
            from: fromKey,
            to: toKey,
            character: characterActor.name,
          },
        ),
      );
    } else if (action === "shipTalentSwap") {
      ui.notifications?.warn(
        tf("sta-officers-log.warnings.pendingShipBenefitsTalentSwapManual", {
          character: characterActor.name,
        }),
      );
      // Ship talent swaps are complex and typically require the talent picker dialog
      // This would need additional implementation
    } else {
      ui.notifications?.warn(
        tf("sta-officers-log.warnings.pendingShipBenefitsUnknownAction", {
          action,
        }),
      );
    }

    // Set the selection flag on the character actor to track that benefit was applied
    if (benefit.flagPath) {
      try {
        await characterActor.setFlag("sta", benefit.flagPath, true);
      } catch (err) {
        console.warn(
          `${MODULE_ID} | Failed to set selection flag:`,
          benefit.flagPath,
          err,
        );
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to apply ship benefit:`, err);
    ui.notifications?.error(
      tf("sta-officers-log.errors.pendingShipBenefitsApplyFailed", {
        message:
          err?.message ||
          t("sta-officers-log.errors.pendingShipBenefitsUnknownError"),
      }),
    );
  }
}

/**
 * Remove a pending benefit from an actor's flag
 */
async function removePendingBenefit(actor, benefitIdToRemove) {
  try {
    const benefits = actor.getFlag?.(MODULE_ID, "pendingShipBenefits") || [];
    const idToRemove = String(benefitIdToRemove ?? "");
    const updated = benefits.filter(
      (b) => String(_getBenefitIdentifier(b) ?? "") !== idToRemove,
    );

    if (updated.length === 0) {
      await actor.unsetFlag(MODULE_ID, "pendingShipBenefits");
    } else {
      await actor.setFlag(MODULE_ID, "pendingShipBenefits", updated);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to remove pending benefit:`, err);
  }
}
