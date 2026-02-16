/**
 * Acclaim Button Override
 *
 * Replaces the default Roll Acclaim button on main character sheets
 * with a custom dialog for acclaim survey functionality.
 *
 * @module sheetHooks/renderAppV2/acclaimButton
 */

import {
  isAcclaimSurveyEnabled,
  getAcclaimPositiveQuestions,
  getAcclaimNegativeQuestions,
} from "../../data/acclaimSurvey.js";
import { t } from "../../core/i18n.js";

const ACCLAIM_BUTTON_SELECTOR =
  '.check-button.acclaim[data-action="onReputationTest"]';

/**
 * Install the acclaim button override on main character sheets.
 * Replaces the default Roll Acclaim button with a custom dialog.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor being displayed.
 * @param {Application} app - The application instance.
 */
export function installAcclaimButtonOverride(root, actor, app) {
  if (!root || !actor) return;

  // Check if acclaim survey is enabled
  if (!isAcclaimSurveyEnabled()) return;

  const btn = root.querySelector(ACCLAIM_BUTTON_SELECTOR);
  if (!btn) return;

  // Don't install twice on the same button
  if (btn.dataset.staAcclaimOverrideInstalled === "1") return;

  // Hide the original button
  btn.style.display = "none";
  btn.setAttribute("aria-hidden", "true");
  btn.dataset.staAcclaimOverrideInstalled = "1";

  // Clone the button without the data-action attribute
  const replacement = btn.cloneNode(true);
  replacement.removeAttribute("data-action");
  replacement.style.display = "";
  replacement.removeAttribute("aria-hidden");
  replacement.dataset.staAcclaimReplacement = "1";

  // Update button label
  const label = replacement.querySelector("span") ?? replacement;
  label.textContent = t("sta-officers-log.acclaimSurvey.rollReputation");

  replacement.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await _showAcclaimDialog(actor);
  });

  // Insert the replacement after the hidden original
  btn.insertAdjacentElement("afterend", replacement);
}

/* ------------------------------------------------------------------ */
/*  Broadcasting helpers (GM-triggered survey)                         */
/* ------------------------------------------------------------------ */

/**
 * Gather the current survey answers from the dialog DOM.
 *
 * @param {HTMLElement} html - The dialog element.
 * @returns {{ positiveChoices: Array, negativeChoices: Array,
 *             positiveCount: number, negativeCount: number }}
 * @private
 */
function _gatherChoices(html) {
  const positiveChoices = [];
  const negativeChoices = [];

  const questions = html.querySelectorAll(".sta-acclaim-question");
  for (const q of questions) {
    const type = q.dataset.questionType;
    const index = parseInt(q.dataset.questionIndex, 10);
    const checked = q.querySelector('input[type="radio"]:checked');
    const answer = checked?.value ?? null;
    if (type === "pos") positiveChoices.push({ index, answer });
    else if (type === "neg") negativeChoices.push({ index, answer });
  }

  return {
    positiveChoices,
    negativeChoices,
    positiveCount: _countYes(html, "pos") + _getModifier(html, "positive"),
    negativeCount: _countYes(html, "neg") + _getModifier(html, "negative"),
  };
}

/**
 * Broadcast current survey state to the GM via socket.
 * Called on every radio-button or modifier change when the survey was
 * opened remotely by the GM.
 *
 * @param {HTMLElement} html - The dialog element.
 * @param {Actor} actor - The actor being surveyed.
 * @param {object} [extra] - Additional fields merged into the message.
 * @private
 */
async function _broadcastSurveyState(html, actor, extra = {}) {
  try {
    const { getModuleSocket } = await import("../../core/socket.js");
    const sock = getModuleSocket();
    if (!sock) return;

    const choices = _gatherChoices(html);
    await sock.executeAsGM("acclaimSurveyUpdate", {
      userId: game.user.id,
      playerName: game.user.name,
      actorName: actor.name,
      actorId: actor.id,
      ...choices,
      ...extra,
    });
  } catch (err) {
    console.error("sta-officers-log | failed to broadcast survey state", err);
  }
}

/**
 * Attach broadcast listeners to the survey dialog so every change is
 * sent to the GM in real time.
 *
 * @param {HTMLElement} html - The dialog element.
 * @param {Actor} actor - The actor being surveyed.
 * @private
 */
