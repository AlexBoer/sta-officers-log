import { MODULE_ID } from "../../constants.js";
import { t } from "../../i18n.js";
import { getModuleSocket } from "../../socket.js";
import { getCurrentMissionLogIdForUser } from "../../mission.js";
import {
  isValueChallenged,
  setValueChallenged,
} from "../../valueChallenged.js";
import {
  labelValuesOnActor,
  STA_DEFAULT_ICON,
  getValueIconPathForValueId,
} from "../../values.js";
import {
  applyArcMilestoneBenefit,
  applyNonArcMilestoneBenefit,
  createMilestoneItem,
  formatChosenBenefitLabel,
  gainDetermination,
  spendDetermination,
  promptCallbackForActorAsGM,
} from "../../callbackFlow.js";

import { ATTRIBUTE_KEYS, DISCIPLINE_KEYS } from "../../callbackFlow/dialogs.js";

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
import { installConfirmDeleteControls } from "./confirmDelete.js";
import {
  applyMissionLogSorting,
  getMissionLogSortModeForActor,
  setMissionLogSortModeForActor,
} from "./logSorting.js";
import {
  areSheetEnhancementsEnabled,
  shouldShowLogUsedToggle,
} from "../../clientSettings.js";

let _staCallbacksHelperMilestoneUpdateHookInstalled = false;
const _staNormalizingLogIds = new Set();
const _staNormalizingActorIds = new Set();
const _staLogMetaDetailsOpenByLogId = new Map(); // logId -> boolean

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
      ":scope > .sta-tracker-button-columns"
    );
    let systemGroup = iconContainer.querySelector?.(
      ":scope > .sta-tracker-button-columns > .sta-tracker-button-group.sta-tracker-system-buttons"
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
      })
    );

    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-reset-button",
        cls: "sta-officers-log-reset",
        title: t("sta-officers-log.tools.resetMission"),
        icon: "fa-solid fa-book",
        onClick: () => game.staCallbacksHelper.promptNewMissionAndReset(),
      })
    );

    officersGroup.appendChild(
      makeButton({
        id: "sta-officers-log-new-scene-button",
        cls: "sta-officers-log-new-scene",
        title: t("sta-officers-log.tools.newScene"),
        icon: "fa-solid fa-clapperboard",
        onClick: () => game.staCallbacksHelper.newScene(),
      })
    );

    columns.appendChild(divider);
    columns.appendChild(officersGroup);
  } catch (_) {
    // ignore
  }
}

