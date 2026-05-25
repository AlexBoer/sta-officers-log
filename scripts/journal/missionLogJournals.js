/**
 * Mission Log Journals
 *
 * When the "enableMissionLogJournals" world setting is on, this module
 * automatically creates and maintains two kinds of JournalEntry in a single
 * shared "Mission Logs" folder:
 *
 *  Personal Logs  — one journal per character (named "<Actor> Personal Logs")
 *                   with one page per log item, sorted by date.
 *                   The owning player(s) get OWNER; everyone else OBSERVER.
 *
 *  Mission Journals — one journal per log *name* that appears on 2+ characters
 *                     (named after the log, e.g. "Encounter at Narendra III")
 *                     with one page per character who has that log, showing
 *                     only their description.  All users get OBSERVER.
 *
 * All writes are GM-only.  Disabling the setting leaves existing journals
 * as frozen snapshots — nothing is deleted.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import {
  normalizeValueStateArray,
  isValueInvokedState,
} from "../values/values.js";
import {
  isDirectiveValueId,
  getDirectiveTextForValueId,
} from "../directives/directives.js";
import { getMilestoneChildLogIds } from "../log/logMetadata.js";

// ── Setting key ───────────────────────────────────────────────────────────────

export const WORLD_ENABLE_MISSION_LOG_JOURNALS_SETTING =
  "enableMissionLogJournals";

export function isMissionLogJournalsEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, WORLD_ENABLE_MISSION_LOG_JOURNALS_SETTING),
    );
  } catch (_) {
    return false;
  }
}

// ── Shared folders ────────────────────────────────────────────────────────────
// Each folder uses its own promise cache so concurrent calls share one creation
// and never race to produce duplicate folders.

function _makeFolderCache(flagKey, localeKey, fallback) {
  let promise = null;

  async function resolve() {
    const existing = game.folders?.find(
      (f) =>
        f.type === "JournalEntry" && f.getFlag?.(MODULE_ID, flagKey) === true,
    );
    if (existing) return existing;

    return Folder.create({
      name: t(localeKey) ?? fallback,
      type: "JournalEntry",
      flags: { [MODULE_ID]: { [flagKey]: true } },
    });
  }

  return async function ensure() {
    if (!promise) promise = resolve();
    const folder = await promise;
    if (!game.folders?.has(folder?.id)) {
      promise = null;
      return ensure();
    }
    return folder;
  };
}

const ensurePersonalLogsFolder = _makeFolderCache(
  "personalLogsFolder",
  "sta-officers-log.journal.personalLogsFolderName",
  "Personal Logs",
);

const ensureMissionLogsFolder = _makeFolderCache(
  "missionLogsFolder",
  "sta-officers-log.journal.missionLogsFolderName",
  "Mission Logs",
);

// ── Flag keys ─────────────────────────────────────────────────────────────────

/** Personal log journal — flagged with the linked actor's ID. */
const LINKED_ACTOR_ID_FLAG = "linkedActorId";
/** Page in a personal log journal — flagged with the linked log item ID. */
const LINKED_LOG_ITEM_ID_FLAG = "linkedLogItemId";

/** Mission journal — flagged with the exact log-item name it represents. */
const MISSION_JOURNAL_LOG_NAME_FLAG = "missionJournalLogName";
/** Page in a mission journal — flagged with the actor ID it belongs to. */
const MISSION_PAGE_ACTOR_ID_FLAG = "missionPageActorId";

// ── Actor eligibility ────────────────────────────────────────────────────────

/** Sheet IDs that mark an actor as an NPC — excluded from journal sync. */
const NPC_SHEET_IDS = new Set([
  "sta.STANPCSheet2e",
  "sta-utils.LcarsNPCSheet2e",
]);

/**
 * Returns true if an actor should have personal/mission journals generated.
 * Requires type === "character" and must not be using an NPC sheet.
 */
function isEligibleActor(actor) {
  if (actor.type !== "character") return false;
  const sheetClass = actor.flags?.core?.sheetClass;
  if (sheetClass && NPC_SHEET_IDS.has(sheetClass)) return false;
  return true;
}

