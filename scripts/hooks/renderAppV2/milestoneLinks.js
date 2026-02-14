import { MODULE_ID } from "../../core/constants.js";
import {
  getMilestoneChildLogIds,
  getPrimaryValueIdForLog,
} from "../../data/logMetadata.js";
import { canCurrentUserChangeActor } from "./sheetUtils.js";
import {
  getMilestoneIconSourceLogId,
  syncMilestoneImgFromLogId,
} from "../../data/milestoneIcons.js";

export { getMilestoneChildLogIds };

/**
 * Hides the associated log dropdowns on milestone sheets and replaces them
 * with simple "From: <log name>" text display. The underlying dropdowns
 * remain in the DOM (just hidden) so the sheet still works if the module
 * is disabled or uninstalled.
 *
 * Also reorganizes the layout:
 * - Moves "From:" display right under the name row
 * - Makes "Milestone is an Arc" and "Steps" fields adjacent
 * - Hides the "Associated logs" header
 *
 * @param {HTMLElement} root - The root element of the milestone sheet
 * @param {Actor} actor - The actor that owns the milestone
 * @param {Item} milestone - The milestone item
 */
export function hideAssociatedLogDropdowns(root, actor, milestone) {
  const selects = Array.from(
    root?.querySelectorAll?.('select[name^="system.child"]') ?? [],
  );
  if (!selects.length) return;

  // Already processed
  if (root.querySelector(".sta-milestone-from-log-display")) return;

  const itemSheet =
    root?.querySelector?.('.item-sheet[data-application-part="itemsheet"]') ||
    root?.querySelector?.(".item-sheet") ||
    null;

  const isArc = !!milestone?.system?.arc?.isArc;

  // For arcs, we show all associated logs; for non-arcs, just childA and childB
  const childIds = isArc
    ? getMilestoneChildLogIds(milestone)
    : [
        String(milestone?.system?.childA ?? ""),
        String(milestone?.system?.childB ?? ""),
      ].filter(Boolean);

  // Get log names
  const logNames = childIds
    .map((id) => {
      const log = id ? actor.items.get(id) : null;
      return log?.type === "log" ? String(log.name ?? "") : null;
    })
    .filter(Boolean);

  // Hide the "Associated logs" header (dropdowns will be moved under "From:" text)
  if (itemSheet) {
    const titles = itemSheet.querySelectorAll(".title");
    for (const title of titles) {
      if (
        String(title.textContent ?? "")
          .trim()
          .toLowerCase() === "associated logs"
      ) {
        title.style.display = "none";
        break;
      }
    }
  }

  // Make "Milestone is an Arc" and "Steps in this Arc" adjacent
  if (itemSheet) {
    const arcCheckboxRow = itemSheet.querySelector(
      '.row:has(input[name="system.arc.isArc"])',
    );
    const stepsRow = itemSheet.querySelector(
      '.row:has(input[name="system.arc.steps"])',
    );

    if (arcCheckboxRow && stepsRow) {
      // Create a combined row
      const combinedRow = document.createElement("div");
      combinedRow.className = "row sta-milestone-arc-row";

      // Move the actual content nodes into the combined row (not clones)
      // This preserves form data binding and event listeners
      const arcContent = arcCheckboxRow.querySelector(".grid-numbers");
      const stepsContent = stepsRow.querySelector(".grid-numbers");

      if (arcContent && stepsContent) {
        combinedRow.appendChild(arcContent);
        combinedRow.appendChild(stepsContent);

        // Insert combined row and hide the now-empty original rows
        arcCheckboxRow.before(combinedRow);
        arcCheckboxRow.style.display = "none";
        stepsRow.style.display = "none";
      }
    }

    // Ensure steps is always a valid integer when isArc changes.
    // This prevents validation errors when unchecking the "is arc" checkbox.
    const stepsInput = itemSheet.querySelector(
      'input[name="system.arc.steps"]',
    );
    const isArcCheckbox = itemSheet.querySelector(
      'input[name="system.arc.isArc"]',
    );
    if (stepsInput && isArcCheckbox) {
      const ensureValidSteps = () => {
        const val = parseInt(stepsInput.value, 10);
        if (!Number.isInteger(val) || val < 0) {
          stepsInput.value = "0";
        }
      };
      // Check on isArc change
      isArcCheckbox.addEventListener("change", ensureValidSteps);
      // Also validate on steps input change/blur
      stepsInput.addEventListener("change", ensureValidSteps);
      stepsInput.addEventListener("blur", ensureValidSteps);
    }
  }

  // Create display text with expandable dropdowns
  if (logNames.length > 0 && itemSheet) {
    const displayContainer = document.createElement("div");
    displayContainer.className = "sta-milestone-from-log-display";

    // Create a details-like structure
    const summaryRow = document.createElement("div");
    summaryRow.className = "sta-milestone-from-summary";
    summaryRow.setAttribute("role", "button");
    summaryRow.tabIndex = 0;
    summaryRow.style.cursor = "pointer";

    const expandIcon = document.createElement("i");
    expandIcon.className =
      "fa-solid fa-chevron-right sta-milestone-expand-icon";
    expandIcon.style.marginRight = "4px";
    expandIcon.style.transition = "transform 0.2s";

    const label = document.createElement("span");
    label.className = "sta-milestone-from-label";
    label.textContent = "From: ";

    const logNamesSpan = document.createElement("span");
    logNamesSpan.className = "sta-milestone-from-logs";
    logNamesSpan.textContent = logNames.join(" ← ");

    summaryRow.appendChild(expandIcon);
    summaryRow.appendChild(label);
    summaryRow.appendChild(logNamesSpan);

    // Create a container for the dropdowns
    const dropdownsContainer = document.createElement("div");
    dropdownsContainer.className = "sta-milestone-dropdowns-container";
    dropdownsContainer.style.display = "none";
    dropdownsContainer.style.paddingLeft = "1em";
    dropdownsContainer.style.marginTop = "0.25em";

    // Move the select dropdowns into the container
    for (const select of selects) {
      // Find the parent row that contains this select
      const parentRow = select.closest(".row");
      if (parentRow) {
        parentRow.style.display = ""; // Reset display
        dropdownsContainer.appendChild(parentRow);
      } else {
        select.style.display = ""; // Reset display
        dropdownsContainer.appendChild(select);
      }
    }

    displayContainer.appendChild(summaryRow);
    displayContainer.appendChild(dropdownsContainer);

    // Toggle handler
    const toggleDropdowns = (ev) => {
      ev?.preventDefault?.();
      const isExpanded = dropdownsContainer.style.display !== "none";
      dropdownsContainer.style.display = isExpanded ? "none" : "block";
      expandIcon.style.transform = isExpanded ? "" : "rotate(90deg)";
    };

    summaryRow.addEventListener("click", toggleDropdowns);
    summaryRow.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") toggleDropdowns(ev);
    });

    // Insert right after the name row (first .row with input[name="name"])
    const nameRow = itemSheet.querySelector('.row:has(input[name="name"])');
    if (nameRow) {
      nameRow.after(displayContainer);
    } else {
      // Fallback: prepend to item sheet
      itemSheet.prepend(displayContainer);
    }
  }
}

