import { MODULE_ID } from "../../constants.js";
import { t } from "../../i18n.js";
import { getModuleSocket } from "../../socket.js";
import {
  getCurrentMissionLogIdForUser,
  isLogUsed,
  setMissionLogForUser,
} from "../../mission.js";
import {
  isValueChallenged,
  setValueChallenged,
} from "../../valueChallenged.js";
import {
  labelValuesOnActor,
  getStaDefaultIcon,
  getValueIconPathForValueId,
  escapeHTML,
  mergeValueStateArray,
  getValueStateArray,
  isValueTrauma,
  setValueTraumaFlag,
  wasLogCreatedWithTrauma,
  setLogCreatedWithTraumaFlag,
  getLogIconPathForValue,
  getValueItems,
} from "../../values.js";
import {
  createMilestoneItem,
  formatChosenBenefitLabel,
  gainDetermination,
  spendDetermination,
  promptCallbackForActorAsGM,
  sendCallbackPromptToUser,
} from "../../callbackFlow.js";

import { ATTRIBUTE_KEYS, DISCIPLINE_KEYS } from "../../callbackFlow/dialogs.js";
import {
  DIRECTIVE_VALUE_ID_PREFIX,
  directiveIconPath,
  getDirectiveSnapshotForLog,
  getMissionDirectives,
  isDirectiveValueId,
  makeDirectiveKeyFromText,
  sanitizeDirectiveText,
  setDirectiveChallenged,
  setMissionDirectives,
} from "../../directives.js";
import { openNewMilestoneArcDialog } from "./newMilestoneArcDialog.js";

import { promptUseValueChoice } from "./useValueDialog.js";
import {
  canCurrentUserChangeActor,
  getActorFromAppOrItem,
  getItemFromApp,
  getUserIdForCharacterActor,
  openCreatedItemSheetAfterMilestone,
  rerenderOpenStaSheetsForActorId as refreshOpenSheet,
  refreshMissionLogSortingForActorId,
} from "./sheetUtils.js";
import { filterMilestoneAssociatedLogOptions } from "./milestoneLinks.js";
import { syncMilestoneImgFromLog } from "../../milestoneIcons.js";
import { installInlineLogChainLinkControls } from "./logLinkControls.js";
import {
  setTraitScarFlag,
  isTraitScar,
  setTraitFatigueFlag,
  isTraitFatigue,
} from "./itemFlags.js";
import { installConfirmDeleteControls } from "./confirmDelete.js";
import {
  applyMissionLogSorting,
  getMissionLogSortModeForActor,
  setMissionLogSortModeForActor,
} from "./logSorting.js";
import { getCreatedKey, compareKeys } from "./sortingUtils.js";
import {
  areSheetEnhancementsEnabled,
  shouldShowLogUsedToggle,
  areTraumaRulesEnabled,
  areScarRulesEnabled,
} from "../../clientSettings.js";

import { installCharacterLogListResizer } from "./logListResizer.js";

import { hasEligibleCallbackTargetForValueId } from "../../logMetadata.js";
import {
  findFatiguedTrait,
  showAttributeSelectionDialog,
  hasFatiguedAttributeChosen,
} from "../stressHook.js";

let _staCallbacksHelperMilestoneUpdateHookInstalled = false;
let _staCallbacksHelperItemSheetRenderHookInstalled = false;
const _staNormalizingLogIds = new Set();
const _staNormalizingActorIds = new Set();
const _staLogMetaDetailsOpenByLogId = new Map(); // logId -> boolean

let _staOpenContextMenuEl = null;
let _staOpenContextMenuCleanup = null;

function closeStaOfficersLogContextMenu() {
  try {
    _staOpenContextMenuCleanup?.();
  } catch (_) {
    // ignore
  }
  _staOpenContextMenuCleanup = null;

  try {
    _staOpenContextMenuEl?.remove?.();
  } catch (_) {
    // ignore
  }
  _staOpenContextMenuEl = null;
}

function openStaOfficersLogContextMenu({ x, y, label, onClick }) {
  closeStaOfficersLogContextMenu();

  const menu = document.createElement("nav");
  // Reuse Foundry's context menu classes so we inherit core styling.
  menu.className = "context-menu sta-officers-log-context-menu";
  menu.setAttribute("role", "menu");
  menu.style.position = "fixed";
  menu.style.left = `${Number(x) || 0}px`;
  menu.style.top = `${Number(y) || 0}px`;
  menu.style.zIndex = "10000";

  const list = document.createElement("div");
  list.className = "context-items";

  const item = document.createElement("div");
  item.className = "context-item";
  item.setAttribute("role", "menuitem");
  item.tabIndex = 0;
  item.textContent = String(label ?? "");
  const runAction = async (ev) => {
    try {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      ev?.stopImmediatePropagation?.();
    } catch (_) {
      // ignore
    }

    // Close immediately for responsiveness.
    closeStaOfficersLogContextMenu();
    try {
      await onClick?.();
    } catch (err) {
      console.error(`${MODULE_ID} | context menu action failed`, err);
    }
  };

  item.addEventListener("click", runAction);
  item.addEventListener("keydown", (ev) => {
    const k = String(ev?.key ?? "");
    if (k === "Enter" || k === " ") runAction(ev);
  });

  list.appendChild(item);
  menu.appendChild(list);
  document.body.appendChild(menu);

  // Clamp to viewport.
  try {
    const rect = menu.getBoundingClientRect();
    const pad = 4;
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    const clampedX = Math.min(Math.max(pad, Number(x) || 0), maxX);
    const clampedY = Math.min(Math.max(pad, Number(y) || 0), maxY);
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
  } catch (_) {
    // ignore
  }

  const onDocMouseDown = (ev) => {
    try {
      const t = ev?.target;
      if (t instanceof Node && menu.contains(t)) return;
    } catch (_) {
      // ignore
    }
    closeStaOfficersLogContextMenu();
  };

  const onKeyDown = (ev) => {
    try {
      if (String(ev?.key ?? "") === "Escape") closeStaOfficersLogContextMenu();
    } catch (_) {
      // ignore
    }
  };

  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  _staOpenContextMenuEl = menu;
  _staOpenContextMenuCleanup = () => {
    try {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    } catch (_) {
      // ignore
    }
  };
}

function _hasEligibleCallbackTargetWithAnyInvokedDirective(
  actor,
  currentMissionLogId,
) {
  try {
    if (!actor || actor.type !== "character") return false;

    // If we can't resolve the mission log id, preserve previous behavior (allow prompting).
    const missionLogId = currentMissionLogId ? String(currentMissionLogId) : "";
    if (!missionLogId) return true;

    // Logs that are already used as a callback target (someone points to them) are not eligible.
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
        const s = String(state ?? "unused");
        if (["positive", "negative", "challenged"].includes(s)) return true;
      }
    }

    return false;
  } catch (_) {
    return true;
  }
}

function installOfficersLogButtonsInStaTracker(app, root) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!game.user?.isGM) return;
    if (!game.staCallbacksHelper) return;

    // Detect the STA system tracker.
    const ctorName = String(app?.constructor?.name ?? "");
    const looksLikeTracker =
      ctorName === "STATracker" ||
      !!root.querySelector?.(".tracker-container") ||
      !!root.querySelector?.("#sta-roll-task-button") ||
      !!root.querySelector?.("#sta-momentum-tracker");

    if (!looksLikeTracker) return;

    // Avoid duplicates across rerenders.
    if (root.querySelector?.(".sta-officers-log-group")) return;

    // Insert next to the existing roll buttons column.
    const row =
      root.querySelector?.(".tracker-container .row") ??
      root.querySelector?.(".row") ??
      null;
    if (!row) return;

    const iconContainer = row.querySelector?.(":scope > .icon-container");
    if (!iconContainer) return;

    // Wrap the existing STA tracker buttons and our module buttons into a 2-column layout.
    let columns = iconContainer.querySelector?.(
      ":scope > .sta-tracker-button-columns",
    );
    let systemGroup = iconContainer.querySelector?.(
      ":scope > .sta-tracker-button-columns > .sta-tracker-button-group.sta-tracker-system-buttons",
    );

    if (!columns || !systemGroup) {
      columns = document.createElement("div");
      columns.className = "sta-tracker-button-columns";

      systemGroup = document.createElement("div");
      systemGroup.className =
        "sta-tracker-button-group sta-tracker-system-buttons";

      // Move existing buttons into the system group.
      const children = Array.from(iconContainer.children);
      for (const child of children) systemGroup.appendChild(child);

      // Replace iconContainer contents with the columns wrapper.
      iconContainer.innerHTML = "";
      columns.appendChild(systemGroup);
      iconContainer.appendChild(columns);
    }

    const makeButton = ({ id, cls, title, icon, onClick }) => {
      const btn = document.createElement("div");
      btn.id = id;
      btn.className = `button ${cls}`;
      btn.title = title;
      btn.dataset.action = "staOfficersLog";

      const i = document.createElement("i");
      // Use fixed-width icons so the column aligns cleanly with the STA buttons.
      i.className = `${icon} fa-fw`;
      btn.appendChild(i);

      btn.addEventListener("click", (event) => {
        try {
          event?.preventDefault?.();
          event?.stopPropagation?.();
        } catch (_) {
          // ignore
        }

        try {
          onClick?.();
        } catch (err) {
          console.error(`${MODULE_ID} | tracker button failed`, err);
        }
      });

      return btn;
    };

    const divider = document.createElement("div");
    divider.className = "sta-tracker-button-divider sta-officers-log-divider";

    const officersGroup = document.createElement("div");
    officersGroup.className = "sta-tracker-button-group sta-officers-log-group";
    officersGroup.dataset.module = MODULE_ID;

    // Mirror the Scene Controls actions.
    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-open-button",
        cls: "sta-officers-log-open",
        title: t("sta-officers-log.tools.sendPrompt"),
        icon: "fa-solid fa-reply",
        onClick: () => game.staCallbacksHelper.open(),
      }),
    );

    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-reset-button",
        cls: "sta-officers-log-reset",
        title: t("sta-officers-log.tools.resetMission"),
        icon: "fa-solid fa-book",
        onClick: () => game.staCallbacksHelper.promptNewMissionAndReset(),
      }),
    );

    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-new-scene-button",
        cls: "sta-officers-log-new-scene",
        title: t("sta-officers-log.tools.newScene"),
        icon: "fa-solid fa-clapperboard",
        onClick: () => game.staCallbacksHelper.newScene(),
      }),
    );

    columns.appendChild(divider);
    columns.appendChild(officersGroup);

    // --- Mission Directives Section ---
    installMissionDirectivesInStaTracker(root, row);
  } catch (_) {
    // ignore
  }
}