// ── Personal journal helpers ──────────────────────────────────────────────────

function getPersonalJournalForActor(actor) {
  return (
    game.journal?.find(
      (j) => j.getFlag?.(MODULE_ID, LINKED_ACTOR_ID_FLAG) === actor.id,
    ) ?? null
  );
}

function buildPersonalJournalName(actor) {
  const suffix =
    t("sta-officers-log.journal.personalLogsSuffix") ?? "Personal Logs";
  return `${actor.name} ${suffix}`;
}

// ── Mission journal helpers ───────────────────────────────────────────────────

export function getMissionJournalForLogName(logName) {
  return (
    game.journal?.find(
      (j) => j.getFlag?.(MODULE_ID, MISSION_JOURNAL_LOG_NAME_FLAG) === logName,
    ) ?? null
  );
}

// ── Ownership ─────────────────────────────────────────────────────────────────

function buildPersonalOwnership(actor) {
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const ownership = { default: OBSERVER };

  for (const user of game.users ?? []) {
    if (user.isGM) continue;
    const level = actor.getUserLevel?.(user) ?? actor.ownership?.[user.id];
    if (level === OWNER) {
      ownership[user.id] = OWNER;
    }
  }

  return ownership;
}

function ownershipEqual(a, b) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

// ── Sort key ──────────────────────────────────────────────────────────────────

function computePageSort(log) {
  const custom = log.system?.customDate ?? null;
  if (custom) {
    const ms = Date.parse(custom);
    if (!Number.isNaN(ms)) return ms;
  }
  return log._stats?.createdTime ?? 0;
}

// ── Chain position ────────────────────────────────────────────────────────────

function computeChainPosition(log, logById) {
  let position = 1;
  let current = log;
  const visited = new Set();

  while (true) {
    const fromLogId = current.system?.callbackLink?.fromLogId ?? null;
    if (!fromLogId) break;
    if (visited.has(fromLogId)) break;
    visited.add(fromLogId);
    const parent = logById.get(String(fromLogId));
    if (!parent) break;
    position++;
    current = parent;
  }

  return position;
}

function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── State label ───────────────────────────────────────────────────────────────

function stateLabel(state) {
  switch (state) {
    case "positive":
      return t("sta-officers-log.journal.statePositive") ?? "Positive";
    case "negative":
      return t("sta-officers-log.journal.stateNegative") ?? "Negative";
    case "challenged":
      return t("sta-officers-log.journal.stateChallenged") ?? "Challenged";
    default:
      return state;
  }
}

// ── Description extractor ─────────────────────────────────────────────────────

function extractDescription(log) {
  const raw = log.system?.description;
  const html =
    typeof raw === "string"
      ? raw
      : typeof raw?.value === "string"
        ? raw.value
        : "";
  return html.trim();
}

// ── Personal page content builder ─────────────────────────────────────────────

