import { getValueItems } from "./values.js";
import { MODULE_ID } from "./constants.js";

export function getMilestoneChildLogIds(milestone) {
  const system = milestone?.system ?? {};
  const childKeys = Object.keys(system).filter((k) => /^child[A-Z]$/.test(k));
  childKeys.sort();
  return childKeys
    .map((k) => String(system?.[k] ?? ""))
    .filter((v) => v && v !== "-");
}

export function getCompletedArcEndLogIds(actor, logItemsById = null) {
  const ends = new Set();

  try {
    const maybeById =
      logItemsById instanceof Map
        ? logItemsById
        : new Map(
            Array.from(actor?.items ?? [])
              .filter((i) => i?.type === "log")
              .map((l) => [String(l.id), l])
          );

    for (const log of maybeById.values()) {
      const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      if (arcInfo?.isArc === true) ends.add(String(log.id));
    }
  } catch (_) {
    // ignore
  }

  return ends;
}

export function getPrimaryValueIdForLog(actor, log, valueItems = null) {
  try {
    if (!actor || actor.type !== "character") return "";
    if (!log || log.type !== "log") return "";

    // 1) Explicit primary selection on the log sheet.
    const explicit = String(log.getFlag?.(MODULE_ID, "primaryValueId") ?? "");
    if (explicit) return explicit;

    // 2) Value used for the callback link (strong signal of chain value).
    const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
    const linkVal = link?.valueId ? String(link.valueId) : "";
    if (linkVal) return linkVal;

    // 3) Arc completion info (only present on the arc-ending log).
    const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
    const arcVal = arcInfo?.valueId ? String(arcInfo.valueId) : "";
    if (arcVal) return arcVal;

    // NOTE: We intentionally do NOT infer primary value from log.img.
    // Value icons (V1..V8) are assigned based on the actor's Value list order.
    // Creating/inserting/reordering Values will change that mapping, which would
    // retroactively change inferred primaries and reshuffle existing chains.
    //
    // If we reach here, the log has no stable primary value recorded.
    // Callers should treat this as "unknown" rather than guessing.
    void valueItems;
    void getValueItems;
    return "";
  } catch (_) {
    return "";
  }
}
