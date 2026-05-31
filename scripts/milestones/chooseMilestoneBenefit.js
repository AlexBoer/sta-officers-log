/**
 * Choose Milestone Benefit Button
 *
 * Adds "Choose Benefit" buttons to log entries that have pending milestones,
 * allowing players to select their milestone rewards (Normal, Spotlight, Arc).
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { isPlainObject } from "../core/utils.js";
import {
  getValueIconPathForValueId,
  getValueStateArray,
} from "../values/values.js";
import { isValueTrauma } from "../values/trauma/trauma.js";
import { createMilestoneItem } from "./milestones.js";
import { formatChosenBenefitLabel } from "./benefits.js";
import { getPrimaryValueIdForLog } from "../log/logMetadata.js";
import { openNewMilestoneArcDialog } from "./newMilestoneArcDialog.js";
import { syncMilestoneImgFromLog } from "./milestoneIcons.js";
import { ensureInlineActionsContainer } from "../sheet/sheetUtils.js";

/** Open the sheet for a just-created milestone item (deferred one tick). */
function _openCreatedItemSheet(actor, createdItemId) {
  const id = createdItemId ? String(createdItemId) : "";
  if (!id || !actor?.items?.get) return;
  setTimeout(() => {
    try {
      const item = actor.items.get(id);
      const sheet = item?.sheet;
      if (!sheet) return;
      sheet.render?.(true);
      sheet.bringToFront?.();
    } catch (_) {
      // item may have been deleted before timeout
    }
  }, 0);
}

/**
 * Install per-Log "Choose Benefit" buttons for logs with a pending milestone.
 *
 * @param {HTMLElement} root - The sheet root element.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The sheet application instance.
 */