function _attachBroadcastListeners(html, actor) {
  const broadcast = () => _broadcastSurveyState(html, actor);

  // Radio button changes
  html.addEventListener("change", (ev) => {
    if (ev.target?.type === "radio") broadcast();
  });

  // Modifier number inputs
  const modifiers = html.querySelectorAll("input[data-modifier]");
  for (const input of modifiers) {
    input.addEventListener("input", broadcast);
  }

  // Also listen on inner wrapper in case events don't bubble
  const inner = html.querySelector(".sta-acclaim-dialog");
  if (inner && inner !== html) {
    inner.addEventListener("change", (ev) => {
      if (ev.target?.type === "radio") broadcast();
    });
  }
}

/* ------------------------------------------------------------------ */
/*  HTML builders                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build question rows HTML for a question set.
 *
 * @param {string[]} questions - Array of questions.
 * @param {string} prefix - Prefix for radio input names (e.g., "pos" or "neg").
 * @returns {string} HTML string for the question rows.
 * @private
 */
function _buildQuestionRows(questions, prefix) {
  return questions
    .map((q, i) => {
      const escapedQ = foundry.utils.escapeHTML(q);
      return `
        <div class="sta-acclaim-question" data-question-index="${i}" data-question-type="${prefix}">
          <div class="sta-acclaim-question-text">${escapedQ}</div>
          <div class="sta-acclaim-question-options">
            <label>
              <input type="radio" name="${prefix}${i}" value="yes" />
              ${t("sta-officers-log.acclaimSurvey.yes")}
            </label>
            <label>
              <input type="radio" name="${prefix}${i}" value="no" />
              ${t("sta-officers-log.acclaimSurvey.no")}
            </label>
            <label>
              <input type="radio" name="${prefix}${i}" value="unsure" />
              ${t("sta-officers-log.acclaimSurvey.unsure")}
            </label>
          </div>
        </div>
      `;
    })
    .join("");
}

/**
 * Build the HTML content for the acclaim survey dialog.
 *
 * @param {string[]} positiveQuestions - Array of positive influence questions.
 * @param {string[]} negativeQuestions - Array of negative influence questions.
 * @returns {string} HTML content for the dialog.
 * @private
 */
function _buildSurveyContent(positiveQuestions, negativeQuestions, actorName) {
  const hasPositive = positiveQuestions.length > 0;
  const hasNegative = negativeQuestions.length > 0;

  if (!hasPositive && !hasNegative) {
    return `
      <div class="sta-acclaim-dialog">
        <p>${t("sta-officers-log.acclaimSurvey.noQuestions")}</p>
      </div>
    `;
  }

  let html = "";
  if (actorName) {
    const label =
      t("sta-officers-log.acclaimSurvey.surveyingFor") || "Surveying for:";
    html += `<div class="sta-acclaim-character-banner">${label} <strong>${foundry.utils.escapeHTML(actorName)}</strong></div>`;
  }
  html += '<div class="sta-acclaim-dialog">';

  const modifierLabel =
    t("sta-officers-log.acclaimSurvey.modifier") || "Modifier";

  // Positive Influences Section
  if (hasPositive) {
    html += `
      <div class="sta-acclaim-section sta-acclaim-positive">
        <h3 class="sta-acclaim-section-title">
          <i class="fa-solid fa-plus"></i>
          ${t("sta-officers-log.acclaimSurvey.positiveInfluences")}
          <span class="sta-acclaim-count">
            (<strong data-count="positive">0</strong> ${t("sta-officers-log.acclaimSurvey.positiveInfluence")})
          </span>
          <span class="sta-acclaim-modifier">
            <label>${modifierLabel}: <input type="number" data-modifier="positive" value="0" min="0" /></label>
          </span>
        </h3>
        <div class="sta-acclaim-questions">
          ${_buildQuestionRows(positiveQuestions, "pos")}
        </div>
      </div>
    `;
  }

  // Negative Influences Section
  if (hasNegative) {
    html += `
      <div class="sta-acclaim-section sta-acclaim-negative">
        <h3 class="sta-acclaim-section-title">
          <i class="fa-solid fa-minus"></i>
          ${t("sta-officers-log.acclaimSurvey.negativeInfluences")}
          <span class="sta-acclaim-count">
            (<strong data-count="negative">0</strong> ${t("sta-officers-log.acclaimSurvey.negativeInfluence")})
          </span>
          <span class="sta-acclaim-modifier">
            <label>${modifierLabel}: <input type="number" data-modifier="negative" value="0" min="0" /></label>
          </span>
        </h3>
        <div class="sta-acclaim-questions">
          ${_buildQuestionRows(negativeQuestions, "neg")}
        </div>
      </div>
    `;
  }

  html += "</div>";
  return html;
}

