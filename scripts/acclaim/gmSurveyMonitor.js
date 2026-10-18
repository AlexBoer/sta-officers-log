/** Shared Acclaim Survey Monitor. */

import {
  getAcclaimPositiveQuestions,
  getAcclaimNegativeQuestions,
  canPlayersUseAcclaimSurveyMonitor,
} from "./acclaimSurvey.js";
import { canCurrentUserChangeActor } from "../core/utils.js";
import { t } from "../core/i18n.js";
import {
  getCharacterHouseReputationInfluence,
  isHouseReputationSurveyEnabled,
} from "../house/house-reputation-spends.js";

let _monitorEl = null;
const _surveys = new Map();

function _answerIcon(answer) {
  if (answer === "yes")
    return '<i class="fa-solid fa-check sta-gm-monitor-icon-yes"></i>';
  if (answer === "no")
    return '<i class="fa-solid fa-xmark sta-gm-monitor-icon-no"></i>';
  return '<span class="sta-gm-monitor-icon-none">—</span>';
}

function _emptyChoices(
  type,
  houseRelativeEnabled = false,
  houseRelativeType = null,
) {
  const questions =
    type === "pos"
      ? getAcclaimPositiveQuestions()
      : getAcclaimNegativeQuestions();
  const choices = questions.map((_question, index) => ({
    index,
    answer: null,
  }));
  if (houseRelativeEnabled) {
    const isRelativeChoice =
      (type === "pos" && houseRelativeType === "positive") ||
      (type === "neg" && houseRelativeType === "negative");
    choices.push({
      index: questions.length,
      answer: isRelativeChoice ? "yes" : null,
    });
  }
  return choices;
}

function _canEdit(actorId) {
  return canCurrentUserChangeActor(game.actors?.get?.(actorId));
}

function _normalize(data) {
  const actorId = String(data?.actorId ?? "");
  const current = _surveys.get(actorId) ?? {};
  const actor = game.actors?.get?.(actorId);
  const hasHouseRelativeEnabled = Object.hasOwn(
    data ?? {},
    "houseRelativeEnabled",
  );
  const houseRelativeEnabled = hasHouseRelativeEnabled
    ? data.houseRelativeEnabled === true
    : (current.houseRelativeEnabled ?? false);
  const hasHouseRelativeType = Object.hasOwn(data ?? {}, "houseRelativeType");
  const houseRelativeType = hasHouseRelativeType
    ? data.houseRelativeType
    : (current.houseRelativeType ?? null);
  const relativeTypeChanged =
    hasHouseRelativeType && houseRelativeType !== current.houseRelativeType;
  const resetRelativeChoices =
    (hasHouseRelativeEnabled && !current.houseRelativeEnabled) ||
    relativeTypeChanged;
  let positiveChoices = Array.isArray(data?.positiveChoices)
    ? [...data.positiveChoices]
    : (current.positiveChoices ??
      _emptyChoices("pos", houseRelativeEnabled, houseRelativeType));
  let negativeChoices = Array.isArray(data?.negativeChoices)
    ? [...data.negativeChoices]
    : (current.negativeChoices ??
      _emptyChoices("neg", houseRelativeEnabled, houseRelativeType));

  const positiveQuestionCount = getAcclaimPositiveQuestions().length;
  const negativeQuestionCount = getAcclaimNegativeQuestions().length;
  positiveChoices = positiveChoices.filter(
    (choice) =>
      choice.index < positiveQuestionCount ||
      (houseRelativeEnabled &&
        choice.index === positiveQuestionCount),
  );
  negativeChoices = negativeChoices.filter(
    (choice) =>
      choice.index < negativeQuestionCount ||
      (houseRelativeEnabled &&
        choice.index === negativeQuestionCount),
  );
  if (houseRelativeEnabled) {
    const ensureHouseRelativeChoice = (choices, index, expectedType) => {
      const existing = choices.find((choice) => choice.index === index);
      const answer = resetRelativeChoices
        ? houseRelativeType === expectedType
          ? "yes"
          : null
        : (existing?.answer ?? null);
      if (existing) {
        return choices.map((choice) =>
          choice.index === index ? { ...choice, answer } : choice,
        );
      }
      return [...choices, { index, answer }];
    };
    positiveChoices = ensureHouseRelativeChoice(
      positiveChoices,
      positiveQuestionCount,
      "positive",
    );
    negativeChoices = ensureHouseRelativeChoice(
      negativeChoices,
      negativeQuestionCount,
      "negative",
    );
  }
  const positiveModifier = Math.max(
    0,
    Number(data?.positiveModifier ?? current.positiveModifier ?? 0) || 0,
  );
  const negativeModifier = Math.max(
    0,
    Number(data?.negativeModifier ?? current.negativeModifier ?? 0) || 0,
  );
  const countYes = (choices) =>
    choices.filter((choice) => choice?.answer === "yes").length;
  return {
    ...current,
    ...data,
    actorId,
    houseRelativeType,
    actorName: actor?.name ?? data?.actorName ?? current.actorName ?? "Unknown",
    houseRelativeEnabled,
    positiveChoices,
    negativeChoices,
    positiveModifier,
    negativeModifier,
    positiveCount: countYes(positiveChoices) + positiveModifier,
    negativeCount: countYes(negativeChoices) + negativeModifier,
    rolled: Boolean(data?.rolled ?? current.rolled),
  };
}