export function installChooseMilestoneBenefitButtons(root, actor, app) {
  const pendingMilestoneLogs = root.querySelectorAll(
    'div.section.milestones li.row.entry[data-item-type="log"], div.section.character-log li.row.entry[data-item-type="log"]',
  );

  for (const entry of pendingMilestoneLogs) {
    if (entry.querySelector(".sta-choose-milestone-btn")) continue;

    const itemId = entry?.dataset?.itemId;
    const logItem = itemId ? actor.items.get(itemId) : null;

    if (!logItem) continue;

    // Check for pending milestone data (used for arc detection and benefit tracking)
    const pendingMilestone =
      logItem.system?.pendingMilestoneBenefit ??
      logItem.getFlag?.(MODULE_ID, "pendingMilestoneBenefit") ??
      null;

    const pendingObj = isPlainObject(pendingMilestone)
      ? pendingMilestone
      : null;
    const arcFromLogForLabel =
      logItem.system?.arcInfo ??
      logItem.getFlag?.(MODULE_ID, "arcInfo") ??
      null;
    const arcForLabel = pendingObj?.arc ?? arcFromLogForLabel ?? null;
    const isArcBenefit = arcForLabel?.isArc === true;

    // Check if benefit has already been chosen
    const benefitChosen = isPlainObject(pendingMilestone)
      ? pendingMilestone.benefitChosen === true
      : false;

    // Check manual override checkbox (default false)
    // The checkbox is the master control for button visibility
    const showMilestoneArcButton =
      logItem.system?.showMilestoneArcButton === true ||
      logItem.getFlag?.(MODULE_ID, "showMilestoneArcButton") === true;

    // Only show button if the checkbox is checked
    if (!showMilestoneArcButton) continue;

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

    // Disable the button if this log is the current mission log
    const isOnCurrentMissionLog = entry.classList.contains(
      "sta-current-mission-log",
    );
    if (isOnCurrentMissionLog) {
      chooseBtn.classList.add("sta-choose-btn-disabled");
      chooseBtn.setAttribute("aria-disabled", "true");
      chooseBtn.tabIndex = -1;
      chooseBtn.title = t("sta-officers-log.milestones.disabledTooltip");
      chooseBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ui.notifications.warn(
          t("sta-officers-log.milestones.disabledNotification"),
        );
      });
      inlineActions.appendChild(chooseBtn);
      continue;
    }

    const onChoose = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const pending = isPlainObject(pendingMilestone)
        ? pendingMilestone
        : { milestoneId: String(pendingMilestone) };

      // Lightweight association: remember which Milestone this log's "Choose" button
      // is acting on. This is stored alongside existing callbackLink data.
      try {
        const milestoneId = pending?.milestoneId
          ? String(pending.milestoneId)
          : "";
        if (milestoneId) {
          const existing =
            logItem.system?.callbackLink ??
            logItem.getFlag?.(MODULE_ID, "callbackLink") ??
            null;
          const next = {
            ...(isPlainObject(existing) ? existing : {}),
            milestoneId,
          };
          await logItem.update(
            { "system.callbackLink": next },
            { renderSheet: false },
          );
        }
      } catch (_) {
        // ignore
      }

      const arcFromLog =
        logItem.system?.arcInfo ??
        logItem.getFlag?.(MODULE_ID, "arcInfo") ??
        null;
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
              log.system?.primaryValueId ||
                log.getFlag?.(MODULE_ID, "primaryValueId") ||
                "",
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

          // Try to get chosenLogId and valueId from pending data first
          let chosenLogId = pending?.chosenLogId ?? null;
          let valueId = pending?.valueId ?? null;

          // If pending data is missing, try to reconstruct from callbackLink
          const callbackLink =
            logItem.system?.callbackLink ??
            logItem.getFlag?.(MODULE_ID, "callbackLink") ??
            null;
          if (!chosenLogId && callbackLink?.fromLogId) {
            chosenLogId = String(callbackLink.fromLogId);
          }
          if (!valueId && callbackLink?.valueId) {
            valueId = String(callbackLink.valueId);
          }

          // If valueId is still missing, try to get it from the log's primary value
          if (!valueId) {
            valueId = getPrimaryValueIdForLog(actor, logItem) || null;
          }

          const valueImg =
            pending?.valueImg ??
            (valueId ? getValueIconPathForValueId(actor, valueId) : null);

          // Determine if this is a standalone milestone (no callback link data)
          const isStandalone = !chosenLogId;

          // Resolve the chosen log if we have an ID
          let resolvedChosenLogId = chosenLogId ? String(chosenLogId) : "";
          let chosenLog = resolvedChosenLogId
            ? (actor.items.get(resolvedChosenLogId) ?? null)
            : null;

          if (!chosenLog && resolvedChosenLogId) {
            // The pending data may refer to a log that was deleted/edited.
            // If possible, fall back to the callbackLink on the CURRENT log.
            const link =
              logItem.system?.callbackLink ??
              logItem.getFlag?.(MODULE_ID, "callbackLink") ??
              null;
            const fallbackId = link?.fromLogId ? String(link.fromLogId) : "";
            const fallbackLog = fallbackId
              ? (actor.items.get(fallbackId) ?? null)
              : null;

            if (fallbackLog?.type === "log") {
              resolvedChosenLogId = fallbackId;
              chosenLog = fallbackLog;

              // Heal so future clicks work without special-casing.
              try {
                await logItem.update({
                  "system.pendingMilestoneBenefit": {
                    ...pending,
                    chosenLogId: resolvedChosenLogId,
                  },
                });
              } catch (_) {
                // ignore
              }
            }
          }

          // For linked milestones, we need the chosen log to exist
          if (!isStandalone && !chosenLog) {
            ui.notifications?.warn(
              "This callback references a Log that no longer exists. Please choose a different Log and try again.",
            );
            // Still clear the button so the button goes away
            try {
              await logItem.update({ "system.showMilestoneArcButton": false });
              await logItem.unsetFlag?.(MODULE_ID, "showMilestoneArcButton");
            } catch (_) {}
            return;
          }

          let milestone = null;
          const milestoneId = pending?.milestoneId ?? null;
          if (milestoneId) {
            milestone = actor.items.get(String(milestoneId)) ?? null;
          }

          if (!milestone) {
            milestone = await createMilestoneItem(actor, {
              // For standalone milestones, use the current log as both chosenLog and currentLog
              chosenLogId: resolvedChosenLogId || logItem.id,
              currentLogId: logItem.id,
              // Milestone icons should match the log that created them.
              // Use the current log's icon when available, otherwise fall back to the value icon.
              valueImg: logItem?.img ? String(logItem.img) : valueImg,
              valueId: valueId || null,
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

          await logItem.update({
            "system.pendingMilestoneBenefit": {
              ...pending,
              milestoneId: milestone.id,
              benefitChosen: true,
            },
          });

          // Auto-uncheck showMilestoneArcButton after benefit is chosen
          try {
            await logItem.update({ "system.showMilestoneArcButton": false });
            await logItem.unsetFlag?.(MODULE_ID, "showMilestoneArcButton");
          } catch (_) {
            // ignore
          }

          try {
            const currentLink =
              logItem.system?.callbackLink ??
              logItem.getFlag?.(MODULE_ID, "callbackLink") ??
              null;
            const updatedLink = isPlainObject(currentLink)
              ? { ...currentLink }
              : {};
            updatedLink.milestoneId = milestone.id;
            await logItem.update({ "system.callbackLink": updatedLink });
          } catch (_) {
            // ignore
          }

          app.render();
          _openCreatedItemSheet(actor, createdItemId);
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