/**
 * Count "yes" answers for a given radio name prefix from a container element.
 *
 * @param {HTMLElement} container - The parent element to search within.
 * @param {string} prefix - The radio name prefix (e.g., "pos" or "neg").
 * @returns {number} Number of "yes"-checked radios.
 * @private
 */
function _countYes(container, prefix) {
  let count = 0;
  const radios = container.querySelectorAll(
    `input[type="radio"][name^="${prefix}"]:checked`,
  );
  for (const radio of radios) {
    if (radio.value === "yes") count++;
  }
  return count;
}

/**
 * Attach real-time counting logic to the dialog.
 *
 * @param {HTMLElement} html - The dialog's HTML element.
 * @private
 */
function _getModifier(html, type) {
  const input = html.querySelector(`input[data-modifier="${type}"]`);
  return Math.max(0, parseInt(input?.value ?? "0", 10) || 0);
}

function _attachCountingLogic(html) {
  const updateCounts = () => {
    const positiveCountEl = html.querySelector('[data-count="positive"]');
    const negativeCountEl = html.querySelector('[data-count="negative"]');
    if (positiveCountEl) {
      positiveCountEl.textContent = String(
        _countYes(html, "pos") + _getModifier(html, "positive"),
      );
    }
    if (negativeCountEl) {
      negativeCountEl.textContent = String(
        _countYes(html, "neg") + _getModifier(html, "negative"),
      );
    }

    // Enable/disable the Roll Acclaim button based on whether all questions
    // have an answer selected
    const totalQuestions = html.querySelectorAll(
      ".sta-acclaim-question",
    ).length;
    const answeredQuestions = html.querySelectorAll(
      'input[type="radio"]:checked',
    ).length;
    const rollBtn = html.querySelector('button[data-action="roll"]');
    if (rollBtn) {
      rollBtn.disabled = answeredQuestions < totalQuestions;
    }
  };

  const onChange = (ev) => {
    if (ev.target?.type === "radio" || ev.target?.type === "number") {
      updateCounts();
    }
  };

  // Also listen for direct input on number fields (covers arrow keys, typing)
  const modifierInputs = html.querySelectorAll("input[data-modifier]");
  for (const input of modifierInputs) {
    input.addEventListener("input", updateCounts);
  }

  html.addEventListener("change", onChange);

  // Also try listening on the content wrapper in case events don't bubble
  // to the application root element
  const inner = html.querySelector(".sta-acclaim-dialog");
  if (inner && inner !== html) {
    inner.addEventListener("change", onChange);
  }

  // Disable the button initially
  updateCounts();
}

/**
 * Perform the acclaim (reputation) roll and post results to chat.
 * Reproduces the roll logic from the STA system's _onReputationTest(),
 * using the system's own chat template for consistent formatting.
 *
 * @param {Actor} actor - The actor rolling acclaim.
 * @param {number} positiveInfluences - Number of positive influences (dice pool).
 * @param {number} negativeInfluences - Number of negative influences (difficulty).
 * @private
 */
