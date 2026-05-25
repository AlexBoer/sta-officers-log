/**
 * Reputation Spend – Chat Message Hook
 *
 * Adds "Spend Acclaim" / "Spend Reprimands" buttons to reputation-roll
 * chat messages and opens a picker dialog when clicked.
 *
 * @module hooks/reputationSpend
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { isAcclaimSurveyEnabled } from "./acclaimSurvey.js";
import {
  getCustomAwards,
  getCustomAcclaimOptions,
  getCustomReprimandOptions,
} from "./customSpendOptions.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/**
 * STA 2e Acclaim Spending Options
 * From the Star Trek Adventures 2nd Edition Core Rulebook.
 */
const ACCLAIM_OPTIONS = [
  {
    action: "commendAnother",
    labelKey: "sta-officers-log.reputationSpend.acclaimCommendAnother",
    descKey: "sta-officers-log.reputationSpend.acclaimCommendAnotherDesc",
    cost: 1,
  },
  {
    action: "elevation",
    labelKey: "sta-officers-log.reputationSpend.acclaimElevation",
    descKey: "sta-officers-log.reputationSpend.acclaimElevationDesc",
    cost: 3,
  },
  {
    action: "gainFavor",
    labelKey: "sta-officers-log.reputationSpend.acclaimGainFavor",
    descKey: "sta-officers-log.reputationSpend.acclaimGainFavorDesc",
    cost: 1,
  },
  {
    action: "increaseReputation",
    labelKey: "sta-officers-log.reputationSpend.acclaimIncreaseReputation",
    descKey: "sta-officers-log.reputationSpend.acclaimIncreaseReputationDesc",
    cost: 0, // variable — handled in dialog
  },
  {
    action: "promotion",
    labelKey: "sta-officers-log.reputationSpend.acclaimPromotion",
    descKey: "sta-officers-log.reputationSpend.acclaimPromotionDesc",
    cost: 3,
  },
  {
    action: "status",
    labelKey: "sta-officers-log.reputationSpend.acclaimStatus",
    descKey: "sta-officers-log.reputationSpend.acclaimStatusDesc",
    cost: 3,
  },
  // ---- Awards ----
  {
    action: "awardPikeMedal",
    labelKey: "sta-officers-log.reputationSpend.awardPikeMedal",
    descKey: "sta-officers-log.reputationSpend.awardPikeMedalDesc",
    cost: 4,
    isAward: true,
  },
  {
    action: "awardCochraneMedal",
    labelKey: "sta-officers-log.reputationSpend.awardCochraneMedal",
    descKey: "sta-officers-log.reputationSpend.awardCochraneMedalDesc",
    cost: 3,
    isAward: true,
  },
  {
    action: "awardGrankiteOrder",
    labelKey: "sta-officers-log.reputationSpend.awardGrankiteOrder",
    descKey: "sta-officers-log.reputationSpend.awardGrankiteOrderDesc",
    cost: 3,
    isAward: true,
  },
  {
    action: "awardKaragiteOrder",
    labelKey: "sta-officers-log.reputationSpend.awardKaragiteOrder",
    descKey: "sta-officers-log.reputationSpend.awardKaragiteOrderDesc",
    cost: 3,
    isAward: true,
  },
  {
    action: "awardLegionOfHonor",
    labelKey: "sta-officers-log.reputationSpend.awardLegionOfHonor",
    descKey: "sta-officers-log.reputationSpend.awardLegionOfHonorDesc",
    cost: 4,
    isAward: true,
  },
  {
    action: "awardPalmLeaf",
    labelKey: "sta-officers-log.reputationSpend.awardPalmLeaf",
    descKey: "sta-officers-log.reputationSpend.awardPalmLeafDesc",
    cost: 3,
    isAward: true,
  },
  {
    action: "awardStarCross",
    labelKey: "sta-officers-log.reputationSpend.awardStarCross",
    descKey: "sta-officers-log.reputationSpend.awardStarCrossDesc",
    cost: 3,
    isAward: true,
  },
  {
    action: "awardConspicuousGallantry",
    labelKey: "sta-officers-log.reputationSpend.awardConspicuousGallantry",
    descKey: "sta-officers-log.reputationSpend.awardConspicuousGallantryDesc",
    cost: 2,
    isAward: true,
  },
  {
    action: "awardDecorationGallantry",
    labelKey: "sta-officers-log.reputationSpend.awardDecorationGallantry",
    descKey: "sta-officers-log.reputationSpend.awardDecorationGallantryDesc",
    cost: 2,
    isAward: true,
  },
  {
    action: "awardMedalOfHonor",
    labelKey: "sta-officers-log.reputationSpend.awardMedalOfHonor",
    descKey: "sta-officers-log.reputationSpend.awardMedalOfHonorDesc",
    cost: 5,
    isAward: true,
  },
  {
    action: "awardSurgeonsDecoration",
    labelKey: "sta-officers-log.reputationSpend.awardSurgeonsDecoration",
    descKey: "sta-officers-log.reputationSpend.awardSurgeonsDecorationDesc",
    cost: 3,
    isAward: true,
  },
];