function buildPersonalPageContent(log, actor, logById, logIdToPageUuid) {
  const parts = [];

  // ── Section 1: Description ────────────────────────────────────────────────
  const descHtml = extractDescription(log);
  if (descHtml) {
    parts.push(descHtml);
  } else {
    const noDesc =
      t("sta-officers-log.journal.noDescription") ?? "No entry recorded.";
    parts.push(`<p><em>${noDesc}</em></p>`);
  }

  // ── Section 2: Values Used ────────────────────────────────────────────────
  const valueStates = log.system?.valueStates ?? {};
  const invokedRows = [];

  for (const [valueId, rawState] of Object.entries(valueStates)) {
    const stateArray = normalizeValueStateArray(rawState);
    const invoked = stateArray.filter((s) => isValueInvokedState(String(s)));
    if (invoked.length === 0) continue;

    let name;
    if (isDirectiveValueId(valueId)) {
      name = getDirectiveTextForValueId(log, valueId) || "(Directive)";
    } else {
      const item = actor.items.get(valueId);
      name = item?.name ?? `(Missing Value: ${valueId})`;
    }

    const stateText = invoked.map(stateLabel).join(", ");
    invokedRows.push(`<li><strong>${name}</strong> — ${stateText}</li>`);
  }

  if (invokedRows.length > 0) {
    const header =
      t("sta-officers-log.journal.valuesUsedHeader") ?? "Values Used";
    parts.push(`<h2>${header}</h2><ul>${invokedRows.join("")}</ul>`);
  }

  // ── Section 3: Callbacks ──────────────────────────────────────────────────
  const callbackParts = [];

  const outgoingFromId = log.system?.callbackLink?.fromLogId ?? null;
  if (outgoingFromId) {
    const targetLog = logById.get(String(outgoingFromId));
    const targetName = targetLog?.name ?? "(Unknown Log)";
    const targetPageUuid = logIdToPageUuid.get(String(outgoingFromId)) ?? null;
    const chainPos = computeChainPosition(log, logById);
    const posLabel = ordinalSuffix(chainPos);

    const linkText = targetPageUuid
      ? `@UUID[${targetPageUuid}]{${targetName}}`
      : targetName;

    const outLabel =
      t("sta-officers-log.journal.callbackOutgoingLabel") ?? "Called back to";
    const chainLabel =
      t("sta-officers-log.journal.chainPosition") ?? "{position} in chain";
    const chainText = chainLabel.replace("{position}", posLabel);
    callbackParts.push(
      `<p>${outLabel}: ${linkText} <em>(${chainText})</em></p>`,
    );
  }

  const incomingLogs = [];
  for (const other of logById.values()) {
    if (other.id === log.id) continue;
    if (other.system?.callbackLink?.fromLogId === log.id) {
      incomingLogs.push(other);
    }
  }

  if (incomingLogs.length > 0) {
    const inLabel =
      t("sta-officers-log.journal.callbackIncomingLabel") ?? "Called back from";
    const other = incomingLogs[0];
    const pageUuid = logIdToPageUuid.get(String(other.id)) ?? null;
    const linkText = pageUuid
      ? `@UUID[${pageUuid}]{${other.name}}`
      : other.name;
    callbackParts.push(`<p>${inLabel}: ${linkText}</p>`);
  }

  if (callbackParts.length > 0) {
    const callbackHeader =
      t("sta-officers-log.journal.callbacksHeader") ?? "Callbacks";
    parts.push(`<h2>${callbackHeader}</h2>${callbackParts.join("")}`);
  }

  // ── Section 4: Milestones Earned ─────────────────────────────────────────
  const milestones = actor.items.filter((i) => i.type === "milestone");
  const earnedRows = [];

  for (const m of milestones) {
    const childIds = getMilestoneChildLogIds(m);
    if (!childIds.includes(log.id)) continue;

    const isArc = m.system?.arc?.isArc === true;
    const steps = m.system?.arc?.steps;
    let label = m.name ?? "(Milestone)";
    if (isArc) {
      const arcLabel =
        t("sta-officers-log.journal.arcMilestoneLabel") ?? "Arc Milestone";
      const stepsText = steps ? ` — ${steps}-step chain` : "";
      label += ` <em>(${arcLabel}${stepsText})</em>`;
    }
    earnedRows.push(`<li>${label}</li>`);
  }

  if (earnedRows.length > 0) {
    const msHeader =
      t("sta-officers-log.journal.milestonesHeader") ?? "Milestones Earned";
    parts.push(`<h2>${msHeader}</h2><ul>${earnedRows.join("")}</ul>`);
  }

  return parts.join("\n");
}

// ── Personal journal sync (debounced per actor) ───────────────────────────────

const _pendingPersonalSync = new Map(); // actorId -> timeoutId

