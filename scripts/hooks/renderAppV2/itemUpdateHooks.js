/**
 * Item Update Hooks
 *
 * Registers Foundry hooks for item lifecycle events (create, update, render, close)
 * to keep character sheets responsive and maintain data integrity for logs,
 * milestones, and callback chains.
 */

import { MODULE_ID } from "../../core/constants.js";
import { formatChosenBenefitLabel } from "../../callbackFlow.js";
import {
  isDirectiveValueId,
  directiveIconPath,
} from "../../data/directives.js";
import {
  isValueTrauma,
  getLogIconPathForValue,
  getStaDefaultIcon,
} from "../../data/values.js";
import { areSheetEnhancementsEnabled } from "../../settings/clientSettings.js";
import {
  getActorFromAppOrItem,
  getItemFromApp,
  rerenderOpenStaSheetsForActorId as refreshOpenSheet,
  refreshMissionLogSortingForActorId,
} from "./sheetUtils.js";
import {
  enforceUniqueFromLogIdTargets,
  syncCallbackTargetUsedFlags,
  isLogBeingNormalized,
  isActorBeingNormalized,
  markLogNormalizing,
  markActorNormalizing,
} from "./callbackSourceButtons.js";
import { installInlineLogChainLinkControls } from "./logLinkControls.js";
import { installLogMetaCollapsible } from "./logMetaCollapsible.js";

let _staCallbacksHelperMilestoneUpdateHookInstalled = false;
let _staCallbacksHelperItemSheetRenderHookInstalled = false;

/**
 * Install hooks for keeping character sheets responsive when items are edited.
 * This includes createItem, updateItem, renderItemSheet, and closeItemSheet hooks.
 */
export function installItemUpdateHooks() {
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
            if (logId && !isLogBeingNormalized(logId)) {
              markLogNormalizing(logId, true);
              void (async () => {
                try {
                  // Enforce: each callback target (fromLogId) can only be used once.
                  // Trigger only when callbackLink-related fields change.
                  if (
                    hasCallbackTargetDedupChange &&
                    !isActorBeingNormalized(String(actor.id))
                  ) {
                    markActorNormalizing(String(actor.id), true);
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
                        () => markActorNormalizing(String(actor.id), false),
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
                  setTimeout(() => markLogNormalizing(logId, false), 0);
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
}