/**
 * STA 2e Reprimand Spending Options
 * From the Star Trek Adventures 2nd Edition Core Rulebook.
 */
const REPRIMAND_OPTIONS = [
  {
    action: "courtMartial",
    labelKey: "sta-officers-log.reputationSpend.reprimandCourtMartial",
    descKey: "sta-officers-log.reputationSpend.reprimandCourtMartialDesc",
    cost: 5,
  },
  {
    action: "demotion",
    labelKey: "sta-officers-log.reputationSpend.reprimandDemotion",
    descKey: "sta-officers-log.reputationSpend.reprimandDemotionDesc",
    cost: 3,
  },
  {
    action: "detention",
    labelKey: "sta-officers-log.reputationSpend.reprimandDetention",
    descKey: "sta-officers-log.reputationSpend.reprimandDetentionDesc",
    cost: 2,
  },
  {
    action: "gainAntipathy",
    labelKey: "sta-officers-log.reputationSpend.reprimandGainAntipathy",
    descKey: "sta-officers-log.reputationSpend.reprimandGainAntipathyDesc",
    cost: 1,
  },
  {
    action: "reduceReputation",
    labelKey: "sta-officers-log.reputationSpend.reprimandReduceReputation",
    descKey: "sta-officers-log.reputationSpend.reprimandReduceReputationDesc",
    cost: 0, // variable — handled in dialog
  },
  {
    action: "shameByAssociation",
    labelKey: "sta-officers-log.reputationSpend.reprimandShameByAssociation",
    descKey: "sta-officers-log.reputationSpend.reprimandShameByAssociationDesc",
    cost: 2,
  },
  {
    action: "status",
    labelKey: "sta-officers-log.reputationSpend.reprimandStatus",
    descKey: "sta-officers-log.reputationSpend.reprimandStatusDesc",
    cost: 3,
  },
  {
    action: "strippedOfAward",
    labelKey: "sta-officers-log.reputationSpend.reprimandStrippedOfAward",
    descKey: "sta-officers-log.reputationSpend.reprimandStrippedOfAwardDesc",
    cost: 1,
  },
];

/* ------------------------------------------------------------------ */
/*  Outcome detection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Parse the outcome text in a reputation-roll chat card to determine
 * the type (acclaim / reprimand / nochange) and amount gained.
 *
 * @param {HTMLElement} card - The `.sta.roll.chat.card` element.
 * @returns {{ type: "acclaim"|"reprimand"|"nochange", amount: number }}
 */
function _parseOutcome(card) {
  // v2.5.0+ uses .greytext for outcome; older versions used h4.dice-total
  const totalEl =
    card.querySelector(".greytext") ?? card.querySelector("h4.dice-total");
  if (!totalEl) return { type: "nochange", amount: 0 };

  const text = (totalEl.textContent ?? "").trim();

  // Match the localized text patterns.
  // "Gains {0} acclaim" or "Gains {0} reprimand"
  // We match against the localized strings by replacing {0} with a digit group.
  const PLACEHOLDER = "__DIGITS__";
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const acclaimTemplate = game.i18n.format("sta.roll.gainacclaim", {
    0: PLACEHOLDER,
  });
  const reprimandTemplate = game.i18n.format("sta.roll.gainreprimand", {
    0: PLACEHOLDER,
  });

  // Build regexes from the templates — escape the surrounding text so that
  // regex metacharacters in localized strings don't break the pattern.
  const buildRegex = (template) => {
    const idx = template.indexOf(PLACEHOLDER);
    if (idx < 0) return null;
    const before = escapeRegex(template.slice(0, idx));
    const after = escapeRegex(template.slice(idx + PLACEHOLDER.length));
    return new RegExp(`${before}(\\d+)${after}`, "i");
  };

  const acclaimRegex = buildRegex(acclaimTemplate);
  const reprimandRegex = buildRegex(reprimandTemplate);

  const acclaimMatch = acclaimRegex?.exec(text);
  if (acclaimMatch) {
    return { type: "acclaim", amount: parseInt(acclaimMatch[1], 10) || 0 };
  }

  const reprimandMatch = reprimandRegex?.exec(text);
  if (reprimandMatch) {
    return { type: "reprimand", amount: parseInt(reprimandMatch[1], 10) || 0 };
  }

  return { type: "nochange", amount: 0 };
}