function _header(survey) {
  const editable = _canEdit(survey.actorId);
  const status = survey.rolled ? "rolled" : "answering";
  const icon = survey.rolled ? "fa-dice-d20" : "fa-pencil";
  const label = survey.rolled
    ? t("sta-officers-log.gmMonitor.rolled")
    : t("sta-officers-log.gmMonitor.answering");
  return `<div class="sta-gm-monitor-col-header" data-actor-id="${survey.actorId}">
    <div class="sta-gm-monitor-actor-name" title="${foundry.utils.escapeHTML(survey.actorName)}">${foundry.utils.escapeHTML(survey.actorName)}</div>
    <div class="sta-gm-monitor-player-stats"><span class="sta-gm-monitor-total-positive"><i class="fa-solid fa-plus"></i><strong data-total="positive">${survey.positiveCount}</strong></span><span class="sta-gm-monitor-total-negative"><i class="fa-solid fa-minus"></i><strong data-total="negative">${survey.negativeCount}</strong></span></div>
    <span class="sta-gm-monitor-status" data-status="${status}"><i class="fa-solid ${icon}"></i> ${label}</span>
    <button type="button" class="sta-gm-monitor-roll" data-action="roll" data-actor-id="${survey.actorId}" ${editable ? "" : "disabled"}><i class="fa-solid fa-dice-d20"></i> ${t("sta-officers-log.acclaimSurvey.rollReputation")}</button>
  </div>`;
}

function _cells(surveys, type, index, isHouseRelative = false) {
  return surveys
    .map((survey) => {
      if (isHouseRelative && !survey.houseRelativeEnabled)
        return '<span class="sta-gm-monitor-answer" data-answer="none" data-editable="false"><span class="sta-gm-monitor-icon-none">—</span></span>';
      const choices =
        type === "pos" ? survey.positiveChoices : survey.negativeChoices;
      const answer =
        choices.find((choice) => choice.index === index)?.answer ?? null;
      return `<span class="sta-gm-monitor-answer" data-actor-id="${survey.actorId}" data-answer="${answer ?? "none"}" data-editable="${_canEdit(survey.actorId)}">${_answerIcon(answer)}</span>`;
    })
    .join("");
}

function _modifiers(surveys, type) {
  const field = type === "pos" ? "positiveModifier" : "negativeModifier";
  return surveys
    .map(
      (survey) =>
        `<input class="sta-gm-monitor-modifier" type="number" min="0" value="${survey[field]}" data-actor-id="${survey.actorId}" data-modifier-type="${type}" ${_canEdit(survey.actorId) ? "" : "disabled"}>`,
    )
    .join("");
}