async function _performAcclaimRoll(
  actor,
  positiveInfluences,
  negativeInfluences,
) {
  // Read reputation and reprimand from the actor data model
  const currentReputation = parseInt(actor.system?.reputation ?? 0, 10);
  const currentReprimand = parseInt(actor.system?.reprimand ?? 0, 10);

  // If no positive influences, nothing to roll
  if (positiveInfluences <= 0) {
    ui.notifications?.warn?.(
      t("sta-officers-log.acclaimSurvey.noPositiveInfluences"),
    );
    return;
  }

  const speaker = ChatMessage.getSpeaker({ actor });

  // Roll logic — identical to STA system's _onReputationTest()
  const targetNumber = currentReputation + 7;
  const complicationThreshold = 20 - Math.min(currentReprimand, 5);
  const roll = new Roll(`${positiveInfluences}d20`);
  await roll.evaluate();

  let diceHtml = "";
  let totalSuccesses = 0;
  let complications = 0;

  for (const die of roll.terms[0].results) {
    const dieResult = Math.round(parseFloat(die.result));
    let dieClass = "roll die d20";

    if (dieResult >= complicationThreshold) {
      dieClass += " min";
      complications += 1;
    } else if (dieResult <= currentReputation) {
      dieClass += " max";
      totalSuccesses += 2;
    } else if (dieResult <= targetNumber) {
      totalSuccesses += 1;
    }

    diceHtml += `<li class="${dieClass}">${dieResult}</li>`;
  }

  // Determine outcome text using the STA system's i18n keys
  let outcomeText = "";
  if (totalSuccesses > negativeInfluences) {
    const acclaim = totalSuccesses - negativeInfluences;
    outcomeText = game.i18n.format("sta.roll.gainacclaim", { 0: acclaim });
  } else {
    const reprimand = negativeInfluences - totalSuccesses + complications;
    if (reprimand > 0) {
      outcomeText = game.i18n.format("sta.roll.gainreprimand", {
        0: reprimand,
      });
    } else {
      outcomeText = game.i18n.localize("sta.roll.nochange");
    }
  }

  // Build chat data and render using the STA system's template
  const chatData = {
    speakerId: speaker.actor?.id ?? speaker.id,
    tokenId: speaker.token?.uuid ?? null,
    dicePool: positiveInfluences,
    diceHtml,
    outcomeText,
    targetNumber,
    complicationThreshold,
    negativeInfluences,
  };

  const chatHtml = await foundry.applications.handlebars.renderTemplate(
    "systems/sta/templates/chat/reputation-roll.hbs",
    chatData,
  );

  ChatMessage.create({
    speaker,
    content: chatHtml,
  });
}

/**
 * Show the acclaim dialog for the given actor.
 * When the player clicks "Roll Acclaim", counts are extracted from the survey
 * and fed into the reputation roll logic.
 *
 * @param {Actor} actor - The actor rolling acclaim.
 * @param {object} [options]
 * @param {boolean} [options.gmTriggered] - If true, broadcast every change
 *   back to the GM in real time via socket.
 * @private
 */
async function _showAcclaimDialog(actor, options = {}) {
  const positiveQuestions = getAcclaimPositiveQuestions();
  const negativeQuestions = getAcclaimNegativeQuestions();
  const content = _buildSurveyContent(
    positiveQuestions,
    negativeQuestions,
    actor.name,
  );

  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: t("sta-officers-log.acclaimSurvey.dialogTitle"),
      icon: "fa-solid fa-star",
    },
    position: {
      width: 900,
    },
    content,
    render: (_event, dialog) => {
      _attachCountingLogic(dialog.element);
      // Always broadcast survey changes to the GM so the monitor
      // works whether the GM triggered the survey or the player
      // opened it themselves from their character sheet.
      if (!game.user.isGM) {
        _attachBroadcastListeners(dialog.element, actor);
      }
    },
    buttons: [
      {
        action: "roll",
        label: t("sta-officers-log.acclaimSurvey.rollReputation"),
        icon: "fa-solid fa-dice-d20",
        default: true,
        callback: (_event, _button, dialog) => {
          const el = dialog.element;
          return {
            positiveInfluences:
              _countYes(el, "pos") + _getModifier(el, "positive"),
            negativeInfluences:
              _countYes(el, "neg") + _getModifier(el, "negative"),
          };
        },
      },
    ],
    close: () => null,
  });

  // User closed dialog without rolling
  if (!result) return;

  // Notify the GM monitor that this player has rolled
  if (!game.user.isGM) {
    try {
      const { getModuleSocket } = await import("../../core/socket.js");
      const sock = getModuleSocket();
      if (sock) {
        await sock.executeAsGM("acclaimSurveyUpdate", {
          userId: game.user.id,
          playerName: game.user.name,
          actorName: actor.name,
          actorId: actor.id,
          rolled: true,
          positiveCount: result.positiveInfluences,
          negativeCount: result.negativeInfluences,
        });
      }
    } catch (err) {
      console.error("sta-officers-log | failed to send rolled status", err);
    }
  }

  await _performAcclaimRoll(
    actor,
    result.positiveInfluences,
    result.negativeInfluences,
  );
}

/**
 * Public entry point for opening the acclaim survey dialog.
 * Used by the socket handler to trigger remotely.
 *
 * @param {Actor} actor - The actor rolling acclaim.
 * @param {object} [options]
 * @param {boolean} [options.gmTriggered] - Forward to _showAcclaimDialog.
 */
export async function showAcclaimDialog(actor, options = {}) {
  return _showAcclaimDialog(actor, options);
}