export function syncJournalForActor(actor) {
  if (!actor?.id) return;
  const actorId = String(actor.id);

  const existing = _pendingPersonalSync.get(actorId);
  if (existing) clearTimeout(existing);

  const id = setTimeout(() => {
    _pendingPersonalSync.delete(actorId);
    _syncPersonalJournalImmediate(actor).catch((err) => {
      console.error(
        `${MODULE_ID} | syncJournalForActor failed for "${actor.name}":`,
        err,
      );
    });
  }, 500);

  _pendingPersonalSync.set(actorId, id);
}

async function _syncPersonalJournalImmediate(actor) {
  if (!game.user?.isGM) return;
  if (!isMissionLogJournalsEnabled()) return;

  const freshActor = game.actors.get(actor.id);
  if (!freshActor) return;
  if (!isEligibleActor(freshActor)) return;

  const logs = freshActor.items.filter((i) => i?.type === "log");
  if (logs.length === 0) return;

  const folder = await ensurePersonalLogsFolder();

  let journal = getPersonalJournalForActor(freshActor);
  const desiredName = buildPersonalJournalName(freshActor);
  const desiredOwnership = buildPersonalOwnership(freshActor);

  if (!journal) {
    journal = await JournalEntry.create({
      name: desiredName,
      folder: folder?.id ?? null,
      ownership: desiredOwnership,
      flags: { [MODULE_ID]: { [LINKED_ACTOR_ID_FLAG]: freshActor.id } },
      pages: [],
    });
    if (!journal) return;
  } else {
    const updates = {};
    if (journal.name !== desiredName) updates.name = desiredName;
    if (!ownershipEqual(journal.ownership, desiredOwnership))
      updates.ownership = desiredOwnership;
    if (Object.keys(updates).length > 0) await journal.update(updates);
  }

  // Build logId → page UUID map from existing pages
  const logById = new Map(logs.map((l) => [String(l.id), l]));
  const logIdToPageUuid = new Map();
  for (const page of journal.pages ?? []) {
    const logItemId = page.getFlag?.(MODULE_ID, LINKED_LOG_ITEM_ID_FLAG);
    if (logItemId) logIdToPageUuid.set(String(logItemId), page.uuid);
  }

  // Delete pages whose log item no longer exists
  const orphanedPageIds = [];
  for (const page of journal.pages ?? []) {
    const logItemId = page.getFlag?.(MODULE_ID, LINKED_LOG_ITEM_ID_FLAG);
    if (logItemId && !logById.has(String(logItemId))) {
      orphanedPageIds.push(page.id);
    }
  }
  if (orphanedPageIds.length > 0) {
    await journal.deleteEmbeddedDocuments("JournalEntryPage", orphanedPageIds);
  }

  const sortedLogs = [...logs].sort(
    (a, b) => computePageSort(a) - computePageSort(b),
  );

  // First pass: create any missing pages (UUIDs not yet known for new pages)
  const pagesToCreate = [];
  for (let i = 0; i < sortedLogs.length; i++) {
    const log = sortedLogs[i];
    if (!_findPersonalPageForLog(journal, log.id)) {
      pagesToCreate.push({
        name: log.name,
        type: "text",
        text: {
          content: buildPersonalPageContent(
            log,
            freshActor,
            logById,
            logIdToPageUuid,
          ),
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        },
        sort: i + 1,
        title: { show: true, level: 1 },
        flags: { [MODULE_ID]: { [LINKED_LOG_ITEM_ID_FLAG]: log.id } },
      });
    }
  }

  if (pagesToCreate.length > 0) {
    await journal.createEmbeddedDocuments("JournalEntryPage", pagesToCreate);
  }
}

function _findPersonalPageForLog(journal, logId) {
  return (
    journal.pages?.find(
      (p) => p.getFlag?.(MODULE_ID, LINKED_LOG_ITEM_ID_FLAG) === String(logId),
    ) ?? null
  );
}

// ── Per-item page operations (used by hooks for surgical updates) ─────────────
// Only the page for the specific log item being created/updated/deleted is
// touched.  All other pages in the journal are left exactly as they are.

const _pendingPageSync = new Map(); // "actorId:logItemId" -> timeoutId

