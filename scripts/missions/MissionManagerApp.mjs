/**
 * Manage Missions Application
 *
 * ApplicationV2 dialog that shows the current mission status and a browsable
 * history of ended missions. The GM can start a new mission, end the current
 * mission, reactivate a past mission, or remove entries from the history.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import {
  hasActiveMission,
  getMissionHistory,
  removeMissionFromHistory,
  reactivateMissionFromHistory,
  promptNewMissionAndReset,
  promptAddParticipant,
} from "./mission.js";
import {
  isMissionLogJournalsEnabled,
  getMissionJournalForLogName,
  syncAllMissionJournals,
  createMissionJournalForEntry,
} from "../journal/index.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

export class MissionManagerApp extends Base {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-mission-manager`,
    window: {
      title: `${MODULE_ID}.tools.manageMissions`,
      resizable: false,
    },
    classes: ["sta-officers-log", "sta-mission-manager-app"],
    position: { width: 480 },
    actions: {
      "end-mission": function () {
        this.close();
        promptNewMissionAndReset();
      },
      "new-mission": function () {
        this.close();
        promptNewMissionAndReset();
      },
      reactivate: async function (event, target) {
        const index = parseInt(target.dataset.index, 10);
        this.close();
        await reactivateMissionFromHistory(index);
      },
      "remove-entry": async function (event, target) {
        const index = parseInt(target.dataset.index, 10);
        await removeMissionFromHistory(index);
        this.render();
      },
      "add-players": async function () {
        await promptAddParticipant();
        this.render();
      },
      "view-journal": async function (event, target) {
        const uuid = target.dataset.journalUuid;
        if (!uuid) return;
        await syncAllMissionJournals();
        const journal = await fromUuid(uuid);
        journal?.sheet?.render(true);
      },
      "create-journal": async function (event, target) {
        const index = parseInt(target.dataset.index, 10);
        const rawHistory = getMissionHistory();
        const entry = rawHistory[index];
        if (!entry) return;
        await createMissionJournalForEntry(entry);
        this.render();
      },
      "sync-journal": async function (event, target) {
        const index = parseInt(target.dataset.index, 10);
        const rawHistory = getMissionHistory();
        const entry = rawHistory[index];
        if (!entry) return;
        await createMissionJournalForEntry(entry);
        this.render();
      },
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/mission-manager.hbs`,
    },
  };

  async _prepareContext(_options) {
    const active = hasActiveMission();
    let currentTitle = "";
    if (active) {
      try {
        currentTitle = (
          game.settings.get(MODULE_ID, "missionTitle") ?? ""
        ).trim();
      } catch (_) {}
    }

    const journalsEnabled = isMissionLogJournalsEnabled();

    const rawHistory = getMissionHistory();
    const history = rawHistory.map((entry, index) => {
      let journalUuid = null;
      let canCreateJournal = false;
      if (journalsEnabled) {
        const actorLogMap = entry.actorLogMap ?? {};
        for (const [actorId, logId] of Object.entries(actorLogMap)) {
          const actor = game.actors?.get(actorId);
          if (!actor) continue;
          const logItem = actor.items.get(logId);
          if (!logItem?.name) continue;
          const journal = getMissionJournalForLogName(logItem.name);
          if (journal) {
            journalUuid = journal.uuid;
            break;
          }
        }
        if (!journalUuid) {
          // Check whether creation is possible (at least one valid participant)
          for (const [actorId, logId] of Object.entries(actorLogMap)) {
            const actor = game.actors?.get(actorId);
            if (!actor) continue;
            const logItem = actor.items.get(logId);
            if (logItem?.name) {
              canCreateJournal = true;
              break;
            }
          }
        }
      }
      return {
        index,
        title: entry.title ?? "",
        endedDateStr: entry.endedAt
          ? new Date(entry.endedAt).toLocaleDateString()
          : "",
        participantCount: Array.isArray(entry.participantIds)
          ? entry.participantIds.length
          : 0,
        journalUuid,
        canCreateJournal,
      };
    });

    return {
      active,
      currentTitle,
      history,
      hasHistory: history.length > 0,
      labels: {
        activeHeader: t(`${MODULE_ID}.dialog.manageMissions.activeHeader`),
        historyHeader: t(`${MODULE_ID}.dialog.manageMissions.historyHeader`),
        noActiveMission: t(
          `${MODULE_ID}.dialog.manageMissions.noActiveMission`,
        ),
        noHistory: t(`${MODULE_ID}.dialog.manageMissions.noHistory`),
        endMission: t(`${MODULE_ID}.dialog.manageMissions.endMission`),
        newMission: t(`${MODULE_ID}.dialog.manageMissions.newMission`),
        addPlayers: t(`${MODULE_ID}.dialog.manageMissions.addPlayers`),
        reactivate: t(`${MODULE_ID}.dialog.manageMissions.reactivate`),
        remove: t(`${MODULE_ID}.dialog.manageMissions.remove`),
        participants: t(`${MODULE_ID}.dialog.manageMissions.participants`),
        viewJournal: t(`${MODULE_ID}.dialog.manageMissions.viewJournal`),
        createJournal: t(`${MODULE_ID}.dialog.manageMissions.createJournal`),
        syncJournal: t(`${MODULE_ID}.dialog.manageMissions.syncJournal`),
      },
    };
  }
}
