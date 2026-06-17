import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { getModuleSocket } from "../core/socket.js";
import {
  getCurrentMissionLogForActor,
  isLogUsed,
  setCurrentMissionLogForActor,
} from "../missions/mission.js";
import { getMilestoneChildLogIds } from "./logMetadata.js";
import { getCreatedKey, compareKeys } from "./sortingUtils.js";
import {
  rerenderOpenStaSheetsForActorId as refreshOpenSheet,
  ensureInlineActionsContainer,
} from "../sheet/sheetUtils.js";
import {
  closeStaOfficersLogContextMenu,
  setupMissionLogContextMenu,
} from "../sheet/contextMenu.js";
import { isLogUnconditionallyIneligibleAsCallbackTarget } from "../callback/callbackEligibility.js";

/**
 * Install callback source buttons on log rows in the character sheet.
 * This adds the "Show Callback and Milestone" button and current mission indicator.
 */
export function installCallbackSourceButtons(root, actor) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!actor?.items) return;

    const shouldAllowUsedToggle =
      String(root?.dataset?.staShowLogUsedToggle ?? "0") === "1";

    const logRows = root.querySelectorAll(
      'div.section.milestones li.row.entry[data-item-type="log"], div.section.character-log li.row.entry[data-item-type="log"]',
    );
    // Get current mission log directly from the actor (no userId needed)
    const currentMissionLogId = getCurrentMissionLogForActor(actor) ?? "";
    const currentMissionIndicatorText =
      t("sta-officers-log.logs.currentMissionIndicator") ??
      "Current mission log";

    const makeCurrentMissionText =
      t("sta-officers-log.logs.makeCurrentMissionLog") ??
      "Make Current Mission Log";

    const requestSetCurrentMissionLog = async (logId) => {
      const lId = logId ? String(logId) : "";

      if (!lId) {
        console.error(
          `${MODULE_ID} | cannot set current mission log (no logId)`,
        );
        return;
      }

      if (!actor) {
        console.error(
          `${MODULE_ID} | cannot set current mission log (no actor)`,
        );
        return;
      }

      try {
        if (game.user?.isGM) {
          // GM can set directly on the actor
          await setCurrentMissionLogForActor(actor, lId);
        } else {
          // Non-GM needs to use socket
          const socket = getModuleSocket();
          if (!socket || typeof socket.executeAsGM !== "function") {
            console.error(
              `${MODULE_ID} | cannot set current mission log (socket unavailable)`,
            );
            return;
          }

          const ok = await socket.executeAsGM("setCurrentMissionLogForActor", {
            actorId: String(actor?.id ?? ""),
            logId: lId,
          });

          if (ok !== true) {
            console.error(
              `${MODULE_ID} | GM rejected setting current mission log for actor ${actor?.id} -> ${lId}`,
            );
            return;
          }
        }
      } catch (err) {
        console.error(`${MODULE_ID} | failed to set current mission log`, err);
        return;
      }

      // Rerender sheets so the indicator updates.
      try {
        refreshOpenSheet(String(actor?.id ?? ""));
      } catch (_) {
        // ignore
      }
    };

    /** Takes a log's ID, and searches through other log items on the same actor until it finds items whose flags.sta-officers-log.callbackLink.fromLogId equals that targetId.
     *  In other words: "find logs that point back to this log".
     *  If multiple logs match, it sorts them by creation time (getCreatedKey) and returns the earliest one. */
    const findSourceLogForTargetId = (targetId) => {
      const tId = targetId ? String(targetId) : "";
      if (!tId) return null;

      const children = [];
      for (const it of actor.items ?? []) {
        if (it?.type !== "log") continue;
        if (
          it.system?.callbackLinkDisabled === true ||
          it.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true
        )
          continue;
        const link =
          it.system?.callbackLink ??
          it.getFlag?.(MODULE_ID, "callbackLink") ??
          null;
        const fromLogId = String(link?.fromLogId ?? "");
        if (fromLogId && fromLogId === tId) children.push(it);
      }

      if (!children.length) return null;
      if (children.length === 1) return children[0];

      const ordered = children
        .slice()
        .sort((a, b) => compareKeys(getCreatedKey(a), getCreatedKey(b)));
      return ordered[0] ?? null;
    };

    const escapeItemIdForSelector = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "";
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(raw);
      }
      return raw.replace(/"/g, '\\"');
    };

    const findLogRowById = (logId) => {
      const normalized = escapeItemIdForSelector(logId);
      if (!normalized) return null;
      const suffix =
        'li.row.entry[data-item-type="log"][data-item-id="' + normalized + '"]';
      const rowEl =
        root.querySelector("div.section.character-log " + suffix) ??
        root.querySelector("div.section.milestones " + suffix);
      return rowEl instanceof HTMLElement ? rowEl : null;
    };

    const findMilestoneRowById = (milestoneId) => {
      const normalized = escapeItemIdForSelector(milestoneId);
      if (!normalized) return null;
      const selector =
        'div.section.milestones li.row.entry[data-item-type="milestone"][data-item-id="' +
        normalized +
        '"]';
      const rowEl = root.querySelector(selector);
      return rowEl instanceof HTMLElement ? rowEl : null;
    };

    const flashRow = (rowEl) => {
      if (!(rowEl instanceof HTMLElement)) return;
      try {
        rowEl.classList.remove("sta-callbacks-source-flash");
        // Force a reflow so the animation can restart.
        void rowEl.offsetWidth;
        rowEl.classList.add("sta-callbacks-source-flash");
        setTimeout(() => {
          try {
            rowEl.classList.remove("sta-callbacks-source-flash");
          } catch (_) {
            // ignore
          }
        }, 1100);
      } catch (_) {
        // ignore
      }
    };

    // Set up right-click context menu for mission log rows using Foundry's ContextMenu API.
    // Skip when sta-utils provides a unified context menu that already includes the
    // "Set Current Mission" action (compact/tidy/lcars/mobile modes all do this).
    let staUtilsHandlesMenu = false;
    const staUtilsActive = game.modules?.get?.("sta-utils")?.active ?? false;
    if (staUtilsActive) {
      // Legacy boolean settings (pre-migration to sheetVariant)
      let legacyHandles = false;
      try {
        legacyHandles =
          game.settings.get("sta-utils", "compactCharacterSheet") === true ||
          game.settings.get("sta-utils", "tidyCharacterSheet") === true ||
          game.settings.get("sta-utils", "lcarsCharacterSheet") === true;
      } catch (_) {
        // not yet registered
      }

      // Unified sheetVariant setting (compact/tidy/lcars post-migration)
      let variantHandles = false;
      try {
        const v = game.settings.get("sta-utils", "sheetVariant");
        variantHandles = v === "compact" || v === "tidy" || v === "lcars";
      } catch (_) {
        // not yet registered
      }

      // Mobile sheet (MobileCharacterSheet2e) — detected via DOM class since
      // this sheet is registered as a distinct class, not via sheetVariant.
      // root may itself be the .character-sheet--mobile element, so check both
      // root.matches() and querySelector() for descendants.
      const mobileHandles =
        !!root?.matches?.(".character-sheet--mobile") ||
        !!root?.querySelector?.(".character-sheet--mobile");

      // LCARS bespoke sheet (LcarsCharacterSheet2e) — detected via DOM class.
      // sta-lcars-sheet is always present; sta-lcars is omitted when the
      // "STA Original" theme is active. root may itself carry these classes,
      // so check root.matches() in addition to querySelector() for descendants.
      const lcarsSheetHandles =
        !!root?.matches?.(".sta-lcars, .sta-lcars-sheet") ||
        !!root?.querySelector?.(".sta-lcars, .sta-lcars-sheet");

      staUtilsHandlesMenu =
        legacyHandles || variantHandles || mobileHandles || lcarsSheetHandles;
    }

    const milestonesSection = root.querySelector("div.section.milestones");
    const characterLogSection = root.querySelector("div.section.character-log");
    const logContextMenuSection = characterLogSection ?? milestonesSection;
    if (logContextMenuSection instanceof HTMLElement && !staUtilsHandlesMenu) {
      setupMissionLogContextMenu({
        container: logContextMenuSection,
        selector: 'li.row.entry[data-item-type="log"][data-item-id]',
        label: makeCurrentMissionText,
        onSelect: async (element) => {
          const logId = element?.dataset?.itemId
            ? String(element.dataset.itemId)
            : "";
          if (!logId) {
            console.error(
              `${MODULE_ID} | cannot set current mission log (missing log id on row)`,
            );
            return;
          }
          await requestSetCurrentMissionLog(logId);
        },
      });
    }

    for (const row of Array.from(logRows)) {
      if (!(row instanceof HTMLElement)) continue;

      const entryId = row?.dataset?.itemId ? String(row.dataset.itemId) : "";
      const logItem = entryId ? actor.items.get(entryId) : null;

      // Mark logs that are unconditionally ineligible as callback targets.
      if (
        logItem &&
        isLogUnconditionallyIneligibleAsCallbackTarget(actor, logItem)
      ) {
        row.classList.add("sta-callback-ineligible-log");
      } else {
        row.classList.remove("sta-callback-ineligible-log");
      }

      const toggleAnchor = row.querySelector("a.value-used.control.toggle");
      if (!(toggleAnchor instanceof HTMLElement)) continue;
      const isCurrentMissionRow =
        entryId && currentMissionLogId && entryId === currentMissionLogId;

      // Always ensure an inlineActions container exists — used for both the
      // current-mission indicator and the Write-Log button.
      const inlineActions = ensureInlineActionsContainer(row, toggleAnchor);
      if (!inlineActions) continue;

      const existingIndicator = row.querySelector(
        ".sta-current-mission-indicator",
      );
      if (isCurrentMissionRow) {
        row.classList.add("sta-current-mission-log");
        if (!existingIndicator) {
          const indicator = document.createElement("span");
          indicator.className = "sta-current-mission-indicator";
          indicator.title = currentMissionIndicatorText;
          indicator.innerHTML = '<i class="fa-solid fa-video"></i>';
          inlineActions.prepend(indicator);
        } else {
          inlineActions.prepend(existingIndicator);
        }
      } else {
        row.classList.remove("sta-current-mission-log");
        existingIndicator?.remove();
      }

      // If the native Used toggle is hidden, prevent accidental toggle clicks.
      // Keep injected buttons clickable.
      if (
        !shouldAllowUsedToggle &&
        toggleAnchor.dataset.staNoUsedToggleBound !== "1"
      ) {
        toggleAnchor.dataset.staNoUsedToggleBound = "1";
        toggleAnchor.addEventListener(
          "click",
          (ev) => {
            try {
              const target = ev?.target instanceof Element ? ev.target : null;
              const isAllowed = Boolean(
                target?.closest?.(
                  ".sta-inline-sheet-btn, .sta-show-source-btn",
                ),
              );
              if (isAllowed) return;
              ev.preventDefault();
              ev.stopPropagation();
              ev.stopImmediatePropagation?.();
            } catch (_) {
              // ignore
            }
          },
          true,
        );
      }

      if (inlineActions.querySelector(":scope > .sta-show-source-btn"))
        continue;

      // ── Write-Log button ─────────────────────────────────────────────────
      // Lives in inlineActions (a <span>), not inside the <a>.control toggle,
      // to avoid the nested-anchor color problem and the 40px width cap.
      // Current mission: labelled "Write Log". Other logs: pencil icon only.
      if (!inlineActions.querySelector(":scope > .sta-write-log-btn")) {
        const writeBtn = document.createElement("button");
        writeBtn.type = "button";
        writeBtn.className = "sta-write-log-btn sta-inline-sheet-btn";
        if (isCurrentMissionRow) {
          writeBtn.classList.add("sta-write-log-btn--current");
          writeBtn.title = "Write log";
          writeBtn.setAttribute("aria-label", "Write log");
          writeBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Write Log';
        } else {
          writeBtn.title = "Edit log";
          writeBtn.setAttribute("aria-label", "Edit log");
          writeBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
        }
        writeBtn.addEventListener("click", (ev) => {
          try {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation?.();
          } catch (_) {
            // ignore
          }
          const itemId = row?.dataset?.itemId ? String(row.dataset.itemId) : "";
          const item = itemId ? actor.items?.get?.(itemId) : null;
          if (item?.sheet) item.sheet.render(true);
        });
        inlineActions.append(writeBtn);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sta-show-source-btn";
      btn.title = "Show Callback and Milestone";
      btn.setAttribute("aria-label", "Show Callback and Milestone");
      btn.innerHTML = '<i class="fa-solid fa-diagram-project"></i>';

      btn.addEventListener("click", (ev) => {
        try {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();
        } catch (_) {
          // ignore
        }

        const targetLogId = row?.dataset?.itemId
          ? String(row.dataset.itemId)
          : "";
        const targetLogItem = targetLogId
          ? (actor.items?.get?.(String(targetLogId)) ?? null)
          : null;
        const callbackLink =
          targetLogItem?.system?.callbackLink ??
          targetLogItem?.getFlag?.(MODULE_ID, "callbackLink") ??
          null;
        const fromLogId = String(callbackLink?.fromLogId ?? "");
        const milestoneId = String(callbackLink?.milestoneId ?? "");

        if (!fromLogId) {
          ui.notifications?.warn?.("This log does not make a callback.");
          return;
        }

        const sourceRow = findLogRowById(fromLogId);
        if (!sourceRow) {
          ui.notifications?.warn?.("Callback log is missing from the sheet.");
          return;
        }

        try {
          sourceRow.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (_) {
          // ignore
        }

        flashRow(sourceRow);

        if (milestoneId) {
          const milestoneRow = findMilestoneRowById(milestoneId);
          if (milestoneRow) {
            flashRow(milestoneRow);
          } else {
            ui.notifications?.warn?.(
              "Associated milestone is missing from the sheet.",
            );
          }
        }
      });

      inlineActions.append(btn);
    }
  } catch (_) {
    // ignore
  }
}