function _content() {
  const surveys = [..._surveys.values()];
  const section = (type, questions, key, icon) => {
    const showHouseRelative = surveys.some(
      (survey) => survey.houseRelativeEnabled,
    );
    if (!questions.length && !showHouseRelative) return "";
    const interactionHint =
      type === "pos"
        ? `<div class="sta-gm-monitor-interaction-hint"><span></span><span>${t("sta-officers-log.gmMonitor.interactionHint")}</span></div>`
        : "";
    let html = `<div class="sta-gm-monitor-section sta-gm-monitor-${type === "pos" ? "positive" : "negative"}">${interactionHint}<h4><span class="sta-gm-monitor-section-label"><i class="fa-solid ${icon}"></i>${t(key)}</span>${_modifiers(surveys, type)}</h4>`;
    for (let index = 0; index < questions.length; index++)
      html += `<div class="sta-gm-monitor-row" data-q-type="${type}" data-q-index="${index}"><span class="sta-gm-monitor-question-text">${foundry.utils.escapeHTML(questions[index])}</span>${_cells(surveys, type, index)}</div>`;
    if (showHouseRelative) {
      const question =
        type === "pos"
          ? t("sta-officers-log.acclaimSurvey.houseElevates") ||
            "Your Reputation exceeds your House's Reputation, elevating your House (+1 positive influence)."
          : t("sta-officers-log.acclaimSurvey.houseDisgraces") ||
            "Your Reputation is lower than your House's Reputation, disgracing your House (+1 negative influence).";
      html += `<div class="sta-gm-monitor-row sta-gm-monitor-house-relative" data-q-type="${type}" data-q-index="${questions.length}"><span class="sta-gm-monitor-question-text">${foundry.utils.escapeHTML(question)}</span>${_cells(surveys, type, questions.length, true)}</div>`;
    }
    return `${html}</div>`;
  };
  return `<div class="sta-gm-monitor"><div class="sta-gm-monitor-header"><div class="sta-gm-monitor-label-spacer"></div>${surveys.map(_header).join("")}</div>${section("pos", getAcclaimPositiveQuestions(), "sta-officers-log.acclaimSurvey.positiveInfluences", "fa-plus")}${section("neg", getAcclaimNegativeQuestions(), "sta-officers-log.acclaimSurvey.negativeInfluences", "fa-minus")}</div>`;
}

function _render() {
  const root = _monitorEl?.querySelector(".sta-gm-monitor");
  if (root) root.outerHTML = _content();
}

function _read(actorId) {
  const survey = _surveys.get(actorId);
  if (!survey) return null;
  const choices = (type) =>
    [
      ...(_monitorEl?.querySelectorAll(
        `.sta-gm-monitor-row[data-q-type="${type}"]`,
      ) ?? []),
    ].map((row) => {
      const cell = row.querySelector(
        `.sta-gm-monitor-answer[data-actor-id="${actorId}"]`,
      );
      return {
        index: Number(row.dataset.qIndex),
        answer:
          cell?.dataset.answer === "none"
            ? null
            : (cell?.dataset.answer ?? null),
      };
    });
  const modifier = (type) =>
    Math.max(
      0,
      Number(
        _monitorEl?.querySelector(
          `.sta-gm-monitor-modifier[data-actor-id="${actorId}"][data-modifier-type="${type}"]`,
        )?.value ?? 0,
      ) || 0,
    );
  return {
    ...survey,
    positiveChoices: choices("pos"),
    negativeChoices: choices("neg"),
    positiveModifier: modifier("pos"),
    negativeModifier: modifier("neg"),
    rolled: false,
  };
}

async function _publish(survey) {
  const { getModuleSocket } = await import("../core/socket.js");
  const socket = getModuleSocket();
  if (!socket) return;
  if (game.user.isGM) {
    const updated = updateGMSurveyMonitor(survey);
    await socket.executeForOthers("acclaimSurveyMonitorUpdate", updated);
  } else {
    const updated = await socket.executeAsGM("acclaimSurveyUpdate", {
      ...survey,
      requestingUserId: game.user.id,
    });
    if (updated?.actorId) updateGMSurveyMonitor(updated);
  }
}

async function _editAnswer(event, answer) {
  const cell = event.target.closest?.(".sta-gm-monitor-answer");
  if (!cell || cell.dataset.editable !== "true") return;
  event.preventDefault();
  const next = cell.dataset.answer === answer ? "none" : answer;
  cell.dataset.answer = next;
  cell.innerHTML = _answerIcon(next === "none" ? null : next);
  const survey = _read(cell.dataset.actorId);
  if (survey) await _publish(survey);
}

