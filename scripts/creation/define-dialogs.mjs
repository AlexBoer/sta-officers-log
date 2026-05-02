/**
 * Define Dialogs
 *
 * Small dialogs for players to define individual character elements
 * (Values, Departments, Focuses, Talents, Pastime) during play.
 * Each dialog is lightweight — just enough to create the relevant actor data.
 *
 * @module creation/defineDialogs
 */

import { MODULE_ID } from "../core/constants.js";
import { DISCIPLINE_KEYS, DISCIPLINE_LABELS } from "./creation-wizard-data.mjs";

const DV2 = () => foundry.applications.api.DialogV2;

// ── Define Value ──────────────────────────────────────────────────────────────

/**
 * Open a dialog to define a new Value for the character.
 * Creates a Value item on the actor.
 *
 * @param {Actor} actor
 */
export async function openDefineValueDialog(actor) {
  const result = await DV2().wait({
    classes: ["sta-officers-log"],
    window: { title: "Define a Value" },
    content: `
      <p style="margin-bottom:0.75rem;font-style:italic;opacity:0.8;">
        Choose a value applicable to the current task. You gain 1 Determination immediately,
        which may be used with this value.
      </p>
      <div class="form-group">
        <label>Value</label>
        <div class="form-fields">
          <input type="text" name="value" placeholder="e.g. Duty Above All Else" autofocus />
        </div>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: "Confirm",
        icon: "fa-solid fa-check",
        default: true,
        callback: (_ev, button) =>
          button.form?.elements?.value?.value?.trim() ?? "",
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fa-solid fa-xmark",
        callback: () => null,
      },
    ],
    rejectClose: false,
  });

  if (!result) return;

  await actor.createEmbeddedDocuments("Item", [
    { type: "value", name: result, system: { description: "" } },
  ]);
  ui.notifications.info(`Value defined: "${result}"`);
}

// ── Define Department ─────────────────────────────────────────────────────────

/**
 * Open a dialog to define a Department rating for the character.
 *
 * @param {Actor} actor
 * @param {object} cipFlag  The current creationInPlay flag value.
 */
export async function openDefineDepartmentDialog(actor, cipFlag) {
  const remainingRatings = [...(cipFlag.remainingDeptRatings ?? [3, 2, 2, 1])];
  if (remainingRatings.length === 0) {
    ui.notifications.warn("No remaining department ratings available.");
    return;
  }

  const disciplines = actor.system?.disciplines ?? {};
  const undefinedDepts = DISCIPLINE_KEYS.filter(
    (k) => (disciplines[k]?.value ?? 0) === 0,
  );

  if (undefinedDepts.length === 0) {
    ui.notifications.info("All departments have already been defined.");
    return;
  }

  const deptOptions = undefinedDepts
    .map((k) => `<option value="${k}">${DISCIPLINE_LABELS[k] ?? k}</option>`)
    .join("");
  const ratingOptions = remainingRatings
    .map((r) => `<option value="${r}">${r}</option>`)
    .join("");

  const result = await DV2().wait({
    classes: ["sta-officers-log"],
    window: { title: "Define a Department" },
    content: `
      <p style="margin-bottom:0.75rem;font-style:italic;opacity:0.8;">
        Choose which department to define and assign one of the remaining ratings.
        Remaining: <strong>${remainingRatings.join(", ")}</strong>
      </p>
      <div class="form-group">
        <label>Department</label>
        <div class="form-fields">
          <select name="dept">${deptOptions}</select>
        </div>
      </div>
      <div class="form-group">
        <label>Rating</label>
        <div class="form-fields">
          <select name="rating">${ratingOptions}</select>
        </div>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: "Confirm",
        icon: "fa-solid fa-check",
        default: true,
        callback: (_ev, button) => ({
          dept: button.form?.elements?.dept?.value ?? "",
          rating: parseInt(button.form?.elements?.rating?.value ?? "0", 10),
        }),
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fa-solid fa-xmark",
        callback: () => null,
      },
    ],
    rejectClose: false,
  });

  if (!result) return;

  const { dept, rating } = result;
  if (!dept || !rating) return;

  await actor.update({ [`system.disciplines.${dept}.value`]: rating });

  const newRatings = [...remainingRatings];
  const idx = newRatings.indexOf(rating);
  if (idx !== -1) newRatings.splice(idx, 1);

  await actor.setFlag(MODULE_ID, "creationInPlay", {
    ...cipFlag,
    remainingDeptRatings: newRatings,
  });

  ui.notifications.info(
    `${DISCIPLINE_LABELS[dept] ?? dept} defined as ${rating}.`,
  );
}