/**
 * Resolve the Actor from a reputation-roll chat message.
 *
 * STA v2.5.0's STARoll.sendToChat() creates messages without an explicit
 * speaker, so message.speaker.actor may be unset.  We fall back to
 * matching the speakerName stored in the message flags, then to the
 * message author's assigned character.
 *
 * @param {ChatMessage} message - The chat message document.
 * @returns {Actor|null}
 */
function _resolveActor(message) {
  // 1. Explicit speaker.actor (set if the roll was created with ChatMessage.getSpeaker)
  const speakerActorId = message?.speaker?.actor;
  if (speakerActorId) {
    const actor = game.actors?.get?.(speakerActorId);
    if (actor) return actor;
  }

  // 2. Match by speakerName stored in flags (handles GM-on-behalf-of-player rolls)
  const speakerName = message?.flags?.sta?.speakerName;
  if (speakerName) {
    const actor = game.actors?.find?.(
      (a) => a.name === speakerName && a.type === "character",
    );
    if (actor) return actor;
  }

  // 3. The message author's assigned character
  const authorChar = message?.author?.character;
  if (authorChar) return authorChar;

  return null;
}

/* ------------------------------------------------------------------ */
/*  Spend dialog                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the HTML content for the spend dialog.
 *
 * @param {"acclaim"|"reprimand"} type
 * @param {number} rollAmount - Amount gained from the roll.
 * @param {number} savedAmount - Amount saved on the character sheet.
 * @param {number} totalBudget - Total available (roll + saved).
 * @param {Actor} actor - The actor spending reputation.
 * @returns {string}
 */
