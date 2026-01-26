/**
 * Choose Milestone Benefit Button
 *
 * Adds "Choose Benefit" buttons to log entries that have pending milestones,
 * allowing players to select their milestone rewards (Normal, Spotlight, Arc).
 */

import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import {
  getValueIconPathForValueId,
  getValueStateArray,
  isValueTrauma,
} from "../../data/values.js";
import {
  createMilestoneItem,
  formatChosenBenefitLabel,
} from "../../callbackFlow.js";
import { openNewMilestoneArcDialog } from "./newMilestoneArcDialog.js";
import { openCreatedItemSheetAfterMilestone } from "./sheetUtils.js";
import { syncMilestoneImgFromLog } from "../../data/milestoneIcons.js";
import { ensureInlineActionsContainer } from "./callbackSourceButtons.js";

/**
 * Install per-Log "Choose Benefit" buttons for logs with a pending milestone.
 *
 * @param {HTMLElement} root - The sheet root element.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The sheet application instance.
 */
export function installChooseMilestoneBenefitButtons(root, actor, app) {
  const pendingMilestoneLogs = root.querySelectorAll(
    'div.section.milestones li.row.entry[data-item-type="log"]',
  );

  for (const entry of pendingMilestoneLogs) {
    if (entry.querySelector(".sta-choose-milestone-btn")) continue;

    const itemId = entry?.dataset?.itemId;
    const logItem = itemId ? actor.items.get(itemId) : null;
    if (!logItem) continue;

    const pendingMilestone = logItem.getFlag?.(
      MODULE_ID,
      "pendingMilestoneBenefit",
    );
    if (!pendingMilestone) continue;

    const pendingObj =
      typeof pendingMilestone === "object" && pendingMilestone
        ? pendingMilestone
        : null;
    const arcFromLogForLabel = logItem.getFlag?.(MODULE_ID, "arcInfo") ?? null;
    const arcForLabel = pendingObj?.arc ?? arcFromLogForLabel ?? null;
    const isArcBenefit = arcForLabel?.isArc === true;

    // Hide the button only after a benefit has been chosen.
    const benefitChosen =
      typeof pendingMilestone === "object" && pendingMilestone
        ? pendingMilestone.benefitChosen === true
        : false;
    if (benefitChosen) continue;

    const toggleEl = entry.querySelector("a.value-used.control.toggle");
    if (!toggleEl) continue;
    const inlineActions = ensureInlineActionsContainer(entry, toggleEl);
    if (!inlineActions) continue;
    if (inlineActions.querySelector(".sta-choose-milestone-btn")) continue;

    const chooseBtn = document.createElement("span");
    chooseBtn.className = "sta-choose-milestone-btn sta-inline-sheet-btn";
    chooseBtn.title = t(
      isArcBenefit
        ? "sta-officers-log.milestones.chooseArcTooltip"
        : "sta-officers-log.milestones.chooseMilestoneTooltip",
    );
    chooseBtn.textContent = t(
      isArcBenefit
        ? "sta-officers-log.milestones.chooseArc"
        : "sta-officers-log.milestones.chooseMilestone",
    );

    chooseBtn.setAttribute("role", "button");
    chooseBtn.tabIndex = 0;

    const onChoose = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const pending =
        typeof pendingMilestone === "object" && pendingMilestone
          ? pendingMilestone
          : { milestoneId: String(pendingMilestone) };

      // Lightweight association: remember which Milestone this log's "Choose" button
      // is acting on. This is stored alongside existing callbackLink data.
      try {
        const milestoneId = pending?.milestoneId
          ? String(pending.milestoneId)
          : "";
        if (milestoneId) {
          const existing = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
          const next = {
            ...(existing && typeof existing === "object" ? existing : {}),
            milestoneId,
          };
          await logItem.update(
            { [`flags.${MODULE_ID}.callbackLink`]: next },
            { renderSheet: false },
          );
        }
      } catch (_) {
        // ignore
      }

      const arcFromLog = logItem.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      const arc = pending?.arc ?? arcFromLog ?? null;

      const initialTab = isArcBenefit ? "arc" : "milestone";

      // Check if this is a trauma arc: all logs in the chain have a trauma as primary value
      let traumaValueId = null;
      let traumaAllChallenged = false;
      if (isArcBenefit && arc) {
        const chainLogIds = Array.isArray(arc.chainLogIds)
          ? arc.chainLogIds.map((x) => String(x)).filter(Boolean)
          : [];
        // Include the current log if not already in the chain
        if (!chainLogIds.includes(String(logItem.id))) {
          chainLogIds.push(String(logItem.id));
        }

        if (chainLogIds.length > 0) {
          // Check each log's primary value to see if it's a trauma
          let allTrauma = true;
          let allChallenged = true;
          let sharedTraumaId = null;

          for (const logId of chainLogIds) {
            const log = actor.items.get(logId);
            if (!log || log.type !== "log") {
              allTrauma = false;
              allChallenged = false;
              break;
            }

            const primaryValueId = String(
              log.getFlag?.(MODULE_ID, "primaryValueId") ?? "",
            );
            if (!primaryValueId) {
              allTrauma = false;
              allChallenged = false;
              break;
            }

            const valueItem = actor.items.get(primaryValueId);
            if (!valueItem || valueItem.type !== "value") {
              allTrauma = false;
              allChallenged = false;
              break;
            }

            if (!isValueTrauma(valueItem)) {
              allTrauma = false;
              allChallenged = false;
              break;
            }

            // Check all logs share the same trauma value
            if (sharedTraumaId === null) {
              sharedTraumaId = primaryValueId;
            } else if (sharedTraumaId !== primaryValueId) {
              allTrauma = false;
              allChallenged = false;
              break;
            }

            // Check if this log has the trauma marked as "challenged" in valueStates
            const valueStates = getValueStateArray(log, primaryValueId);
            if (!valueStates.includes("challenged")) {
              allChallenged = false;
            }
          }

          if (allTrauma && sharedTraumaId) {
            traumaValueId = sharedTraumaId;
            traumaAllChallenged = allChallenged;
          }
        }
      }

      openNewMilestoneArcDialog(actor, {
        initialTab,
        lockOtherTab: true,
        traumaValueId,
        traumaAllChallenged,
        onApplied: async ({ applied }) => {
          if (!applied?.applied) return;

          const createdItemId = applied?.createdItemId ?? "";
          const benefitLabel = formatChosenBenefitLabel(applied);

          const chosenLogId = pending?.chosenLogId ?? null;
          const valueId = pending?.valueId ?? null;
          const valueImg =
            pending?.valueImg ??
            (valueId ? getValueIconPathForValueId(actor, valueId) : null);

          if (!chosenLogId || !valueId) {
            ui.notifications?.warn(
              t("sta-officers-log.dialog.chooseMilestoneBenefit.missingData"),
            );
            return;
          }

          // The pending data may refer to a log that was deleted/edited.
          // If possible, fall back to the callbackLink on the CURRENT log.
          let resolvedChosenLogId = chosenLogId ? String(chosenLogId) : "";
          let chosenLog = resolvedChosenLogId
            ? (actor.items.get(resolvedChosenLogId) ?? null)
            : null;

          if (!chosenLog) {
            const link = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
            const fallbackId = link?.fromLogId ? String(link.fromLogId) : "";
            const fallbackLog = fallbackId
              ? (actor.items.get(fallbackId) ?? null)
              : null;

            if (fallbackLog?.type === "log") {
              resolvedChosenLogId = fallbackId;
              chosenLog = fallbackLog;

              // Heal the flag so future clicks work without special-casing.
              try {
                await logItem.setFlag(MODULE_ID, "pendingMilestoneBenefit", {
                  ...pending,
                  chosenLogId: resolvedChosenLogId,
                });
              } catch (_) {
                // ignore
              }
            }
          }

          if (!chosenLog) {
            ui.notifications?.warn(
              "This callback references a Log that no longer exists. Please choose a different Log and try again.",
            );
            return;
          }

          let milestone = null;
          const milestoneId = pending?.milestoneId ?? null;
          if (milestoneId) {
            milestone = actor.items.get(String(milestoneId)) ?? null;
          }

          if (!milestone) {
            milestone = await createMilestoneItem(actor, {
              chosenLogId: resolvedChosenLogId,
              currentLogId: logItem.id,
              // Milestone icons should match the log that created them.
              // Use the current log's icon when available, otherwise fall back to the value icon.
              valueImg: logItem?.img ? String(logItem.img) : valueImg,
              valueId,
              arc: isArcBenefit ? arc : null,
              benefitLabel,
              benefit: createdItemId
                ? {
                    createdItemId,
                    action: applied?.action,
                    syncPolicy:
                      applied?.action === "arcValue" ? "once" : "always",
                    syncedOnce: false,
                  }
                : null,
            });
          }

          if (!milestone) {
            ui.notifications?.error(
              t("sta-officers-log.dialog.chooseMilestoneBenefit.createFailed"),
            );
            return;
          }

          // Always align milestone icon with the log the user clicked from, even when
          // reusing an existing milestone.
          try {
            await syncMilestoneImgFromLog(milestone, logItem, {
              setSourceFlag: true,
            });
          } catch (_) {
            // ignore
          }

          if (createdItemId) {
            try {
              await milestone.setFlag(MODULE_ID, "milestoneBenefit", {
                createdItemId,
                action: applied?.action ?? "",
                syncPolicy: applied?.action === "arcValue" ? "once" : "always",
                syncedOnce: false,
              });
            } catch (_) {
              // ignore
            }
          }

          const desiredName = benefitLabel
            ? `${String(benefitLabel).trim()}`
            : null;
          if (desiredName && milestone.name !== desiredName) {
            await milestone.update({ name: desiredName });
          }

          await logItem.setFlag(MODULE_ID, "pendingMilestoneBenefit", {
            ...pending,
            milestoneId: milestone.id,
            benefitChosen: true,
          });

          try {
            const currentLink =
              logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
            const updatedLink =
              currentLink && typeof currentLink === "object"
                ? { ...currentLink }
                : {};
            updatedLink.milestoneId = milestone.id;
            await logItem.setFlag(MODULE_ID, "callbackLink", updatedLink);
          } catch (_) {
            // ignore
          }

          app.render();
          openCreatedItemSheetAfterMilestone(actor, createdItemId);
        },
      });
    };

    chooseBtn.addEventListener("click", onChoose);
    chooseBtn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") onChoose(ev);
    });

    inlineActions.appendChild(chooseBtn);
  }
}