async function _roll(event) {
  const button = event.target.closest?.('[data-action="roll"]');
  if (!button || button.disabled) return;
  const survey = _read(button.dataset.actorId);
  const actor = game.actors?.get?.(button.dataset.actorId);
  if (!survey || !actor || !_canEdit(actor.id)) return;
  const { performAcclaimSurveyRoll } = await import("./acclaimButton.js");
  const submitted = await performAcclaimSurveyRoll(
    actor,
    survey.positiveCount,
    survey.negativeCount,
  );
  if (submitted) await _publish({ ...survey, rolled: true });
}

function _installInteractions() {
  _monitorEl?.addEventListener("click", (event) => {
    if (event.target.closest?.('[data-action="roll"]')) void _roll(event);
    else void _editAnswer(event, "yes");
  });
  _monitorEl?.addEventListener(
    "contextmenu",
    (event) => void _editAnswer(event, "no"),
  );
  const publishModifier = (event) => {
    const input = event.target.closest?.(".sta-gm-monitor-modifier");
    if (!input || input.disabled) return;
    const survey = _read(input.dataset.actorId);
    if (survey) void _publish(survey);
  };
  _monitorEl?.addEventListener("input", publishModifier);
  _monitorEl?.addEventListener("change", publishModifier);
}

export function updateGMSurveyMonitor(data) {
  const survey = _normalize(data);
  if (!survey.actorId) return null;
  _surveys.set(survey.actorId, survey);
  _render();
  return survey;
}

export function getGMSurveyMonitorState() {
  return [..._surveys.values()];
}

export async function openSurveyMonitorForActor(actor) {
  if (!actor || !_canEdit(actor.id)) {
    ui.notifications?.warn(t("sta-officers-log.gmMonitor.actorOwnerOnly"));
    return;
  }
  const { getModuleSocket } = await import("../core/socket.js");
  const socket = getModuleSocket();
  if (!socket) return;
  const houseRelativeEnabled = isHouseReputationSurveyEnabled(actor);
  const houseInfluence = await getCharacterHouseReputationInfluence(actor);
  let survey;
  if (game.user.isGM) {
    survey = updateGMSurveyMonitor({
      actorId: actor.id,
      actorName: actor.name,
      houseRelativeEnabled,
      houseRelativeType: houseInfluence?.type ?? null,
    });
    await socket.executeForOthers("acclaimSurveyMonitorUpdate", survey);
  } else {
    survey = await socket.executeAsGM("acclaimSurveyMonitorOpen", {
      actorId: actor.id,
      requestingUserId: game.user.id,
      houseRelativeEnabled,
      houseRelativeType: houseInfluence?.type ?? null,
    });
    if (survey?.actorId) updateGMSurveyMonitor(survey);
  }
  await openGMSurveyMonitor();
}

export async function showGMSurveyMonitor(surveys = []) {
  for (const survey of surveys) updateGMSurveyMonitor(survey);
  if (_monitorEl) {
    _render();
    return;
  }
  await foundry.applications.api.DialogV2.wait({
    classes: ["sta-officers-log"],
    window: {
      title: t("sta-officers-log.gmMonitor.title"),
      icon: "fa-solid fa-eye",
    },
    position: { width: 960 },
    content: _content(),
    render: (_event, dialog) => {
      _monitorEl = dialog.element;
      _installInteractions();
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

export async function openGMSurveyMonitor() {
  if (!game.user.isGM && !canPlayersUseAcclaimSurveyMonitor()) {
    ui.notifications?.warn(
      t("sta-officers-log.gmMonitor.playerAccessDisabled"),
    );
    return;
  }
  if (!game.user.isGM) {
    const { getModuleSocket } = await import("../core/socket.js");
    const state = await getModuleSocket()?.executeAsGM(
      "getAcclaimSurveyMonitorState",
    );
    if (Array.isArray(state))
      for (const survey of state) updateGMSurveyMonitor(survey);
  }
  return showGMSurveyMonitor();
}