function _buildSpendContent(type, rollAmount, savedAmount, totalBudget, actor) {
  const isAcclaim = type === "acclaim";
  const options = isAcclaim
    ? [...ACCLAIM_OPTIONS, ...getCustomAcclaimOptions(), ...getCustomAwards()]
    : [...REPRIMAND_OPTIONS, ...getCustomReprimandOptions()];
  const headerKey = isAcclaim
    ? "sta-officers-log.reputationSpend.acclaimHeader"
    : "sta-officers-log.reputationSpend.reprimandHeader";

  const currentReputation = parseInt(actor.system?.reputation ?? 0, 10);
  const currentReprimand = parseInt(actor.system?.reprimand ?? 0, 10);

  // Compute the effective cost for each option.
  // "Increase Reputation" and "Reduce Reputation" have variable costs
  // based on the actor's current reputation.
  const effectiveCosts = {};
  for (const opt of options) {
    if (opt.action === "increaseReputation") {
      effectiveCosts[opt.action] = currentReputation + 1;
    } else if (opt.action === "reduceReputation") {
      effectiveCosts[opt.action] = currentReputation;
    } else {
      effectiveCosts[opt.action] = opt.cost;
    }
  }

  let rows = "";
  let awardHeaderInserted = false;
  let customHeaderInserted = false;
  for (const opt of options) {
    const effCost = effectiveCosts[opt.action];

    // Only show options the player can afford (base/minimum cost ≤ budget)
    if (effCost > totalBudget) continue;

    // Insert an "Awards" subheader before the first award option
    if (opt.isAward && !awardHeaderInserted) {
      awardHeaderInserted = true;
      const awardsHeaderText =
        t("sta-officers-log.reputationSpend.awardsHeader") || "Awards";
      rows += `<h4 class="sta-spend-subheader">${awardsHeaderText}</h4>`;
    }

    // Insert a "Custom" subheader before the first custom non-award option
    if (opt.isCustom && !opt.isAward && !customHeaderInserted) {
      customHeaderInserted = true;
      const customHeaderText =
        t("sta-officers-log.reputationSpend.customHeader") || "Custom";
      rows += `<h4 class="sta-spend-subheader">${customHeaderText}</h4>`;
    }

    const label = opt.isCustom ? opt.label : t(opt.labelKey) || opt.action;
    const desc = opt.isCustom ? opt.desc : t(opt.descKey) || "";
    const costLabel = t("sta-officers-log.reputationSpend.cost") || "Cost";
    // Variable-cost options show "1+" to hint at variability
    const isVariable =
      opt.action === "gainFavor" ||
      opt.action === "gainAntipathy" ||
      opt.action === "strippedOfAward";
    const costDisplay = isVariable ? `${effCost}+` : String(effCost);
    const variableInput = isVariable
      ? `<input type="number" class="sta-spend-variable-input" min="${effCost}" value="${effCost}" data-base-cost="${effCost}" />`
      : "";
    rows += `
      <div class="sta-spend-option" data-action="${opt.action}" data-cost="${effCost}"${isVariable ? ' data-variable="true"' : ""}>
        <label>
          <input type="checkbox" value="${opt.action}" />
          <span class="sta-spend-option-label">${label}</span>
          <span class="sta-spend-option-cost">(${costLabel}: ${costDisplay})</span>
          ${variableInput}
        </label>
        <p class="sta-spend-option-desc">${desc}</p>
      </div>`;
  }

  const headerText =
    t(headerKey) || (isAcclaim ? "Spend Acclaim" : "Spend Reprimands");
  const typeLabel = isAcclaim
    ? t("sta-officers-log.reputationSpend.acclaimLabel") || "Acclaim"
    : t("sta-officers-log.reputationSpend.reprimandLabel") || "Reprimands";
  const availableText =
    t("sta-officers-log.reputationSpend.available") || "Available";

  const statusClass = isAcclaim ? "sta-spend-acclaim" : "sta-spend-reprimand";

  const fromRollLabel =
    t("sta-officers-log.reputationSpend.fromRoll") || "From Roll";
  const savedLabel = t("sta-officers-log.reputationSpend.saved") || "Saved";

  return `
    <div class="sta-spend-dialog ${statusClass}">
      <div class="sta-spend-status">
        <span class="sta-spend-status-label">${typeLabel} ${availableText}:</span>
        <strong class="sta-spend-status-amount">${totalBudget}</strong>
        <span class="sta-spend-status-breakdown">(${fromRollLabel}: ${rollAmount}${savedAmount > 0 ? ` + ${savedLabel}: ${savedAmount}` : ""})</span>
      </div>
      <div class="sta-spend-current-stats">
        <span>${t("sta-officers-log.reputationSpend.currentReputation") || "Current Reputation"}: <strong>${currentReputation}</strong></span>
        <span>${t("sta-officers-log.reputationSpend.currentReprimands") || "Current Reprimands"}: <strong>${currentReprimand}</strong></span>
      </div>
      <h3>${headerText}</h3>
      <div class="sta-spend-options">
        ${rows}
      </div>
      <div class="sta-spend-adhoc-custom">
        <h4 class="sta-spend-subheader">${t("sta-officers-log.reputationSpend.adhocCustomHeader") || "Custom Entry"}</h4>
        <div class="sta-spend-adhoc-row">
          <label>
            <input type="checkbox" class="sta-spend-adhoc-cb" />
            <input type="text" class="sta-spend-adhoc-name" placeholder="${t("sta-officers-log.reputationSpend.adhocNamePlaceholder") || "Name"}" />
            <span class="sta-spend-option-cost">(${t("sta-officers-log.reputationSpend.cost") || "Cost"}:</span>
            <input type="number" class="sta-spend-adhoc-cost" min="0" value="1" /><span class="sta-spend-option-cost">)</span>
          </label>
        </div>
      </div>
      <div class="sta-spend-total">
        <span class="sta-spend-total-label">${t("sta-officers-log.reputationSpend.totalCost") || "Total Cost"}:</span>
        <span class="sta-spend-total-amount">0</span>
        <span class="sta-spend-total-separator">/</span>
        <span class="sta-spend-total-available">${totalBudget}</span>
      </div>
    </div>`;
}

/**
 * Open the spend dialog for acclaim or reprimands.
 *
 * @param {"acclaim"|"reprimand"} type
 * @param {number} amount - Amount gained from the roll.
 * @param {Actor} actor - The actor spending reputation.
 */