export function syncPageForLogItem(actor, logItem) {
  if (!actor?.id || !logItem?.id) return;
  const key = `${actor.id}:${logItem.id}`;

  const existing = _pendingPageSync.get(key);
  if (existing) clearTimeout(existing);

  const id = setTimeout(() => {
    _pendingPageSync.delete(key);
    _syncPageForLogItemImmediate(actor, logItem).catch((err) => {
      console.error(
        `${MODULE_ID} | syncPageForLogItem failed for log "${logItem.name}":`,
        err,
      );
    });
  }, 500);

  _pendingPageSync.set(key, id);
}

async function _syncPageForLogItemImmediate(actor, logItem) {
  if (!game.user?.isGM) return;
  if (!isMissionLogJournalsEnabled()) return;

  const freshActor = game.actors.get(actor.id);
  if (!freshActor) return;
  if (!isEligibleActor(freshActor)) return;

  const freshLog = freshActor.items.get(logItem.id);
  if (!freshLog) return; // Already deleted; handled by deletePageForLogItem

  const folder = await ensurePersonalLogsFolder();

  // Ensure the journal exists; create it if this is the first log for the actor.
  let journal = getPersonalJournalForActor(freshActor);
  if (!journal) {
    journal = await JournalEntry.create({
      name: buildPersonalJournalName(freshActor),
      folder: folder?.id ?? null,
      ownership: buildPersonalOwnership(freshActor),
      flags: { [MODULE_ID]: { [LINKED_ACTOR_ID_FLAG]: freshActor.id } },
      pages: [],
    });
    if (!journal) return;
  }

  // Build maps from existing pages for cross-link resolution.
  // We read existing UUIDs here but do NOT modify any other page.
  const allLogs = freshActor.items.filter((i) => i?.type === "log");
  const logById = new Map(allLogs.map((l) => [String(l.id), l]));
  const logIdToPageUuid = new Map();
  for (const page of journal.pages ?? []) {
    const id = page.getFlag?.(MODULE_ID, LINKED_LOG_ITEM_ID_FLAG);
    if (id) logIdToPageUuid.set(String(id), page.uuid);
  }

  const newContent = buildPersonalPageContent(
    freshLog,
    freshActor,
    logById,
    logIdToPageUuid,
  );

  const existingPage = _findPersonalPageForLog(journal, freshLog.id);

  if (!existingPage) {
    const sortedLogs = [...allLogs].sort(
      (a, b) => computePageSort(a) - computePageSort(b),
    );
    const sortIndex = sortedLogs.findIndex((l) => l.id === freshLog.id);
    const sort =
      sortIndex >= 0 ? sortIndex + 1 : (journal.pages?.size ?? 0) + 1;

    await journal.createEmbeddedDocuments("JournalEntryPage", [
      {
        name: freshLog.name,
        type: "text",
        text: {
          content: newContent,
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        },
        sort,
        title: { show: true, level: 1 },
        flags: { [MODULE_ID]: { [LINKED_LOG_ITEM_ID_FLAG]: freshLog.id } },
      },
    ]);
  } else {
    const needsUpdate =
      existingPage.name !== freshLog.name ||
      existingPage.text?.content !== newContent;
    if (needsUpdate) {
      await existingPage.update({
        name: freshLog.name,
        "text.content": newContent,
      });
    }
  }
}

export function deletePageForLogItem(actor, logItemId) {
  if (!actor?.id || !logItemId) return;
  _deletePageForLogItemImmediate(actor, logItemId).catch((err) => {
    console.error(`${MODULE_ID} | deletePageForLogItem failed:`, err);
  });
}

async function _deletePageForLogItemImmediate(actor, logItemId) {
  if (!game.user?.isGM) return;
  if (!isMissionLogJournalsEnabled()) return;

  const freshActor = game.actors.get(actor.id);
  const journal = freshActor
    ? getPersonalJournalForActor(freshActor)
    : (game.journal?.find(
        (j) => j.getFlag?.(MODULE_ID, LINKED_ACTOR_ID_FLAG) === actor.id,
      ) ?? null);

  if (!journal) return;

  const page = _findPersonalPageForLog(journal, logItemId);
  if (!page) return;

  await journal.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
}