/**
 * Install "Show Associated Logs" buttons on milestone rows in the character sheet.
 * When clicked, it highlights the logs that are children of that milestone.
 */
export function installMilestoneHighlightButtons(root, actor) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!actor?.items) return;

    const milestoneRows = root.querySelectorAll(
      'div.section.milestones li.row.entry[data-item-type="milestone"]',
    );

    const escapeItemIdForSelector = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "";
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(raw);
      }
      return raw.replace(/"/g, '\\"');
    };

    const findLogRowById = (logId) => {
      const normalized = escapeItemIdForSelector(logId);
      if (!normalized) return null;
      const suffix =
        'li.row.entry[data-item-type="log"][data-item-id="' + normalized + '"]';
      const rowEl =
        root.querySelector("div.section.character-log " + suffix) ??
        root.querySelector("div.section.milestones " + suffix) ??
        root.querySelector(".sta-sup-advancement-logs " + suffix);
      return rowEl instanceof HTMLElement ? rowEl : null;
    };

    const flashRow = (rowEl) => {
      if (!(rowEl instanceof HTMLElement)) return;
      try {
        rowEl.classList.remove("sta-callbacks-source-flash");
        // Force a reflow so the animation can restart.
        void rowEl.offsetWidth;
        rowEl.classList.add("sta-callbacks-source-flash");
        setTimeout(() => {
          try {
            rowEl.classList.remove("sta-callbacks-source-flash");
          } catch (_) {
            // ignore
          }
        }, 1100);
      } catch (_) {
        // ignore
      }
    };

    for (const row of Array.from(milestoneRows)) {
      if (!(row instanceof HTMLElement)) continue;

      const milestoneId = row?.dataset?.itemId
        ? String(row.dataset.itemId)
        : "";
      if (!milestoneId) continue;

      const milestone = actor.items.get(milestoneId);
      if (!milestone || milestone.type !== "milestone") continue;

      // Get associated log IDs
      const childLogIds = getMilestoneChildLogIds(milestone);

      // Avoid duplicates
      if (row.querySelector(".sta-show-milestone-logs-btn")) continue;

      // Find the control div to insert before it
      const controlDiv = row.querySelector(".control");
      if (!(controlDiv instanceof HTMLElement)) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sta-show-milestone-logs-btn";
      btn.title = childLogIds.length
        ? "Show Associated Logs"
        : "No associated logs to highlight";
      btn.setAttribute(
        "aria-label",
        childLogIds.length
          ? "Show Associated Logs"
          : "No associated logs to highlight",
      );
      btn.style.paddingRight = "7px";
      btn.style.marginLeft = "-7px";
      btn.innerHTML = '<i class="fa-solid fa-diagram-project"></i>';

      if (!childLogIds.length) {
        btn.classList.add("is-disabled");
        btn.setAttribute("aria-disabled", "true");
      }

      btn.addEventListener("click", (ev) => {
        try {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation?.();
        } catch (_) {
          // ignore
        }

        if (btn.classList.contains("is-disabled")) return;

        let foundAny = false;
        let firstRow = null;

        for (const logId of childLogIds) {
          const logRow = findLogRowById(logId);
          if (logRow) {
            foundAny = true;
            if (!firstRow) firstRow = logRow;
            flashRow(logRow);
          }
        }

        if (!foundAny) {
          ui.notifications?.warn?.("Associated logs not found on this sheet.");
          return;
        }

        // Scroll to the first associated log
        if (firstRow) {
          try {
            firstRow.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch (_) {
            // ignore
          }
        }
      });

      // Insert before the control div
      row.insertBefore(btn, controlDiv);
    }
  } catch (_) {
    // ignore
  }
}