export async function openSpendDialog(type, amount, actor) {
  const isAcclaim = type === "acclaim";
  const titleKey = isAcclaim
    ? "sta-officers-log.reputationSpend.acclaimTitle"
    : "sta-officers-log.reputationSpend.reprimandTitle";
  const title =
    t(titleKey) || (isAcclaim ? "Spend Acclaim" : "Spend Reprimands");

  // Include any saved/accumulated acclaim or reprimands from the character sheet
  const savedAmount = isAcclaim
    ? parseInt(actor.system?.acclaim ?? 0, 10)
    : parseInt(actor.system?.reprimand ?? 0, 10);
  const totalBudget = amount + savedAmount;

  const content = _buildSpendContent(
    type,
    amount,
    savedAmount,
    totalBudget,
    actor,
  );

  const options = isAcclaim
    ? [...ACCLAIM_OPTIONS, ...getCustomAcclaimOptions(), ...getCustomAwards()]
    : [...REPRIMAND_OPTIONS, ...getCustomReprimandOptions()];

  const confirmLabel =
    t("sta-officers-log.reputationSpend.confirm") || "Confirm";

  const result = await foundry.applications.api.DialogV2.wait({
    classes: ["sta-officers-log"],
    window: {
      title,
      icon: isAcclaim ? "fa-solid fa-star" : "fa-solid fa-triangle-exclamation",
    },
    position: { width: 520 },
    content,
    render: (_event, dialog) => {
      const el = dialog.element;
      const confirmBtn = el.querySelector('button[data-action="confirm"]');
      if (confirmBtn) confirmBtn.disabled = true;

      const totalAmountEl = el.querySelector(".sta-spend-total-amount");
      const totalBar = el.querySelector(".sta-spend-total");

      const getEffectiveCost = (optEl) =>
        parseInt(optEl?.dataset?.cost ?? "999", 10);

      // --- Ad-hoc custom row elements ---
      const adhocCb = el.querySelector(".sta-spend-adhoc-cb");
      const adhocName = el.querySelector(".sta-spend-adhoc-name");
      const adhocCost = el.querySelector(".sta-spend-adhoc-cost");

      /** Recalculate total cost of all checked options and update UI. */
      const updateTotal = () => {
        let total = 0;
        for (const cb of el.querySelectorAll(
          '.sta-spend-option input[type="checkbox"]:checked',
        )) {
          const optEl = cb.closest(".sta-spend-option");
          total += getEffectiveCost(optEl);
        }
        // Include ad-hoc custom cost when checked
        if (adhocCb?.checked) {
          total += Math.max(0, parseInt(adhocCost?.value, 10) || 0);
        }
        if (totalAmountEl) totalAmountEl.textContent = String(total);
        if (totalBar) {
          totalBar.classList.toggle(
            "sta-spend-over-budget",
            total > totalBudget,
          );
        }
        if (confirmBtn) {
          confirmBtn.disabled = total === 0 || total > totalBudget;
        }
      };

      // Handle variable-cost number inputs updating data-cost
      for (const numInput of el.querySelectorAll(".sta-spend-variable-input")) {
        numInput.addEventListener("input", () => {
          const optEl = numInput.closest(".sta-spend-option");
          const baseCost = parseInt(numInput.dataset.baseCost ?? "1", 10);
          const val = Math.max(
            baseCost,
            parseInt(numInput.value, 10) || baseCost,
          );
          numInput.value = String(val);
          if (optEl) optEl.dataset.cost = String(val);
          updateTotal();
        });
      }

      // Listen for checkbox changes
      el.addEventListener("change", (ev) => {
        if (ev.target.type === "checkbox") updateTotal();
      });

      // Ad-hoc custom cost input updates total live
      if (adhocCost) {
        adhocCost.addEventListener("input", () => updateTotal());
      }
      // Auto-check the ad-hoc checkbox when the user types a name
      if (adhocName && adhocCb) {
        adhocName.addEventListener("input", () => {
          adhocCb.checked = adhocName.value.trim().length > 0;
          updateTotal();
        });
      }

      // All options shown are already filtered to be affordable,
      // but mark any that exceed the budget as unaffordable (edge case)
      for (const oEl of el.querySelectorAll(".sta-spend-option")) {
        oEl.classList.toggle(
          "sta-spend-unaffordable",
          getEffectiveCost(oEl) > totalBudget,
        );
      }
    },
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        icon: "fa-solid fa-check",
        default: true,
        callback: (_event, _button, dialog) => {
          const el = dialog.element;
          const selections = [];
          for (const cb of el.querySelectorAll(
            '.sta-spend-option input[type="checkbox"]:checked',
          )) {
            const optEl = cb.closest(".sta-spend-option");
            const effCost = parseInt(optEl?.dataset?.cost ?? "0", 10);
            selections.push({ action: cb.value, cost: effCost });
          }
          // Include ad-hoc custom entry if checked and has a name
          const adhocCbEl = el.querySelector(".sta-spend-adhoc-cb");
          const adhocNameEl = el.querySelector(".sta-spend-adhoc-name");
          const adhocCostEl = el.querySelector(".sta-spend-adhoc-cost");
          if (adhocCbEl?.checked) {
            const name = (adhocNameEl?.value ?? "").trim();
            const cost = Math.max(0, parseInt(adhocCostEl?.value, 10) || 0);
            if (name) {
              selections.push({ action: "adhocCustom", cost, label: name });
            }
          }
          return selections.length > 0 ? selections : null;
        },
      },
    ],
    close: () => null,
  });

  if (!result || !result.length) return;

  // Post the spending choices to chat
  const speaker = ChatMessage.getSpeaker({ actor });
  const typeLabel = isAcclaim
    ? t("sta-officers-log.reputationSpend.acclaimLabel") || "Acclaim"
    : t("sta-officers-log.reputationSpend.reprimandLabel") || "Reprimands";

  const totalCost = result.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const remaining = totalBudget - totalCost;

  // Build list items with option name, cost, and description
  const lines = result.map((r) => {
    // Ad-hoc custom entries carry their own label
    if (r.action === "adhocCustom") {
      return `<li><strong>${r.label}</strong> (${r.cost})</li>`;
    }
    const opt = options.find((o) => o.action === r.action);
    const lbl = opt
      ? opt.isCustom
        ? opt.label
        : t(opt.labelKey) || opt.action
      : r.action;
    const desc = opt ? (opt.isCustom ? opt.desc : t(opt.descKey) || "") : "";
    return `<li><strong>${lbl}</strong> (${r.cost})${desc ? `<br/><em>${desc}</em>` : ""}</li>`;
  });

  const spentVerb = t("sta-officers-log.reputationSpend.spent") || "spent";
  const remainingLabel =
    t("sta-officers-log.reputationSpend.remaining") || "Remaining";

  let remainingNote = "";
  if (isAcclaim) {
    // Unspent acclaim is wasted
    if (remaining > 0) {
      const wastedText =
        t("sta-officers-log.reputationSpend.acclaimWasted") ||
        "{amount} acclaim wasted.";
      remainingNote = `<p class="sta-spend-chat-remaining sta-spend-chat-wasted">${wastedText.replace("{amount}", String(remaining))}</p>`;
    }
  } else {
    // Unspent reprimands are saved to the character sheet
    if (remaining > 0) {
      const savedText =
        t("sta-officers-log.reputationSpend.reprimandSaved") ||
        "{amount} reprimands saved.";
      remainingNote = `<p class="sta-spend-chat-remaining sta-spend-chat-saved">${savedText.replace("{amount}", String(remaining))}</p>`;
      // Persist unspent reprimands to the actor.
      // `remaining` already accounts for the previously-saved amount
      // (totalBudget = rollAmount + savedAmount), so write it directly.
      await actor.update({ "system.reprimand": remaining });
    }
  }

  const manualNote =
    t("sta-officers-log.reputationSpend.manualNote") ||
    "(Changes must be applied manually)";

  const chatContent = `
    <div class="sta-spend-chat-result">
      <p><strong>${actor.name}</strong> ${spentVerb} ${totalCost} ${typeLabel}:</p>
      <ul>${lines.join("")}</ul>
      ${remainingNote}
      <p class="sta-spend-chat-manual">${manualNote}</p>
    </div>`;

  await ChatMessage.create({
    speaker,
    content: chatContent,
  });
}