function installMissionDirectivesInStaTracker(root, row) {
  try {
    const directives = getMissionDirectives();

    // Find the tracker container to append to.
    const trackerContainer =
      root.querySelector?.(".tracker-container[data-application-part]") ??
      root.querySelector?.(".tracker-container") ??
      row?.parentElement ??
      null;
    if (!trackerContainer) return;

    // Remove any existing section so we always rebuild with fresh data.
    // This ensures the directives list updates when directives are edited.
    const existingSection = trackerContainer.querySelector?.(
      ".sta-tracker-directives-section",
    );
    if (existingSection) {
      existingSection.remove();
    }

    // Measure current height before adding the section.
    const heightBefore = trackerContainer.offsetHeight;

    // Create the directives section.
    const section = document.createElement("div");
    section.className = "sta-tracker-directives-section";

    const header = document.createElement("div");
    header.className = "sta-tracker-directives-header";

    const headerText = document.createElement("span");
    headerText.textContent = t("sta-officers-log.tracker.missionDirectives");
    header.appendChild(headerText);

    // Add edit button for GM only.
    if (game.user?.isGM) {
      const editButton = document.createElement("button");
      editButton.className = "sta-tracker-directives-edit-btn";
      editButton.type = "button";
      editButton.title = t("sta-officers-log.tracker.editDirectives");
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener("click", () => {
        toggleDirectivesEditMode(section, trackerContainer, root);
      });
      header.appendChild(editButton);
    }

    section.appendChild(header);

    // Create display mode content.
    const displayContainer = document.createElement("div");
    displayContainer.className = "sta-tracker-directives-display";

    const list = document.createElement("ul");
    list.className = "sta-tracker-directives-list";

    if (directives.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className =
        "sta-tracker-directive-item sta-tracker-directive-empty";
      emptyItem.textContent = t("sta-officers-log.tracker.noDirectives");
      list.appendChild(emptyItem);
    } else {
      for (const directive of directives) {
        const item = document.createElement("li");
        item.className = "sta-tracker-directive-item";
        item.textContent = directive;
        list.appendChild(item);
      }
    }

    displayContainer.appendChild(list);
    section.appendChild(displayContainer);

    // Create edit mode content (hidden by default).
    const editContainer = document.createElement("div");
    editContainer.className = "sta-tracker-directives-edit";
    editContainer.style.display = "none";

    const textarea = document.createElement("textarea");
    textarea.className = "sta-tracker-directives-textarea";
    textarea.placeholder = t("sta-officers-log.tracker.directivesPlaceholder");
    textarea.value = directives.join("\n");
    editContainer.appendChild(textarea);

    const saveButton = document.createElement("button");
    saveButton.className = "sta-tracker-directives-save-btn";
    saveButton.type = "button";
    saveButton.textContent = t("sta-officers-log.tracker.save");
    saveButton.addEventListener("click", async () => {
      const newDirectives = textarea.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await setMissionDirectives(newDirectives);
      // Rebuild the section with fresh data.
      installMissionDirectivesInStaTracker(root, row);
    });
    editContainer.appendChild(saveButton);

    section.appendChild(editContainer);
    trackerContainer.appendChild(section);

    // After adding the section, use negative margin-top to shift the tracker up.
    // The STA system continuously resets the inline `top` style, but margin-top
    // via CSS should persist and effectively move the tracker upward.
    requestAnimationFrame(() => {
      try {
        const heightAfter = trackerContainer.offsetHeight;
        const heightDiff = heightAfter - heightBefore;

        if (heightDiff > 0) {
          // Apply negative margin to the outermost app element to shift it up.
          // This works even when the STA system resets the `top` style.
          const appElement = root.closest?.("[id^='app-']") ?? root;
          if (appElement instanceof HTMLElement) {
            appElement.style.marginTop = `-${heightDiff}px`;
          }
        }
      } catch (_) {
        // ignore
      }
    });
  } catch (_) {
    // ignore
  }
}

/**
 * Toggle between display and edit mode for the directives section.
 */
function toggleDirectivesEditMode(section, trackerContainer, root) {
  const displayContainer = section.querySelector(
    ".sta-tracker-directives-display",
  );
  const editContainer = section.querySelector(".sta-tracker-directives-edit");
  const editButton = section.querySelector(".sta-tracker-directives-edit-btn");

  if (!displayContainer || !editContainer) return;

  const isEditing = editContainer.style.display !== "none";

  if (isEditing) {
    // Switch to display mode.
    displayContainer.style.display = "";
    editContainer.style.display = "none";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.title = t("sta-officers-log.tracker.editDirectives");
    }
  } else {
    // Switch to edit mode.
    displayContainer.style.display = "none";
    editContainer.style.display = "";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-times"></i>';
      editButton.title = t("sta-officers-log.tracker.cancelEdit");
    }
    // Focus the textarea.
    const textarea = editContainer.querySelector("textarea");
    if (textarea) {
      textarea.focus();
    }
  }

  // Recalculate margin-top after switching modes, since the edit mode
  // (especially with 0 directives) can be significantly taller than display mode.
  requestAnimationFrame(() => {
    try {
      const appElement = root.closest?.("[id^='app-']") ?? root;
      if (!(appElement instanceof HTMLElement)) return;
      if (!(trackerContainer instanceof HTMLElement)) return;

      // Temporarily remove margin-top to measure the "base" height
      // (i.e., the tracker without our margin adjustment).
      const previousMargin = appElement.style.marginTop || "";
      appElement.style.marginTop = "";

      // The directives section is now rendered; measure its contribution.
      const sectionHeight = section?.offsetHeight ?? 0;

      if (sectionHeight > 0) {
        appElement.style.marginTop = `-${sectionHeight}px`;
      } else {
        appElement.style.marginTop = previousMargin;
      }
    } catch (_) {
      // ignore
    }
  });
}