export function filterMilestoneAssociatedLogOptions(root, actor, milestone) {
  const selects = Array.from(
    root?.querySelectorAll?.('select[name^="system.child"]') ?? [],
  );
  if (!selects.length) return;

  const isArc = !!milestone?.system?.arc?.isArc;

  const otherMilestones = actor.items
    .filter((i) => i?.type === "milestone")
    .filter((ms) => String(ms.id) !== String(milestone?.id ?? ""));

  const usedChildAByNonArc = new Set(
    otherMilestones
      .filter((ms) => !ms.system?.arc?.isArc)
      .map((ms) => String(ms.system?.childA ?? ""))
      .filter(Boolean),
  );

  const usedChildBByNonArc = new Set(
    otherMilestones
      .filter((ms) => !ms.system?.arc?.isArc)
      .map((ms) => String(ms.system?.childB ?? ""))
      .filter(Boolean),
  );

  const usedByOtherArcs = new Set();
  for (const ms of otherMilestones.filter((ms) => !!ms.system?.arc?.isArc)) {
    for (const id of getMilestoneChildLogIds(ms)) usedByOtherArcs.add(id);
  }

  const currentlySelectedInThisMilestone = new Set(
    getMilestoneChildLogIds(milestone),
  );

  for (const select of selects) {
    const name = String(select.getAttribute("name") ?? "");
    if (!isArc && name !== "system.childA" && name !== "system.childB")
      continue;

    const currentVal = String(select.value ?? "");

    // Iterate options backwards so removal is safe.
    for (let i = select.options.length - 1; i >= 0; i -= 1) {
      const opt = select.options[i];
      const v = String(opt?.value ?? "");
      if (!v) continue;

      if (!isArc) {
        // Non-arc: childA and childB are each unique across non-arc milestones.
        // (Cross-usage is allowed: the same log may be childA in one milestone and childB in another.)
        if (name === "system.childA") {
          if (usedChildAByNonArc.has(v) && v !== currentVal) opt.remove();
        } else if (name === "system.childB") {
          if (usedChildBByNonArc.has(v) && v !== currentVal) opt.remove();
        }
      } else {
        // Arc: can select logs not already part of another arc.
        if (
          usedByOtherArcs.has(v) &&
          !currentlySelectedInThisMilestone.has(v)
        ) {
          opt.remove();
        }
      }
    }
  }
}

