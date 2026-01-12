import { MODULE_ID } from "./constants.js";

export function getArcsEarnedOnActor(actor) {
  if (!actor) return 0;
  const logs = actor.items.filter((i) => i.type === "log");
  let count = 0;
  for (const log of logs) {
    const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
    if (arcInfo?.isArc === true) count += 1;
  }
  return count;
}

export function getConsumedArcLogIds(actor) {
  /** @type {Set<string>} */
  const consumed = new Set();
  if (!actor) return consumed;

  const logs = actor.items.filter((i) => i.type === "log");
  for (const log of logs) {
    const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
    if (arcInfo?.isArc !== true) continue;
    const chain = Array.isArray(arcInfo.chainLogIds) ? arcInfo.chainLogIds : [];
    for (const id of chain) {
      if (id) consumed.add(String(id));
    }
  }

  return consumed;
}

export function getCallbackLogEdgesForValue(actor, valueId) {
  /** @type {Map<string, Set<string>>} */
  const incoming = new Map();

  const logs = actor.items.filter((i) => i.type === "log");
  for (const log of logs) {
    const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
    if (!link || link.valueId !== valueId) continue;

    const from = link.fromLogId;
    const to = log.id;
    if (!from || !to || from === to) continue;

    let set = incoming.get(to);
    if (!set) {
      set = new Set();
      incoming.set(to, set);
    }
    set.add(from);
  }

  return { incoming };
}

export function computeBestChainEndingAt({
  incoming,
  endLogId,
  disallowNodeIds,
}) {
  const memo = new Map(); // nodeId -> {len:number, prev:string|null}
  const visiting = new Set();

  const visit = (nodeId) => {
    if (disallowNodeIds?.has?.(nodeId)) {
      const res = { len: 0, prev: null };
      memo.set(nodeId, res);
      return res;
    }

    const cached = memo.get(nodeId);
    if (cached) return cached;

    if (visiting.has(nodeId)) {
      // Cycle guard: treat as chain break
      const res = { len: 1, prev: null };
      memo.set(nodeId, res);
      return res;
    }

    visiting.add(nodeId);
    let best = { len: 1, prev: null };
    const preds = incoming.get(nodeId);
    if (preds) {
      for (const pred of preds) {
        if (disallowNodeIds?.has?.(pred)) continue;
        const predRes = visit(pred);
        if (!predRes?.len) continue;
        const candidateLen = predRes.len + 1;
        if (candidateLen > best.len) {
          best = { len: candidateLen, prev: pred };
        }
      }
    }
    visiting.delete(nodeId);
    memo.set(nodeId, best);
    return best;
  };

  const endRes = visit(endLogId);
  const chain = [];
  if (!endRes?.len) return { length: 0, chainLogIds: chain };
  let cur = endLogId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    const prev = memo.get(cur)?.prev ?? null;
    cur = prev;
  }
  chain.reverse();
  return { length: endRes.len, chainLogIds: chain };
}

export function getCharacterArcEligibility(actor, { valueId, endLogId }) {
  const arcsEarned = getArcsEarnedOnActor(actor);
  const requiredChainLength = 3 + arcsEarned;
  const consumedArcLogIds = getConsumedArcLogIds(actor);
  const { incoming } = getCallbackLogEdgesForValue(actor, valueId);
  const { length, chainLogIds } = computeBestChainEndingAt({
    incoming,
    endLogId,
    disallowNodeIds: consumedArcLogIds,
  });

  const chainForArc =
    chainLogIds.length >= requiredChainLength
      ? chainLogIds.slice(-requiredChainLength)
      : chainLogIds;

  return {
    qualifies: length >= requiredChainLength,
    arcsEarned,
    requiredChainLength,
    chainLength: length,
    chainLogIds,
    chainForArc,
    consumedArcLogIdsCount: consumedArcLogIds.size,
  };
}

function _getMilestoneChildLogIds(milestone) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const childIds = [];

  for (let i = 0; i < letters.length; i += 1) {
    const key = `child${letters[i]}`;
    const id = milestone?.system?.[key];
    if (!id) break;
    childIds.push(String(id));
  }

  return childIds;
}

function _getCompletedArcEndLogIds(actor, logsById) {
  /** @type {Set<string>} */
  const ends = new Set();
  if (!actor) return ends;

  try {
    // 1) Completed arcs recorded on log flags.
    for (const log of logsById.values()) {
      const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      if (arcInfo?.isArc === true) ends.add(String(log.id));
    }

    // 2) Also treat completed Arc milestones as Arc boundaries (manual edits).
    const milestones = Array.from(actor?.items ?? []).filter(
      (i) => i?.type === "milestone"
    );

    for (const ms of milestones) {
      try {
        if (ms.system?.arc?.isArc !== true) continue;
        const steps = Number(ms.system?.arc?.steps ?? 0);
        if (!Number.isFinite(steps) || steps <= 0) continue;
        const childIds = _getMilestoneChildLogIds(ms);
        if (childIds.length !== steps) continue;
        const endId = childIds.length
          ? String(childIds[childIds.length - 1])
          : "";
        if (endId) ends.add(endId);
      } catch (_) {
        // ignore
      }
    }
  } catch (_) {
    // ignore
  }

  return ends;
}