function installCallbackSourceButtons(root, actor) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!actor?.items) return;

    const shouldAllowUsedToggle =
      String(root?.dataset?.staShowLogUsedToggle ?? "0") === "1";

    const logRows = root.querySelectorAll(
      'div.section.milestones li.row.entry[data-item-type="log"]'
    );

    const getCreatedKey = (log) => {
      const createdRaw =
        log?._stats?.createdTime ?? log?._source?._stats?.createdTime ?? null;
      const created = Number(createdRaw);
      const createdKey = Number.isFinite(created)
        ? created
        : Number.MAX_SAFE_INTEGER;

      const sortRaw = Number(log?.sort ?? 0);
      const sortKey = Number.isFinite(sortRaw) ? sortRaw : 0;

      const idKey = String(log?.id ?? "");
      return { createdKey, sortKey, idKey };
    };

    const compareKeys = (a, b) => {
      if (a.createdKey !== b.createdKey) return a.createdKey - b.createdKey;
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return String(a.idKey).localeCompare(String(b.idKey));
    };

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

      const toggleAnchor = row.querySelector("a.value-used.control.toggle");
      if (!(toggleAnchor instanceof HTMLElement)) continue;

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
                target?.closest?.(".sta-inline-sheet-btn, .sta-show-source-btn")
              );
              if (isAllowed) return;
              ev.preventDefault();
              ev.stopPropagation();
              ev.stopImmediatePropagation?.();
            } catch (_) {
              // ignore
            }
          },
          true
        );
      }

      if (toggleAnchor.querySelector(":scope > .sta-show-source-btn")) continue;

      const btn = document.createElement("a");
      btn.className = "sta-show-source-btn";
      btn.title = "Show log that called back to this log";
      btn.setAttribute("aria-label", "Show source log");
      btn.innerHTML = '<i class="fa-solid fa-arrow-down-wide-short"></i>';

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
        const sourceLog = findSourceLogForTargetId(targetLogId);
        const sourceId = sourceLog?.id ? String(sourceLog.id) : "";
        if (!sourceId) {
          ui.notifications?.warn?.("No incoming callback found for this log.");
          return;
        }

        const selector =
          'div.section.milestones li.row.entry[data-item-type="log"][data-item-id="' +
          sourceId +
          '"]';
        const sourceRow = root.querySelector(selector);
        if (!(sourceRow instanceof HTMLElement)) {
          ui.notifications?.warn?.("Source log is not visible on this sheet.");
          return;
        }

        try {
          sourceRow.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (_) {
          // ignore
        }

        flashRow(sourceRow);
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

    const getCreatedKey = (log) => {
      const createdRaw =
        log?._stats?.createdTime ?? log?._source?._stats?.createdTime ?? null;
      const created = Number(createdRaw);
      const createdKey = Number.isFinite(created)
        ? created
        : Number.MAX_SAFE_INTEGER;

      const sortRaw = Number(log?.sort ?? 0);
      const sortKey = Number.isFinite(sortRaw) ? sortRaw : 0;

      const idKey = String(log?.id ?? "");
      return { createdKey, sortKey, idKey };
    };

    const compareKeys = (a, b) => {
      if (a.createdKey !== b.createdKey) return a.createdKey - b.createdKey;
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return String(a.idKey).localeCompare(String(b.idKey));
    };

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
            { renderSheet: false }
          );
        } catch (err) {
          console.warn(
            `${MODULE_ID} | failed enforcing unique callback target for ${losingId} -> ${String(
              fromLogId
            )}`,
            err
          );
        }
      }
    }

    // Optional UX: if the currently edited log lost a collision, warn.
    if (editedLogId && loserLogIds.includes(String(editedLogId))) {
      try {
        const collidedFromLogId = String(
          loserToFromLogId.get(String(editedLogId)) ?? ""
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
          `Callback target already used (${targetLabel}); link cleared.`
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
          log.update({ "system.used": true }, { renderSheet: false })
        );
      } else if (!desired && current) {
        updates.push(
          log.update({ "system.used": false }, { renderSheet: false })
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
          String(a.name ?? "").localeCompare(String(b.name ?? ""))
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
            { renderSheet: false }
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
      `button[data-action="${action}"], footer button[data-action="${action}"]`
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
    const a = actorId ? game.actors?.get?.(actorId) ?? null : null;
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
      (i) => i?.type === "focus"
    ).length;
    const talentCount = (a.items ?? []).filter(
      (i) => i?.type === "talent" || i?.type === "shipTalent"
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
                    (a) => a?.type === "character"
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
                  `${base}callbackLink.fromLogId`
                ) !== undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLink.valueId`
                ) !== undefined ||
                foundry.utils.getProperty(changes, `${base}primaryValueId`) !==
                  undefined ||
                foundry.utils.getProperty(changes, `${base}arcInfo`) !==
                  undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLinkDisabled`
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
                  `${base}callbackLink.fromLogId`
                ) !== undefined ||
                foundry.utils.getProperty(
                  changes,
                  `${base}callbackLinkDisabled`
                ) !== undefined
              );
            } catch (_) {
              return false;
            }
          })();

          if (actor?.type === "character" && actor?.id && hasChainFlagChange) {
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
                      await enforceUniqueFromLogIdTargets(actor, {
                        editedLogId: logId,
                      });

                      // Keep system.used in sync with whether a log is a callback target.
                      await syncCallbackTargetUsedFlags(actor);
                    } catch (_) {
                      // ignore
                    } finally {
                      // Clear guard on next tick to prevent loops.
                      setTimeout(
                        () => _staNormalizingActorIds.delete(String(actor.id)),
                        0
                      );
                    }
                  }

                  const primaryValueId = String(
                    item.getFlag?.(MODULE_ID, "primaryValueId") ?? ""
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
                          `${base}callbackLink`
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}callbackLink.fromLogId`
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}callbackLink.valueId`
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
                          `flags.${MODULE_ID}.primaryValueId`
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
                          `${base}arcInfo.isArc`
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}arcInfo.steps`
                        ) !== undefined ||
                        foundry.utils.getProperty(
                          changes,
                          `${base}arcInfo.valueId`
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
                  if (primaryValueTouched) {
                    try {
                      const valueItem = primaryValueId
                        ? actor.items.get(primaryValueId)
                        : null;
                      const desiredImg =
                        valueItem?.type === "value" && valueItem?.img
                          ? String(valueItem.img)
                          : STA_DEFAULT_ICON;
                      if (
                        desiredImg &&
                        String(item.img ?? "") !== String(desiredImg)
                      ) {
                        update.img = desiredImg;
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
                            ""
                        );

                        if (!arcValueId) {
                          // Invalid arc state: drop arc completion.
                          update[`flags.${MODULE_ID}.arcInfo`] = null;
                        } else {
                          const computeChainLogIdsByParentWalk = (
                            actorDoc,
                            endLogId,
                            maxSteps,
                            disallowNodeIds
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
                              actor.items ?? []
                            ).filter((i) => i?.type === "log");
                            for (const other of actorLogs) {
                              if (String(other.id) === String(item.id))
                                continue;
                              const otherArc =
                                other.getFlag?.(MODULE_ID, "arcInfo") ?? null;
                              if (otherArc?.isArc !== true) continue;
                              const otherChain = Array.isArray(
                                otherArc.chainLogIds
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
                              disallowNodeIds
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

                  if (Object.keys(update).length) {
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

  Hooks.on("renderApplicationV2", (app, root /* HTMLElement */, _context) => {
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

    // STA system tracker: add Officers Log buttons next to the roll buttons.
    installOfficersLogButtonsInStaTracker(app, root);

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

    // Only target your STA character sheet app
    if (!app?.id?.startsWith("STACharacterSheet2e")) return;

    const actor = app.actor;
    if (!actor || actor.type !== "character") return;

    // Add a "Visualize Story" button to the Character Logs title (when present)
    const anyLogEntry = root.querySelector(
      'div.section.milestones li.row.entry[data-item-type="log"]'
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
          logsTitleEl.querySelectorAll(":scope > a.sta-log-sort-btn")
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
              "Couldn't save Mission Log sort preference for this character."
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
          getMissionLogSortModeForActor(actor)
        );
      }
    }

    applyMissionLogSorting(root, actor, getMissionLogSortModeForActor(actor));

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
              <p>Delete <strong>${String(name)}</strong> anyway?</p>
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
        "sta-officers-log.tools.labelValues"
      )} <i class="fa-solid fa-tags"></i>`;

      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await labelValuesOnActor(actor);
        app.render(); // refresh sheet to display new icons
      });

      titleEl.appendChild(btn);
    }

    // Add a per-Value "Use Value" button.
    const valueEntries = root.querySelectorAll(
      'div.section.values li.row.entry[data-item-type="value"]'
    );

    for (const entry of valueEntries) {
      const toggleEl = entry.querySelector(
        'a.value-used.control.toggle, a.value-used.control.toggle > i[data-action="onStrikeThrough"]'
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

      const useBtn = document.createElement("span");
      useBtn.className = "sta-use-value-btn sta-inline-sheet-btn";
      useBtn.title = t("sta-officers-log.values.useValueTooltip");
      useBtn.textContent = t("sta-officers-log.values.useValue");
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

        const choice = await promptUseValueChoice({
          valueName: valueItem.name ?? "",
          canChoosePositive: det > 0,
        });

        if (!choice) return;

        const missionUserId = game.user.isGM
          ? getUserIdForCharacterActor(actor)
          : game.user.id;
        const currentMissionLogId = missionUserId
          ? getCurrentMissionLogIdForUser(missionUserId)
          : null;

        const valueState =
          choice === "positive"
            ? "positive"
            : choice === "challenge"
            ? "challenged"
            : "negative";

        if (game.user.isGM) {
          if (valueState === "positive") {
            await spendDetermination(actor);
          } else {
            await gainDetermination(actor);
            if (choice === "challenge") {
              await setValueChallenged(valueItem, true);
            }
          }

          const currentLog = currentMissionLogId
            ? actor.items.get(String(currentMissionLogId))
            : null;
          if (currentLog) {
            await currentLog.update({
              [`system.valueStates.${valueItem.id}`]: valueState,
            });
          }

          // GM clicked "Use Value" on a player's sheet: prompt the GM locally for the callback,
          // but apply it for the owning player's mission/chain context.
          const owningUserId = getUserIdForCharacterActor(actor);
          if (owningUserId) {
            await promptCallbackForActorAsGM(actor, owningUserId, {
              reason: "Value used",
              defaultValueId: valueItem.id,
              defaultValueState: valueState,
            });
          }

          app.render();
          return;
        }

        const moduleSocket = getModuleSocket();
        if (!moduleSocket) {
          ui.notifications?.error(
            t("sta-officers-log.errors.socketNotAvailable")
          );
          return;
        }

        if (choice === "positive") {
          await spendDetermination(actor);

          // Players can record the usage immediately.
          const currentLog = currentMissionLogId
            ? actor.items.get(String(currentMissionLogId))
            : null;
          if (currentLog) {
            await currentLog.update({
              [`system.valueStates.${valueItem.id}`]: "positive",
            });
          }

          // Ask the GM to prompt the player for a callback.
          try {
            await moduleSocket.executeAsGM("promptCallbackForUser", {
              targetUserId: game.user.id,
              reason: "Value used",
              defaultValueId: valueItem.id,
              defaultValueState: "positive",
            });
          } catch (err) {
            console.error(
              "sta-officers-log | Failed to request callback prompt",
              err
            );
          }

          app.render();
          return;
        }

        // GM approval required for negative and challenge
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
            }
          );

          if (result?.approved) {
            ui.notifications?.info(
              t("sta-officers-log.dialog.useValue.approved")
            );
          } else {
            ui.notifications?.warn(
              t("sta-officers-log.dialog.useValue.denied")
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

      toggleAnchor.prepend(useBtn);
    }

    // Add a per-Log "Choose Benefit" button for logs which have a pending milestone.
    const pendingMilestoneLogs = root.querySelectorAll(
      'div.section.milestones li.row.entry[data-item-type="log"]'
    );

    for (const entry of pendingMilestoneLogs) {
      if (entry.querySelector(".sta-choose-milestone-btn")) continue;

      const itemId = entry?.dataset?.itemId;
      const logItem = itemId ? actor.items.get(itemId) : null;
      if (!logItem) continue;

      const pendingMilestone = logItem.getFlag?.(
        MODULE_ID,
        "pendingMilestoneBenefit"
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
      if (toggleEl.querySelector(".sta-choose-milestone-btn")) continue;

      const chooseBtn = document.createElement("span");
      chooseBtn.className = "sta-choose-milestone-btn sta-inline-sheet-btn";
      chooseBtn.title = t(
        isArcBenefit
          ? "sta-officers-log.milestones.chooseArcTooltip"
          : "sta-officers-log.milestones.chooseMilestoneTooltip"
      );
      chooseBtn.textContent = t(
        isArcBenefit
          ? "sta-officers-log.milestones.chooseArc"
          : "sta-officers-log.milestones.chooseMilestone"
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
              { renderSheet: false }
            );
          }
        } catch (_) {
          // ignore
        }

        const arcFromLog = logItem.getFlag?.(MODULE_ID, "arcInfo") ?? null;
        const arc = pending?.arc ?? arcFromLog ?? null;

        const initialTab = isArcBenefit ? "arc" : "milestone";

        openNewMilestoneArcDialog(actor, {
          initialTab,
          lockOtherTab: true,
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
                t("sta-officers-log.dialog.chooseMilestoneBenefit.missingData")
              );
              return;
            }

            // The pending data may refer to a log that was deleted/edited.
            // If possible, fall back to the callbackLink on the CURRENT log.
            let resolvedChosenLogId = chosenLogId ? String(chosenLogId) : "";
            let chosenLog = resolvedChosenLogId
              ? actor.items.get(resolvedChosenLogId) ?? null
              : null;

            if (!chosenLog) {
              const link = logItem.getFlag?.(MODULE_ID, "callbackLink") ?? null;
              const fallbackId = link?.fromLogId ? String(link.fromLogId) : "";
              const fallbackLog = fallbackId
                ? actor.items.get(fallbackId) ?? null
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
                "This callback references a Log that no longer exists. Please choose a different Log and try again."
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
                t("sta-officers-log.dialog.chooseMilestoneBenefit.createFailed")
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

            app.render();
            openCreatedItemSheetAfterMilestone(actor, createdItemId);
          },
        });
      };

      chooseBtn.addEventListener("click", onChoose);
      chooseBtn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") onChoose(ev);
      });

      toggleEl.prepend(chooseBtn);
    }
  });
}