/* ------------------------------------------------------------------ */
/*  GM Macro – Send spend dialog to a player                           */
/* ------------------------------------------------------------------ */

/**
 * GM-only macro: pick an online player, type (acclaim/reprimand),
 * and amount, then send a whispered chat message with a spend button.
 */
export async function promptGMSpendDialog() {
  if (!game.user.isGM) {
    ui.notifications?.warn(
      t("sta-officers-log.reputationSpend.gmOnly") ||
        "Only the GM can use this.",
    );
    return;
  }

  // Build list of online players with assigned characters
  const onlinePlayers = game.users.filter(
    (u) => u.active && !u.isGM && u.character,
  );
  if (!onlinePlayers.length) {
    ui.notifications?.warn(
      t("sta-officers-log.reputationSpend.noOnlinePlayers") ||
        "No online players with assigned characters.",
    );
    return;
  }

  const playerOptions = onlinePlayers
    .map(
      (u) => `<option value="${u.id}">${u.name} (${u.character.name})</option>`,
    )
    .join("");

  const dialogTitle =
    t("sta-officers-log.reputationSpend.gmDialogTitle") || "Send Spend Dialog";
  const playerLabel =
    t("sta-officers-log.reputationSpend.gmPlayerLabel") || "Player";
  const typeLabel = t("sta-officers-log.reputationSpend.gmTypeLabel") || "Type";
  const amountLabel =
    t("sta-officers-log.reputationSpend.gmAmountLabel") || "Amount";
  const acclaimLabel =
    t("sta-officers-log.reputationSpend.acclaimLabel") || "Acclaim";
  const reprimandLabel =
    t("sta-officers-log.reputationSpend.reprimandLabel") || "Reprimands";
  const sendLabel = t("sta-officers-log.reputationSpend.gmSendLabel") || "Send";

  const formContent = `
    <form class="sta-gm-spend-form">
      <div class="form-group">
        <label>${playerLabel}</label>
        <select name="playerId">${playerOptions}</select>
      </div>
      <div class="form-group">
        <label>${typeLabel}</label>
        <select name="spendType">
          <option value="acclaim">${acclaimLabel}</option>
          <option value="reprimand">${reprimandLabel}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${amountLabel}</label>
        <input type="number" name="spendAmount" min="1" value="1" />
      </div>
    </form>`;

  const result = await foundry.applications.api.DialogV2.wait({
    classes: ["sta-officers-log"],
    window: { title: dialogTitle, icon: "fa-solid fa-paper-plane" },
    position: { width: 360 },
    content: formContent,
    buttons: [
      {
        action: "send",
        label: sendLabel,
        icon: "fa-solid fa-paper-plane",
        default: true,
        callback: (_event, _button, dialog) => {
          const el = dialog.element;
          const playerId = el.querySelector('[name="playerId"]').value;
          const spendType = el.querySelector('[name="spendType"]').value;
          const spendAmount = parseInt(
            el.querySelector('[name="spendAmount"]').value ?? "1",
            10,
          );
          return { playerId, spendType, spendAmount };
        },
      },
    ],
    close: () => null,
  });

  if (!result) return;

  const targetUser = game.users.get(result.playerId);
  if (!targetUser?.character) {
    ui.notifications?.error(
      t("sta-officers-log.reputationSpend.noCharacter") ||
        "Player has no assigned character.",
    );
    return;
  }

  const actor = targetUser.character;
  const amount = Math.max(1, result.spendAmount || 1);
  const isAcclaim = result.spendType === "acclaim";

  const btnLabel = isAcclaim
    ? t("sta-officers-log.reputationSpend.spendAcclaimBtn") || "Spend Acclaim"
    : t("sta-officers-log.reputationSpend.spendReprimandBtn") ||
      "Spend Reprimands";
  const btnIcon = isAcclaim
    ? "fa-solid fa-star"
    : "fa-solid fa-triangle-exclamation";
  const btnClass = isAcclaim
    ? "sta-spend-btn sta-gm-spend-btn sta-spend-acclaim-btn"
    : "sta-spend-btn sta-gm-spend-btn sta-spend-reprimand-btn";
  const typeName = isAcclaim ? acclaimLabel : reprimandLabel;

  const gmSentLabel =
    t("sta-officers-log.reputationSpend.gmSentMessage") ||
    "The GM has assigned you {amount} {type} to spend.";
  const msgText = gmSentLabel
    .replace("{amount}", String(amount))
    .replace("{type}", typeName);

  const chatContent = `
    <div class="sta-gm-spend-message">
      <p>${msgText}</p>
      <div class="sta-spend-btn-container">
        <button type="button" class="${btnClass}"
          data-spend-type="${result.spendType}"
          data-spend-amount="${amount}"
          data-actor-id="${actor.id}">
          <i class="${btnIcon}"></i> ${btnLabel}
        </button>
      </div>
    </div>`;

  await ChatMessage.create({
    content: chatContent,
    whisper: [result.playerId],
    speaker: ChatMessage.getSpeaker({ alias: "GM" }),
  });

  ui.notifications?.info(
    (
      t("sta-officers-log.reputationSpend.spendSent") ||
      "{type} spend sent to {player}."
    )
      .replace("{type}", typeName)
      .replace("{player}", targetUser.name),
  );
}