/**
 * Enforce that each callback target log (fromLogId) is only pointed to by one child log.
 * If multiple logs point to the same target, only the earliest (by creation time) wins.
 */
export async function enforceUniqueFromLogIdTargets(
  actor,
  { editedLogId } = {},
) {
  try {
    if (!actor?.items) return { loserLogIds: [] };

    // Only the GM or an OWNER of the actor should perform normalization writes.
    // Other connected clients will still receive the document updates, but must not
    // attempt to "fix" anything locally or Foundry will raise permission errors.
    try {
      const canWrite =
        game.user?.isGM === true ||
        actor?.isOwner === true ||
        (typeof actor?.testUserPermission === "function" &&
          actor.testUserPermission(game.user, "OWNER"));
      if (!canWrite) return { loserLogIds: [] };
    } catch (_) {
      return { loserLogIds: [] };
    }

    const logs = actor.items.filter((i) => i?.type === "log");
    if (!logs.length) return { loserLogIds: [] };

    const byFromLogId = new Map(); // fromLogId -> childLog[]

    for (const log of logs) {
      try {
        if (
          log.system?.callbackLinkDisabled === true ||
          log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true
        )
          continue;
        const link =
          log.system?.callbackLink ??
          log.getFlag?.(MODULE_ID, "callbackLink") ??
          null;
        const fromLogId = String(link?.fromLogId ?? "");
        if (!fromLogId) continue;

        const bucket = byFromLogId.get(fromLogId) ?? [];
        bucket.push(log);
        byFromLogId.set(fromLogId, bucket);
      } catch (_) {
        // ignore
      }
    }

    const loserLogIds = [];
    const loserToFromLogId = new Map(); // childLogId -> fromLogId

    for (const [fromLogId, children] of byFromLogId.entries()) {
      if (!Array.isArray(children) || children.length <= 1) continue;

      const ordered = children
        .slice()
        .sort((a, b) => compareKeys(getCreatedKey(a), getCreatedKey(b)));

      const losers = ordered.slice(1);
      if (!losers.length) continue;

      for (const losingLog of losers) {
        const losingId = losingLog?.id ? String(losingLog.id) : "";
        if (!losingId) continue;
        loserLogIds.push(losingId);
        loserToFromLogId.set(losingId, String(fromLogId));

        try {
          await losingLog.update(
            {
              "system.callbackLink": null,
            },
            { renderSheet: false },
          );
        } catch (err) {
          console.warn(
            `${MODULE_ID} | failed enforcing unique callback target for ${losingId} -> ${String(
              fromLogId,
            )}`,
            err,
          );
        }
      }
    }

    // Optional UX: if the currently edited log lost a collision, warn.
    if (editedLogId && loserLogIds.includes(String(editedLogId))) {
      try {
        const collidedFromLogId = String(
          loserToFromLogId.get(String(editedLogId)) ?? "",
        );

        const fromName = (() => {
          try {
            const target = collidedFromLogId
              ? actor.items.get(collidedFromLogId)
              : null;
            const name =
              target?.type === "log" ? String(target.name ?? "") : "";
            return name.trim();
          } catch (_) {
            return "";
          }
        })();

        const targetLabel = fromName || collidedFromLogId || "that log";
        ui.notifications?.warn?.(
          `Callback target already used (${targetLabel}); link cleared.`,
        );
      } catch (_) {
        // ignore
      }
    }

    return { loserLogIds };
  } catch (_) {
    return { loserLogIds: [] };
  }
}

