import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import { getModuleSocket } from "../../core/socket.js";
import {
  getCurrentMissionLogForActor,
  isLogUsed,
  setCurrentMissionLogForActor,
} from "../../data/mission.js";
import { getCreatedKey, compareKeys } from "./sortingUtils.js";
import { rerenderOpenStaSheetsForActorId as refreshOpenSheet } from "./sheetUtils.js";
import {
  closeStaOfficersLogContextMenu,
  openStaOfficersLogContextMenu,
} from "./contextMenu.js";

// Module-level state for tracking normalization operations
const _staNormalizingLogIds = new Set();
const _staNormalizingActorIds = new Set();

/**
 * Check if a log is currently being normalized.
 */
export function isLogBeingNormalized(logId) {
  return _staNormalizingLogIds.has(String(logId ?? ""));
}

/**
 * Check if an actor is currently being normalized.
 */
export function isActorBeingNormalized(actorId) {
  return _staNormalizingActorIds.has(String(actorId ?? ""));
}

/**
 * Mark a log as being normalized (to prevent re-entrancy).
 */
export function markLogNormalizing(logId, normalizing = true) {
  const id = String(logId ?? "");
  if (!id) return;
  if (normalizing) {
    _staNormalizingLogIds.add(id);
  } else {
    _staNormalizingLogIds.delete(id);
  }
}

/**
 * Mark an actor as being normalized (to prevent re-entrancy).
 */
export function markActorNormalizing(actorId, normalizing = true) {
  const id = String(actorId ?? "");
  if (!id) return;
  if (normalizing) {
    _staNormalizingActorIds.add(id);
  } else {
    _staNormalizingActorIds.delete(id);
  }
}

/**
 * Ensure an inline actions container exists before the toggle element.
 */
export function ensureInlineActionsContainer(rowEl, toggleEl) {
  if (!(rowEl instanceof HTMLElement) || !(toggleEl instanceof HTMLElement)) {
    return null;
  }
  let container = rowEl.querySelector(".sta-log-inline-actions");
  if (!(container instanceof HTMLElement)) {
    container = document.createElement("span");
    container.className = "sta-log-inline-actions";
  }
  if (container.parentElement !== rowEl || container.nextSibling !== toggleEl) {
    rowEl.insertBefore(container, toggleEl);
  }
  return container;
}

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
      'div.section.milestones li.row.entry[data-item-type="log"]',
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
        if (it.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true) continue;
        const link = it.getFlag?.(MODULE_ID, "callbackLink") ?? null;
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
      const selector =
        'div.section.milestones li.row.entry[data-item-type="log"][data-item-id="' +
        normalized +
        '"]';
      const rowEl = root.querySelector(selector);
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

    for (const row of Array.from(logRows)) {
      if (!(row instanceof HTMLElement)) continue;

      const entryId = row?.dataset?.itemId ? String(row.dataset.itemId) : "";

      // Right-click context menu: Make Current Mission Log
      if (row.dataset.staMissionLogContextBound !== "1") {
        row.dataset.staMissionLogContextBound = "1";
        row.addEventListener(
          "contextmenu",
          (ev) => {
            try {
              ev?.preventDefault?.();
              ev?.stopPropagation?.();
              ev?.stopImmediatePropagation?.();
            } catch (_) {
              // ignore
            }

            const logId = row?.dataset?.itemId
              ? String(row.dataset.itemId)
              : "";
            if (!logId) {
              console.error(
                `${MODULE_ID} | cannot set current mission log (missing log id on row)`,
              );
              return;
            }

            openStaOfficersLogContextMenu({
              x: ev?.clientX ?? 0,
              y: ev?.clientY ?? 0,
              label: makeCurrentMissionText,
              onClick: async () => requestSetCurrentMissionLog(logId),
            });
          },
          true,
        );
      }

      const toggleAnchor = row.querySelector("a.value-used.control.toggle");
      if (!(toggleAnchor instanceof HTMLElement)) continue;
      const isCurrentMissionRow =
        entryId && currentMissionLogId && entryId === currentMissionLogId;
      const existingIndicator = row.querySelector(
        ".sta-current-mission-indicator",
      );
      if (isCurrentMissionRow) {
        const inlineActions = ensureInlineActionsContainer(row, toggleAnchor);
        if (!inlineActions) continue;
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

      if (toggleAnchor.querySelector(":scope > .sta-show-source-btn")) continue;

      const btn = document.createElement("a");
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
          targetLogItem?.getFlag?.(MODULE_ID, "callbackLink") ?? null;
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

      toggleAnchor.appendChild(btn);
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

    const logs = Array.from(actor.items ?? []).filter((i) => i?.type === "log");
    if (!logs.length) return { loserLogIds: [] };

    const byFromLogId = new Map(); // fromLogId -> childLog[]

    for (const log of logs) {
      try {
        if (log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true) continue;
        const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
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
              [`flags.${MODULE_ID}.callbackLink.fromLogId`]: null,
              [`flags.${MODULE_ID}.callbackLink.valueId`]: null,
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

    const logs = Array.from(actor.items ?? []).filter((i) => i?.type === "log");
    if (!logs.length) return;

    const targetIds = new Set();
    for (const child of logs) {
      try {
        if (child.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true)
          continue;
        const link = child.getFlag?.(MODULE_ID, "callbackLink") ?? null;
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