// ── Define Focus ──────────────────────────────────────────────────────────────

/**
 * Open the focus picker to define a new Focus for the character.
 * Uses the same picker as milestone benefits.
 *
 * @param {Actor} actor
 */
export async function openDefineFocusDialog(actor) {
  const { promptFocusChoiceFromCompendium } =
    await import("../milestones/focusPickerDialog.js");

  const chosen = await promptFocusChoiceFromCompendium();
  if (!chosen) return;

  if (chosen.custom === true) {
    // Open a blank focus item sheet for the player to fill in.
    const [created] = await actor.createEmbeddedDocuments("Item", [
      { type: "focus", name: "New Focus", system: { description: "" } },
    ]);
    try {
      created?.sheet?.render?.(true);
    } catch (_) {
      // ignore
    }
    return;
  }

  const focusData = chosen.item
    ? { ...foundry.utils.deepClone(chosen.item), _id: undefined }
    : {
        type: "focus",
        name: chosen.name ?? "New Focus",
        system: { description: "" },
      };
  focusData.type = focusData.type ?? "focus";
  focusData.name = chosen.name ?? focusData.name;
  focusData.img = chosen.img ?? focusData.img ?? null;

  await actor.createEmbeddedDocuments("Item", [focusData]);
  ui.notifications.info(`Focus defined: "${focusData.name}"`);
}

// ── Define Talent ─────────────────────────────────────────────────────────────

/**
 * Open the talent picker to define a new Talent for the character.
 * Uses the same picker as milestone benefits.
 *
 * @param {Actor} actor
 */
export async function openDefineTalentDialog(actor) {
  const { promptTalentChoiceFromCompendium } =
    await import("../milestones/talentPickerDialog.js");

  const chosen = await promptTalentChoiceFromCompendium({ actor });
  if (!chosen) return;

  if (chosen.custom === true) {
    const [created] = await actor.createEmbeddedDocuments("Item", [
      { type: "talent", name: "New Talent", system: { description: "" } },
    ]);
    try {
      created?.sheet?.render?.(true);
    } catch (_) {
      // ignore
    }
    return;
  }

  const talentData = chosen.item
    ? { ...foundry.utils.deepClone(chosen.item), _id: undefined }
    : {
        type: "talent",
        name: chosen.name ?? "New Talent",
        system: { description: "" },
      };
  talentData.type = talentData.type ?? "talent";
  talentData.name = chosen.name ?? talentData.name;
  talentData.img = chosen.img ?? talentData.img ?? null;

  await actor.createEmbeddedDocuments("Item", [talentData]);
  ui.notifications.info(`Talent defined: "${talentData.name}"`);
}

// ── Define Pastime ────────────────────────────────────────────────────────────

/**
 * Open a dialog to define a Pastime for the character.
 *
 * @param {Actor} actor
 */
export async function openDefinePastimeDialog(actor) {
  const existing = actor.system?.pastimes ?? "";

  const result = await DV2().wait({
    classes: ["sta-officers-log"],
    window: { title: "Define a Pastime" },
    content: `
      <p style="margin-bottom:0.75rem;font-style:italic;opacity:0.8;">
        Pastimes reflect what the character does in their off-duty hours.
        See page 133 for more information.
      </p>
      <div class="form-group">
        <label>Pastime</label>
        <div class="form-fields">
          <textarea name="pastime" rows="3"
            placeholder="e.g. Playing the Vulcan lute…" autofocus
            style="width:100%;box-sizing:border-box;"
          >${existing}</textarea>
        </div>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: "Save",
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (_ev, button) =>
          button.form?.elements?.pastime?.value?.trim() ?? "",
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fa-solid fa-xmark",
        callback: () => null,
      },
    ],
    rejectClose: false,
  });

  if (result === null || result === undefined) return;

  await actor.update({ "system.pastimes": result });
  ui.notifications.info("Pastime updated.");
}