/**
 * Sync the system.used flag on logs based on whether they are callback targets.
 * A log is "used" if another log points to it via callbackLink.fromLogId.
 */
export async function syncCallbackTargetUsedFlags(actor) {
  try {
    if (!actor?.items) return;

    // Only the GM or an OWNER of the actor should perform normalization writes.
    // Prevents "User X lacks permission to update Item" errors on other clients.
    try {
      const canWrite =
        game.user?.isGM === true ||
        actor?.isOwner === true ||
        (typeof actor?.testUserPermission === "function" &&
          actor.testUserPermission(game.user, "OWNER"));
      if (!canWrite) return;
    } catch (_) {
      return;
    }

    const logs = actor.items.filter((i) => i?.type === "log");
    if (!logs.length) return;

    const targetIds = new Set();
    for (const child of logs) {
      try {
        if (
          child.system?.callbackLinkDisabled === true ||
          child.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true
        )
          continue;
        const link =
          child.system?.callbackLink ??
          child.getFlag?.(MODULE_ID, "callbackLink") ??
          null;
        const fromLogId = String(link?.fromLogId ?? "");
        if (fromLogId) targetIds.add(fromLogId);
      } catch (_) {
        // ignore
      }
    }

    const updates = [];
    for (const log of logs) {
      const id = log?.id ? String(log.id) : "";
      if (!id) continue;

      const desired = targetIds.has(id);
      const current = Boolean(log?.system?.used);

      // Only write when we need to flip state.
      if (desired && !current) {
        updates.push(
          log.update({ "system.used": true }, { renderSheet: false }),
        );
      } else if (!desired && current) {
        updates.push(
          log.update({ "system.used": false }, { renderSheet: false }),
        );
      }
    }

    if (updates.length) await Promise.allSettled(updates);
  } catch (_) {
    // ignore
  }
}