function ensureInlineActionsContainer(rowEl, toggleEl) {
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

function installCallbackSourceButtons(root, actor) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!actor?.items) return;

    const shouldAllowUsedToggle =
      String(root?.dataset?.staShowLogUsedToggle ?? "0") === "1";

    const logRows = root.querySelectorAll(
      'div.section.milestones li.row.entry[data-item-type="log"]',
    );
    const missionUserId = getUserIdForCharacterActor(actor);
    const currentMissionLogId = missionUserId
      ? String(getCurrentMissionLogIdForUser(missionUserId) ?? "")
      : "";
    const currentMissionIndicatorText =
      t("sta-officers-log.logs.currentMissionIndicator") ??
      "Current mission log";

    const makeCurrentMissionText =
      t("sta-officers-log.logs.makeCurrentMissionLog") ??
      "Make Current Mission Log";

    const requestSetCurrentMissionLog = async (logId) => {
      const lId = logId ? String(logId) : "";
      const uId = missionUserId ? String(missionUserId) : "";

      if (!uId) {
        console.error(
          `${MODULE_ID} | cannot set current mission log (no user for actor ${String(
            actor?.id ?? "",
          )})`,
        );
        return;
      }
      if (!lId) {
        console.error(
          `${MODULE_ID} | cannot set current mission log (no logId)`,
        );
        return;
      }

      try {
        if (game.user?.isGM) {
          await setMissionLogForUser(uId, lId);
        } else {
          const socket = getModuleSocket();
          if (!socket || typeof socket.executeAsGM !== "function") {
            console.error(
              `${MODULE_ID} | cannot set current mission log (socket unavailable)`,
            );
            return;
          }

          const ok = await socket.executeAsGM("setCurrentMissionLogForUser", {
            actorId: String(actor?.id ?? ""),
            userId: uId,
            logId: lId,
          });

          if (ok !== true) {
            console.error(
              `${MODULE_ID} | GM rejected setting current mission log for ${uId} -> ${lId}`,
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
     *  In other words: “find logs that point back to this log”.
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
            if (!missionUserId) {
              console.error(
                `${MODULE_ID} | cannot set current mission log (no user for actor)`,
              );
              return;
            }
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

async function enforceUniqueFromLogIdTargets(actor, { editedLogId } = {}) {
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

async function syncCallbackTargetUsedFlags(actor) {
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

function installLogMetaCollapsible(root, logItem) {
  const itemSheet =
    root?.querySelector?.('.item-sheet[data-application-part="itemsheet"]') ||
    root?.querySelector?.(".item-sheet") ||
    null;
  if (!itemSheet) return;

  const logId = logItem?.id ? String(logItem.id) : "";

  // Avoid double-wrapping on partial rerenders.
  if (itemSheet.querySelector(":scope .sta-callbacks-log-meta")) return;

  const nameInput = itemSheet.querySelector('input[name="name"]');
  if (!nameInput) return;
  const nameRow = nameInput.closest(".row") || null;
  if (!nameRow) return;

  // Description in STA uses a prose-mirror element.
  const descEditor =
    itemSheet.querySelector('prose-mirror[name="system.description"]') ||
    itemSheet.querySelector('textarea[name="system.description"]') ||
    itemSheet.querySelector('textarea[name="system.description.value"]') ||
    null;
  if (!descEditor) return;

  const descNote = descEditor.closest(".note") || descEditor.parentElement;
  if (!descNote) return;

  const descTitle =
    (descNote.previousElementSibling?.classList?.contains("title")
      ? descNote.previousElementSibling
      : null) || null;
  if (!descTitle) return;

  // Collect all nodes between Name row and Description title (metadata) and move them into <details>.
  const metaNodes = [];
  for (let node = nameRow.nextSibling; node && node !== descTitle; ) {
    const next = node.nextSibling;
    // Ignore pure-whitespace text nodes.
    if (node.nodeType === Node.TEXT_NODE) {
      if (!String(node.textContent ?? "").trim()) {
        node = next;
        continue;
      }
    }
    metaNodes.push(node);
    node = next;
  }

  // Move Description directly under the Name row.
  try {
    itemSheet.insertBefore(descTitle, nameRow.nextSibling);
    itemSheet.insertBefore(descNote, descTitle.nextSibling);
  } catch (_) {
    // ignore
  }

  const details = document.createElement("details");
  details.className = "sta-callbacks-log-meta";
  // Preserve open/closed state across rerenders.
  if (logId) {
    details.open = _staLogMetaDetailsOpenByLogId.get(logId) === true;
    details.addEventListener("toggle", () => {
      try {
        _staLogMetaDetailsOpenByLogId.set(logId, details.open === true);
      } catch (_) {
        // ignore
      }
    });
  } else {
    details.open = false;
  }

  const summary = document.createElement("summary");
  summary.className = "sta-callbacks-log-meta-summary";
  summary.textContent = "Edit Log Data";
  details.appendChild(summary);

  // Manual callback milestone association (no sorting behavior, just metadata).
  try {
    const actor = logItem?.parent ?? logItem?.actor ?? null;
    if (actor?.items && actor.type === "character") {
      const milestones = Array.from(actor.items ?? [])
        .filter((i) => i?.type === "milestone")
        .sort((a, b) =>
          String(a.name ?? "").localeCompare(String(b.name ?? "")),
        );

      const existingLink = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
      const existingMilestoneId = existingLink?.milestoneId
        ? String(existingLink.milestoneId)
        : "";

      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("label");
      label.textContent = "Callback Milestone";

      const select = document.createElement("select");
      select.dataset.staCallbacksField = "callbackLinkMilestoneId";
      select.title =
        "Associate a Milestone/Arc with this log's callbackLink metadata";

      const none = document.createElement("option");
      none.value = "";
      none.textContent = "— None —";
      select.appendChild(none);

      for (const ms of milestones) {
        const opt = document.createElement("option");
        opt.value = String(ms.id);
        opt.textContent = String(ms.name ?? "").trim() || String(ms.id);
        select.appendChild(opt);
      }

      if (existingMilestoneId) select.value = existingMilestoneId;

      const onChange = async (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();

        const selectedId = String(select.value ?? "");
        try {
          const current = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
          const next = {
            ...(current && typeof current === "object" ? current : {}),
          };

          if (selectedId) next.milestoneId = selectedId;
          else delete next.milestoneId;

          await logItem.update(
            { [`flags.${MODULE_ID}.callbackLink`]: next },
            { renderSheet: false },
          );

          // If the user associates a Milestone/Arc with this log, keep the milestone icon
          // aligned with this log's icon (value icon).
          try {
            if (selectedId) {
              const ms = actor.items.get(String(selectedId)) ?? null;
              if (ms?.type === "milestone") {
                await syncMilestoneImgFromLog(ms, logItem, {
                  setSourceFlag: true,
                });
              }
            }
          } catch (_) {
            // ignore
          }
        } catch (_) {
          // ignore
        }
      };

      select.addEventListener("change", onChange);

      row.appendChild(label);
      row.appendChild(select);
      details.appendChild(row);
    }
  } catch (_) {
    // ignore
  }

  // Checkbox to mark whether this log was created while its primary value was a trauma.
  // This flag persists so logs keep their V# or T# icon prefix even if the value's
  // trauma status later changes.
  // Only show if Trauma rules are enabled.
  if (areTraumaRulesEnabled()) {
    try {
      const createdWithTraumaRow = document.createElement("div");
      createdWithTraumaRow.className = "row sta-log-created-with-trauma-row";

      const traumaLabel = document.createElement("label");
      traumaLabel.textContent = t(
        "sta-officers-log.logSheet.createdWithTraumaLabel",
      );
      traumaLabel.title = t(
        "sta-officers-log.logSheet.createdWithTraumaTooltip",
      );

      const traumaCheckbox = document.createElement("input");
      traumaCheckbox.type = "checkbox";
      traumaCheckbox.dataset.staCallbacksField = "createdWithTrauma";
      traumaCheckbox.title = t(
        "sta-officers-log.logSheet.createdWithTraumaTooltip",
      );
      traumaCheckbox.checked = wasLogCreatedWithTrauma(logItem);

      const onTraumaChange = async (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();

        try {
          await setLogCreatedWithTraumaFlag(logItem, traumaCheckbox.checked);
        } catch (_) {
          // ignore
        }
      };

      traumaCheckbox.addEventListener("change", onTraumaChange);

      createdWithTraumaRow.appendChild(traumaLabel);
      createdWithTraumaRow.appendChild(traumaCheckbox);
      details.appendChild(createdWithTraumaRow);
    } catch (_) {
      // ignore
    }
  }

  try {
    itemSheet.insertBefore(details, descNote.nextSibling);
  } catch (_) {
    // ignore
  }

  for (const node of metaNodes) {
    try {
      details.appendChild(node);
    } catch (_) {
      // ignore
    }
  }
}

function installSupportingBenefitCaps(root) {
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

function installTraitScarCheckbox(root, item) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "trait") return;

    const quantityInput = root.querySelector('input[name="system.quantity"]');
    if (!(quantityInput instanceof HTMLInputElement)) return;
    const quantityRow = quantityInput.closest("div.row");
    if (!(quantityRow instanceof HTMLElement)) return;

    const existingControl = quantityRow.querySelector(
      ".sta-trait-scar-control",
    );
    const tooltipText =
      t("sta-officers-log.traits.scarTooltip") ?? "Mark this trait as a Scar.";
    const labelText = t("sta-officers-log.traits.scarLabel") ?? "Scar";
    const usedTooltipText =
      t("sta-officers-log.traits.usedTooltip") ?? "Mark this Scar as used.";
    const usedLabelText = t("sta-officers-log.traits.usedLabel") ?? "Used";

    let checkbox;
    if (existingControl instanceof HTMLElement) {
      checkbox = existingControl.querySelector(".sta-trait-scar-checkbox");
      if (checkbox instanceof HTMLInputElement) {
        checkbox.checked = isTraitScar(item);
      }
      const usedSwitch = existingControl.querySelector(
        ".sta-trait-used-switch",
      );
      if (usedSwitch instanceof HTMLInputElement) {
        usedSwitch.checked = item.getFlag?.(MODULE_ID, "isScarUsed") ?? false;
      }
      const fatiguedSwitch = existingControl.querySelector(
        ".sta-trait-fatigued-switch",
      );
      if (fatiguedSwitch instanceof HTMLInputElement) {
        fatiguedSwitch.checked = isTraitFatigue(item);
      }
      return;
    }

    const control = document.createElement("div");
    control.className = "sta-trait-scar-control";

    const labelWrapper = document.createElement("label");
    labelWrapper.className = "checkbox sta-trait-scar-field";
    labelWrapper.title = tooltipText;

    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "sta-trait-scar-checkbox";
    checkbox.checked = isTraitScar(item);
    checkbox.title = tooltipText;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = labelText;

    labelWrapper.appendChild(checkbox);
    labelWrapper.appendChild(labelSpan);
    control.appendChild(labelWrapper);

    // Add the "Used" toggle switch
    const usedLabelWrapper = document.createElement("label");
    usedLabelWrapper.className = "checkbox sta-trait-used-field";
    usedLabelWrapper.title = usedTooltipText;

    const usedSwitch = document.createElement("input");
    usedSwitch.type = "checkbox";
    usedSwitch.className = "sta-trait-used-switch";
    usedSwitch.checked = item.getFlag?.(MODULE_ID, "isScarUsed") ?? false;
    usedSwitch.title = usedTooltipText;

    const usedLabelSpan = document.createElement("span");
    usedLabelSpan.textContent = usedLabelText;

    usedLabelWrapper.appendChild(usedSwitch);
    usedLabelWrapper.appendChild(usedLabelSpan);
    control.appendChild(usedLabelWrapper);

    // Add divider before Fatigued checkbox
    const divider = document.createElement("span");
    divider.className = "sta-trait-checkbox-divider";
    divider.textContent = "|";
    control.appendChild(divider);

    // Add the "Fatigued" toggle switch
    const fatiguedTooltipText =
      t("sta-officers-log.traits.fatiguedTooltip") ??
      "Mark this trait as a Fatigued trait (auto-created when stress is maxed).";
    const fatiguedLabelText =
      t("sta-officers-log.traits.fatiguedLabel") ?? "Fatigued";

    const fatiguedLabelWrapper = document.createElement("label");
    fatiguedLabelWrapper.className = "checkbox sta-trait-fatigued-field";
    fatiguedLabelWrapper.title = fatiguedTooltipText;

    const fatiguedSwitch = document.createElement("input");
    fatiguedSwitch.type = "checkbox";
    fatiguedSwitch.className = "sta-trait-fatigued-switch";
    fatiguedSwitch.checked = isTraitFatigue(item);
    fatiguedSwitch.title = fatiguedTooltipText;

    const fatiguedLabelSpan = document.createElement("span");
    fatiguedLabelSpan.textContent = fatiguedLabelText;

    fatiguedLabelWrapper.appendChild(fatiguedSwitch);
    fatiguedLabelWrapper.appendChild(fatiguedLabelSpan);
    control.appendChild(fatiguedLabelWrapper);

    quantityRow.appendChild(control);

    const onChange = async () => {
      checkbox.disabled = true;
      try {
        await setTraitScarFlag(item, checkbox.checked);
      } catch (err) {
        console.error(`${MODULE_ID} | trait scar toggle failed`, err);
        checkbox.checked = isTraitScar(item);
      } finally {
        checkbox.disabled = false;
      }
    };

    const onUsedChange = async () => {
      usedSwitch.disabled = true;
      try {
        await item.setFlag(MODULE_ID, "isScarUsed", usedSwitch.checked);
      } catch (err) {
        console.error(`${MODULE_ID} | trait used toggle failed`, err);
        usedSwitch.checked = item.getFlag?.(MODULE_ID, "isScarUsed") ?? false;
      } finally {
        usedSwitch.disabled = false;
      }
    };

    const onFatiguedChange = async () => {
      fatiguedSwitch.disabled = true;
      try {
        await setTraitFatigueFlag(item, fatiguedSwitch.checked);
      } catch (err) {
        console.error(`${MODULE_ID} | trait fatigued toggle failed`, err);
        fatiguedSwitch.checked = isTraitFatigue(item);
      } finally {
        fatiguedSwitch.disabled = false;
      }
    };

    checkbox.addEventListener("change", onChange);
    usedSwitch.addEventListener("change", onUsedChange);
    fatiguedSwitch.addEventListener("change", onFatiguedChange);
  } catch (_) {
    // ignore
  }
}

function installValueTraumaCheckbox(root, item) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "value") return;

    const nameInput = root.querySelector('input[name="name"]');
    if (!(nameInput instanceof HTMLInputElement)) return;
    const nameRow = nameInput.closest("div.row");
    if (!(nameRow instanceof HTMLElement)) return;

    const existingControl = nameRow.querySelector(".sta-value-trauma-control");
    const tooltipText =
      t("sta-officers-log.values.traumaTooltip") ??
      "Mark this Value as Trauma.";
    const labelText = t("sta-officers-log.values.traumaLabel") ?? "Trauma";

    let checkbox;
    if (existingControl instanceof HTMLElement) {
      checkbox = existingControl.querySelector(".sta-value-trauma-checkbox");
      if (checkbox instanceof HTMLInputElement) {
        checkbox.checked = isValueTrauma(item);
      }
      return;
    }

    const control = document.createElement("div");
    control.className = "sta-value-trauma-control";

    const labelWrapper = document.createElement("label");
    labelWrapper.className = "checkbox sta-value-trauma-field";
    labelWrapper.title = tooltipText;

    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "sta-value-trauma-checkbox";
    checkbox.checked = isValueTrauma(item);
    checkbox.title = tooltipText;

    const labelSpan = document.createElement("span");
    labelSpan.textContent = labelText;

    labelWrapper.appendChild(checkbox);
    labelWrapper.appendChild(labelSpan);
    control.appendChild(labelWrapper);

    nameRow.appendChild(control);

    const onChange = async () => {
      checkbox.disabled = true;
      try {
        await setValueTraumaFlag(item, checkbox.checked);

        // Update the value's icon from V# to T# or vice versa
        try {
          const actor = item.parent;
          if (actor && actor.type === "character") {
            // Get the value's current position in the sorted list
            const values = getValueItems(actor);
            const sorted = values
              .slice()
              .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
            const idx = sorted.findIndex(
              (v) => String(v.id) === String(item.id),
            );

            if (idx >= 0) {
              const n = Math.min(idx + 1, 8); // VALUE_ICON_COUNT = 8
              // After toggling, isValueTrauma will return the new state
              const newIsTrauma = checkbox.checked;
              const newIconPath = newIsTrauma
                ? `modules/${MODULE_ID}/assets/ValueIcons/T${n}.webp`
                : `modules/${MODULE_ID}/assets/ValueIcons/V${n}.webp`;

              if (String(item.img ?? "") !== newIconPath) {
                await item.update({ img: newIconPath });
              }
            }
          }
        } catch (iconErr) {
          console.warn(`${MODULE_ID} | failed to update value icon`, iconErr);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | value trauma toggle failed`, err);
        checkbox.checked = isValueTrauma(item);
      } finally {
        checkbox.disabled = false;
      }
    };

    checkbox.addEventListener("change", onChange);
  } catch (_) {
    // ignore
  }
}

export function installRenderApplicationV2Hook() {
  // Keep character sheets responsive when milestones are edited manually.
  if (!_staCallbacksHelperMilestoneUpdateHookInstalled) {
    _staCallbacksHelperMilestoneUpdateHookInstalled = true;

    Hooks.on("createItem", (item) => {
      try {
        if (!areSheetEnhancementsEnabled()) return;
        if (item?.type !== "milestone") return; //we hook on the creation of all items but then only continue for milestones.
        const actor = item?.parent; // find out who the character actor is who has the milestone.
        if (!actor?.id) return;
        // Avoid full character-sheet rerenders (they flash/steal focus). We only
        // need to refresh the log ordering/arc wrappers.
        refreshMissionLogSortingForActorId(actor.id);
      } catch (_) {
        // ignore
      }
    });

    Hooks.on("updateItem", (item, changes) => {
      try {
        // Keep milestone names in sync when a created item is renamed.
        // This is independent of sheet UX enhancements.
        if (changes?.name !== undefined) {
          const itemType = String(item?.type ?? "");
          const supported =
            itemType === "focus" ||
            itemType === "talent" ||
            itemType === "shipTalent" ||
            itemType === "value";

          if (supported && item?.id) {
            const newItemName = String(item.name ?? "").trim();
            if (newItemName) {
              void (async () => {
                const findLinkedMilestones = (actor) => {
                  try {
                    return actor.items.filter((it) => {
                      if (it?.type !== "milestone") return false;
                      const benefit =
                        it.getFlag?.(MODULE_ID, "milestoneBenefit") ?? null;
                      const createdItemId = benefit?.createdItemId
                        ? String(benefit.createdItemId)
                        : "";
                      return createdItemId && createdItemId === String(item.id);
                    });
                  } catch (_) {
                    return [];
                  }
                };

                // If renamed item is on a character, only that character can have the matching milestone.
                // Ship talents live on the Group Ship actor, so we search all characters.
                const candidateActors = (() => {
                  const parent = item?.parent ?? null;
                  if (parent?.type === "character") return [parent];
                  return (game.actors ?? []).filter(
                    (a) => a?.type === "character",
                  );
                })();

                for (const actor of candidateActors) {
                  const linkedMilestones = findLinkedMilestones(actor);
                  if (!linkedMilestones.length) continue;

                  for (const ms of linkedMilestones) {
                    const benefit =
                      ms.getFlag?.(MODULE_ID, "milestoneBenefit") ?? null;
                    const syncPolicy = String(benefit?.syncPolicy ?? "always");
                    const syncedOnce = Boolean(benefit?.syncedOnce);
                    if (syncPolicy === "once" && syncedOnce) continue;

                    const benefitAction = (() => {
                      const fromFlag = benefit?.action
                        ? String(benefit.action)
                        : "";
                      if (fromFlag) return fromFlag;

                      // Reasonable fallbacks (older milestones without flags)
                      if (itemType === "value") return "arcValue";
                      if (itemType === "shipTalent" || itemType === "talent")
                        return "arcShipTalent";
                      return itemType;
                    })();

                    const desiredName = formatChosenBenefitLabel({
                      applied: true,
                      action: benefitAction,
                      name: newItemName,
                    });

                    if (!desiredName) continue;
                    if (ms?.name !== desiredName) {
                      try {
                        await ms.update({ name: desiredName });
                      } catch (_) {
                        // ignore
                      }
                    }

                    if (syncPolicy === "once" && !syncedOnce) {
                      try {
                        await ms.setFlag(MODULE_ID, "milestoneBenefit", {
                          ...(benefit && typeof benefit === "object"
                            ? benefit
                            : {}),
                          syncedOnce: true,
                        });
                      } catch (_) {
                        // ignore
                      }
                    }
                  }
                }
              })();
            }
          }
        }

        if (!areSheetEnhancementsEnabled()) return;

        // If a Milestone item is being edited in its own sheet, keep that sheet in front.
        // This mirrors the Log-sheet behavior, but only refocuses when the user is
        // actively interacting with the Milestone sheet (so we don't steal focus).
        if (item?.type === "milestone") {
          const sheet = item?.sheet;
          const isOpen = sheet?.rendered === true || sheet?._state > 0;
          if (isOpen) {
            const refocus = () => {
              try {
                const activeEl =
                  typeof document === "undefined"
                    ? null
                    : document.activeElement;

                const el = sheet?.element ?? sheet?._element ?? null;
                const rootEl =
                  el instanceof HTMLElement
                    ? el
                    : Array.isArray(el) && el[0] instanceof HTMLElement
                      ? el[0]
                      : el?.[0] instanceof HTMLElement
                        ? el[0]
                        : typeof el?.get === "function" &&
                            el.get(0) instanceof HTMLElement
                          ? el.get(0)
                          : null;

                if (
                  !(
                    activeEl instanceof HTMLElement &&
                    rootEl instanceof HTMLElement &&
                    rootEl.contains(activeEl)
                  )
                ) {
                  return;
                }

                if (typeof sheet.bringToFront === "function")
                  sheet.bringToFront();
                else if (typeof sheet.bringToTop === "function")
                  sheet.bringToTop();
              } catch (_) {
                // ignore
              }
            };

            setTimeout(refocus, 25);
            setTimeout(refocus, 125);
          }
        }

        // If a Log item is being edited in its own sheet, keep that sheet in front.
        // Some sheet rerenders (including the character sheet) can steal focus.
        if (item?.type === "log") {
          const actor = item?.parent ?? null;
          const sheet = item?.sheet;
          const isOpen = sheet?.rendered === true || sheet?._state > 0;
          if (isOpen) {
            // Defer to allow any actor/character-sheet rerenders to finish first.
            // Do a second attempt a bit later in case another window is raised.
            const refocus = () => {
              try {
                // Only refocus if the user is actively interacting with THIS Log sheet.
                // Otherwise this can steal focus from other item sheets (e.g. Milestones)
                // when log sorting updates occur.
                const activeEl =
                  typeof document === "undefined"
                    ? null
                    : document.activeElement;

                const el = sheet?.element ?? sheet?._element ?? null;
                const rootEl =
                  el instanceof HTMLElement
                    ? el
                    : Array.isArray(el) && el[0] instanceof HTMLElement
                      ? el[0]
                      : el?.[0] instanceof HTMLElement
                        ? el[0]
                        : typeof el?.get === "function" &&
                            el.get(0) instanceof HTMLElement
                          ? el.get(0)
                          : null;

                if (
                  !(
                    activeEl instanceof HTMLElement &&
                    rootEl instanceof HTMLElement &&
                    rootEl.contains(activeEl)
                  )
                ) {
                  return;
                }

                // Foundry v12+: bringToTop was renamed to bringToFront.
                // Calling bringToTop in v13 triggers a deprecation warning, so only
                // use it as a fallback for older versions.
                if (typeof sheet.bringToFront === "function")
                  sheet.bringToFront();
                else if (typeof sheet.bringToTop === "function")
                  sheet.bringToTop();
              } catch (_) {
                // ignore
              }
            };
            setTimeout(refocus, 25);
            setTimeout(refocus, 125);
          }

          // If the Log's chain-related data changed, refresh open character sheets
          // (without stealing focus) AFTER the save/update is complete.
          const hasChainFlagChange = (() => {
            try {
              const base = `flags.${MODULE_ID}.`;
              return (
                foundry.utils.getProperty(changes, `${base}callbackLink`) !==
                  undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLink.fromLogId`,
                ) !== undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLink.valueId`,
                ) !== undefined ||
                foundry.utils.getProperty(changes, `${base}primaryValueId`) !==
                  undefined ||
                foundry.utils.getProperty(changes, `${base}arcInfo`) !==
                  undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLinkDisabled`,
                ) !== undefined
              );
            } catch (_) {
              return false;
            }
          })();

          const hasCallbackTargetDedupChange = (() => {
            try {
              const base = `flags.${MODULE_ID}.`;
              return (
                foundry.utils.getProperty(changes, `${base}callbackLink`) !==
                  undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLink.fromLogId`,
                ) !== undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLinkDisabled`,
                ) !== undefined
              );
            } catch (_) {
              return false;
            }
          })();

          if (actor?.type === "character" && actor?.id && hasChainFlagChange) {
            // Normalization writes (enforcing uniqueness, syncing used flags) must only
            // run on a client that can actually update the actor, otherwise Foundry logs
            // permission errors for non-owners.
            const canWriteActor = (() => {
              try {
                return (
                  game.user?.isGM === true ||
                  actor?.isOwner === true ||
                  (typeof actor?.testUserPermission === "function" &&
                    actor.testUserPermission(game.user, "OWNER"))
                );
              } catch (_) {
                return false;
              }
            })();

            // Normalize flags for consistent chain behavior.
            const logId = item?.id ? String(item.id) : "";
            if (logId && !_staNormalizingLogIds.has(logId)) {
              _staNormalizingLogIds.add(logId);
              void (async () => {
                try {
                  // Enforce: each callback target (fromLogId) can only be used once.
                  // Trigger only when callbackLink-related fields change.
                  if (
                    hasCallbackTargetDedupChange &&
                    !_staNormalizingActorIds.has(String(actor.id))
                  ) {
                    _staNormalizingActorIds.add(String(actor.id));
                    try {
                      if (canWriteActor) {
                        await enforceUniqueFromLogIdTargets(actor, {
                          editedLogId: logId,
                        });

                        // Keep system.used in sync with whether a log is a callback target.
                        await syncCallbackTargetUsedFlags(actor);
                      }
                    } catch (_) {
                      // ignore
                    } finally {
                      // Clear guard on next tick to prevent loops.
                      setTimeout(
                        () => _staNormalizingActorIds.delete(String(actor.id)),
                        0,
                      );
                    }
                  }

                  const primaryValueId = String(
                    item.getFlag?.(MODULE_ID, "primaryValueId") ?? "",
                  );
                  const link =
                    item.getFlag?.(MODULE_ID, "callbackLink") ?? null;
                  const fromLogId = String(link?.fromLogId ?? "");
                  const linkValueId = String(link?.valueId ?? "");

                  const update = {};

                  const callbackLinkTouched = (() => {
                    try {
                      const base = `flags.${MODULE_ID}.`;
                      return (
                        foundry.utils.getProperty(
                          changes,
                          `${base}callbackLink`,
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}callbackLink.fromLogId`,
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}callbackLink.valueId`,
                        ) !== undefined
                      );
                    } catch (_) {
                      return false;
                    }
                  })();

                  const primaryValueTouched = (() => {
                    try {
                      return (
                        foundry.utils.getProperty(
                          changes,
                          `flags.${MODULE_ID}.primaryValueId`,
                        ) !== undefined
                      );
                    } catch (_) {
                      return false;
                    }
                  })();

                  const arcInfoTouched = (() => {
                    try {
                      const base = `flags.${MODULE_ID}.`;
                      return (
                        foundry.utils.getProperty(changes, `${base}arcInfo`) !==
                          undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}arcInfo.isArc`,
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}arcInfo.steps`,
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}arcInfo.valueId`,
                        ) !== undefined
                      );
                    } catch (_) {
                      return false;
                    }
                  })();

                  const arcInfo = item.getFlag?.(MODULE_ID, "arcInfo") ?? null;
                  const isArc = arcInfo?.isArc === true;
                  const shouldNormalizeArc =
                    arcInfoTouched || (callbackLinkTouched && isArc);

                  // Only treat callbackLinkDisabled as an explicit override when the user actually
                  // edited the callbackLink field.
                  if (callbackLinkTouched) {
                    if (!fromLogId) {
                      // User selected "No link". Clear callbackLink and mark as explicitly disabled
                      // so milestone-derived links don't reassert it.
                      update[`flags.${MODULE_ID}.callbackLink`] = null;
                      update[`flags.${MODULE_ID}.callbackLinkDisabled`] = true;
                    } else {
                      // User selected a real callback link.
                      update[`flags.${MODULE_ID}.callbackLinkDisabled`] = null;
                      // Keep callbackLink.valueId aligned with Primary Value.
                      if (primaryValueId && linkValueId !== primaryValueId) {
                        update[`flags.${MODULE_ID}.callbackLink.valueId`] =
                          primaryValueId;
                      }
                    }
                  }

                  // Sync log icon to Primary Value (or default) after save.
                  // Also set createdWithTrauma flag based on whether the value is currently a trauma.
                  if (primaryValueTouched) {
                    try {
                      if (
                        primaryValueId &&
                        !isDirectiveValueId(primaryValueId)
                      ) {
                        const valueItem = actor.items.get(primaryValueId);
                        if (valueItem?.type === "value") {
                          // Record whether this log was created with a trauma as its primary value.
                          // This flag persists so logs keep their V# or T# prefix even if the value's
                          // trauma status later changes.
                          const valueIsTrauma = isValueTrauma(valueItem);
                          update[`flags.${MODULE_ID}.createdWithTrauma`] =
                            valueIsTrauma;

                          // Compute icon using the new trauma status and value's current position
                          const desiredImg = getLogIconPathForValue(
                            actor,
                            primaryValueId,
                            valueIsTrauma,
                          );
                          if (
                            desiredImg &&
                            String(item.img ?? "") !== String(desiredImg)
                          ) {
                            update.img = desiredImg;
                          }
                        } else {
                          // Value not found - use default icon
                          const desiredImg = getStaDefaultIcon();
                          if (
                            desiredImg &&
                            String(item.img ?? "") !== String(desiredImg)
                          ) {
                            update.img = desiredImg;
                          }
                        }
                      } else if (
                        primaryValueId &&
                        isDirectiveValueId(primaryValueId)
                      ) {
                        const desiredImg = directiveIconPath();
                        if (
                          desiredImg &&
                          String(item.img ?? "") !== String(desiredImg)
                        ) {
                          update.img = desiredImg;
                        }
                      } else {
                        // No primary value - use default icon
                        const desiredImg = getStaDefaultIcon();
                        if (
                          desiredImg &&
                          String(item.img ?? "") !== String(desiredImg)
                        ) {
                          update.img = desiredImg;
                        }
                      }
                    } catch (_) {
                      // ignore
                    }
                  }

                  // Normalize arc completion metadata (chainLogIds) after save.
                  if (shouldNormalizeArc) {
                    try {
                      if (!isArc) {
                        // If the sheet wrote an arcInfo object with isArc=false, clear it out.
                        update[`flags.${MODULE_ID}.arcInfo`] = null;
                      } else {
                        const rawSteps = Number(arcInfo?.steps ?? 0);
                        const steps =
                          Number.isFinite(rawSteps) && rawSteps > 0
                            ? Math.floor(rawSteps)
                            : 1;

                        const arcValueId = String(
                          arcInfo?.valueId ??
                            primaryValueId ??
                            linkValueId ??
                            "",
                        );

                        if (!arcValueId) {
                          // Invalid arc state: drop arc completion.
                          update[`flags.${MODULE_ID}.arcInfo`] = null;
                        } else {
                          const computeChainLogIdsByParentWalk = (
                            actorDoc,
                            endLogId,
                            maxSteps,
                            disallowNodeIds,
                          ) => {
                            try {
                              const steps = Number(maxSteps);
                              if (!Number.isFinite(steps) || steps <= 0)
                                return [];
                              const actorItems = actorDoc?.items ?? null;
                              if (!actorItems?.get) return [];

                              const result = [];
                              const seen = new Set();
                              let cur = endLogId ? String(endLogId) : "";

                              while (cur && result.length < steps) {
                                const id = String(cur);
                                if (seen.has(id)) break;
                                seen.add(id);

                                const curItem = actorItems.get(id);
                                if (!curItem || curItem.type !== "log") break;

                                result.push(id);

                                const parentRaw =
                                  curItem.getFlag?.(MODULE_ID, "callbackLink")
                                    ?.fromLogId ?? "";
                                const parentId = parentRaw
                                  ? String(parentRaw)
                                  : "";
                                if (!parentId) break;

                                if (disallowNodeIds?.has?.(parentId)) break;

                                const parentItem = actorItems.get(parentId);
                                if (!parentItem || parentItem.type !== "log")
                                  break;

                                cur = parentId;
                              }

                              return result.reverse();
                            } catch (_) {
                              return [];
                            }
                          };

                          // Disallow reusing nodes already consumed by OTHER arcs.
                          const disallowNodeIds = new Set();
                          try {
                            const actorLogs = Array.from(
                              actor.items ?? [],
                            ).filter((i) => i?.type === "log");
                            for (const other of actorLogs) {
                              if (String(other.id) === String(item.id))
                                continue;
                              const otherArc =
                                other.getFlag?.(MODULE_ID, "arcInfo") ?? null;
                              if (otherArc?.isArc !== true) continue;
                              const otherChain = Array.isArray(
                                otherArc.chainLogIds,
                              )
                                ? otherArc.chainLogIds
                                : [];
                              for (const id of otherChain) {
                                if (id) disallowNodeIds.add(String(id));
                              }
                            }
                          } catch (_) {
                            // ignore
                          }

                          let chainLogIds = [];
                          try {
                            chainLogIds = computeChainLogIdsByParentWalk(
                              actor,
                              String(item.id),
                              steps,
                              disallowNodeIds,
                            );
                          } catch (_) {
                            chainLogIds = [];
                          }

                          const nextArcInfo = {
                            ...(arcInfo && typeof arcInfo === "object"
                              ? arcInfo
                              : {}),
                            isArc: true,
                            steps,
                            valueId: arcValueId,
                            chainLogIds,
                            // Persisted, user-editable arc title. Do NOT derive it from the
                            // Value name so renaming a Value doesn't rename arcs.
                            arcLabel:
                              arcInfo && typeof arcInfo === "object"
                                ? String(arcInfo.arcLabel ?? "")
                                : "",
                          };

                          const normalizeIdArray = (arr) =>
                            (Array.isArray(arr) ? arr : [])
                              .map((x) => String(x))
                              .filter(Boolean);
                          const arraysEqual = (a, b) => {
                            const aa = normalizeIdArray(a);
                            const bb = normalizeIdArray(b);
                            if (aa.length !== bb.length) return false;
                            for (let i = 0; i < aa.length; i += 1) {
                              if (aa[i] !== bb[i]) return false;
                            }
                            return true;
                          };

                          // If we're only normalizing due to callbackLink changes,
                          // avoid churning arcInfo unless the chain actually changed.
                          if (
                            arcInfoTouched ||
                            !arraysEqual(arcInfo?.chainLogIds, chainLogIds)
                          ) {
                            update[`flags.${MODULE_ID}.arcInfo`] = nextArcInfo;
                          }
                        }
                      }
                    } catch (_) {
                      // ignore
                    }
                  }

                  // Only a client with write permission should apply normalization writes.
                  if (canWriteActor && Object.keys(update).length) {
                    await item.update(update, { renderSheet: false });
                  }
                } catch (_) {
                  // ignore
                } finally {
                  // Clear guard on next tick so other legitimate updates still work.
                  setTimeout(() => _staNormalizingLogIds.delete(logId), 0);
                }
              })();
            }

            // Refresh character sheet sorting/indentation without focus stealing.
            setTimeout(() => {
              try {
                refreshMissionLogSortingForActorId(actor.id);
              } catch (_) {
                // ignore
              }
            }, 0);
          }

          return;
        }

        if (item?.type !== "milestone") return;
        const actor = item?.parent;
        if (!actor?.id) return;

        // Only rerender when the milestone's associated logs / arc-ness changes.
        const system = changes?.system ?? {};
        const hasChildChange =
          Object.keys(system).some((k) => /^child[A-Z]$/.test(k)) ||
          system?.arc !== undefined;
        if (!hasChildChange) return;

        // Avoid full character-sheet rerenders (they flash/steal focus). We only
        // need to refresh the log ordering/arc wrappers.
        refreshMissionLogSortingForActorId(actor.id);
      } catch (_) {
        // ignore
      }
    });
  }

  // Compatibility: some environments still emit classic document-sheet hooks for item sheets.
  // Installing this fallback keeps our Log item sheet UI (including the "Edit Log Data" section)
  // working even if renderApplicationV2 isn't fired for that sheet.
  if (!_staCallbacksHelperItemSheetRenderHookInstalled) {
    _staCallbacksHelperItemSheetRenderHookInstalled = true;

    Hooks.on("renderItemSheet", (app, html) => {
      try {
        if (!areSheetEnhancementsEnabled()) return;

        const item =
          app?.object ??
          app?.item ??
          (typeof getItemFromApp === "function" ? getItemFromApp(app) : null);
        if (!item) return;

        const root =
          html instanceof HTMLElement
            ? html
            : Array.isArray(html) && html[0] instanceof HTMLElement
              ? html[0]
              : html?.[0] instanceof HTMLElement
                ? html[0]
                : typeof html?.get === "function" &&
                    html.get(0) instanceof HTMLElement
                  ? html.get(0)
                  : null;
        if (!(root instanceof HTMLElement)) return;

        if (item?.type === "log") {
          try {
            const actor = getActorFromAppOrItem(app, item);
            if (actor?.type === "character") {
              installInlineLogChainLinkControls(root, actor, item);
            }
          } catch (_) {
            // ignore
          }

          installLogMetaCollapsible(root, item);
        }
      } catch (_) {
        // ignore
      }
    });

    // Re-render the parent character sheet when a log or milestone item sheet is closed.
    // This ensures changes made in the item sheet are immediately reflected on the character sheet.
    Hooks.on("closeItemSheet", (app) => {
      try {
        const item =
          app?.object ??
          app?.item ??
          (typeof getItemFromApp === "function" ? getItemFromApp(app) : null);
        if (!item) return;

        const itemType = item?.type;
        if (itemType !== "log" && itemType !== "milestone") return;

        const actor = getActorFromAppOrItem(app, item);
        if (!actor?.id || actor?.type !== "character") return;

        refreshOpenSheet(actor.id);
      } catch (_) {
        // ignore
      }
    });
  }

  Hooks.on("renderApplicationV2", (app, root /* HTMLElement */, _context) => {
    // Ensure our custom context menu never survives a rerender.
    try {
      closeStaOfficersLogContextMenu();
    } catch (_) {
      // ignore
    }

    // Always drive CSS flags on STA character sheets, even if sheet enhancements are disabled.
    try {
      if (app?.id?.startsWith?.("STACharacterSheet2e") && root?.dataset) {
        root.dataset.staShowLogUsedToggle = shouldShowLogUsedToggle()
          ? "1"
          : "0";
      }
    } catch (_) {
      // ignore
    }

    // STA system tracker: add Officers Log buttons next to the roll buttons (GM only).
    installOfficersLogButtonsInStaTracker(app, root);

    // STA system tracker: add Mission Directives section for all users.
    try {
      if (root instanceof HTMLElement) {
        const trackerContainer =
          root.querySelector?.(".tracker-container[data-application-part]") ??
          root.querySelector?.(".tracker-container") ??
          null;
        if (trackerContainer) {
          const row =
            root.querySelector?.("div.tracker-column.abilities .roll-button") ??
            root.querySelector?.(".roll-button") ??
            null;
          installMissionDirectivesInStaTracker(root, row);
        }
      }
    } catch (_) {
      // ignore
    }

    // Check if this is a Dice Pool dialog and add fatigue notice if needed
    try {
      const isDicePoolDialog =
        root?.querySelector?.("#dice-pool-form") ||
        root?.querySelector?.('[id*="dice-pool"]') ||
        app?.window?.title === "Dice Pool";

      if (isDicePoolDialog) {
        // Get the speaker actor from the context or from the last used actor
        let actor = null;

        // Try to get actor from app's options or context
        if (app?.options?.actor) {
          actor = app.options.actor;
        } else if (app?.actor) {
          actor = app.actor;
        } else if (app?.object?.actor) {
          actor = app.object.actor;
        } else if (_context?.actor) {
          actor = _context.actor;
        } else {
          // Try to get the last controlled token's actor
          const controlledTokens = canvas?.tokens?.controlled ?? [];
          if (controlledTokens.length > 0) {
            actor = controlledTokens[0].actor;
          } else if (game?.user?.character) {
            actor = game.user.character;
          }
        }

        if (actor) {
          // Check if character has a trait with isFatigue flag set to true
          const isFatigued = actor.items.some((item) => {
            return item.type === "trait" && isTraitFatigue(item);
          });

          if (isFatigued) {
            // Add fatigue notice to the dialog
            const footer = root?.querySelector?.("footer.form-footer") ?? null;

            if (footer) {
              // Check if we've already added the fatigue notice to avoid duplicates
              if (!footer.querySelector(".sta-dice-pool-fatigue-notice")) {
                const fatigueNotice = document.createElement("div");
                fatigueNotice.className = "sta-dice-pool-fatigue-notice";
                fatigueNotice.innerHTML =
                  '<p style="color: #d91e1e; font-weight: bold; margin-top: 10px;">You are fatigued: +1 Difficulty</p>';
                footer.insertBefore(fatigueNotice, footer.firstChild);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        "sta-officers-log | Failed to check fatigue in Dice Pool dialog",
        err,
      );
    }

    if (!areSheetEnhancementsEnabled()) return;
    // DialogV2: force vertical benefit button layout by wrapping footer buttons.
    // We use an in-content marker because DialogV2 window classes are not always
    // applied in a way that is easy to target with CSS.
    if (root?.querySelector?.('[data-sta-callbacks-dialog="choose-benefit"]')) {
      const footer =
        root.querySelector("footer.form-footer") ??
        root.querySelector(".form-footer") ??
        null;

      if (footer && !footer.querySelector(".sta-callbacks-vertical-footer")) {
        const wrapper = document.createElement("div");
        wrapper.className = "sta-callbacks-vertical-footer";
        while (footer.firstChild) wrapper.appendChild(footer.firstChild);
        footer.appendChild(wrapper);
      }

      // Supporting-character benefit picker: dynamically disable buttons when caps are reached.
      if (root.querySelector?.('[data-sta-callbacks-supporting-benefit="1"]')) {
        installSupportingBenefitCaps(root);
      }

      // Not a sheet render; stop here.
      return;
    }

    // Milestone/Log item sheets: enforce associations and allow manual linking.
    try {
      const item = getItemFromApp(app);
      if (item?.type === "milestone") {
        const actor = getActorFromAppOrItem(app, item);
        if (actor?.type === "character") {
          filterMilestoneAssociatedLogOptions(root, actor, item);
        }
      } else if (item?.type === "log") {
        const actor = getActorFromAppOrItem(app, item);
        if (actor?.type === "character") {
          installInlineLogChainLinkControls(root, actor, item);
        }

        // Log item sheet UX: show Name + Description first, collapse the rest.
        installLogMetaCollapsible(root, item);
      }
    } catch (_) {
      // ignore
    }

    try {
      const item = getItemFromApp(app);
      if (item?.type === "trait") {
        installTraitScarCheckbox(root, item);
      } else if (item?.type === "value") {
        installValueTraumaCheckbox(root, item);
      }
    } catch (_) {
      // ignore
    }

    // Only target your STA character sheet app
    if (
      !app?.id?.startsWith("STACharacterSheet2e") &&
      !app?.id?.startsWith("STASupportingSheet2e")
    )
      return;

    const actor = app.actor;
    if (!actor || actor.type !== "character") return;

    // Mark fatigued attribute checkbox as disabled on the character sheet
    // Only if a fatigued trait actually exists (not just orphaned flags)
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

    // Add a "Visualize Story" button to the Character Logs title (when present)
    const anyLogEntry = root.querySelector(
      'div.section.milestones li.row.entry[data-item-type="log"]',
    );
    const logsSection = anyLogEntry?.closest?.("div.section") ?? null;
    const logsTitleEl = logsSection
      ? logsSection.querySelector(":scope > div.title") ||
        logsSection.querySelector("div.title")
      : null;

    const ensureActions = () => {
      if (!logsTitleEl) return null;
      logsTitleEl.classList.add("sta-values-title-with-button");

      let actions = logsTitleEl.querySelector(":scope > .sta-title-actions");
      if (!actions) {
        actions = document.createElement("span");
        actions.className = "sta-title-actions";

        // If a previous render appended buttons directly, adopt them.
        const existingBtns = Array.from(
          logsTitleEl.querySelectorAll(":scope > a.sta-log-sort-btn"),
        );
        for (const b of existingBtns) actions.appendChild(b);

        logsTitleEl.appendChild(actions);
      }

      return actions;
    };

    const actions = ensureActions();

    const applyMissionLogSortButtonLabel = (btnEl, mode) => {
      if (!btnEl) return;
      const m = String(mode ?? "created");

      // Use innerHTML so we can render a compact icon for A→Z.
      btnEl.innerHTML =
        m === "alpha"
          ? 'Sort: A⮕Z <i class="fa-solid fa-arrow-down-a-z"></i>'
          : m === "chain"
            ? 'Sort: Chain <i class="fa-solid fa-link"></i>'
            : m === "custom"
              ? 'Sort: Custom <i class="fa-solid fa-list"></i>'
              : 'Sort: Date <i class="fa-solid fa-calendar-day"></i>';

      btnEl.title =
        m === "alpha"
          ? "Mission Log sort: Alphabetical Order"
          : m === "chain"
            ? "Mission Log sort: Chain Order"
            : m === "custom"
              ? "Mission Log sort: Custom Order"
              : "Mission Log sort: Creation Order";
    };

    if (actions) {
      const canChange = canCurrentUserChangeActor(actor);
      const existingBtn = actions.querySelector(".sta-log-sort-btn");

      // Hide for non-owners.
      if (!canChange) {
        existingBtn?.remove?.();
      } else if (!existingBtn) {
        const btn = document.createElement("a");
        btn.className = "sta-log-sort-btn";

        const updateLabel = (modeOverride) => {
          const mode = modeOverride ?? getMissionLogSortModeForActor(actor);
          applyMissionLogSortButtonLabel(btn, mode);
        };

        updateLabel();

        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const cur = getMissionLogSortModeForActor(actor);
          const next =
            cur === "created"
              ? "alpha"
              : cur === "alpha"
                ? "chain"
                : cur === "chain"
                  ? "custom"
                  : "created";

          // Persist on the actor (per character). If this fails for some reason,
          // still apply locally so the user sees an immediate effect.
          const res = await setMissionLogSortModeForActor(actor, next);

          if (!res.ok) {
            ui?.notifications?.warn?.(
              "Couldn't save Mission Log sort preference for this character.",
            );
          }

          updateLabel(res.mode);
          applyMissionLogSorting(root, actor, res.mode);

          // Keep multiple open sheets for the same character in sync.
          if (res.ok) refreshOpenSheet(actor.id);
        });

        actions.appendChild(btn);
      } else {
        // Keep label in sync (in case another hook sets state before render)
        applyMissionLogSortButtonLabel(
          existingBtn,
          getMissionLogSortModeForActor(actor),
        );
      }
    }

    applyMissionLogSorting(root, actor, getMissionLogSortModeForActor(actor));

    // Character sheet UX: allow resizing the Character Log list height.
    try {
      installCharacterLogListResizer(root);
    } catch (_) {
      // ignore
    }

    // Logs: add a show-source icon button to flash the incoming-callback source.
    try {
      installCallbackSourceButtons(root, actor);
    } catch (_) {
      // ignore
    }

    // Logs: replace delete with a confirmation-wrapped delete.
    // Deleting logs can break chain/arc references because item IDs are not reusable.
    try {
      installConfirmDeleteControls(root, {
        entrySelector:
          'div.section.milestones li.row.entry[data-item-type="log"]',
        shouldInstall: (entryEl) => entryEl?.dataset?.itemType === "log",
        deleteSelector: 'a.delete[data-action="onItemDelete"], a.delete',
        onDelete: async (entryEl) => {
          const itemId = entryEl?.dataset?.itemId
            ? String(entryEl.dataset.itemId)
            : "";
          if (!itemId) return;
          await actor.deleteEmbeddedDocuments("Item", [itemId]);
        },
        getConfirmCopy: (entryEl) => {
          const name =
            entryEl?.dataset?.itemValue ||
            entryEl?.querySelector?.("input.item-name")?.value ||
            "this log";
          return {
            title: "Delete Log?",
            contentHtml: `
              <p><strong>Deleting a log can break arc chains</strong></p>
              <p>You will need to recreate the chain manually by setting the correct callbacks.</p>
              <hr />
              <p>Delete <strong>${escapeHTML(String(name))}</strong> anyway?</p>
            `.trim(),
          };
        },
      });
    } catch (_) {
      // ignore
    }

    const titleEl = root?.querySelector?.("div.section.values > div.title");

    // Add the "Label Values" button once.
    if (titleEl && !titleEl.querySelector(".sta-label-values-btn")) {
      titleEl.classList.add("sta-values-title-with-button");

      const btn = document.createElement("a");
      btn.className = "sta-label-values-btn";
      btn.title = t("sta-officers-log.tools.labelValuesTooltip");
      btn.innerHTML = `${t(
        "sta-officers-log.tools.labelValues",
      )} <i class="fa-solid fa-tags"></i>`;

      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await labelValuesOnActor(actor);
        app.render(); // refresh sheet to display new icons
      });

      titleEl.appendChild(btn);
    }

    // Add a section-level "Use Directive" button once.
    if (titleEl && !titleEl.querySelector(".sta-use-directive-btn")) {
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

        // Check if this is a supporting character (no logs, no callbacks)
        const isSupportingCharacter = (() => {
          const sheetClass =
            actor?.getFlag?.("core", "sheetClass") ??
            foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
            "";
          return String(sheetClass) === "sta.STASupportingSheet2e";
        })();

        const det = Number(actor.system?.determination?.value ?? 0);

        const missionUserId = !isSupportingCharacter
          ? game.user.isGM
            ? getUserIdForCharacterActor(actor)
            : game.user.id
          : null;
        const currentMissionLogId =
          !isSupportingCharacter && missionUserId
            ? getCurrentMissionLogIdForUser(missionUserId)
            : null;

        const currentLog = currentMissionLogId
          ? actor.items.get(String(currentMissionLogId))
          : null;

        // Prefer per-log snapshot (permanently copied at mission start)
        const snapshot = currentLog
          ? getDirectiveSnapshotForLog(currentLog)
          : [];
        const directives = snapshot.length ? snapshot : getMissionDirectives();

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
            const customGroup = html?.querySelector(
              "[data-sta-directive-custom]",
            );
            const customInput = html?.querySelector(
              'input[name="directiveText"]',
            );
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
                directiveText:
                  button.form?.elements?.directiveText?.value ?? "",
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

        const applyLogUsage = async (logDoc) => {
          if (!logDoc || isSupportingCharacter) return; // Skip for supporting characters

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
            const existing =
              logDoc.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
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

          await applyLogUsage(currentLog);

          // Prompt callback locally, but apply for owning player's mission context.
          // (only for main characters, not supporting characters)
          if (!isSupportingCharacter) {
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

          app.render();
          return;
        }

        const moduleSocket = getModuleSocket();
        if (!moduleSocket) {
          ui.notifications?.error(
            t("sta-officers-log.errors.socketNotAvailable"),
          );
          return;
        }

        if (choice === "positive") {
          await spendDetermination(actor);
          await applyLogUsage(currentLog);

          // Ask the GM to prompt the player for a callback (only for main characters).
          if (!isSupportingCharacter) {
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

          app.render();
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
              currentMissionLogId,
            },
          );

          if (result?.approved) {
            ui.notifications?.info(
              t("sta-officers-log.dialog.useValue.approved"),
            );
          } else {
            ui.notifications?.warn(
              t("sta-officers-log.dialog.useValue.denied"),
            );
          }
        } catch (err) {
          console.error(
            "sta-officers-log | Use Directive approval failed",
            err,
          );
          ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
        }

        app.render();
      });

      titleEl.appendChild(dirBtn);
    }

    // Add a per-Trait "Use Scar" button.
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
            ui.notifications?.warn(
              t("sta-officers-log.dialog.useValue.denied"),
            );
            useBtn.disabled = false;
          }
        } catch (err) {
          console.error("sta-officers-log | Use Scar approval failed", err);
          ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
          useBtn.disabled = false;
        } finally {
          app.render();
        }
      };

      useBtn.addEventListener("click", onUseScar);
      useBtn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") onUseScar(ev);
      });

      // Insert button after item-name and before quantity
      itemNameInput.insertAdjacentElement("afterend", useBtn);
    }

    // Add a per-Trait "Choose Attribute" button for fatigue traits that haven't had an attribute chosen.
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
          app.render();
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

    // Add a per-Value "Use Value" button.
    const valueEntries = root.querySelectorAll(
      'div.section.values li.row.entry[data-item-type="value"]',
    );

    for (const entry of valueEntries) {
      const toggleEl = entry.querySelector(
        'a.value-used.control.toggle, a.value-used.control.toggle > i[data-action="onStrikeThrough"]',
      );
      const toggleAnchor =
        toggleEl instanceof HTMLElement && toggleEl.tagName === "A"
          ? toggleEl
          : toggleEl?.closest?.("a.value-used.control.toggle");
      if (!toggleAnchor) continue;
      if (toggleAnchor.querySelector(".sta-use-value-btn")) continue;

      const itemId = entry?.dataset?.itemId;
      const valueItem = itemId ? actor.items.get(itemId) : null;
      if (!valueItem) continue;

      const challenged = isValueChallenged(valueItem);
      const isTrauma = isValueTrauma(valueItem);

      const useBtn = document.createElement("span");
      useBtn.className = "sta-use-value-btn sta-inline-sheet-btn";
      useBtn.title = isTrauma
        ? t("sta-officers-log.values.useTraumaTooltip")
        : t("sta-officers-log.values.useValueTooltip");
      useBtn.textContent = isTrauma
        ? t("sta-officers-log.values.useTrauma")
        : t("sta-officers-log.values.useValue");
      useBtn.setAttribute("role", "button");
      useBtn.tabIndex = challenged ? -1 : 0;

      if (challenged) {
        useBtn.classList.add("is-disabled");
        useBtn.setAttribute("aria-disabled", "true");
        useBtn.title = `${useBtn.title} (Challenged)`;
      }

      const onUse = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        if (isValueChallenged(valueItem)) return;

        const det = Number(actor.system?.determination?.value ?? 0);
        const valueIsTrauma = isValueTrauma(valueItem);

        const choice = await promptUseValueChoice({
          valueName: valueItem.name ?? "",
          canChoosePositive: det > 0,
          isTrauma: valueIsTrauma,
        });

        if (!choice) return;

        // Check if this is a supporting character (no logs, no callbacks)
        const isSupportingCharacter = (() => {
          const sheetClass =
            actor?.getFlag?.("core", "sheetClass") ??
            foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
            "";
          return String(sheetClass) === "sta.STASupportingSheet2e";
        })();

        const missionUserId = !isSupportingCharacter
          ? game.user.isGM
            ? getUserIdForCharacterActor(actor)
            : game.user.id
          : null;
        const currentMissionLogId =
          !isSupportingCharacter && missionUserId
            ? getCurrentMissionLogIdForUser(missionUserId)
            : null;

        const valueState =
          choice === "positive"
            ? "positive"
            : choice === "challenge"
              ? "challenged"
              : "negative";

        // Helper to adjust stress on an actor
        const adjustStress = async (delta) => {
          const current = Number(actor.system?.stress?.value ?? 0);
          const max = Number(actor.system?.stress?.max ?? current);
          const newValue = Math.max(0, Math.min(max, current + delta));
          await actor.update({ "system.stress.value": newValue });
        };

        // Helper to set stress to max
        const setStressToMax = async () => {
          const max = Number(actor.system?.stress?.max ?? 0);
          await actor.update({ "system.stress.value": max });
        };

        // Helper to record value state on log (only for main characters)
        const recordValueStateOnLog = async () => {
          if (isSupportingCharacter) return; // Skip for supporting characters
          const currentLog = currentMissionLogId
            ? actor.items.get(String(currentMissionLogId))
            : null;
          if (currentLog) {
            const existingRaw =
              currentLog.system?.valueStates?.[String(valueItem.id)];
            await currentLog.update({
              [`system.valueStates.${valueItem.id}`]: mergeValueStateArray(
                existingRaw,
                valueState,
              ),
            });
          }
        };

        // Trauma challenged: special handling - no GM approval, no determination, max stress
        if (valueIsTrauma && choice === "challenge") {
          await setStressToMax();
          await setValueChallenged(valueItem, true);
          await recordValueStateOnLog();

          // Show callback prompt (GM or player) - only for main characters
          if (!isSupportingCharacter) {
            if (game.user.isGM) {
              const owningUserId = getUserIdForCharacterActor(actor);
              if (owningUserId) {
                if (
                  hasEligibleCallbackTargetForValueId(
                    actor,
                    currentMissionLogId,
                    valueItem.id,
                  )
                ) {
                  await promptCallbackForActorAsGM(actor, owningUserId, {
                    reason: "Trauma challenged",
                    defaultValueId: valueItem.id,
                    defaultValueState: valueState,
                  });
                }
              }
            } else {
              try {
                if (
                  hasEligibleCallbackTargetForValueId(
                    actor,
                    currentMissionLogId,
                    valueItem.id,
                  )
                ) {
                  const targetUser = game.user;
                  await sendCallbackPromptToUser(targetUser, {
                    reason: "Trauma challenged",
                    defaultValueId: valueItem.id,
                    defaultValueState: valueState,
                  });
                }
              } catch (err) {
                console.error(
                  "sta-officers-log | Failed to show callback prompt",
                  err,
                );
              }
            }
          }

          app.render();
          return;
        }

        if (game.user.isGM) {
          if (valueState === "positive") {
            await spendDetermination(actor);
            if (valueIsTrauma) {
              await adjustStress(1); // Trauma positive: +1 stress
            }
          } else {
            await gainDetermination(actor);
            if (valueIsTrauma && valueState === "negative") {
              await adjustStress(-2); // Trauma negative: -2 stress
            }
            if (choice === "challenge") {
              await setValueChallenged(valueItem, true);
            }
          }

          await recordValueStateOnLog();

          // GM clicked "Use Value" on a player's sheet: prompt the GM locally for the callback,
          // but apply it for the owning player's mission/chain context.
          // (only for main characters, not supporting characters)
          if (!isSupportingCharacter) {
            const owningUserId = getUserIdForCharacterActor(actor);
            if (owningUserId) {
              if (
                hasEligibleCallbackTargetForValueId(
                  actor,
                  currentMissionLogId,
                  valueItem.id,
                )
              ) {
                await promptCallbackForActorAsGM(actor, owningUserId, {
                  reason: "Value used",
                  defaultValueId: valueItem.id,
                  defaultValueState: valueState,
                });
              }
            }
          }

          app.render();
          return;
        }

        const moduleSocket = getModuleSocket();
        if (!moduleSocket) {
          ui.notifications?.error(
            t("sta-officers-log.errors.socketNotAvailable"),
          );
          return;
        }

        if (choice === "positive") {
          await spendDetermination(actor);
          if (valueIsTrauma) {
            await adjustStress(1); // Trauma positive: +1 stress
          }

          // Players can record the usage immediately.
          await recordValueStateOnLog();

          // Show callback prompt locally to the player (only for main characters).
          if (!isSupportingCharacter) {
            try {
              if (
                hasEligibleCallbackTargetForValueId(
                  actor,
                  currentMissionLogId,
                  valueItem.id,
                )
              ) {
                const targetUser = game.user;
                await sendCallbackPromptToUser(targetUser, {
                  reason: "Value used",
                  defaultValueId: valueItem.id,
                  defaultValueState: "positive",
                });
              }
            } catch (err) {
              console.error(
                "sta-officers-log | Failed to show callback prompt",
                err,
              );
            }
          }

          app.render();
          return;
        }

        // GM approval required for negative and challenge (non-trauma challenge handled above)
        try {
          const result = await moduleSocket.executeAsGM(
            "requestValueUseApproval",
            {
              requestingUserId: game.user.id,
              actorUuid: actor.uuid,
              actorName: actor.name,
              valueItemId: valueItem.id,
              valueName: valueItem.name,
              usage: choice,
              currentMissionLogId,
              isTrauma: valueIsTrauma,
            },
          );

          if (result?.approved) {
            ui.notifications?.info(
              t("sta-officers-log.dialog.useValue.approved"),
            );
          } else {
            ui.notifications?.warn(
              t("sta-officers-log.dialog.useValue.denied"),
            );
          }
        } catch (err) {
          console.error("sta-officers-log | Use Value approval failed", err);
          ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
        }

        app.render();
      };

      if (!challenged) {
        useBtn.addEventListener("click", onUse);
        useBtn.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") onUse(ev);
        });
      }

      toggleAnchor.parentElement.insertBefore(useBtn, toggleAnchor);
    }

    // Add a per-Log "Choose Benefit" button for logs which have a pending milestone.
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
      const arcFromLogForLabel =
        logItem.getFlag?.(MODULE_ID, "arcInfo") ?? null;
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
            const existing =
              logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
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
                t(
                  "sta-officers-log.dialog.chooseMilestoneBenefit.createFailed",
                ),
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
                  syncPolicy:
                    applied?.action === "arcValue" ? "once" : "always",
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
  });
}
