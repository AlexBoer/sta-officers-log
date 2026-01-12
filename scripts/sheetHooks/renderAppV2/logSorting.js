import { MODULE_ID } from "../../constants.js";
import {
  getCompletedArcEndLogIds,
  getMilestoneChildLogIds,
  getPrimaryValueIdForLog,
} from "../../logMetadata.js";
import {
  computeBestChainEndingAt,
  getCallbackLogEdgesForValue,
} from "../../arcChains.js";
import { openNewMilestoneArcDialog } from "./newMilestoneArcDialog.js";

export { getCompletedArcEndLogIds, getPrimaryValueIdForLog };

// UI-only: per-session collapsed state for completed Arc groups.
// Keyed by actorId so multiple character sheets don't interfere.
const _collapsedArcsByActorId = new Map(); // actorId -> Set<arcId>

function _isArcCollapsed(actorId, arcId) {
  const aId = actorId ? String(actorId) : "";
  const gId = arcId ? String(arcId) : "";
  if (!aId || !gId) return false;
  const set = _collapsedArcsByActorId.get(aId);
  return set ? set.has(gId) : false;
}

function _setArcCollapsed(actorId, arcId, collapsed) {
  const aId = actorId ? String(actorId) : "";
  const gId = arcId ? String(arcId) : "";
  if (!aId || !gId) return;
  let set = _collapsedArcsByActorId.get(aId);
  if (!set) {
    set = new Set();
    _collapsedArcsByActorId.set(aId, set);
  }
  if (collapsed) set.add(gId);
  else set.delete(gId);
}

function _unwrapArcGroups(sectionEl) {
  const section = sectionEl;
  if (!section?.querySelectorAll) return;
  const wrappers = Array.from(
    section.querySelectorAll(":scope > .sta-callbacks-arc-group")
  );
  for (const wrapper of wrappers) {
    try {
      while (wrapper.firstChild) {
        const child = wrapper.firstChild;
        // Arc title rows are UI-only; discard them when unwrapping.
        if (child?.classList?.contains?.("sta-callbacks-arc-title")) {
          child.remove();
          continue;
        }
        section.insertBefore(child, wrapper);
      }
      wrapper.remove();
    } catch (_) {
      // ignore
    }
  }
}