/* ------------------------------------------------------------------ */
/*  GM Macro – Trigger acclaim survey for all online players           */
/* ------------------------------------------------------------------ */

/**
 * GM-only macro: opens the acclaim survey dialog for every online
 * player who has an assigned character, as if they clicked
 * "Roll Reputation" on their sheet.
 */
export async function triggerAllPlayersAcclaimSurvey() {
  if (!game.user.isGM) {
    ui.notifications?.warn(
      t("sta-officers-log.reputationSpend.gmOnly") ||
        "Only the GM can use this.",
    );
    return;
  }

  const { getModuleSocket } = await import("../core/socket.js");
  const sock = getModuleSocket();
  if (!sock) {
    ui.notifications?.error(
      t("sta-officers-log.errors.socketLibRequired") ||
        "SocketLib is required.",
    );
    return;
  }

  const onlinePlayers = game.users.filter(
    (u) => u.active && !u.isGM && u.character,
  );
  if (!onlinePlayers.length) {
    ui.notifications?.warn(
      t("sta-officers-log.reputationSpend.noOnlinePlayers") ||
        "No online players with assigned characters.",
    );
    return;
  }

  // Build the player list for the GM monitor
  const playerList = onlinePlayers.map((u) => ({
    userId: u.id,
    playerName: u.name,
    actorName: u.character?.name ?? "—",
  }));

  // Open the GM monitoring dialog FIRST so it's ready for live updates
  const { showGMSurveyMonitor } = await import("./gmSurveyMonitor.js");
  // Don't await — let it stay open while players work
  showGMSurveyMonitor(playerList);

  // Fire survey requests without awaiting each player's dialog result.
  // executeAsUser returns a promise that resolves when the remote handler
  // finishes (i.e. when the player closes/submits). We intentionally don't
  // await those so the GM monitor opens immediately.
  let sent = 0;
  for (const user of onlinePlayers) {
    try {
      sock.executeAsUser("showAcclaimSurvey", user.id, {
        actorId: user.character.id,
      });
      sent++;
    } catch (err) {
      console.error(
        `${MODULE_ID} | failed to send acclaim survey to ${user.name}`,
        err,
      );
    }
  }

  const sentMsg =
    t("sta-officers-log.reputationSpend.surveySent") ||
    "Acclaim survey sent to {count} player(s).";
  ui.notifications?.info(sentMsg.replace("{count}", String(sent)));
}

