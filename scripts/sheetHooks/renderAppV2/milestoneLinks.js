import { MODULE_ID } from "../../constants.js";
import {
  getMilestoneChildLogIds,
  getPrimaryValueIdForLog,
} from "../../logMetadata.js";
import { canCurrentUserChangeActor } from "./sheetUtils.js";
import {
  getMilestoneIconSourceLogId,
  syncMilestoneImgFromLogId,
} from "../../milestoneIcons.js";

export { getMilestoneChildLogIds };

export function filterMilestoneAssociatedLogOptions(root, actor, milestone) {
  const selects = Array.from(
    root?.querySelectorAll?.('select[name^="system.child"]') ?? []
  );
  if (!selects.length) return;

  const isArc = !!milestone?.system?.arc?.isArc;

  const otherMilestones = Array.from(actor?.items ?? [])
    .filter((i) => i?.type === "milestone")
    .filter((ms) => String(ms.id) !== String(milestone?.id ?? ""));

  const usedChildAByNonArc = new Set(
    otherMilestones
      .filter((ms) => !ms.system?.arc?.isArc)
      .map((ms) => String(ms.system?.childA ?? ""))
      .filter(Boolean)
  );

  const usedChildBByNonArc = new Set(
    otherMilestones
      .filter((ms) => !ms.system?.arc?.isArc)
      .map((ms) => String(ms.system?.childB ?? ""))
      .filter(Boolean)
  );

  const usedByOtherArcs = new Set();
  for (const ms of otherMilestones.filter((ms) => !!ms.system?.arc?.isArc)) {
    for (const id of getMilestoneChildLogIds(ms)) usedByOtherArcs.add(id);
  }

  const currentlySelectedInThisMilestone = new Set(
    getMilestoneChildLogIds(milestone)
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
      // ignore
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
        const valueItems = Array.from(actor?.items ?? []).filter(
          (i) => i?.type === "value"
        );
        const primary = getPrimaryValueIdForLog(actor, childA, valueItems);
        if (primary && String(primary) !== valueId) {
          await milestone.setFlag?.(
            MODULE_ID,
            "callbackValueId",
            String(primary)
          );
          valueId = String(primary);
        }
      }
    } catch (_) {
      // ignore
    }

    const setLink = async ({ logId, fromLogId }) => {
      const log = logId ? actor.items.get(String(logId)) : null;
      if (!log || log.type !== "log" || !log.setFlag) return;

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
    // ignore
  }
}
