/**
 * GM Survey Monitor
 *
 * Shows a compact table-style view of all players' acclaim survey choices.
 * Questions are listed once as rows; each player has an answer-indicator column.
 *
 * @module hooks/renderAppV2/gmSurveyMonitor
 */

import {
  getAcclaimPositiveQuestions,
  getAcclaimNegativeQuestions,
} from "../../data/acclaimSurvey.js";
import { t } from "../../core/i18n.js";

/* ------------------------------------------------------------------ */
/*  Module-level state                                                 */
/* ------------------------------------------------------------------ */

/** @type {HTMLElement|null} Reference to the live dialog DOM element. */
let _monitorEl = null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Map an answer string to a display symbol.
 * @param {string|null} answer - "yes" | "no" | "unsure" | null
 * @returns {string}
 */
function _answerIcon(answer) {
  switch (answer) {
    case "yes":
      return '<i class="fa-solid fa-check sta-gm-monitor-icon-yes"></i>';
    case "no":
      return '<i class="fa-solid fa-xmark sta-gm-monitor-icon-no"></i>';
    case "unsure":
      return '<i class="fa-solid fa-question sta-gm-monitor-icon-unsure"></i>';
    default:
      return '<span class="sta-gm-monitor-icon-none">—</span>';
  }
}

/* ------------------------------------------------------------------ */
/*  Build HTML — compact table layout                                  */
/* ------------------------------------------------------------------ */

/**
 * Build a single player column header cell.
 * @private
 */
function _buildPlayerColHeader(player) {
  return `
    <div class="sta-gm-monitor-col-header" data-user-id="${player.userId}">
      <div class="sta-gm-monitor-player-name">
        ${foundry.utils.escapeHTML(player.playerName)}
      </div>
      <div class="sta-gm-monitor-actor-name" title="${foundry.utils.escapeHTML(player.actorName)}">
        (${foundry.utils.escapeHTML(player.actorName)})
      </div>
      <div class="sta-gm-monitor-player-stats">
        <span class="sta-gm-monitor-total-positive" title="${t("sta-officers-log.acclaimSurvey.positiveInfluences")}">
          <i class="fa-solid fa-plus"></i><strong data-total="positive">0</strong>
        </span>
        <span class="sta-gm-monitor-total-negative" title="${t("sta-officers-log.acclaimSurvey.negativeInfluences")}">
          <i class="fa-solid fa-minus"></i><strong data-total="negative">0</strong>
        </span>
      </div>
      <span class="sta-gm-monitor-status" data-status="waiting">
        <i class="fa-solid fa-hourglass-half"></i>
        ${t("sta-officers-log.gmMonitor.waiting")}
      </span>
    </div>`;
}

/**
 * Build answer indicator cells for one question row, one per player.
 * @private
 */
function _buildAnswerCells(players) {
  return players
    .map(
      (p) =>
        `<span class="sta-gm-monitor-answer" data-user-id="${p.userId}" data-answer="none">${_answerIcon(null)}</span>`,
    )
    .join("");
}

/**
 * Build the full content HTML for the GM monitor dialog.
 *
 * @param {{ userId: string, playerName: string, actorName: string }[]} players
 * @returns {string}
 */
function _buildMonitorContent(players) {
  const positiveQuestions = getAcclaimPositiveQuestions();
  const negativeQuestions = getAcclaimNegativeQuestions();

  let html = '<div class="sta-gm-monitor">';

  // ----- Player column headers -----
  html += '<div class="sta-gm-monitor-header">';
  html += '<div class="sta-gm-monitor-label-spacer"></div>'; // spacer for question text column
  for (const player of players) {
    html += _buildPlayerColHeader(player);
  }
  html += "</div>";

  // ----- Positive Influences section -----
  if (positiveQuestions.length > 0) {
    html += `
      <div class="sta-gm-monitor-section sta-gm-monitor-positive">
        <h4>
          <i class="fa-solid fa-plus"></i>
          ${t("sta-officers-log.acclaimSurvey.positiveInfluences")}
        </h4>`;
    for (let i = 0; i < positiveQuestions.length; i++) {
      html += `
        <div class="sta-gm-monitor-row" data-q-type="pos" data-q-index="${i}">
          <span class="sta-gm-monitor-question-text">${foundry.utils.escapeHTML(positiveQuestions[i])}</span>
          ${_buildAnswerCells(players)}
        </div>`;
    }
    html += "</div>";
  }

  // ----- Negative Influences section -----
  if (negativeQuestions.length > 0) {
    html += `
      <div class="sta-gm-monitor-section sta-gm-monitor-negative">
        <h4>
          <i class="fa-solid fa-minus"></i>
          ${t("sta-officers-log.acclaimSurvey.negativeInfluences")}
        </h4>`;
    for (let i = 0; i < negativeQuestions.length; i++) {
      html += `
        <div class="sta-gm-monitor-row" data-q-type="neg" data-q-index="${i}">
          <span class="sta-gm-monitor-question-text">${foundry.utils.escapeHTML(negativeQuestions[i])}</span>
          ${_buildAnswerCells(players)}
        </div>`;
    }
    html += "</div>";
  }

  html += "</div>";
  return html;
}

/* ------------------------------------------------------------------ */
/*  Dynamic player column insertion                                    */
/* ------------------------------------------------------------------ */

/**
 * Dynamically add a new player column to the existing monitor.
 *
 * @param {{ userId: string, playerName: string, actorName: string }} player
 * @private
 */