/* ------------------------------------------------------------------ */

/**
 * Install the renderChatMessageHTML hook that adds spend buttons
 * to reputation roll results.
 */
export function installReputationSpendHook() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html;
    if (!root) return;

    // ---- Handle GM-sent spend buttons embedded in chat messages ----
    const gmBtn = root.querySelector(".sta-gm-spend-btn");
    if (gmBtn && gmBtn.dataset.staWired !== "1") {
      gmBtn.dataset.staWired = "1";
      gmBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const spendType = gmBtn.dataset.spendType;
        const spendAmount = parseInt(gmBtn.dataset.spendAmount ?? "0", 10);
        const actorId = gmBtn.dataset.actorId;
        const actor = game.actors?.get?.(actorId);
        if (!actor) {
          ui.notifications?.error("Actor not found.");
          return;
        }
        await openSpendDialog(spendType, spendAmount, actor);
      });
    }

    // Only process reputation roll buttons if acclaim survey is enabled
    if (!isAcclaimSurveyEnabled()) return;

    // Find the STA reputation roll card (v2.5.0+ uses .chatcard, older uses .sta.roll.chat.card)
    const card =
      root.querySelector(".chatcard") ||
      root.querySelector(".sta.roll.chat.card");
    if (!card) return;

    // Identify reputation rolls: prefer flags (v2.5.0+), fall back to DOM
    const isReputationRoll =
      message.flags?.sta?.rollType === "acclaim" ||
      !!card.querySelector(".flavor.acclaim");
    if (!isReputationRoll) return;

    // Parse outcome
    const outcome = _parseOutcome(card);
    if (outcome.type === "nochange" || outcome.amount <= 0) return;

    // Don't add buttons twice
    if (card.querySelector(".sta-spend-btn")) return;

    // Resolve the actor
    const actor = _resolveActor(message);
    if (!actor) return;

    // Only show spend buttons to the user who rolled or the GM
    if (!message.isAuthor && !game.user.isGM) return;

    const isAcclaim = outcome.type === "acclaim";
    const btnLabel = isAcclaim
      ? t("sta-officers-log.reputationSpend.spendAcclaimBtn") || "Spend Acclaim"
      : t("sta-officers-log.reputationSpend.spendReprimandBtn") ||
        "Spend Reprimands";
    const btnIcon = isAcclaim
      ? "fa-solid fa-star"
      : "fa-solid fa-triangle-exclamation";
    const btnClass = isAcclaim
      ? "sta-spend-btn sta-spend-acclaim-btn"
      : "sta-spend-btn sta-spend-reprimand-btn";

    const btnContainer = document.createElement("div");
    btnContainer.className = "sta-spend-btn-container";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = btnClass;
    btn.innerHTML = `<i class="${btnIcon}"></i> ${btnLabel}`;

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await openSpendDialog(outcome.type, outcome.amount, actor);
    });

    btnContainer.appendChild(btn);
    card.appendChild(btnContainer);
  });
}
