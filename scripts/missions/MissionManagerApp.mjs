/**
 * Manage Missions Application
 *
 * ApplicationV2 dialog that shows the current mission status and a browsable
 * history of ended missions. The GM can start a new mission, end the current
 * mission, reactivate a past mission, or remove entries from the history.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { getMissionDirectives } from "../directives/directives.js";
import {
  hasActiveMission,
  getMissionHistory,
  getActiveMissionCharacterSummary,
  getMissionCharacterSummaryForEntry,
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
  _formatMainCharacterMarkdownRow(row, labels) {
    const values = Array.isArray(row?.valuesUsed)
      ? row.valuesUsed.filter(Boolean).join(", ")
      : "";
    const valuesText = values || labels.noValuesUsed;

    const lines = [`- **${row?.name ?? "Unknown"}**`];
    lines.push(`  - ${labels.valuesUsed}: ${valuesText}`);

    if (row?.madeCallback) {
      const targetTitle = String(row?.callbackTargetTitle ?? "").trim();
      if (targetTitle) {
        lines.push(`  - ${labels.callbackTo} *__${targetTitle}__*`);
      } else {
        lines.push(`  - ${labels.callbackMade}`);
      }

      if (row?.callbackMilestoneChosen) {
        const milestoneText = row?.callbackMilestoneLabel
          ? row.callbackMilestoneLabel
          : labels.milestoneChosen;
        lines.push(`  - ${labels.milestone}: ${milestoneText}`);
      } else if (row?.callbackMilestonePending) {
        lines.push(`  - ${labels.milestone}: ${labels.milestonePending}`);
      }
    } else {
      lines.push(`  - ${labels.callbackNotMade}`);
    }

    return lines.join("\n");
  }

  _formatSupportingCharacterMarkdownRow(row, labels) {
    let advancementText = labels.noAdvancement;
    if (row?.advancementChosen) {
      advancementText = row?.advancementLabel
        ? `${labels.advancementChosen} (${row.advancementLabel})`
        : labels.advancementChosen;
    } else if (row?.advancementPending) {
      advancementText = labels.advancementPending;
    }

    return `- **${row?.name ?? "Unknown"}** | ${labels.advancement}: ${advancementText}`;
  }

  _buildMissionDetailsMarkdown({
    title,
    endedDateStr = "",
    directives = [],
    mainCharacters = [],
    supportingCharacters = [],
  }) {
    const labels = {
      mainCharacters: t(`${MODULE_ID}.dialog.manageMissions.mainCharacters`),
      supportingCharacters: t(
        `${MODULE_ID}.dialog.manageMissions.supportingCharacters`,
      ),
      valuesUsed: t(`${MODULE_ID}.dialog.manageMissions.valuesUsed`),
      noValuesUsed: t(`${MODULE_ID}.dialog.manageMissions.noValuesUsed`),
      callbackMade: t(`${MODULE_ID}.dialog.manageMissions.callbackMade`),
      callbackNotMade: t(`${MODULE_ID}.dialog.manageMissions.callbackNotMade`),
      callbackMilestone: t(
        `${MODULE_ID}.dialog.manageMissions.callbackMilestone`,
      ),
      callbackTo: t(`${MODULE_ID}.dialog.manageMissions.callbackTo`),
      milestoneChosen: t(`${MODULE_ID}.dialog.manageMissions.milestoneChosen`),
      milestonePending: t(
        `${MODULE_ID}.dialog.manageMissions.milestonePending`,
      ),
      milestone: t(`${MODULE_ID}.dialog.manageMissions.milestone`),
      advancement: t(`${MODULE_ID}.dialog.manageMissions.advancement`),
      advancementChosen: t(
        `${MODULE_ID}.dialog.manageMissions.advancementChosen`,
      ),
      advancementPending: t(
        `${MODULE_ID}.dialog.manageMissions.advancementPending`,
      ),
      noAdvancement: t(`${MODULE_ID}.dialog.manageMissions.noAdvancement`),
      directives: t(`${MODULE_ID}.dialog.manageMissions.directives`),
      noDirectives: t(`${MODULE_ID}.dialog.manageMissions.noDirectives`),
      none: t(`${MODULE_ID}.dialog.manageMissions.none`),
    };

    const lines = [
      `## ${String(title ?? "(untitled)").trim() || "(untitled)"}`,
    ];
    if (endedDateStr) {
      lines.push(`- ${endedDateStr}`);
    }

    lines.push("");
    lines.push(`### ${labels.directives}`);
    if (Array.isArray(directives) && directives.length > 0) {
      for (const directive of directives) {
        lines.push(`- ${String(directive ?? "").trim()}`);
      }
    } else {
      lines.push(`- ${labels.noDirectives}`);
    }

    lines.push("");
    lines.push(`### ${labels.mainCharacters}`);
    if (Array.isArray(mainCharacters) && mainCharacters.length > 0) {
      for (const row of mainCharacters) {
        lines.push(this._formatMainCharacterMarkdownRow(row, labels));
      }
    } else {
      lines.push(`- ${labels.none}`);
    }

    lines.push("");
    lines.push(`### ${labels.supportingCharacters}`);
    if (
      Array.isArray(supportingCharacters) &&
      supportingCharacters.length > 0
    ) {
      for (const row of supportingCharacters) {
        lines.push(this._formatSupportingCharacterMarkdownRow(row, labels));
      }
    } else {
      lines.push(`- ${labels.none}`);
    }

    return lines.join("\n");
  }

  async _copyMissionDetailsMarkdown(payload) {
    const markdown = this._buildMissionDetailsMarkdown(payload);
    try {
      await navigator.clipboard.writeText(markdown);
      ui.notifications.info(t(`${MODULE_ID}.dialog.manageMissions.copied`));
    } catch (err) {
      console.error(
        `${MODULE_ID} | Failed to copy mission details markdown`,
        err,
      );
      ui.notifications.warn(t(`${MODULE_ID}.dialog.manageMissions.copyFailed`));
    }
  }

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
        if (!game.user?.isGM) return;
        this.close();
        promptNewMissionAndReset();
      },
      "new-mission": function () {
        if (!game.user?.isGM) return;
        this.close();
        promptNewMissionAndReset();
      },
      reactivate: async function (event, target) {
        if (!game.user?.isGM) return;
        const index = parseInt(target.dataset.index, 10);
        this.close();
        await reactivateMissionFromHistory(index);
      },
      "remove-entry": async function (event, target) {
        if (!game.user?.isGM) return;
        const index = parseInt(target.dataset.index, 10);
        await removeMissionFromHistory(index);
        this.render();
      },
      "add-players": async function () {
        if (!game.user?.isGM) return;
        await promptAddParticipant();
        this.render();
      },
      "open-main-log": async function (event, target) {
        if (!game.user?.isGM) return;
        const actorId = String(target.dataset.actorId ?? "");
        const logId = String(target.dataset.logId ?? "");
        if (!actorId || !logId) return;

        const actor = game.actors?.get(actorId);
        if (!actor) return;

        const logItem = actor.items.get(logId);
        if (logItem?.sheet?.render) {
          logItem.sheet.render(true);
          return;
        }

        actor.sheet?.render?.(true);
      },
      "copy-active-markdown": async function () {
        if (!game.user?.isGM) return;
        const summary = getActiveMissionCharacterSummary();
        const directives = getMissionDirectives();
        let title = "";
        try {
          title = String(
            game.settings.get(MODULE_ID, "missionTitle") ?? "",
          ).trim();
        } catch (_) {
          title = "";
        }
        await this._copyMissionDetailsMarkdown({
          title: title || "(untitled)",
          directives,
          mainCharacters: summary.mainCharacters ?? [],
          supportingCharacters: summary.supportingCharacters ?? [],
        });
      },
      "copy-history-markdown": async function (event, target) {
        if (!game.user?.isGM) return;
        const index = parseInt(target.dataset.index, 10);
        const rawHistory = getMissionHistory();
        const entry = rawHistory[index];
        if (!entry) return;

        const summary = getMissionCharacterSummaryForEntry(entry);
        const endedDateStr = entry.endedAt
          ? new Date(entry.endedAt).toLocaleDateString()
          : "";

        await this._copyMissionDetailsMarkdown({
          title: entry.title ?? "(untitled)",
          endedDateStr,
          directives: Array.isArray(entry.directives) ? entry.directives : [],
          mainCharacters: summary.mainCharacters ?? [],
          supportingCharacters: summary.supportingCharacters ?? [],
        });
      },
      "view-journal": async function (event, target) {
        if (!game.user?.isGM) return;
        const uuid = target.dataset.journalUuid;
        if (!uuid) return;
        await syncAllMissionJournals();
        const journal = await fromUuid(uuid);
        journal?.sheet?.render(true);
      },
      "create-journal": async function (event, target) {
        if (!game.user?.isGM) return;
        const index = parseInt(target.dataset.index, 10);
        const rawHistory = getMissionHistory();
        const entry = rawHistory[index];
        if (!entry) return;
        const summary = getMissionCharacterSummaryForEntry(entry);
        await createMissionJournalForEntry({
          ...entry,
          mainCharacters: summary.mainCharacters ?? [],
          introducedSupportingCharacters: summary.supportingCharacters ?? [],
        });
        this.render();
      },
      "sync-journal": async function (event, target) {
        if (!game.user?.isGM) return;
        const index = parseInt(target.dataset.index, 10);
        const rawHistory = getMissionHistory();
        const entry = rawHistory[index];
        if (!entry) return;
        const summary = getMissionCharacterSummaryForEntry(entry);
        await createMissionJournalForEntry({
          ...entry,
          mainCharacters: summary.mainCharacters ?? [],
          introducedSupportingCharacters: summary.supportingCharacters ?? [],
        });
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
    let activeDirectives = [];
    let activeMainCharacters = [];
    let activeSupportingCharacters = [];
    if (active) {
      try {
        currentTitle = (
          game.settings.get(MODULE_ID, "missionTitle") ?? ""
        ).trim();
      } catch (_) {}

      const activeSummary = getActiveMissionCharacterSummary();
      activeDirectives = getMissionDirectives();
      activeMainCharacters = (activeSummary.mainCharacters ?? []).map((row) => {
        const valuesUsedArr = Array.isArray(row?.valuesUsed)
          ? row.valuesUsed
          : [];
        return {
          ...row,
          valuesUsedText: valuesUsedArr
            .map((v) => String(v ?? "").trim())
            .filter((v) => Boolean(v))
            .join(", "),
        };
      });
      activeSupportingCharacters = activeSummary.supportingCharacters ?? [];
    }

    const journalsEnabled = isMissionLogJournalsEnabled();

    const rawHistory = getMissionHistory();
    const history = rawHistory.map((entry, index) => {
      const summary = getMissionCharacterSummaryForEntry(entry);
      const actorLogMap = entry.actorLogMap ?? {};
      const mainCharacters = (summary.mainCharacters ?? []).map((row) => {
        const valuesUsedArr = Array.isArray(row?.valuesUsed)
          ? row.valuesUsed
          : [];
        return {
          ...row,
          logId: row?.logId
            ? String(row.logId)
            : row?.actorId && actorLogMap[row.actorId]
              ? String(actorLogMap[row.actorId])
              : null,
          valuesUsedText: valuesUsedArr
            .map((v) => String(v ?? "").trim())
            .filter((v) => Boolean(v))
            .join(", "),
        };
      });
      const supportingCharacters = summary.supportingCharacters ?? [];

      let journalUuid = null;
      let canCreateJournal = false;
      if (journalsEnabled) {
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
        directives: Array.isArray(entry.directives)
          ? entry.directives
              .map((d) => String(d ?? "").trim())
              .filter((d) => Boolean(d))
          : [],
        mainCharacters,
        supportingCharacters,
        hasCharacterSummary:
          mainCharacters.length > 0 || supportingCharacters.length > 0,
        journalUuid,
        canCreateJournal,
      };
    });

    return {
      active,
      currentTitle,
      isGM: Boolean(game.user?.isGM),
      activeDirectives,
      activeMainCharacters,
      activeSupportingCharacters,
      activeHasCharacterSummary:
        activeMainCharacters.length > 0 ||
        activeSupportingCharacters.length > 0,
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
        mainCharacters: t(`${MODULE_ID}.dialog.manageMissions.mainCharacters`),
        supportingCharacters: t(
          `${MODULE_ID}.dialog.manageMissions.supportingCharacters`,
        ),
        valuesUsed: t(`${MODULE_ID}.dialog.manageMissions.valuesUsed`),
        noValuesUsed: t(`${MODULE_ID}.dialog.manageMissions.noValuesUsed`),
        callbackMade: t(`${MODULE_ID}.dialog.manageMissions.callbackMade`),
        callbackNotMade: t(
          `${MODULE_ID}.dialog.manageMissions.callbackNotMade`,
        ),
        callbackMilestone: t(
          `${MODULE_ID}.dialog.manageMissions.callbackMilestone`,
        ),
        milestoneChosen: t(
          `${MODULE_ID}.dialog.manageMissions.milestoneChosen`,
        ),
        milestonePending: t(
          `${MODULE_ID}.dialog.manageMissions.milestonePending`,
        ),
        advancement: t(`${MODULE_ID}.dialog.manageMissions.advancement`),
        advancementChosen: t(
          `${MODULE_ID}.dialog.manageMissions.advancementChosen`,
        ),
        advancementPending: t(
          `${MODULE_ID}.dialog.manageMissions.advancementPending`,
        ),
        noAdvancement: t(`${MODULE_ID}.dialog.manageMissions.noAdvancement`),
        openLog: t(`${MODULE_ID}.dialog.manageMissions.openLog`),
        directives: t(`${MODULE_ID}.dialog.manageMissions.directives`),
        noDirectives: t(`${MODULE_ID}.dialog.manageMissions.noDirectives`),
        copyMarkdown: t(`${MODULE_ID}.dialog.manageMissions.copyMarkdown`),
        missionDetails: t(`${MODULE_ID}.dialog.manageMissions.missionDetails`),
        none: t(`${MODULE_ID}.dialog.manageMissions.none`),
        viewJournal: t(`${MODULE_ID}.dialog.manageMissions.viewJournal`),
        createJournal: t(`${MODULE_ID}.dialog.manageMissions.createJournal`),
        syncJournal: t(`${MODULE_ID}.dialog.manageMissions.syncJournal`),
      },
    };
  }
}