function _addPlayerColumn(player) {
  if (!_monitorEl) return;

  // Add column header
  const header = _monitorEl.querySelector(".sta-gm-monitor-header");
  if (header) {
    const tpl = document.createElement("template");
    tpl.innerHTML = _buildPlayerColHeader(player).trim();
    header.appendChild(tpl.content.firstElementChild);
  }

  // Add an answer cell to every question row
  const rows = _monitorEl.querySelectorAll(".sta-gm-monitor-row");
  for (const row of rows) {
    const cell = document.createElement("span");
    cell.className = "sta-gm-monitor-answer";
    cell.dataset.userId = player.userId;
    cell.dataset.answer = "none";
    cell.innerHTML = _answerIcon(null);
    row.appendChild(cell);
  }
}

/* ------------------------------------------------------------------ */
/*  Live update API                                                    */
/* ------------------------------------------------------------------ */

/**
 * Called by the socket handler when a player sends a survey state update.
 *
 * @param {object} data
 * @param {string} data.userId
 * @param {string} [data.playerName]
 * @param {string} [data.actorName]
 * @param {Array<{index:number, answer:string|null}>} [data.positiveChoices]
 * @param {Array<{index:number, answer:string|null}>} [data.negativeChoices]
 * @param {number} [data.positiveCount]
 * @param {number} [data.negativeCount]
 * @param {boolean} [data.rolled] - True when the player has rolled.
 */
export function updateGMMonitor(data) {
  if (!_monitorEl) return;

  // If the player doesn't have a column yet, add one dynamically
  let colHeader = _monitorEl.querySelector(
    `.sta-gm-monitor-col-header[data-user-id="${data.userId}"]`,
  );
  if (!colHeader) {
    _addPlayerColumn({
      userId: data.userId,
      playerName: data.playerName ?? "Unknown",
      actorName: data.actorName ?? "—",
    });
    colHeader = _monitorEl.querySelector(
      `.sta-gm-monitor-col-header[data-user-id="${data.userId}"]`,
    );
  }

  // --- Update individual question answer cells ---
  if (data.positiveChoices) {
    for (const choice of data.positiveChoices) {
      const row = _monitorEl.querySelector(
        `.sta-gm-monitor-row[data-q-type="pos"][data-q-index="${choice.index}"]`,
      );
      if (!row) continue;
      const cell = row.querySelector(
        `.sta-gm-monitor-answer[data-user-id="${data.userId}"]`,
      );
      if (cell) {
        cell.dataset.answer = choice.answer || "none";
        cell.innerHTML = _answerIcon(choice.answer);
      }
    }
  }

  if (data.negativeChoices) {
    for (const choice of data.negativeChoices) {
      const row = _monitorEl.querySelector(
        `.sta-gm-monitor-row[data-q-type="neg"][data-q-index="${choice.index}"]`,
      );
      if (!row) continue;
      const cell = row.querySelector(
        `.sta-gm-monitor-answer[data-user-id="${data.userId}"]`,
      );
      if (cell) {
        cell.dataset.answer = choice.answer || "none";
        cell.innerHTML = _answerIcon(choice.answer);
      }
    }
  }

  // --- Update totals in column header ---
  if (colHeader) {
    const posTotalEl = colHeader.querySelector('[data-total="positive"]');
    const negTotalEl = colHeader.querySelector('[data-total="negative"]');
    if (posTotalEl) posTotalEl.textContent = String(data.positiveCount ?? 0);
    if (negTotalEl) negTotalEl.textContent = String(data.negativeCount ?? 0);
  }

  // --- Update status indicator ---
  const statusEl = colHeader?.querySelector(".sta-gm-monitor-status");
  if (!statusEl) return;

  if (data.rolled) {
    statusEl.dataset.status = "rolled";
    statusEl.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${t("sta-officers-log.gmMonitor.rolled")}`;
  } else {
    statusEl.dataset.status = "answering";
    statusEl.innerHTML = `<i class="fa-solid fa-pencil"></i> ${t("sta-officers-log.gmMonitor.answering")}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Show the monitor dialog                                            */
/* ------------------------------------------------------------------ */

/**
 * Open the GM Survey Monitor dialog.
 *
 * @param {{ userId: string, playerName: string, actorName: string }[]} players
 */
export async function showGMSurveyMonitor(players) {
  const content = _buildMonitorContent(players);

  await foundry.applications.api.DialogV2.wait({
    window: {
      title: t("sta-officers-log.gmMonitor.title"),
      icon: "fa-solid fa-eye",
    },
    position: {
      width: 960,
    },
    content,
    render: (_event, dialog) => {
      _monitorEl = dialog.element;
    },
    buttons: [
      {
        action: "close",
        label: t("sta-officers-log.gmMonitor.close"),
        icon: "fa-solid fa-times",
      },
    ],
    close: () => {
      _monitorEl = null;
    },
  });
}

/**
 * Standalone entry point for the GM to open the survey monitor.
 * Usable from a macro or the module API without triggering surveys.
 * The monitor starts with columns for all online players and
 * dynamically adds new columns if other players start a survey.
 */
export async function openGMSurveyMonitor() {
  if (!game.user.isGM) {
    ui.notifications?.warn(
      t("sta-officers-log.gmMonitor.gmOnly") ||
        "Only the GM can use the survey monitor.",
    );
    return;
  }

  const onlinePlayers = game.users
    .filter((u) => u.active && !u.isGM && u.character)
    .map((u) => ({
      userId: u.id,
      playerName: u.name,
      actorName: u.character?.name ?? "—",
    }));

  return showGMSurveyMonitor(onlinePlayers);
}