export function syncJournalMetadataForActor(actor) {
  if (!actor?.id) return;
  _syncJournalMetadataImmediate(actor).catch((err) => {
    console.error(`${MODULE_ID} | syncJournalMetadataForActor failed:`, err);
  });
}

async function _syncJournalMetadataImmediate(actor) {
  if (!game.user?.isGM) return;
  if (!isMissionLogJournalsEnabled()) return;

  const freshActor = game.actors.get(actor.id);
  if (!freshActor) return;

  const journal = getPersonalJournalForActor(freshActor);
  if (!journal) return;

  const desiredName = buildPersonalJournalName(freshActor);
  const desiredOwnership = buildPersonalOwnership(freshActor);
  const updates = {};
  if (journal.name !== desiredName) updates.name = desiredName;
  if (!ownershipEqual(journal.ownership, desiredOwnership))
    updates.ownership = desiredOwnership;
  if (Object.keys(updates).length > 0) await journal.update(updates);
}

// ── Mission journal sync (debounced, single global debounce) ──────────────────

let _pendingMissionJournalSync = null;

export function syncMissionJournalsDebounced() {
  if (_pendingMissionJournalSync) clearTimeout(_pendingMissionJournalSync);
  _pendingMissionJournalSync = setTimeout(() => {
    _pendingMissionJournalSync = null;
    syncAllMissionJournals().catch((err) => {
      console.error(`${MODULE_ID} | syncAllMissionJournals failed:`, err);
    });
  }, 500);
}

export async function syncAllMissionJournals() {
  if (!game.user?.isGM) return;
  if (!isMissionLogJournalsEnabled()) return;

  const folder = await ensureMissionLogsFolder();

  // Collect all log names → entries across all characters
  const logNameMap = new Map(); // logName -> [{ actor, log }]
  for (const actor of game.actors ?? []) {
    if (!isEligibleActor(actor)) continue;
    for (const item of actor.items ?? []) {
      if (item?.type !== "log") continue;
      const name = item.name;
      if (!logNameMap.has(name)) logNameMap.set(name, []);
      logNameMap.get(name).push({ actor, log: item });
    }
  }

  // Sync EXISTING mission journals only — do not auto-create new ones.
  // New journals are only created when the GM explicitly uses the Mission Manager.
  await Promise.all(
    [...logNameMap.entries()]
      .filter(([logName]) => getMissionJournalForLogName(logName) != null)
      .map(async ([logName, entries]) => {
        try {
          await _syncMissionJournalImmediate(logName, entries, folder);
        } catch (err) {
          console.error(
            `${MODULE_ID} | _syncMissionJournalImmediate failed for "${logName}":`,
            err,
          );
        }
      }),
  );
  // Mission journals are only deleted when the GM explicitly removes them;
  // auto-deletion based on actor count has been removed to match the
  // on-demand creation model.
}

