/**
 * OfficersLogSheet — Custom item sheet for sta-officers-log "log" items.
 *
 * Registered as an opt-in alternative to the system's STALogSheet via:
 *   DocumentSheetConfig.registerSheet(Item, MODULE_ID, OfficersLogSheet, { types:['log'], makeDefault:false })
 *
 * Design goals:
 *  - Surface all Officers-Log data (callback links, arc info, directives, log options)
 *    in one consolidated sheet instead of injecting into the system sheet.
 *  - Mirror the value-state table interaction from the system's STALogSheet.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { getValueStateArray } from "../values/values.js";
import {
  DIRECTIVE_VALUE_ID_PREFIX,
  getDirectiveKeyFromValueId,
  makeDirectiveKeyFromText,
  makeDirectiveValueIdFromText,
  getMissionDirectives,
} from "../directives/directives.js";
import { areTraumaRulesEnabled } from "../settings/clientSettings.js";
import { wasLogCreatedWithTrauma } from "../values/trauma/trauma.js";
import {
  openNewMilestoneArcDialog,
  createStandaloneMilestoneItem,
} from "../milestones/newMilestoneArcDialog.js";

const { api, sheets } = foundry.applications;

export class OfficersLogSheet extends api.HandlebarsApplicationMixin(
  sheets.ItemSheetV2,
) {
  /** Tracks whether the Chain & Arc <details> is open — persists across re-renders */
  #chainSectionOpen = false;

  static PARTS = {
    itemsheet: {
      template: `modules/${MODULE_ID}/templates/officers-log-sheet.hbs`,
    },
  };

  static DEFAULT_OPTIONS = {
    classes: ["sta-officers-log", "officers-log-sheet"],
    actions: {
      onRemoveDirective: OfficersLogSheet._onRemoveDirective,
      onAddDirective: OfficersLogSheet._onAddDirective,
      onOpenLinkedLog: OfficersLogSheet._onOpenLinkedLog,
      onOpenMilestone: OfficersLogSheet._onOpenMilestone,
      onChooseMilestone: OfficersLogSheet._onChooseMilestone,
      onLogOptions: OfficersLogSheet._onLogOptions,
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    position: {
      height: "auto",
      width: 500,
    },
    window: {
      resizable: true,
    },
  };

  get title() {
    return `${this.item.name} — Log`;
  }

  // ── Context ─────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = item.actor;

    // ── Actor values ───────────────────────────────────────────────────────────
    const allActorValues = actor
      ? actor.items.filter((i) => i.type === "value")
      : [];
    const primaryValueId = item.system.primaryValueId ?? "";

    const actorValues = allActorValues.map((v) => {
      const states = getValueStateArray(item, v.id);
      return {
        id: v.id,
        name: v.name ?? "",
        isUnused: states.includes("unused"),
        isPositive: states.includes("positive"),
        isNegative: states.includes("negative"),
        isChallenged: states.includes("challenged"),
        isPrimary: v.id === primaryValueId,
      };
    });

    // ── Directive rows ─────────────────────────────────────────────────────────
    const directiveLabels = item.system.directiveLabels ?? {};

    const directiveRows = Object.entries(directiveLabels).map(([key, text]) => {
      const valueId = `${DIRECTIVE_VALUE_ID_PREFIX}${key}`;
      const states = getValueStateArray(item, valueId);
      return {
        key,
        valueId,
        text: String(text ?? ""),
        isUnused: states.includes("unused"),
        isPositive: states.includes("positive"),
        isNegative: states.includes("negative"),
        isChallenged: states.includes("challenged"),
        isPrimary: valueId === primaryValueId,
      };
    });

    // ── Callback / chain info ──────────────────────────────────────────────────
    const callbackLink = item.system.callbackLink;
    const selectedCallbackLogId = callbackLink?.fromLogId ?? "";
    const hasCallbackLink = Boolean(selectedCallbackLogId);

    const allLogs = actor
      ? actor.items.filter((i) => i.type === "log" && i.id !== item.id)
      : [];

    const callsBackToLog = selectedCallbackLogId
      ? allLogs.find((l) => l.id === selectedCallbackLogId)
      : null;
    const callsBackToName =
      callsBackToLog?.name ?? t("sta-officers-log.logSheet.unknownLog");

    // The log that calls back to this one (inbound callback)
    const calledBackByLog = actor
      ? actor.items.find(
          (i) =>
            i.type === "log" &&
            i.id !== item.id &&
            i.system?.callbackLink?.fromLogId === item.id,
        )
      : null;

    // Sorted log options for the "Calls back to" dropdown
    const callbackLogOptions = allLogs.map((l) => ({
      id: l.id,
      name: l.name ?? "",
      selected: l.id === selectedCallbackLogId,
    }));

    // ── Chain value options ────────────────────────────────────────────────────
    const chainValueOptions = [
      ...allActorValues.map((v) => ({
        id: v.id,
        name: v.name ?? "",
        selected: v.id === primaryValueId,
        isDirective: false,
      })),
      ...directiveRows.map((d) => ({
        id: d.valueId,
        name: d.text,
        selected: d.valueId === primaryValueId,
        isDirective: true,
      })),
    ];

    // ── Arc / milestone info ───────────────────────────────────────────────────
    const arcInfo = item.system.arcInfo;
    const arcIsComplete = arcInfo?.isArc === true;

    // Default arc steps: use saved value, or derive from existing arcs on the actor.
    let arcSteps;
    if (
      Number.isFinite(Number(arcInfo?.steps)) &&
      Number(arcInfo?.steps) >= 1
    ) {
      arcSteps = Number(arcInfo.steps);
    } else {
      const existingSteps = actor
        ? actor.items
            .filter(
              (i) =>
                i.type === "log" &&
                i.id !== item.id &&
                i.system?.arcInfo?.isArc === true,
            )
            .map((i) => Number(i.system.arcInfo.steps) || 0)
        : [];
      const max = existingSteps.length ? Math.max(...existingSteps) : 0;
      arcSteps = max >= 1 ? max + 1 : 3;
    }
    const selectedMilestoneId = callbackLink?.milestoneId ?? "";
    const milestoneIsSet = Boolean(selectedMilestoneId);

    const allMilestones = actor
      ? actor.items.filter((i) => i.type === "milestone")
      : [];
    const milestoneOptions = allMilestones.map((m) => ({
      id: m.id,
      name: m.name ?? "",
      selected: m.id === selectedMilestoneId,
    }));

    // ── Stardate ───────────────────────────────────────────────────────────────
    const stardate = _formatStardate(item);

    // ── Enriched description ───────────────────────────────────────────────────
    let enrichedNotes = "";
    try {
      enrichedNotes =
        (await TextEditor?.enrichHTML?.(item.system?.description ?? "", {
          relativeTo: item,
          secrets: item.isOwner,
        })) ?? "";
    } catch (_) {
      enrichedNotes = item.system?.description ?? "";
    }

    // ── Log options ────────────────────────────────────────────────────────────
    const showTraumaCheckbox = areTraumaRulesEnabled();
    const createdWithTrauma = showTraumaCheckbox
      ? wasLogCreatedWithTrauma(item)
      : false;

    return {
      ...context,
      item,
      actorValues,
      directiveRows,
      primaryValueId,
      hasCallbackLink,
      selectedCallbackLogId,
      callsBackToName,
      calledBackByLog: calledBackByLog
        ? { id: calledBackByLog.id, name: calledBackByLog.name ?? "" }
        : null,
      callbackLogOptions,
      chainValueOptions,
      arcIsComplete,
      arcSteps,
      selectedMilestoneId,
      milestoneIsSet,
      milestoneOptions,
      stardate,
      enrichedNotes,
      showTraumaCheckbox,
      createdWithTrauma,
      showMilestoneArcButton: item.system.showMilestoneArcButton === true,
      customDate: item.system.customDate ?? "",
    };
  }

  // ── Form submit — strip custom ol-* fields before update ──────────────────

  async _processSubmitData(event, form, formData) {
    const data = await super._processSubmitData(event, form, formData);
    // super may return null if the sheet is being torn down during re-render
    if (!data) return data;
    // Strip custom ol-* fields we handle via dedicated change listeners
    for (const key of Object.keys(data)) {
      if (key.startsWith("ol-")) delete data[key];
    }
    return data;
  }

  // ── Render lifecycle ───────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender(context, options);
    this.#attachCustomListeners();

    // Restore open state and reflow on toggle
    const details = this.element?.querySelector(".ol-chain-section");
    if (details) {
      if (this.#chainSectionOpen) details.open = true;
      details.addEventListener("toggle", () => {
        this.#chainSectionOpen = details.open;
        this.setPosition({ height: "auto" });
      });
    }
  }

  #attachCustomListeners() {
    const el = this.element;
    if (!el) return;

    // Value state checkboxes (data-value-id + data-state, no name attr)
    el.querySelectorAll(".ol-value-state-cb").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        e.stopPropagation(); // prevent submitOnChange
        this.#handleValueStateChange(
          cb.dataset.valueId,
          cb.dataset.state,
          cb.checked,
        );
      });
    });

    // Primary value radio buttons (data-value-id, no name attr)
    el.querySelectorAll(".ol-primary-radio").forEach((radio) => {
      radio.addEventListener("change", (e) => {
        e.stopPropagation();
        if (radio.checked) {
          this.item.update({
            "system.primaryValueId": radio.dataset.valueId ?? "",
          });
        }
      });
    });

    // Callback-from select
    const cbSelect = el.querySelector("[name='ol-callback-from']");
    cbSelect?.addEventListener("change", (e) => {
      e.stopPropagation();
      this.#handleCallbackFromChange(cbSelect.value);
    });

    // Arc complete checkbox
    const arcCb = el.querySelector("[name='ol-arc-complete']");
    arcCb?.addEventListener("change", (e) => {
      e.stopPropagation();
      this.#handleArcCompleteChange(arcCb.checked);
    });

    // Arc steps input
    const arcStepsInput = el.querySelector("[name='ol-arc-steps']");
    arcStepsInput?.addEventListener("change", (e) => {
      e.stopPropagation();
      const v = parseInt(arcStepsInput.value, 10);
      if (Number.isFinite(v) && v >= 1) this.#handleArcStepsChange(v);
    });

    // Chain value select
    const cvSelect = el.querySelector("[name='ol-chain-value']");
    cvSelect?.addEventListener("change", (e) => {
      e.stopPropagation();
      this.item.update({ "system.primaryValueId": cvSelect.value ?? "" });
    });

    // Milestone select
    const msSelect = el.querySelector("[name='ol-milestone']");
    msSelect?.addEventListener("change", (e) => {
      e.stopPropagation();
      this.#handleMilestoneChange(msSelect.value);
    });
  }

  // ── Change handlers ───────────────────────────────────────────────────────

  async #handleValueStateChange(valueId, state, checked) {
    if (!valueId || !state) return;
    const current = getValueStateArray(this.item, valueId);

    let next;
    if (state === "unused") {
      next = ["unused"];
    } else if (checked) {
      next = current.filter((s) => s !== "unused");
      if (!next.includes(state)) next.push(state);
      if (!next.length) next = [state];
    } else {
      next = current.filter((s) => s !== state);
      if (!next.length) next = ["unused"];
    }

    await this.item.update({ [`system.valueStates.${valueId}`]: next });
  }

  async #handleCallbackFromChange(fromLogId) {
    const existing = this.item.system.callbackLink ?? {};
    if (fromLogId) {
      await this.item.update({
        "system.callbackLink": { ...existing, fromLogId },
        "system.callbackLinkDisabled": false,
      });
    } else {
      await this.item.update({
        "system.callbackLink": null,
        "system.callbackLinkDisabled": true,
      });
    }
  }

  async #handleArcCompleteChange(isArc) {
    // Completing an arc requires a chain value — otherwise the hook will silently revert it.
    // Catch the attempt early and show a clear error instead.
    if (isArc) {
      const sys = this.item.system;
      const hasChainValue =
        sys.arcInfo?.valueId || sys.primaryValueId || sys.callbackLink?.valueId;
      if (!hasChainValue) {
        ui.notifications?.warn(
          t("sta-officers-log.logSheet.arcCompleteNeedsChain") ??
            "A chain value (primary value) must be set before marking an arc as complete.",
        );
        // Revert the checkbox in the DOM without saving
        const cb = this.element?.querySelector("[name='ol-arc-complete']");
        if (cb) cb.checked = false;
        return;
      }
    }
    const existing = this.item.system.arcInfo ?? {};
    const steps =
      Number.isFinite(Number(existing.steps)) && Number(existing.steps) >= 1
        ? Number(existing.steps)
        : this.#defaultArcSteps();
    await this.item.update({
      "system.arcInfo": { ...existing, isArc: Boolean(isArc), steps },
    });
  }

  /** Compute the default arc steps: longest existing arc + 1, or 3. */
  #defaultArcSteps() {
    const actor = this.item.actor;
    if (!actor) return 3;
    const existingSteps = actor.items
      .filter(
        (i) =>
          i.type === "log" &&
          i.id !== this.item.id &&
          i.system?.arcInfo?.isArc === true,
      )
      .map((i) => Number(i.system.arcInfo.steps) || 0);
    const max = existingSteps.length ? Math.max(...existingSteps) : 0;
    return max >= 1 ? max + 1 : 3;
  }

  async #handleArcStepsChange(steps) {
    const existing = this.item.system.arcInfo ?? {};
    await this.item.update({
      "system.arcInfo": { ...existing, steps: Number(steps) },
    });
  }

  async #handleMilestoneChange(milestoneId) {
    const existing = this.item.system.callbackLink ?? {};
    await this.item.update({
      "system.callbackLink": {
        ...existing,
        milestoneId: milestoneId || null,
      },
    });
  }

  // ── Static action handlers ────────────────────────────────────────────────

  /** Remove a directive row from this log. */
  static async _onRemoveDirective(event, target) {
    const valueId = target.dataset.valueId;
    if (!valueId) return;
    const key = getDirectiveKeyFromValueId(valueId);
    // Use Foundry's "-=key" deletion syntax so mergeObject actually removes the
    // entry instead of leaving the old key in place via recursive merge.
    const updates = { [`system.directiveLabels.-=${key}`]: true };
    if (this.item.system.primaryDirectiveKey === key) {
      updates["system.primaryDirectiveKey"] = "";
    }
    await this.item.update(updates);
  }

  /** Add a directive from the mission directive list. */
  static async _onAddDirective(event, target) {
    const item = this.item;
    const missionDirectives = getMissionDirectives();

    if (!missionDirectives.length) {
      ui.notifications?.warn?.(
        t("sta-officers-log.directives.noMissionDirectives") ??
          "No mission directives are set. Configure them in module settings.",
      );
      return;
    }

    const existingLabels = item.system.directiveLabels ?? {};
    const existingKeys = new Set(Object.keys(existingLabels));

    const options = missionDirectives
      .map((text) => {
        const key = makeDirectiveKeyFromText(text);
        const already = existingKeys.has(key);
        return `<option value="${key}"${already ? " disabled" : ""}>${already ? `${text} (already added)` : text}</option>`;
      })
      .join("");

    const pickedKey = await foundry.applications.api.DialogV2.prompt({
      classes: ["sta-officers-log"],
      window: {
        title:
          t("sta-officers-log.directives.addDirectiveTitle") ?? "Add Directive",
      },
      content: `
        <div class="form-group">
          <label>${t("sta-officers-log.directives.pickDirective") ?? "Choose a directive:"}</label>
          <select name="directiveKey">
            <option value="">— ${t("sta-officers-log.directives.selectOne") ?? "Select"} —</option>
            ${options}
          </select>
        </div>
      `,
      ok: {
        label: t("sta-officers-log.directives.addDirective") ?? "Add",
        callback: (_event, button) =>
          button.form?.elements?.directiveKey?.value ?? "",
      },
      rejectClose: false,
    });

    if (!pickedKey) return;

    const pickedText = missionDirectives.find(
      (d) => makeDirectiveKeyFromText(d) === pickedKey,
    );
    if (!pickedText) return;

    const newLabels = { ...existingLabels, [pickedKey]: pickedText };
    const updates = { "system.directiveLabels": newLabels };
    if (!item.system.primaryDirectiveKey) {
      updates["system.primaryDirectiveKey"] = pickedKey;
    }
    await item.update(updates);
  }

  /** Open a linked log's sheet. */
  static async _onOpenLinkedLog(event, target) {
    const logId = target.dataset.logId;
    if (!logId) return;
    const log = this.item.actor?.items?.get(logId);
    if (!log) return;
    log.sheet?.render?.(true);
    log.sheet?.bringToFront?.();
  }

  /** Open the linked milestone's sheet. */
  static async _onOpenMilestone(event, target) {
    const milestoneId = this.item.system.callbackLink?.milestoneId;
    if (!milestoneId) return;
    const milestone = this.item.actor?.items?.get(milestoneId);
    if (!milestone) return;
    milestone.sheet?.render?.(true);
    milestone.sheet?.bringToFront?.();
  }

  /** Open the new milestone/arc dialog for this log's actor. */
  static async _onChooseMilestone(event, target) {
    const item = this.item;
    const actor = item.actor;
    if (!actor) return;
    openNewMilestoneArcDialog(actor, {
      onApplied: async ({ applied, label, isArc }) => {
        const milestone = await createStandaloneMilestoneItem(actor, {
          name: label || (isArc ? "Custom Arc" : "Custom Milestone"),
          applied,
          isArc,
        });
        if (!milestone) return;
        const existing = item.system.callbackLink ?? {};
        await item.update({
          "system.callbackLink": { ...existing, milestoneId: milestone.id },
        });
      },
    });
  }

  /** Open the log options dialog (trauma, showMilestoneArcButton, customDate, customIrlDate). */
  static async _onLogOptions(event, target) {
    const item = this.item;
    const showTrauma = areTraumaRulesEnabled();
    const createdWithTrauma = showTrauma
      ? wasLogCreatedWithTrauma(item)
      : false;
    const showMilestoneArcButton = item.system.showMilestoneArcButton === true;
    const customDate = item.system.customDate ?? "";
    const customIrlDate = item.system.customIrlDate ?? "";
    // Pre-fill date input only if stored value is ISO format; ignore legacy stardates
    const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(customDate) ? customDate : "";
    const isoIrlDate = /^\d{4}-\d{2}-\d{2}$/.test(customIrlDate)
      ? customIrlDate
      : "";
    const initialStardate = isoDate
      ? _stardateFromDate(new Date(isoDate + "T12:00:00"))
      : "";

    const traumaRow = showTrauma
      ? `<div class="form-group">
           <label class="checkbox">
             <input type="checkbox" name="createdWithTrauma"${createdWithTrauma ? " checked" : ""}>
             ${t("sta-officers-log.logSheet.createdWithTraumaLabel")}
           </label>
         </div>`
      : "";

    const result = await foundry.applications.api.DialogV2.prompt({
      classes: ["sta-officers-log"],
      window: {
        title: t("sta-officers-log.logSheet.logOptions") ?? "Log Options",
      },
      content: `
        ${traumaRow}
        <div class="form-group">
          <label class="checkbox">
            <input type="checkbox" name="showMilestoneArcButton"${showMilestoneArcButton ? " checked" : ""}>
            ${t("sta-officers-log.logSheet.showMilestoneArcButton") ?? "Show Milestone/Arc Button"}
          </label>
        </div>
        <div class="form-group">
          <label>${t("sta-officers-log.logSheet.customDate") ?? "In-Game Date"}</label>
          <input type="date" name="customDate" value="${isoDate}"
            oninput="const d=new Date(this.value+'T12:00:00');const y=d.getFullYear();const s=new Date(y,0,0);const day=Math.floor((d-s)/86400000);this.closest('.form-group').querySelector('.ol-stardate-calc').textContent=this.value?'Stardate: '+y+'.'+String(day).padStart(3,'0'):''">
          <small class="ol-stardate-calc">${initialStardate ? "Stardate: " + initialStardate : ""}</small>
        </div>
        <div class="form-group">
          <label>${t("sta-officers-log.logSheet.customIrlDate") ?? "Custom IRL Date"}</label>
          <input type="date" name="customIrlDate" value="${isoIrlDate}">
        </div>
      `,
      ok: {
        label: t("sta-officers-log.logSheet.save") ?? "Save",
        callback: (_event, button) => {
          const f = button.form;
          return {
            createdWithTrauma: f?.elements?.createdWithTrauma?.checked ?? false,
            showMilestoneArcButton:
              f?.elements?.showMilestoneArcButton?.checked ?? false,
            customDate: f?.elements?.customDate?.value?.trim() ?? "",
            customIrlDate: f?.elements?.customIrlDate?.value?.trim() ?? "",
          };
        },
      },
      rejectClose: false,
    });

    if (!result) return;

    const updates = {
      "system.showMilestoneArcButton": result.showMilestoneArcButton,
      "system.customDate": result.customDate || null,
      "system.customIrlDate": result.customIrlDate || null,
    };
    if (showTrauma) {
      updates["system.createdWithTrauma"] = result.createdWithTrauma;
    }
    await item.update(updates);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a Date object to a YYYY.DDD stardate string. */
function _stardateFromDate(date) {
  const year = date.getFullYear();
  const start = new Date(year, 0, 0);
  const day = Math.floor((date - start) / (1000 * 60 * 60 * 24));
  return `${year}.${String(day).padStart(3, "0")}`;
}

/** Convert a Date to a stardate string, using sta-utils TNG calculator if available. */
function _stardateFromDateFull(date) {
  const fn =
    game.modules.get("sta-utils")?.active &&
    game.staUtils?.calendarDateToStardate;
  if (fn) return fn(date);
  return _stardateFromDate(date);
}

/**
 * Format a stardate string for display.
 * If customDate is an ISO date (YYYY-MM-DD), computes a stardate from it.
 * Falls back to the item's creation timestamp.
 */
function _formatStardate(item) {
  const custom = item.system?.customDate;
  if (custom) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(custom)) {
      return _stardateFromDateFull(new Date(custom + "T12:00:00"));
    }
    return custom; // legacy free-text stardate
  }
  const ts = item._stats?.createdTime;
  if (!ts) return "";
  return _stardateFromDateFull(new Date(ts));
}