export function getLogSortKey(item) {
  const n = Number(item?.sort);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function normalizeMissionLogSortMode(mode) {
  // Backward-compatibility: previous versions stored "creation".
  const s = mode ? String(mode) : "created";
  const normalized = s === "creation" ? "created" : s;
  return ["created", "alpha", "chain", "custom"].includes(normalized)
    ? normalized
    : "created";
}

export function getMissionLogSortModeForActor(actor) {
  return normalizeMissionLogSortMode(
    actor?.getFlag?.(MODULE_ID, "missionLogSortMode")
  );
}

export async function setMissionLogSortModeForActor(actor, mode) {
  const normalized = normalizeMissionLogSortMode(mode);
  if (!actor?.setFlag) return { ok: false, mode: normalized };

  try {
    await actor.setFlag(MODULE_ID, "missionLogSortMode", normalized);
    return { ok: true, mode: normalized };
  } catch (err) {
    console.warn(
      `${MODULE_ID} | failed to persist missionLogSortMode on actor`,
      err
    );
    return { ok: false, mode: normalized };
  }
}

function _getLogChainComponents(actor, logItems) {
  const byId = new Map(logItems.map((l) => [String(l.id), l]));
  const adj = new Map();

  // When an Arc is completed, we want the next mission to start a new chain
  // even if it calls back to the last log in that Arc.
  const completedArcEndLogIds = getCompletedArcEndLogIds(actor, byId);

  let milestones = [];
  try {
    milestones = Array.from(actor?.items ?? []).filter(
      (i) => i?.type === "milestone"
    );
  } catch (_) {
    milestones = [];
  }

  const valueItems = Array.from(actor?.items ?? []).filter(
    (i) => i?.type === "value"
  );

  // Explicit per-log override set by the "Link Log to Chain" dialog.
  // If true, we will not treat this log as a "callback to" anything in chain sorting,
  // even if milestones imply otherwise.
  const callbackLinkDisabledToLogIds = new Set();
  for (const log of logItems) {
    const disabled = log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true;
    if (disabled) callbackLinkDisabledToLogIds.add(String(log.id));
  }

  const ensure = (id) => {
    const key = String(id);
    if (!adj.has(key)) adj.set(key, new Set());
    return adj.get(key);
  };

  // Undirected edges between logs that are linked via callbackLink.
  for (const log of logItems) {
    const link = log.getFlag?.(MODULE_ID, "callbackLink");
    const fromId = link?.fromLogId ? String(link.fromLogId) : "";
    const valueId = link?.valueId ? String(link.valueId) : "";
    if (!fromId) continue;
    const a = String(log.id);
    const b = fromId;
    if (!byId.has(b)) continue;

    // Respect explicit manual unlink overrides.
    if (callbackLinkDisabledToLogIds.has(a)) continue;

    // Break chains across completed Arc boundaries.
    if (completedArcEndLogIds.has(b)) continue;

    // Break chains when the callback link's value doesn't match the chain primary.
    if (valueId) {
      const aPrimary = getPrimaryValueIdForLog(actor, log, valueItems);
      const bLog = byId.get(String(b));
      const bPrimary = bLog
        ? getPrimaryValueIdForLog(actor, bLog, valueItems)
        : "";
      if (aPrimary && aPrimary !== valueId) continue;
      if (bPrimary && bPrimary !== valueId) continue;
    }

    ensure(a).add(b);
    ensure(b).add(a);
  }

  // Also treat Milestone associations as chain links so manual edits update sorting.
  for (const ms of milestones) {
    try {
      const isArc = !!ms.system?.arc?.isArc;
      const childIds = getMilestoneChildLogIds(ms).filter((id) => byId.has(id));
      if (!childIds.length) continue;

      const msValueId = String(ms.getFlag(MODULE_ID, "callbackValueId") ?? "");

      if (isArc) {
        for (let i = 1; i < childIds.length; i += 1) {
          const a = childIds[i - 1];
          const b = childIds[i];

          // Respect explicit manual unlink overrides (to-side).
          if (callbackLinkDisabledToLogIds.has(b)) continue;

          // Break chains when the milestone value doesn't match the chain primary.
          if (msValueId) {
            const aLog = byId.get(String(a));
            const bLog = byId.get(String(b));
            const aPrimary = aLog
              ? getPrimaryValueIdForLog(actor, aLog, valueItems)
              : "";
            const bPrimary = bLog
              ? getPrimaryValueIdForLog(actor, bLog, valueItems)
              : "";
            if (aPrimary && aPrimary !== msValueId) continue;
            if (bPrimary && bPrimary !== msValueId) continue;
          }

          ensure(a).add(b);
          ensure(b).add(a);
        }
      } else {
        const a = String(ms.system?.childA ?? "");
        const b = String(ms.system?.childB ?? "");
        if (!a || !b) continue;
        if (!byId.has(a) || !byId.has(b)) continue;

        // Respect explicit manual unlink overrides (to-side).
        if (callbackLinkDisabledToLogIds.has(b)) continue;

        // Break non-arc links across completed Arc boundaries.
        if (completedArcEndLogIds.has(a) || completedArcEndLogIds.has(b))
          continue;

        // Break chains when the milestone value doesn't match the chain primary.
        if (msValueId) {
          const aLog = byId.get(String(a));
          const bLog = byId.get(String(b));
          const aPrimary = aLog
            ? getPrimaryValueIdForLog(actor, aLog, valueItems)
            : "";
          const bPrimary = bLog
            ? getPrimaryValueIdForLog(actor, bLog, valueItems)
            : "";
          if (aPrimary && aPrimary !== msValueId) continue;
          if (bPrimary && bPrimary !== msValueId) continue;
        }

        ensure(a).add(b);
        ensure(b).add(a);
      }
    } catch (_) {
      // ignore
    }
  }

  const visited = new Set();
  const components = [];

  for (const log of logItems) {
    const start = String(log.id);
    if (visited.has(start)) continue;

    const queue = [start];
    visited.add(start);
    const ids = [];

    while (queue.length) {
      const id = queue.pop();
      ids.push(id);
      for (const nb of adj.get(id) ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        queue.push(nb);
      }
    }

    const items = ids.map((id) => byId.get(id)).filter(Boolean);
    components.push(items);
  }

  return components;
}

function _getValidCallbackParentMap(actor, logItems) {
  const byId = new Map(logItems.map((l) => [String(l.id), l]));

  // When an Arc is completed, we want the next mission to start a new chain
  // even if it calls back to the last log in that Arc.
  const completedArcEndLogIds = getCompletedArcEndLogIds(actor, byId);

  const valueItems = Array.from(actor?.items ?? []).filter(
    (i) => i?.type === "value"
  );

  // Explicit per-log override set by the "Link Log to Chain" dialog.
  const callbackLinkDisabledToLogIds = new Set();
  for (const log of logItems) {
    const disabled = log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true;
    if (disabled) callbackLinkDisabledToLogIds.add(String(log.id));
  }

  /** @type {Map<string, string>} */
  const parentByChildId = new Map();

  for (const log of logItems) {
    const link = log.getFlag?.(MODULE_ID, "callbackLink");
    const fromId = link?.fromLogId ? String(link.fromLogId) : "";
    const valueId = link?.valueId ? String(link.valueId) : "";
    if (!fromId) continue;

    const childId = String(log.id);
    const parentId = fromId;
    if (!byId.has(parentId)) continue;

    // Respect explicit manual unlink overrides.
    if (callbackLinkDisabledToLogIds.has(childId)) continue;

    // Break chains across completed Arc boundaries.
    if (completedArcEndLogIds.has(parentId)) continue;

    // Break chains when the callback link's value doesn't match the chain primary.
    if (valueId) {
      const childPrimary = getPrimaryValueIdForLog(actor, log, valueItems);
      const parentLog = byId.get(String(parentId));
      const parentPrimary = parentLog
        ? getPrimaryValueIdForLog(actor, parentLog, valueItems)
        : "";
      if (childPrimary && childPrimary !== valueId) continue;
      if (parentPrimary && parentPrimary !== valueId) continue;
    }

    parentByChildId.set(childId, parentId);
  }

  return parentByChildId;
}

function _getChainIndentChildLogIds(actor, logItems) {
  return new Set(_getValidCallbackParentMap(actor, logItems).keys());
}

export function applyMissionLogSorting(root, actor, mode) {
  const sortMode = normalizeMissionLogSortMode(mode);

  // Custom mode: do not reorder anything; rely on the sheet's default order
  // (which is typically based on Item.sort / manual dragging).
  if (sortMode === "custom") return;

  const section = root?.querySelector?.("div.section.milestones");
  if (!section) return;

  // If we wrapped logs previously, unwrap them before any reordering.
  _unwrapArcGroups(section);

  const logEntryEls = Array.from(
    section.querySelectorAll('li.row.entry[data-item-type="log"]')
  );
  if (!logEntryEls.length) return;

  const logItems = logEntryEls
    .map((el) => {
      const id = el?.dataset?.itemId ? String(el.dataset.itemId) : "";
      const item = id ? actor.items.get(id) : null;
      return item && item.type === "log" ? item : null;
    })
    .filter(Boolean);

  const byId = new Map(logItems.map((l) => [String(l.id), l]));
  const byElId = new Map(
    logEntryEls
      .map((el) => [String(el?.dataset?.itemId ?? ""), el])
      .filter(([id]) => id)
  );

  const clearIndent = () => {
    for (const el of logEntryEls)
      el.classList.remove("sta-callbacks-chain-child");
  };

  const clearArcDecorations = () => {
    for (const el of logEntryEls) {
      try {
        delete el.dataset.staCallbacksArcId;
      } catch (_) {
        // ignore
      }
      // Reset any display overrides from collapsed state.
      if (el.style?.display) el.style.display = "";
    }
  };

  const sortCreation = (a, b) => {
    const d = getLogSortKey(a) - getLogSortKey(b);
    if (d) return d;
    const an = String(a.name ?? "");
    const bn = String(b.name ?? "");
    const nd = an.localeCompare(bn, undefined, { sensitivity: "base" });
    if (nd) return nd;
    return String(a.id).localeCompare(String(b.id));
  };

  let orderedIds = [];
  /** @type {null | Array<{arcId:string, arcLabel:string, ids:string[]}>} */
  let arcWrapGroups = null;

  const getCreatedTimeKey = (item) => {
    // Prefer the live document stats, but fall back to _source for safety.
    // (Some document instances may not expose _stats directly.)
    const direct = item?._stats?.createdTime;
    const source = item?._source?._stats?.createdTime;
    const t = Number(direct ?? source);
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };

  const sortCreatedTime = (a, b) => {
    // Oldest-first by createdTime.
    const d = getCreatedTimeKey(a) - getCreatedTimeKey(b);
    if (d) return d;

    // IMPORTANT: do NOT fall back to Item.sort here.
    // Item.sort reflects manual drag order, which is exactly what "custom" is for.
    const an = String(a.name ?? "");
    const bn = String(b.name ?? "");
    const nd = an.localeCompare(bn, undefined, { sensitivity: "base" });
    if (nd) return nd;
    return String(a.id).localeCompare(String(b.id));
  };

  if (sortMode === "created") {
    clearIndent();
    clearArcDecorations();
    const items = Array.from(logItems).sort(sortCreatedTime);
    orderedIds = items.map((i) => String(i.id));
  } else if (sortMode === "alpha") {
    clearIndent();
    clearArcDecorations();
    const items = Array.from(logItems);
    items.sort((a, b) => {
      const an = String(a.name ?? "");
      const bn = String(b.name ?? "");
      const nd = an.localeCompare(bn, undefined, { sensitivity: "base" });
      if (nd) return nd;
      return sortCreation(a, b);
    });
    orderedIds = items.map((i) => String(i.id));
  } else if (sortMode === "chain") {
    clearArcDecorations();
    const valueItems = Array.from(actor?.items ?? []).filter(
      (i) => i?.type === "value"
    );

    // ----- 1) Build completed-Arc blocks first (Arc Order) -----
    /** @type {Array<{arcId:string, ids:string[], maxTime:number, valueNameLabel:string}>} */
    const arcBlocks = [];
    const usedArcIds = new Set();

    const arcEndLogs = logItems.filter((log) => {
      const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      return arcInfo?.isArc === true;
    });

    for (const log of arcEndLogs) {
      const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      if (!arcInfo?.isArc) continue;

      const arcValueId = arcInfo?.valueId
        ? String(arcInfo.valueId)
        : getPrimaryValueIdForLog(actor, log, valueItems);

      let steps = Number(arcInfo?.steps ?? 0);
      if (!Number.isFinite(steps) || steps <= 0) {
        const fromChain = Array.isArray(arcInfo?.chainLogIds)
          ? arcInfo.chainLogIds.length
          : 0;
        steps = fromChain > 0 ? fromChain : 1;
      }

      /** @type {string[]} */
      let chainIds = [];

      try {
        if (arcValueId) {
          // Disallow reusing nodes already consumed by OTHER arcs.
          const disallowNodeIds = new Set();
          for (const other of logItems) {
            if (String(other.id) === String(log.id)) continue;
            const otherArcInfo = other.getFlag?.(MODULE_ID, "arcInfo") ?? null;
            if (otherArcInfo?.isArc !== true) continue;
            const otherChain = Array.isArray(otherArcInfo.chainLogIds)
              ? otherArcInfo.chainLogIds
              : [];
            for (const id of otherChain) {
              if (id) disallowNodeIds.add(String(id));
            }
          }

          const { incoming } = getCallbackLogEdgesForValue(actor, arcValueId);
          const computed = computeBestChainEndingAt({
            incoming,
            endLogId: String(log.id),
            disallowNodeIds,
          });

          const full = Array.isArray(computed?.chainLogIds)
            ? computed.chainLogIds.map((x) => String(x)).filter(Boolean)
            : [];
          chainIds = full.length > steps ? full.slice(-steps) : full;
        }
      } catch (_) {
        chainIds = [];
      }

      // Fallback to the stored chain list (older arcs / no usable callback links).
      if (!chainIds.length) {
        chainIds = Array.isArray(arcInfo.chainLogIds)
          ? arcInfo.chainLogIds.map((x) => String(x)).filter(Boolean)
          : [];
      }

      // If logs were deleted, some IDs won't exist anymore. Keep the arc visible anyway.
      const presentChain = chainIds
        .map((id) => String(id))
        .filter((id) => byId.has(String(id)));

      if (!presentChain.length) continue;

      // Prevent overlapping arc blocks.
      if (presentChain.some((id) => usedArcIds.has(String(id)))) continue;
      for (const id of presentChain) usedArcIds.add(String(id));

      let maxTime = 0;
      for (const id of presentChain) {
        const item = byId.get(String(id));
        const t = getCreatedTimeKey(item);
        if (t > maxTime) maxTime = t;
      }

      const valueIdForLabel = arcInfo?.valueId
        ? String(arcInfo.valueId)
        : arcValueId
        ? String(arcValueId)
        : "";

      const valueNameLabel = valueIdForLabel
        ? String(actor.items.get(valueIdForLabel)?.name ?? "")
        : "";

      arcBlocks.push({
        arcId: String(log.id),
        ids: presentChain,
        maxTime,
        valueNameLabel,
      });
    }

    // Arc Order:
    // 1) Shorter arcs first (fewer logs in the arc chain)
    // 2) Tie-breaker: earlier completion first (latest log createdTime)
    arcBlocks.sort((a, b) => {
      const ld = (a.ids?.length ?? 0) - (b.ids?.length ?? 0);
      if (ld) return ld;
      return (
        (a.maxTime ?? Number.MAX_SAFE_INTEGER) -
        (b.maxTime ?? Number.MAX_SAFE_INTEGER)
      );
    });
    arcWrapGroups = arcBlocks.map((b, idx) => ({
      arcId: b.arcId,
      arcLabel: `Arc ${idx + 1}${
        b.valueNameLabel ? ` (${b.valueNameLabel})` : ""
      }`,
      ids: b.ids,
    }));

    // ----- 2) Remaining logs (Chain Order > Date Order) -----
    const remainingIds = new Set(logItems.map((l) => String(l.id)));
    for (const g of arcWrapGroups)
      for (const id of g.ids) remainingIds.delete(String(id));

    const remainingItems = logItems.filter((l) =>
      remainingIds.has(String(l.id))
    );
    const remainingById = new Map(remainingItems.map((l) => [String(l.id), l]));

    const parentByChildId = _getValidCallbackParentMap(actor, remainingItems);

    const orderComponent = (items) => {
      const itemById = new Map(items.map((i) => [String(i.id), i]));
      const childrenByParentId = new Map();
      const roots = [];

      for (const item of items) {
        const id = String(item.id);
        const parentId = parentByChildId.get(id);
        if (parentId && itemById.has(String(parentId))) {
          const key = String(parentId);
          if (!childrenByParentId.has(key)) childrenByParentId.set(key, []);
          childrenByParentId.get(key).push(id);
        } else {
          roots.push(id);
        }
      }

      const byTime = (ida, idb) =>
        getCreatedTimeKey(itemById.get(ida)) -
        getCreatedTimeKey(itemById.get(idb));

      roots.sort(byTime);
      for (const [pid, childIds] of childrenByParentId.entries()) {
        childIds.sort(byTime);
        childrenByParentId.set(pid, childIds);
      }

      const visited = new Set();
      const ordered = [];

      const visit = (id) => {
        if (visited.has(id)) return;
        visited.add(id);
        const it = itemById.get(id);
        if (it) ordered.push(it);
        const kids = childrenByParentId.get(String(id)) ?? [];
        for (const kid of kids) visit(kid);
      };

      for (const r of roots) visit(r);

      // Safety: append any remaining nodes deterministically.
      if (ordered.length !== items.length) {
        const remaining = items
          .map((i) => String(i.id))
          .filter((id) => !visited.has(id))
          .sort(byTime);
        for (const id of remaining) visit(id);
      }

      return ordered;
    };

    const components = _getLogChainComponents(actor, remainingItems);
    const normalized = components
      .map((items) => {
        const sorted = orderComponent(items);
        let minTime = Number.MAX_SAFE_INTEGER;
        for (const it of sorted) {
          const t = getCreatedTimeKey(it);
          if (t < minTime) minTime = t;
        }
        return { sorted, minKey: minTime };
      })
      .sort((a, b) => a.minKey - b.minKey);

    orderedIds = [
      ...arcWrapGroups.flatMap((g) => g.ids.map((id) => String(id))),
      ...normalized.flatMap((c) => c.sorted.map((i) => String(i.id))),
    ].filter((id) => byId.has(String(id)));

    // Indent only logs that are a valid callback child within the current chain rules.
    clearIndent();
    const indentChildIds = _getChainIndentChildLogIds(actor, logItems);
    for (const id of indentChildIds) {
      const el = byElId.get(String(id));
      if (el) el.classList.add("sta-callbacks-chain-child");
    }

    // Arc boxing/collapse is applied after we reorder the DOM.
  } else {
    // Fallback: treat as created.
    clearIndent();
    clearArcDecorations();
    const items = Array.from(logItems).sort(sortCreatedTime);
    orderedIds = items.map((i) => String(i.id));
  }

  // Find the start of the Milestones section so we don't insert logs under it.
  const milestoneCreate = section.querySelector(
    'a.control.create[data-type="milestone"]'
  );
  const milestoneHeader =
    milestoneCreate?.closest?.("div.header.row.item") ?? null;
  const milestoneTitle =
    milestoneHeader?.previousElementSibling?.classList?.contains("title")
      ? milestoneHeader.previousElementSibling
      : null;

  // Players without sufficient permissions may not have the milestone "create" control.
  // Fall back to the first milestone entry/header if needed.
  const firstMilestoneEntry = section.querySelector(
    'li.row.entry[data-item-type="milestone"]'
  );
  const insertBeforeEl =
    milestoneTitle ?? milestoneHeader ?? firstMilestoneEntry;

  if (insertBeforeEl) {
    for (const id of orderedIds) {
      const el = byElId.get(id);
      if (!el) continue;
      section.insertBefore(el, insertBeforeEl);
    }
  } else {
    // If there is no milestone area at all, just reorder by appending logs.
    for (const id of orderedIds) {
      const el = byElId.get(id);
      if (!el) continue;
      section.appendChild(el);
    }
  }

  // ----- Completed Arc visualization (wrapper + collapse) -----
  if (sortMode === "chain") {
    try {
      const actorId = String(actor?.id ?? "");
      const usedIds = new Set();

      /** @type {Array<{arcId:string, startId:string, ids:string[]}>} */
      const arcGroups = [];

      // Prefer using the chain-mode precomputed arc blocks so ordering is stable
      // and aligns with "Arc Order > Chain Order > Date Order".
      if (Array.isArray(arcWrapGroups) && arcWrapGroups.length) {
        for (const g of arcWrapGroups) {
          const ids = Array.isArray(g.ids)
            ? g.ids.map((x) => String(x)).filter(Boolean)
            : [];
          const present = ids.filter((id) => orderedIds.includes(String(id)));
          if (!present.length) continue;
          const startId = String(present[0]);
          arcGroups.push({
            arcId: String(g.arcId),
            startId,
            ids: present,
            arcLabel: String(g.arcLabel ?? ""),
          });
        }
      }

      const applyCollapsedState = (wrapperEl, arcId) => {
        const collapsed = _isArcCollapsed(actorId, arcId);
        wrapperEl.classList.toggle("is-collapsed", collapsed);

        const icons = Array.from(
          wrapperEl.querySelectorAll(
            '.sta-arc-collapse-btn i[class*="fa-chevron"]'
          )
        );
        for (const icon of icons) {
          icon.classList.toggle("fa-chevron-right", collapsed);
          icon.classList.toggle("fa-chevron-down", !collapsed);
        }
      };

      for (let arcIndex = 0; arcIndex < arcGroups.length; arcIndex += 1) {
        const { arcId, startId, ids } = arcGroups[arcIndex];
        const arcLabelFull = String(
          arcGroups[arcIndex]?.arcLabel ?? `Arc ${arcIndex + 1}`
        );

        const startEl = byElId.get(String(startId));
        if (!startEl) continue;

        // Create wrapper and move arc log elements inside.
        const wrapper = document.createElement("div");
        wrapper.className = "sta-callbacks-arc-group";
        wrapper.dataset.staArcId = arcId;
        wrapper.dataset.staArcLabel = arcLabelFull;
        section.insertBefore(wrapper, startEl);

        // Add a title row for the collapsed state (when all logs are hidden).
        const titleRow = document.createElement("div");
        titleRow.className = "sta-callbacks-arc-title";
        titleRow.dataset.staArcId = arcId;
        titleRow.dataset.staArcLabel = arcLabelFull;
        wrapper.appendChild(titleRow);

        for (const id of ids) {
          const el = byElId.get(String(id));
          if (!el) continue;
          el.dataset.staCallbacksArcId = arcId;
          wrapper.appendChild(el);
        }

        // Move/add the collapse control to the "Callback?" (toggle) column, like the original.
        // This column is an <a>, so we must NOT inject another <a> inside it.
        // Instead we use a <span role="button">.
        try {
          const existing =
            startEl.querySelectorAll?.(".sta-arc-collapse-btn") ?? [];
          for (const node of Array.from(existing)) node.remove();
        } catch (_) {
          // ignore
        }

        const toggleHost =
          startEl?.querySelector?.(":scope > a.value-used.control.toggle") ??
          startEl?.querySelector?.(":scope > .value-used.control.toggle") ??
          startEl?.querySelector?.(":scope > .value-used") ??
          null;

        if (toggleHost) {
          const btn = document.createElement("span");
          btn.className = "sta-arc-collapse-btn";
          btn.title = `${arcLabelFull} (collapse/expand)`;
          btn.setAttribute("aria-label", btn.title);
          btn.setAttribute("role", "button");
          btn.tabIndex = 0;
          btn.innerHTML = `<i class="fa-solid fa-chevron-down"></i><span class="sta-arc-collapse-label">${arcLabelFull}</span>`;

          const onToggle = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const next = !_isArcCollapsed(actorId, arcId);
            _setArcCollapsed(actorId, arcId, next);
            applyCollapsedState(wrapper, arcId);
          };

          btn.addEventListener("click", onToggle);
          btn.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") onToggle(ev);
          });

          toggleHost.prepend(btn);

          // Mirror control in the arc title row (visible only when collapsed).
          const titleBtn = document.createElement("span");
          titleBtn.className = "sta-arc-collapse-btn";
          titleBtn.title = btn.title;
          titleBtn.setAttribute("aria-label", btn.title);
          titleBtn.setAttribute("role", "button");
          titleBtn.tabIndex = 0;
          titleBtn.innerHTML = btn.innerHTML;

          titleBtn.addEventListener("click", onToggle);
          titleBtn.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") onToggle(ev);
          });

          // Make the entire title row clickable as well.
          titleRow.addEventListener("click", onToggle);
          titleRow.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") onToggle(ev);
          });
          titleRow.setAttribute("role", "button");
          titleRow.tabIndex = 0;
          titleRow.appendChild(titleBtn);
        }

        applyCollapsedState(wrapper, arcId);
      }
    } catch (_) {
      // ignore
    }
  }

  // ----- Logs UI tweaks: callback header + tooltips -----
  try {
    const tooltip = "Used for Callback";

    // Replace the column header text "Callback?" with the reverse-arrow icon.
    const headerContainer =
      section.querySelector(":scope > div.header.row.item") ??
      section.querySelector(":scope > li.row.header") ??
      section.querySelector(":scope > .header") ??
      null;

    if (headerContainer) {
      const candidates = Array.from(
        headerContainer.querySelectorAll("*")
      ).filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.children?.length) return false;
        const text = String(el.textContent ?? "").trim();
        return /^callback\?$/i.test(text);
      });

      for (const el of candidates) {
        el.innerHTML = '<i class="fa-solid fa-reply"></i>';
        el.title = tooltip;
        el.setAttribute("aria-label", tooltip);
        el.classList.add("sta-callbacks-callback-header-icon");
      }
    }

    // Add tooltips to all callback toggles in log rows.
    const toggles = section.querySelectorAll(
      'li.row.entry[data-item-type="log"] a.value-used.control.toggle, li.row.entry[data-item-type="log"] .value-used.control.toggle'
    );
    for (const el of Array.from(toggles)) {
      if (!(el instanceof HTMLElement)) continue;
      el.title = tooltip;
      el.setAttribute("aria-label", tooltip);
    }
  } catch (_) {
    // ignore
  }

  // ----- Milestones UI tweak: replace default + with custom button -----
  try {
    const milestoneCreate = section.querySelector(
      'a.control.create[data-type="milestone"]'
    );
    const milestoneHeader =
      milestoneCreate?.closest?.("div.header.row.item") ?? null;

    if (milestoneCreate && milestoneHeader) {
      // Avoid duplicates across rerenders.
      const existingCustom = milestoneHeader.querySelector(
        ".sta-milestone-create-placeholder"
      );
      if (!existingCustom) {
        // Remove the original Foundry create control.
        try {
          milestoneCreate.remove();
        } catch (_) {
          // ignore
        }

        const btn = document.createElement("a");
        btn.className = "control sta-milestone-create-placeholder";
        btn.title = "New Milestone / Arc";
        btn.setAttribute("aria-label", "New Milestone / Arc");
        btn.setAttribute("role", "button");
        btn.tabIndex = 0;
        btn.innerHTML = '<i class="fas fa-plus"></i>';

        const onClick = async (ev) => {
          ev?.preventDefault?.();
          ev?.stopPropagation?.();

          try {
            openNewMilestoneArcDialog(actor);
          } catch (_) {
            // ignore
          }
        };

        btn.addEventListener("click", onClick);
        btn.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") onClick(ev);
        });

        milestoneHeader.appendChild(btn);
      }
    }
  } catch (_) {
    // ignore
  }
}