async function _syncMissionJournalImmediate(
  logName,
  entries,
  folder,
  { forceCreate = false } = {},
) {
  // Require 2+ characters unless the GM is explicitly forcing creation
  if (!forceCreate && entries.length < 2) return;

  let journal = getMissionJournalForLogName(logName);
  const observerOnly = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };

  if (!journal) {
    journal = await JournalEntry.create({
      name: logName,
      folder: folder?.id ?? null,
      ownership: observerOnly,
      flags: { [MODULE_ID]: { [MISSION_JOURNAL_LOG_NAME_FLAG]: logName } },
      pages: [],
    });
    if (!journal) return;
  } else {
    if (journal.name !== logName) await journal.update({ name: logName });
  }

  const actorIdSet = new Set(entries.map(({ actor }) => actor.id));

  // Delete pages for characters who no longer have this log
  const orphanedPageIds = [];
  for (const page of journal.pages ?? []) {
    const linkedActorId = page.getFlag?.(MODULE_ID, MISSION_PAGE_ACTOR_ID_FLAG);
    if (linkedActorId && !actorIdSet.has(linkedActorId)) {
      orphanedPageIds.push(page.id);
    }
  }
  if (orphanedPageIds.length > 0) {
    await journal.deleteEmbeddedDocuments("JournalEntryPage", orphanedPageIds);
  }

  // Sort alphabetically by actor name for a stable, readable order
  const sortedEntries = [...entries].sort((a, b) =>
    a.actor.name.localeCompare(b.actor.name),
  );

  const newPages = [];
  const pageUpdates = [];

  for (let i = 0; i < sortedEntries.length; i++) {
    const { actor, log } = sortedEntries[i];

    const descHtml = extractDescription(log);
    const content = descHtml
      ? descHtml
      : `<p><em>${t("sta-officers-log.journal.noDescription") ?? "No entry recorded."}</em></p>`;

    const existingPage = journal.pages?.find(
      (p) => p.getFlag?.(MODULE_ID, MISSION_PAGE_ACTOR_ID_FLAG) === actor.id,
    );

    if (!existingPage) {
      newPages.push({
        name: actor.name,
        type: "text",
        text: {
          content,
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
        },
        sort: i + 1,
        title: { show: true, level: 1 },
        flags: {
          [MODULE_ID]: { [MISSION_PAGE_ACTOR_ID_FLAG]: actor.id },
        },
      });
    } else {
      const needsUpdate =
        existingPage.name !== actor.name ||
        existingPage.text?.content !== content ||
        existingPage.sort !== i + 1;
      if (needsUpdate) {
        pageUpdates.push({
          _id: existingPage.id,
          name: actor.name,
          "text.content": content,
          sort: i + 1,
        });
      }
    }
  }

  if (newPages.length > 0) {
    await journal.createEmbeddedDocuments("JournalEntryPage", newPages);
  }
  if (pageUpdates.length > 0) {
    await journal.updateEmbeddedDocuments("JournalEntryPage", pageUpdates);
  }
}

// ── On-demand mission journal creation ───────────────────────────────────────

/**
 * Creates (or re-syncs) the mission journal for a specific history entry.
 * Called when the GM clicks "Create Journal" in the Mission Manager.
 * Works even if only one participant's log is still present.
 */
export async function createMissionJournalForEntry(historyEntry) {
  if (!game.user?.isGM) return;
  if (!isMissionLogJournalsEnabled()) return;

  const folder = await ensureMissionLogsFolder();
  const actorLogMap = historyEntry.actorLogMap ?? {};

  // Collect valid actor+log pairs, grouped by log name
  const logNameMap = new Map();
  for (const [actorId, logId] of Object.entries(actorLogMap)) {
    const actor = game.actors?.get(actorId);
    if (!actor || !isEligibleActor(actor)) continue;
    const logItem = actor.items.get(logId);
    if (!logItem?.name) continue;
    const name = logItem.name;
    if (!logNameMap.has(name)) logNameMap.set(name, []);
    logNameMap.get(name).push({ actor, log: logItem });
  }

  if (logNameMap.size === 0) {
    ui.notifications?.warn(
      `${MODULE_ID} | No eligible participants found for this mission entry.`,
    );
    return;
  }

  await Promise.all(
    [...logNameMap.entries()].map(([logName, entries]) =>
      _syncMissionJournalImmediate(logName, entries, folder, {
        forceCreate: true,
      }),
    ),
  );
}

// ── Sync all ───────────────────────────────────────────────────────────────────

export async function syncAllJournals() {
  if (!game.user?.isGM) return;
  if (!isMissionLogJournalsEnabled()) return;

  // Personal journals — each debounced individually
  for (const actor of game.actors ?? []) {
    if (!isEligibleActor(actor)) continue;
    const hasLogs = actor.items.some((i) => i?.type === "log");
    if (!hasLogs) continue;
    syncJournalForActor(actor);
  }

  // Mission journals — single debounced full resync
  syncMissionJournalsDebounced();
}
