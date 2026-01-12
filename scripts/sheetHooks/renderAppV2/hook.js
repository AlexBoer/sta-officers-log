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
} from "./sheetUtils.js";
import {
  filterMilestoneAssociatedLogOptions,
  syncCallbackLinksFromMilestone,
} from "./milestoneLinks.js";
import { installInlineLogChainLinkControls } from "./logLinkControls.js";
import { installConfirmDeleteControls } from "./confirmDelete.js";
import {
  applyMissionLogSorting,
  getMissionLogSortModeForActor,
  setMissionLogSortModeForActor,
} from "./logSorting.js";
import { areSheetEnhancementsEnabled } from "../../clientSettings.js";

let _staCallbacksHelperMilestoneUpdateHookInstalled = false;

function installLogMetaCollapsible(root) {
  const itemSheet =
    root?.querySelector?.('.item-sheet[data-application-part="itemsheet"]') ||
    root?.querySelector?.(".item-sheet") ||
    null;
  if (!itemSheet) return;

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
  details.open = false;

  const summary = document.createElement("summary");
  summary.className = "sta-callbacks-log-meta-summary";
  summary.textContent = "Edit Log Data";
  details.appendChild(summary);

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
        void syncCallbackLinksFromMilestone(actor, item);
        refreshOpenSheet(actor.id);
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

        // If a Log item is being edited in its own sheet, keep that sheet in front.
        // Some sheet rerenders (including the character sheet) can steal focus.
        if (item?.type === "log") {
          const sheet = item?.sheet;
          const isOpen = sheet?.rendered === true || sheet?._state > 0;
          if (isOpen) {
            // Defer to allow any actor/character-sheet rerenders to finish first.
            setTimeout(() => {
              try {
                // Foundry v12+: bringToTop was renamed to bringToFront.
                sheet.bringToFront?.();
              } catch (_) {
                // ignore
              }
            }, 25);
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

        void syncCallbackLinksFromMilestone(actor, item);

        refreshOpenSheet(actor.id);
      } catch (_) {
        // ignore
      }
    });
  }

  Hooks.on("renderApplicationV2", (app, root /* HTMLElement */, _context) => {
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
        installLogMetaCollapsible(root);
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
              <p><strong>Deleting a log can break chain/arc links on this sheet.</strong></p>
              <p>Logs are referenced by their internal ID. If you delete this log, that ID is gone permanently.</p>
              <p>Dragging a log back later typically creates a <em>new</em> Item with a <em>new</em> ID, so existing chains/arcs may remain broken.</p>
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
          console.error(
            "sta-officers-log | Use Value approval failed",
            err
          );
          ui.notifications?.error(
            t("sta-officers-log.dialog.useValue.error")
          );
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
                t(
                  "sta-officers-log.dialog.chooseMilestoneBenefit.missingData"
                )
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
                valueImg,
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
                  "sta-officers-log.dialog.chooseMilestoneBenefit.createFailed"
                )
              );
              return;
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