// This funciton takes a milestone and checks the logs in its Associated Logs (childA, childB, etc).
// It then ensures that those logs have their callbackLink flags set appropriately to link to the log they call back to.
// Eg. For a milestone with childA=log1 and childB=log2, log2 will get a callbackLink flag that means "Log 2 calls back to Log 1".
// The value is the flag looks like { fromLogId: log1.id, valueId: <milestone callbackValueId> }.
// valueId is also set so that the log knows which value it is associated with.
//
// NOTE: `milestone` here is a Foundry Item document (embedded on a Character Actor) with:
// - milestone.type === "milestone"
// - milestone.system.childA..childZ = log IDs
// - milestone.system.arc = { isArc: true, steps: number } when arc
// - milestone.system.description = string filled in by the user.
// - milestone flags: milestone.getFlag(MODULE_ID, "callbackValueId")
export async function syncCallbackLinksFromMilestone(actor, milestone) {
  try {
    if (!actor || actor.type !== "character") return;
    if (!milestone || milestone.type !== "milestone") return;
    if (!canCurrentUserChangeActor(actor)) return;

    // Keep the milestone icon aligned with its chosen source log (when set),
    // otherwise fall back to the first associated log.
    try {
      const sourceLogId = getMilestoneIconSourceLogId(milestone);
      if (sourceLogId) {
        await syncMilestoneImgFromLogId(actor, milestone, sourceLogId);
      }
    } catch (_) {
      // icon sync is cosmetic
    }

    const isArc = !!milestone.system?.arc?.isArc;

    // Auto-sync the milestone's callbackValueId from childA's primary value.
    // This keeps milestone-derived callback links value-consistent with existing chains.
    let valueId = String(milestone.getFlag(MODULE_ID, "callbackValueId") ?? "");
    try {
      const childAId = isArc
        ? String(getMilestoneChildLogIds(milestone)?.[0] ?? "")
        : String(milestone.system?.childA ?? "");
      const childA = childAId ? actor.items.get(childAId) : null;
      if (childA?.type === "log") {
        const valueItems = actor.items.filter((i) => i?.type === "value");
        const primary = getPrimaryValueIdForLog(actor, childA, valueItems);
        if (primary && String(primary) !== valueId) {
          await milestone.setFlag?.(
            MODULE_ID,
            "callbackValueId",
            String(primary),
          );
          valueId = String(primary);
        }
      }
    } catch (_) {
      // value sync is best-effort
    }

    const setLink = async ({ logId, fromLogId }) => {
      const log = logId ? actor.items.get(String(logId)) : null;
      if (!log || log.type !== "log" || !log.setFlag) return;

      // Respect user's explicit "no link" override - don't re-assert callback links
      const isDisabled =
        log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true;
      if (isDisabled) return;

      const existing = log.getFlag?.(MODULE_ID, "callbackLink") ?? {};
      const exFrom = String(existing?.fromLogId ?? "");
      const exVal = String(existing?.valueId ?? "");
      const nextFrom = String(fromLogId ?? "");
      // IMPORTANT: if the milestone doesn't have a callbackValueId set,
      // do NOT overwrite an existing per-log link valueId.
      // Empty valueId breaks value-specific chain edges used by arc grouping.
      const milestoneVal = String(valueId ?? "");
      const nextVal = milestoneVal || exVal;

      if (exFrom === nextFrom && exVal === nextVal) return;
      await log.setFlag(MODULE_ID, "callbackLink", {
        fromLogId: nextFrom,
        valueId: nextVal,
      });
    };

    if (isArc) {
      const childIds = getMilestoneChildLogIds(milestone);
      for (let i = 1; i < childIds.length; i += 1) {
        await setLink({ logId: childIds[i], fromLogId: childIds[i - 1] });
      }
    } else {
      const fromLogId = String(milestone.system?.childA ?? "");
      const logId = String(milestone.system?.childB ?? "");
      if (!fromLogId || !logId) return;
      await setLink({ logId, fromLogId });
    }
  } catch (_) {
    // link sync failed, likely permissions
  }
}
