import { MODULE_ID } from "./constants.js";
import { getMilestoneChildLogIds } from "./logMetadata.js";

export const MILESTONE_ICON_SOURCE_LOG_FLAG = "milestoneIconSourceLogId";

function _getChildAFallbackLogId(milestone) {
  try {
    const isArc = !!milestone?.system?.arc?.isArc;
    if (isArc) {
      return String(getMilestoneChildLogIds(milestone)?.[0] ?? "");
    }
    return String(milestone?.system?.childA ?? "");
  } catch (_) {
    return "";
  }
}

export function getMilestoneIconSourceLogId(milestone) {
  try {
    const fromFlag = milestone?.getFlag?.(
      MODULE_ID,
      MILESTONE_ICON_SOURCE_LOG_FLAG
    );
    const asString = fromFlag ? String(fromFlag) : "";
    return asString || _getChildAFallbackLogId(milestone);
  } catch (_) {
    return _getChildAFallbackLogId(milestone);
  }
}

export async function syncMilestoneImgFromLog(
  milestone,
  log,
  { setSourceFlag = false } = {}
) {
  try {
    if (!milestone || milestone.type !== "milestone") return false;
    if (!log || log.type !== "log") return false;

    const desiredImg = log?.img ? String(log.img) : "";
    if (!desiredImg) return false;

    const currentImg = String(milestone?.img ?? "");
    if (currentImg !== desiredImg) {
      await milestone.update?.({ img: desiredImg });
    }

    if (setSourceFlag) {
      try {
        const current = milestone.getFlag?.(
          MODULE_ID,
          MILESTONE_ICON_SOURCE_LOG_FLAG
        );
        if (String(current ?? "") !== String(log.id ?? "")) {
          await milestone.setFlag?.(
            MODULE_ID,
            MILESTONE_ICON_SOURCE_LOG_FLAG,
            String(log.id ?? "")
          );
        }
      } catch (_) {
        // ignore
      }
    }

    return currentImg !== desiredImg;
  } catch (_) {
    return false;
  }
}

export async function syncMilestoneImgFromLogId(
  actor,
  milestone,
  logId,
  { setSourceFlag = false } = {}
) {
  try {
    if (!actor || actor.type !== "character") return false;
    const id = String(logId ?? "");
    if (!id) return false;
    const log = actor.items?.get?.(id) ?? null;
    return await syncMilestoneImgFromLog(milestone, log, { setSourceFlag });
  } catch (_) {
    return false;
  }
}

export async function syncAllMilestoneIconsOnActor(actor) {
  try {
    if (!actor || actor.type !== "character") return 0;

    const milestones = Array.from(actor.items ?? []).filter(
      (i) => i?.type === "milestone"
    );

    const updates = [];

    for (const ms of milestones) {
      const preferredLogId = (() => {
        try {
          const fromFlag = ms.getFlag?.(
            MODULE_ID,
            MILESTONE_ICON_SOURCE_LOG_FLAG
          );
          return fromFlag ? String(fromFlag) : "";
        } catch (_) {
          return "";
        }
      })();

      const fallbackLogId = _getChildAFallbackLogId(ms);

      const resolveLog = (id) => {
        try {
          const l = id ? actor.items?.get?.(String(id)) ?? null : null;
          return l?.type === "log" ? l : null;
        } catch (_) {
          return null;
        }
      };

      const sourceLog = resolveLog(preferredLogId) ?? resolveLog(fallbackLogId);
      if (!sourceLog) continue;

      const desiredImg = sourceLog?.img ? String(sourceLog.img) : "";
      if (!desiredImg) continue;

      if (String(ms?.img ?? "") !== desiredImg) {
        updates.push({ _id: ms.id, img: desiredImg });
      }
    }

    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
    }

    return updates.length;
  } catch (_) {
    return 0;
  }
}
