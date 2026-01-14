import { MODULE_ID } from "../../constants.js";
import { STA_DEFAULT_ICON, escapeHTML } from "../../values.js";
import { isLogUsed } from "../../mission.js";
import { isCallbackTargetCompatibleWithValue } from "../../callbackEligibility.js";
import { t } from "../../i18n.js";
import {
  DIRECTIVE_VALUE_ID_PREFIX,
  directiveIconPath,
  getDirectiveKeyFromValueId,
  getDirectiveSnapshotForLog,
  getDirectiveTextForValueId,
  getMissionDirectives,
  isDirectiveValueId,
  makeDirectiveKeyFromText,
  makeDirectiveValueIdFromText,
  sanitizeDirectiveText,
} from "../../directives.js";
import {
  computeBestChainEndingAt,
  getCallbackLogEdgesForValue,
} from "../../arcChains.js";
import {
  canCurrentUserChangeActor,
  refreshMissionLogSortingForActorId,
} from "./sheetUtils.js";
import {
  getCompletedArcEndLogIds,
  getLogSortKey,
  getPrimaryValueIdForLog,
} from "./logSorting.js";

async function _syncLogImgToValue(actor, log, valueId) {
  const vId = valueId ? String(valueId) : "";
  if (!actor || actor.type !== "character") return;
  if (!log || log.type !== "log") return;

  if (vId && isDirectiveValueId(vId)) {
    const icon = directiveIconPath();
    if (icon && String(log.img ?? "") !== String(icon)) {
      try {
        await log.update({ img: icon }, { render: false, renderSheet: false });
      } catch (_) {
        // ignore
      }
    }
    return;
  }

  // If no value is selected, restore STA default.
  if (!vId) {
    if (STA_DEFAULT_ICON && log.img !== STA_DEFAULT_ICON) {
      try {
        await log.update(
          { img: STA_DEFAULT_ICON },
          { render: false, renderSheet: false }
        );
      } catch (_) {
        // ignore
      }
    }
    return;
  }

  const valueItem = vId ? actor.items.get(vId) : null;
  const desiredImg =
    valueItem?.type === "value" && valueItem?.img ? String(valueItem.img) : "";

  if (desiredImg && log.img !== desiredImg) {
    try {
      await log.update(
        { img: desiredImg },
        { render: false, renderSheet: false }
      );
    } catch (_) {
      // ignore
    }
  }
}

const flagPath = (key) => `flags.${MODULE_ID}.${key}`;

async function setFlagWithoutRender(log, key, value) {
  if (!log || typeof log.update !== "function") return;
  await log.update(
    { [flagPath(key)]: value },
    { render: false, renderSheet: false }
  );
}

async function unsetFlagWithoutRender(log, key) {
  if (!log || typeof log.update !== "function") return;
  // Foundry does not reliably delete properties when setting `undefined`.
  // Use `null` to unset flags.
  await log.update(
    { [flagPath(key)]: null },
    { render: false, renderSheet: false }
  );
}

export async function promptLinkLogToChain({ actor, log }) {
  if (!actor || actor.type !== "character") return;
  if (!log || log.type !== "log") return;
  if (!canCurrentUserChangeActor(actor)) return;

  const logs = Array.from(actor.items ?? []).filter((i) => i?.type === "log");
  const values = Array.from(actor.items ?? []).filter(
    (i) => i?.type === "value"
  );

  const existing = log.getFlag?.(MODULE_ID, "callbackLink") ?? {};
  const existingFrom = String(existing?.fromLogId ?? "");
  const existingValue = String(existing?.valueId ?? "");

  const logOptions = logs
    .filter((l) => String(l.id) !== String(log.id))
    .filter((l) => !isLogUsed(l) || String(l.id) === existingFrom)
    .map((l) => {
      const sel = String(l.id) === existingFrom ? " selected" : "";
      return `<option value="${escapeHTML(l.id)}"${sel}>${escapeHTML(
        l.name
      )}</option>`;
    })
    .join("");

  const valueOptions = values
    .map((v) => {
      const sel = String(v.id) === existingValue ? " selected" : "";
      const icon = v?.img ? String(v.img) : "";
      // Best-effort: show icon in the dropdown option (works in Chromium in many cases).
      const style = icon
        ? ` style="background-image:url('${escapeHTML(
            icon
          )}');background-repeat:no-repeat;background-position:4px 50%;background-size:16px 16px;padding-left:24px;"`
        : "";
      return `<option value="${escapeHTML(v.id)}"${sel}${style}>${escapeHTML(
        v.name
      )}</option>`;
    })
    .join("");

  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: "Link Log to Chain" },
    content: `
      <div class="form-group">
        <label>Link <strong>${escapeHTML(
          log.name ?? "Log"
        )}</strong> as a callback to:</label>
        <select name="fromLogId">
          <option value="">- (No link)</option>
          ${logOptions}
        </select>
        <p class="hint">Choose the earlier log this one calls back to.</p>
      </div>

      <div class="form-group">
        <label>Value (optional):</label>
        <select name="valueId">
          <option value="">-</option>
          ${valueOptions}
        </select>
      </div>
    `,
    buttons: [
      {
        action: "save",
        label: "Save",
        default: true,
        callback: (_event, button) => {
          const form = button.form;
          return {
            fromLogId: String(form?.elements?.fromLogId?.value ?? ""),
            valueId: String(form?.elements?.valueId?.value ?? ""),
          };
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
    modal: false,
  });

  if (!res || res === "cancel") return;

  const fromLogId = String(res.fromLogId ?? "");
  const valueId = String(res.valueId ?? "");

  // Enforce: cannot call back to a log that is already used (unless it's the existing selection).
  if (fromLogId && fromLogId !== existingFrom) {
    const target = actor.items.get(String(fromLogId));
    if (target?.type === "log" && isLogUsed(target)) {
      ui.notifications?.warn?.(
        "That log has already been used for a callback."
      );
      return;
    }
  }

  if (!fromLogId) {
    await unsetFlagWithoutRender(log, "callbackLink");

    // Mark an explicit override so milestone-derived edges don't keep it in a chain.
    try {
      await setFlagWithoutRender(log, "callbackLinkDisabled", true);
    } catch (_) {
      // ignore
    }

    // Still allow the user to change the icon via the Value dropdown.
    await _syncLogImgToValue(actor, log, valueId);
  } else {
    // Clear explicit override when setting a link.
    try {
      await unsetFlagWithoutRender(log, "callbackLinkDisabled");
    } catch (_) {
      // ignore
    }

    await setFlagWithoutRender(log, "callbackLink", { fromLogId, valueId });

    // Align the log's icon to the selected value (or restore STA default).
    await _syncLogImgToValue(actor, log, valueId);
  }

  // Update any open character sheets so chain sorting/indentation refreshes.
  rerenderOpenStaSheetsForActorId(actor.id);
}

export function installInlineLogChainLinkControls(root, actor, log) {
  // Remove the old header button (we now do this inline in the sheet).
  try {
    root
      ?.querySelector?.("header.window-header .sta-link-chain-btn")
      ?.remove?.();
  } catch (_) {
    // ignore
  }

  const canChange = canCurrentUserChangeActor(actor);

  // If the user can't change, ensure our injected controls are removed.
  if (!canChange) {
    root?.querySelector?.(".sta-log-link-controls")?.remove?.();
    return;
  }

  const sheetRoot =
    root?.querySelector?.('.item-sheet[data-application-part="itemsheet"]') ||
    root?.querySelector?.(".item-sheet") ||
    null;
  if (!sheetRoot) return;

  // We insert into the sheet's <form> when present, so don't require direct-child.
  if (sheetRoot.querySelector(".sta-log-link-controls")) return;

  const logs = Array.from(actor.items ?? [])
    .filter((i) => i?.type === "log")
    .filter((l) => String(l.id) !== String(log.id))
    .slice()
    .sort((a, b) => {
      const d = getLogSortKey(a) - getLogSortKey(b);
      if (d) return d;
      return String(a.name ?? "").localeCompare(
        String(b.name ?? ""),
        undefined,
        {
          sensitivity: "base",
        }
      );
    });

  const values = Array.from(actor.items ?? [])
    .filter((i) => i?.type === "value")
    .slice()
    .sort((a, b) => {
      const d = Number(a.sort ?? 0) - Number(b.sort ?? 0);
      if (d) return d;
      return String(a.name ?? "").localeCompare(
        String(b.name ?? ""),
        undefined,
        {
          sensitivity: "base",
        }
      );
    });

  const existing = log.getFlag?.(MODULE_ID, "callbackLink") ?? {};
  const existingFrom = String(existing?.fromLogId ?? "");
  const existingValue = String(existing?.valueId ?? "");
  const isDisabled = log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true;

  const persistedPrimary = String(
    log.getFlag?.(MODULE_ID, "primaryValueId") ?? ""
  );

  const directivesSnapshot = (() => {
    const snap = getDirectiveSnapshotForLog(log);
    return snap.length ? snap : getMissionDirectives();
  })();
  const directivesByKey = new Map();
  for (const d of directivesSnapshot) {
    const text = sanitizeDirectiveText(d);
    if (!text) continue;
    const key = makeDirectiveKeyFromText(text);
    if (!key) continue;
    directivesByKey.set(key, text);
  }

  // Also include any directives already present on this log, so they can be
  // selected as Primary even if they are not in the current mission list.
  try {
    const existingLabels = log.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
    if (existingLabels && typeof existingLabels === "object") {
      for (const [k, v] of Object.entries(existingLabels)) {
        const key = String(k ?? "");
        const text = sanitizeDirectiveText(v ?? "");
        if (!key || !text) continue;
        if (!directivesByKey.has(key)) directivesByKey.set(key, text);
      }
    }
  } catch (_) {
    // ignore
  }

  try {
    const states = log?.system?.valueStates ?? {};
    for (const [valueId, state] of Object.entries(states)) {
      if (String(state) === "unused") continue;
      if (!isDirectiveValueId(valueId)) continue;
      const key = getDirectiveKeyFromValueId(valueId);
      if (!key) continue;
      if (directivesByKey.has(String(key))) continue;
      const text = sanitizeDirectiveText(
        getDirectiveTextForValueId(log, valueId)
      );
      if (text) directivesByKey.set(String(key), text);
    }
  } catch (_) {
    // ignore
  }

  const existingArcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
  const isArcEnd = existingArcInfo?.isArc === true;
  const existingArcValueId = String(existingArcInfo?.valueId ?? "");
  const existingArcStepsRaw = Number(existingArcInfo?.steps ?? 0);
  const existingArcSteps = Number.isFinite(existingArcStepsRaw)
    ? existingArcStepsRaw
    : 0;
  const existingArcChainLen = Array.isArray(existingArcInfo?.chainLogIds)
    ? existingArcInfo.chainLogIds.length
    : 0;
  const initialArcSteps = Math.max(
    1,
    existingArcSteps || existingArcChainLen || 3
  );

  const selectedFromLogId = isDisabled ? "" : existingFrom;
  // Prefer the explicit Primary Value selection.
  const selectedValueId = persistedPrimary || existingValue;

  let _baselineFromLogId = String(selectedFromLogId);
  let _baselineValueId = String(selectedValueId);
  let _baselineIsArcEnd = Boolean(isArcEnd);
  let _baselineArcSteps = Number.isFinite(Number(initialArcSteps))
    ? Number(initialArcSteps)
    : 1;
  let _baselineArcValueId = String(
    existingArcValueId || existingValue || selectedValueId || ""
  );

  const completedArcEndLogIds = getCompletedArcEndLogIds(actor);

  const isEligibleFromLogId = (targetLogId, currentValueId) => {
    const tId = targetLogId ? String(targetLogId) : "";
    const vId = currentValueId ? String(currentValueId) : "";
    if (!tId) return true;

    // Prevent linking to logs that have already been used for a callback.
    // Keep the current selection available so existing data isn't broken.
    // Keep the *saved* selection available so existing data isn't broken.
    if (tId !== String(_baselineFromLogId)) {
      const usedTarget = actor.items.get(tId);
      if (usedTarget?.type === "log" && isLogUsed(usedTarget)) return false;
    }

    const target = actor.items.get(tId);
    if (!target || target.type !== "log") return false;
    const targetPrimary = getPrimaryValueIdForLog(actor, target, values);

    return isCallbackTargetCompatibleWithValue({
      valueId: vId,
      targetPrimaryValueId: targetPrimary,
      isCompletedArcEnd: completedArcEndLogIds.has(tId),
    });
  };

  const buildFromOptionsHtml = (currentValueId) => {
    const vId = currentValueId ? String(currentValueId) : "";
    const options = [];
    options.push('<option value="">- (No link)</option>');

    for (const l of logs) {
      const id = String(l.id);
      const eligible = isEligibleFromLogId(id, vId);
      if (!eligible && id !== String(_baselineFromLogId)) continue;

      const sel = id === String(selectedFromLogId) ? " selected" : "";

      // Never disable the currently-saved selection, otherwise the browser
      // may drop it on initial render (which can then get persisted).
      const isBaseline = id === String(_baselineFromLogId);
      const disabled = eligible || isBaseline ? "" : " disabled";
      const suffix = eligible
        ? ""
        : isLogUsed(l)
        ? " (already used)"
        : vId
        ? " (different primary value)"
        : "";

      options.push(
        `<option value="${escapeHTML(id)}"${sel}${disabled}>${escapeHTML(
          String(l.name ?? "") + suffix
        )}</option>`
      );
    }

    return options.join("");
  };

  const buildPrimaryValueOptionsHtml = (currentValueId) => {
    const curId = currentValueId ? String(currentValueId) : "";
    const options = [];

    const emptySel = !curId ? " selected" : "";
    options.push(`<option value=""${emptySel}>-</option>`);

    // Values first
    for (const v of values) {
      const id = String(v.id);
      const sel = id === curId ? " selected" : "";
      options.push(
        `<option value="${escapeHTML(id)}"${sel}>${escapeHTML(
          String(v.name ?? "")
        )}</option>`
      );
    }

    // Directives section
    const directiveOptions = [];
    const seenDirectiveValueIds = new Set();

    for (const [key, text] of directivesByKey.entries()) {
      const valueId = `${DIRECTIVE_VALUE_ID_PREFIX}${String(key)}`;
      seenDirectiveValueIds.add(String(valueId));
      const sel = String(valueId) === curId ? " selected" : "";
      directiveOptions.push(
        `<option value="${escapeHTML(valueId)}"${sel}>${escapeHTML(
          String(text ?? valueId)
        )}</option>`
      );
    }

    // Ensure the currently-selected directive displays even if it isn't in the current directives list.
    if (
      curId &&
      isDirectiveValueId(curId) &&
      !seenDirectiveValueIds.has(curId)
    ) {
      const label =
        sanitizeDirectiveText(getDirectiveTextForValueId(log, curId)) || curId;
      directiveOptions.unshift(
        `<option value="${escapeHTML(curId)}" selected>${escapeHTML(
          label
        )}</option>`
      );
    }

    // Always show the directives section separator.
    options.push('<option value="" disabled>--Directives--</option>');
    if (directiveOptions.length) options.push(directiveOptions.join(""));

    return options.join("");
  };

  const wrapper = document.createElement("div");
  wrapper.className = "sta-log-link-controls";
  wrapper.innerHTML = `
    <input type="hidden" data-sta-callbacks-field="callbackLinkValueId" value="${escapeHTML(
      String(selectedValueId)
    )}" />
    <input type="hidden" data-sta-callbacks-field="arcValueId" value="${escapeHTML(
      String(existingArcValueId || existingValue || selectedValueId || "")
    )}" />
    <div class="column">
      <div class="title">Calls back to:</div>
      <select data-sta-callbacks-field="fromLogId">
        ${buildFromOptionsHtml(selectedValueId)}
      </select>
    </div>

    <div class="column">
      <div class="title">Primary Value</div>
      <select data-sta-callbacks-field="valueId">
        ${buildPrimaryValueOptionsHtml(selectedValueId)}
      </select>
    </div>

    <div class="column">
      <div class="title">Arc</div>
      <div class="sta-arc-fields">
        <label class="sta-arc-toggle">
          <input type="checkbox" data-sta-callbacks-field="isArcEnd" ${
            isArcEnd ? "checked" : ""
          } />
          <span>${escapeHTML(t("sta-officers-log.logSheet.arcComplete"))}</span>
        </label>

        <label class="sta-arc-steps">
          <span class="sta-arc-label">Steps</span>
          <input type="number" data-sta-callbacks-field="arcSteps" min="1" step="1" value="${escapeHTML(
            String(initialArcSteps)
          )}" />
        </label>
      </div>
    </div>
  `;

  const formRoot = sheetRoot.querySelector("form") ?? sheetRoot;
  const firstRowInForm = formRoot.querySelector(":scope > .row");
  const insertBeforeInForm = firstRowInForm?.nextElementSibling ?? null;
  if (insertBeforeInForm) formRoot.insertBefore(wrapper, insertBeforeInForm);
  else formRoot.prepend(wrapper);

  const fromSelect = wrapper.querySelector(
    'select[data-sta-callbacks-field="fromLogId"]'
  );
  const valueSelect = wrapper.querySelector(
    'select[data-sta-callbacks-field="valueId"]'
  );
  const arcToggle = wrapper.querySelector(
    'input[data-sta-callbacks-field="isArcEnd"]'
  );
  const arcStepsInput = wrapper.querySelector(
    'input[data-sta-callbacks-field="arcSteps"]'
  );
  const callbackLinkValueIdInput = wrapper.querySelector(
    'input[data-sta-callbacks-field="callbackLinkValueId"]'
  );
  const arcValueIdInput = wrapper.querySelector(
    'input[data-sta-callbacks-field="arcValueId"]'
  );
  if (!(fromSelect instanceof HTMLSelectElement)) return;
  if (!(valueSelect instanceof HTMLSelectElement)) return;
  if (!(arcToggle instanceof HTMLInputElement)) return;
  if (!(arcStepsInput instanceof HTMLInputElement)) return;
  if (!(callbackLinkValueIdInput instanceof HTMLInputElement)) return;
  if (!(arcValueIdInput instanceof HTMLInputElement)) return;

  if (wrapper.dataset.staBound === "1") return;
  wrapper.dataset.staBound = "1";

  const getEffectiveValueId = () => {
    return String(valueSelect.value ?? "");
  };

  const ensurePrimaryValueOptionExists = (valueId, label) => {
    const vId = valueId ? String(valueId) : "";
    if (!vId) return;
    const exists = Array.from(valueSelect.options).some(
      (o) => String(o.value) === vId
    );
    if (exists) return;

    if (!isDirectiveValueId(vId)) return;

    const safeLabel = sanitizeDirectiveText(label ?? "") || vId;
    const opt = document.createElement("option");
    opt.value = vId;
    opt.textContent = safeLabel;

    // Insert after the "--Directives--" separator if present.
    const sep = Array.from(valueSelect.options).find(
      (o) => o.disabled && String(o.textContent ?? "").includes("Directives")
    );
    if (sep) {
      try {
        sep.after(opt);
        return;
      } catch (_) {
        // ignore
      }
    }

    valueSelect.appendChild(opt);
  };

  const refreshFromOptions = () => {
    const curVal = String(getEffectiveValueId() ?? "");
    const existingSel = String(fromSelect.value ?? "");
    fromSelect.innerHTML = buildFromOptionsHtml(curVal);

    // If the previous selection is still present, keep it; otherwise reset.
    const stillExists = Array.from(fromSelect.options).some(
      (o) => String(o.value) === existingSel
    );
    if (stillExists) fromSelect.value = existingSel;
    else fromSelect.value = "";
  };

  const alignPrimaryValueToCallbackTarget = () => {
    const fromLogId = String(fromSelect.value ?? "");
    if (!fromLogId) return;

    // Exception: when calling back to the end of a completed arc, do NOT
    // auto-set the Primary Value. The new log is not part of that arc.
    if (completedArcEndLogIds?.has?.(fromLogId)) return;

    const target = actor.items.get(fromLogId);
    if (!target || target.type !== "log") return;

    const targetPrimaryValueId = String(
      getPrimaryValueIdForLog(actor, target, values) ?? ""
    );
    if (!targetPrimaryValueId) return;

    if (isDirectiveValueId(targetPrimaryValueId)) {
      const label =
        getDirectiveTextForValueId(log, targetPrimaryValueId) ||
        getDirectiveTextForValueId(target, targetPrimaryValueId) ||
        targetPrimaryValueId;
      ensurePrimaryValueOptionExists(targetPrimaryValueId, label);
    }

    const optionExists = Array.from(valueSelect.options).some(
      (o) => String(o.value) === targetPrimaryValueId
    );
    if (!optionExists) return;

    if (String(valueSelect.value ?? "") === targetPrimaryValueId) return;
    valueSelect.value = targetPrimaryValueId;

    refreshFromOptions();
  };

  const syncFormFields = () => {
    let fromLogId = String(fromSelect.value ?? "");
    const valueId = String(getEffectiveValueId() ?? "");
    const wantsArcEnd = arcToggle.checked === true;

    const parseSteps = () => {
      const n = Number(arcStepsInput.value ?? 0);
      if (!Number.isFinite(n) || n <= 0) return 1;
      return Math.floor(n);
    };

    // Enforce: cannot call back to a log with a different primary value,
    // unless that log is the last log in a completed arc chain.
    if (fromLogId && valueId && !isEligibleFromLogId(fromLogId, valueId)) {
      ui.notifications?.warn(
        "Cannot call back to a log with a different primary value."
      );
      fromSelect.value = "";
      fromLogId = "";
    }

    // Enforce: cannot call back to a log that is already used.
    // BUT: allow the currently-saved selection (grandfathered) so opening a log
    // cannot auto-clear its existing callback link.
    if (fromLogId && String(fromLogId) !== String(_baselineFromLogId)) {
      const target = actor.items.get(String(fromLogId));
      if (target?.type === "log" && isLogUsed(target)) {
        ui.notifications?.warn?.(
          "That log has already been used for a callback."
        );
        fromSelect.value = "";
        fromLogId = "";
      }
    }

    // Keep callbackLink.valueId in sync with Primary Value.
    callbackLinkValueIdInput.value = valueId;

    // Arc end toggle: requires a stable Primary Value.
    if (wantsArcEnd) {
      const arcValueId = valueId || _baselineArcValueId;
      if (!arcValueId) {
        ui.notifications?.warn?.(
          "Select a Primary Value before marking an Arc end."
        );
        arcToggle.checked = false;
      } else {
        arcValueIdInput.value = String(arcValueId);
        arcStepsInput.value = String(parseSteps());
      }
    } else {
      // Still keep a reasonable valueId in the hidden field, but arcInfo.isArc will submit false.
      arcValueIdInput.value = String(_baselineArcValueId || valueId || "");
    }
  };

  let _saveTimer = null;
  let _saveInFlight = false;

  const scheduleSave = () => {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => void persistNow(), 150);
  };

  const persistNow = async () => {
    if (_saveInFlight) return;
    _saveInFlight = true;

    // Ensure hidden fields represent the current UI.
    syncFormFields();

    let fromLogId = String(fromSelect.value ?? "");
    const valueId = String(getEffectiveValueId() ?? "");
    const wantsArcEnd = arcToggle.checked === true;
    const stepsRaw = Number(arcStepsInput.value ?? 0);
    const steps =
      Number.isFinite(stepsRaw) && stepsRaw > 0 ? Math.floor(stepsRaw) : 1;
    const arcValueId = String(arcValueIdInput.value ?? "");

    if (wantsArcEnd && !arcValueId) {
      ui.notifications?.warn?.(
        "Select a Primary Value before marking an Arc end."
      );
      return;
    }

    const update = {};

    // Primary Value
    update[`flags.${MODULE_ID}.primaryValueId`] = valueId ? valueId : null;

    // Directive metadata for editing/display
    if (valueId && isDirectiveValueId(valueId)) {
      const key = getDirectiveKeyFromValueId(valueId);
      update[`flags.${MODULE_ID}.primaryDirectiveKey`] = key ? key : null;

      // Keep directiveLabels updated from the directives list (or existing map).
      // Do not allow editing directive text from this Primary Value UI.
      if (key) {
        try {
          const existing = log.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
          const cloned =
            existing && typeof existing === "object"
              ? foundry.utils.deepClone(existing)
              : {};

          const fromList = directivesByKey.get(String(key)) ?? "";
          const fromExisting =
            typeof cloned?.[String(key)] === "string"
              ? String(cloned[String(key)])
              : "";
          const desired = sanitizeDirectiveText(fromList || fromExisting);

          if (desired && String(cloned[String(key)] ?? "") !== desired) {
            cloned[String(key)] = desired;
            update[`flags.${MODULE_ID}.directiveLabels`] = cloned;
          }
        } catch (_) {
          // ignore
        }
      }
    } else {
      update[`flags.${MODULE_ID}.primaryDirectiveKey`] = null;
    }

    // Calls-back-to link
    if (!fromLogId) {
      update[`flags.${MODULE_ID}.callbackLink`] = null;
      update[`flags.${MODULE_ID}.callbackLinkDisabled`] = true;
    } else {
      update[`flags.${MODULE_ID}.callbackLinkDisabled`] = null;
      update[`flags.${MODULE_ID}.callbackLink`] = {
        fromLogId: String(fromLogId),
        valueId: String(valueId),
      };
    }

    // Arc info
    if (!wantsArcEnd) {
      update[`flags.${MODULE_ID}.arcInfo`] = null;
    } else {
      // Preserve existing arc title. The title is edited via the Arc title-bar
      // edit button (character sheet), so don't overwrite it from the Log sheet.
      let arcLabel = "";
      try {
        const curArcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
        arcLabel = String(curArcInfo?.arcLabel ?? "");
      } catch (_) {
        arcLabel = "";
      }

      // If no title exists yet (new arc end), default to the current Value name.
      // This is persisted once and won't change if the Value is renamed later.
      if (!arcLabel.trim() && arcValueId) {
        try {
          if (isDirectiveValueId(arcValueId)) {
            const name = getDirectiveTextForValueId(log, arcValueId);
            if (name) arcLabel = name;
          } else {
            const v = actor.items.get(String(arcValueId));
            const name = v?.type === "value" ? String(v.name ?? "") : "";
            if (name) arcLabel = name;
          }
        } catch (_) {
          // ignore
        }
      }

      const arcInfo = {
        isArc: true,
        steps,
        valueId: String(arcValueId),
      };
      arcInfo.arcLabel = String(arcLabel ?? "");
      update[`flags.${MODULE_ID}.arcInfo`] = arcInfo;
    }

    // Sync icon to Primary Value (or default)
    try {
      const desiredImg =
        valueId && isDirectiveValueId(valueId)
          ? directiveIconPath()
          : (() => {
              const valueItem = valueId ? actor.items.get(valueId) : null;
              return valueItem?.type === "value" && valueItem?.img
                ? String(valueItem.img)
                : STA_DEFAULT_ICON;
            })();
      if (desiredImg && String(log.img ?? "") !== String(desiredImg)) {
        update.img = desiredImg;
      }
    } catch (_) {
      // ignore
    }

    try {
      await log.update(update, { render: false, renderSheet: false });

      // Update baseline to the newly-saved state.
      _baselineFromLogId = String(fromLogId);
      _baselineValueId = String(valueId);
      _baselineIsArcEnd = Boolean(wantsArcEnd);
      _baselineArcSteps = steps;
      _baselineArcValueId = String(arcValueId || valueId || "");

      // Ensure character sheets refresh their log sorting/indentation.
      try {
        refreshMissionLogSortingForActorId(actor.id);
      } catch (_) {
        // ignore
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | failed saving log link controls`, err);
      ui.notifications?.error?.("Failed to save log link data.");
    } finally {
      _saveInFlight = false;
    }
  };

  fromSelect.addEventListener("change", (ev) => {
    try {
      ev?.stopPropagation?.();
    } catch (_) {
      // ignore
    }
    alignPrimaryValueToCallbackTarget();
    syncFormFields();
    scheduleSave();
  });

  valueSelect.addEventListener("change", (ev) => {
    try {
      ev?.stopPropagation?.();
    } catch (_) {
      // ignore
    }
    refreshFromOptions();
    syncFormFields();
    scheduleSave();
  });

  arcToggle.addEventListener("change", (ev) => {
    try {
      ev?.stopPropagation?.();
    } catch (_) {
      // ignore
    }
    syncFormFields();
    scheduleSave();
  });

  arcStepsInput.addEventListener("change", (ev) => {
    try {
      ev?.stopPropagation?.();
    } catch (_) {
      // ignore
    }
    syncFormFields();
    scheduleSave();
  });

  // Ensure the fromLog options reflect the current primary value on initial render.
  refreshFromOptions();

  // --- Add Directive button (inline in the system value-state table header) ---
  const installAddDirectiveButton = () => {
    const anyRadio = sheetRoot.querySelector(
      'input[type="radio"][name^="system.valueStates."]'
    );
    const firstRow = anyRadio?.closest?.(".row") ?? null;
    const rowsParent = firstRow?.parentElement ?? null;
    if (!rowsParent) return;

    const headerRow =
      rowsParent.querySelector(":scope > .row.title") ||
      rowsParent.querySelector(".row.title");
    if (!(headerRow instanceof HTMLElement)) return;

    const nameCol =
      headerRow.querySelector(":scope > .col-name") ||
      headerRow.querySelector(".col-name");
    if (!(nameCol instanceof HTMLElement)) return;

    if (nameCol.querySelector(":scope > .sta-add-directive-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sta-inline-sheet-btn sta-add-directive-btn";
    btn.textContent = "Add Directive";

    btn.addEventListener("click", async (ev) => {
      try {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
      } catch (_) {
        // ignore
      }

      const optionsHtml = Array.from(directivesByKey.entries())
        .map(([key, text]) => {
          return `<option value="${escapeHTML(String(key))}">${escapeHTML(
            String(text)
          )}</option>`;
        })
        .join("");

      const res = await foundry.applications.api.DialogV2.wait({
        window: { title: "Add Directive" },
        content: `
          <div class="form-group">
            <label>Directive</label>
            <div class="form-fields">
              <select name="directiveKey">
                <option value="__other__">${escapeHTML(
                  t("sta-officers-log.dialog.useDirective.other")
                )}</option>
                ${optionsHtml}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Text (optional)</label>
            <div class="form-fields">
              <input type="text" name="directiveText" maxlength="100" placeholder="${escapeHTML(
                t("sta-officers-log.dialog.useDirective.otherPlaceholder")
              )}" />
            </div>
            <p class="hint">If blank, uses the selected directive. Sanitized, max 100 characters.</p>
          </div>
        `,
        buttons: [
          {
            action: "add",
            label: "Add",
            default: true,
            callback: (_event, button) => ({
              directiveKey: String(
                button.form?.elements?.directiveKey?.value ?? "__other__"
              ),
              directiveText: String(
                button.form?.elements?.directiveText?.value ?? ""
              ),
            }),
          },
          { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
        modal: false,
      });

      if (!res || res === "cancel") return;

      const selectedKey = String(res.directiveKey ?? "__other__");
      const typed = sanitizeDirectiveText(res.directiveText ?? "");
      const chosen = typed
        ? typed
        : selectedKey && selectedKey !== "__other__"
        ? directivesByKey.get(selectedKey) || ""
        : "";
      const cleaned = sanitizeDirectiveText(chosen);
      if (!cleaned) {
        ui.notifications?.warn?.(
          t("sta-officers-log.dialog.useDirective.missing")
        );
        return;
      }

      const valueId = makeDirectiveValueIdFromText(cleaned);
      const key = makeDirectiveKeyFromText(cleaned);
      if (!valueId || !key) return;

      const curState = String(
        log?.system?.valueStates?.[String(valueId)] ?? "unused"
      );
      const nextState = curState === "unused" ? "positive" : curState;

      const update = {
        [`system.valueStates.${valueId}`]: nextState,
      };

      try {
        const existing = log.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
        const cloned =
          existing && typeof existing === "object"
            ? foundry.utils.deepClone(existing)
            : {};
        cloned[String(key)] = cleaned;
        update[`flags.${MODULE_ID}.directiveLabels`] = cloned;
      } catch (_) {
        // ignore
      }

      try {
        await log.update(update, { render: false, renderSheet: false });
      } catch (_) {
        // ignore
      }

      try {
        refreshMissionLogSortingForActorId(actor.id);
      } catch (_) {
        // ignore
      }

      try {
        log?.sheet?.render?.(false);
      } catch (_) {
        // ignore
      }
    });

    nameCol.appendChild(btn);
  };

  // Ensure the currently-selected directive is present in the Primary Value dropdown.
  if (selectedValueId && isDirectiveValueId(selectedValueId)) {
    ensurePrimaryValueOptionExists(
      String(selectedValueId),
      getDirectiveTextForValueId(log, selectedValueId)
    );
  }

  // --- Inline invoked directives in the value state list ---

  const installInlineInvokedDirectiveRows = () => {
    const states = log?.system?.valueStates ?? {};
    const invoked = [];
    for (const [valueId, state] of Object.entries(states)) {
      if (!isDirectiveValueId(valueId)) continue;
      if (String(state) === "unused") continue;
      invoked.push({
        valueId: String(valueId),
        state: String(state),
        text: getDirectiveTextForValueId(log, valueId),
      });
    }
    invoked.sort((a, b) =>
      String(a.text ?? a.valueId).localeCompare(
        String(b.text ?? b.valueId),
        undefined,
        {
          sensitivity: "base",
        }
      )
    );

    // Find the system-provided value-state rows.
    const anyRadio = sheetRoot.querySelector(
      'input[type="radio"][name^="system.valueStates."]'
    );
    const firstRow = anyRadio?.closest?.(".row") ?? null;
    const rowsParent = firstRow?.parentElement ?? null;
    if (!rowsParent) return;

    // Clear any previously injected directive rows.
    for (const el of Array.from(
      rowsParent.querySelectorAll(":scope > .sta-directive-value-row")
    )) {
      try {
        el.remove();
      } catch (_) {
        // ignore
      }
    }

    if (!invoked.length) return;

    const valueStateRows = Array.from(rowsParent.children).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (!el.classList.contains("row")) return false;
      return Boolean(
        el.querySelector('input[type="radio"][name^="system.valueStates."]')
      );
    });

    const insertAfter = valueStateRows.length
      ? valueStateRows[valueStateRows.length - 1]
      : firstRow;
    if (!(insertAfter instanceof HTMLElement)) return;

    let anchor = insertAfter;

    for (const d of invoked) {
      const row = document.createElement("div");
      row.className = "row sta-directive-value-row";
      row.dataset.staDirectiveValueId = d.valueId;

      const safeText = sanitizeDirectiveText(d.text ?? "") || d.valueId;

      const nameCol = document.createElement("div");
      nameCol.className = "col-name value-name sta-directive-name-cell";

      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.className = "text-entry sta-directive-inline-text";
      textInput.value = safeText;
      textInput.placeholder = t(
        "sta-officers-log.dialog.useDirective.otherPlaceholder"
      );
      textInput.maxLength = 100;
      nameCol.appendChild(textInput);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "sta-directive-remove-btn";
      removeBtn.title = "Remove directive";
      removeBtn.setAttribute("aria-label", "Remove directive");
      removeBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      nameCol.appendChild(removeBtn);

      row.appendChild(nameCol);

      const buildRadio = (value) => {
        const col = document.createElement("div");
        col.className = "col-radio";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `system.valueStates.${d.valueId}`;
        input.value = value;
        if (String(d.state) === String(value)) input.checked = true;
        col.appendChild(input);
        return input;
      };

      const unusedRadio = buildRadio("unused");
      const posRadio = buildRadio("positive");
      const negRadio = buildRadio("negative");
      const chalRadio = buildRadio("challenged");
      row.appendChild(unusedRadio.closest(".col-radio"));
      row.appendChild(posRadio.closest(".col-radio"));
      row.appendChild(negRadio.closest(".col-radio"));
      row.appendChild(chalRadio.closest(".col-radio"));

      const onStateChange = async (ev) => {
        const input = ev?.currentTarget;
        if (!(input instanceof HTMLInputElement)) return;
        if (!input.checked) return;
        const next = String(input.value ?? "unused");
        try {
          await log.update(
            { [`system.valueStates.${d.valueId}`]: next },
            { render: false, renderSheet: false }
          );
        } catch (_) {
          // ignore
        }

        if (next === "unused") {
          try {
            row.remove();
          } catch (_) {
            // ignore
          }
        }

        try {
          refreshMissionLogSortingForActorId(actor.id);
        } catch (_) {
          // ignore
        }
      };

      for (const r of [unusedRadio, posRadio, negRadio, chalRadio]) {
        r.addEventListener("change", (ev) => {
          try {
            ev?.stopPropagation?.();
          } catch (_) {
            // ignore
          }
          void onStateChange(ev);
        });
      }

      const onTextChange = async () => {
        const newText = sanitizeDirectiveText(textInput.value ?? "");
        if (!newText) {
          textInput.value = safeText;
          return;
        }

        const oldId = String(d.valueId);
        const newId = makeDirectiveValueIdFromText(newText);
        if (!newId) return;

        const currentStates = log?.system?.valueStates ?? {};
        const oldState = String(currentStates?.[oldId] ?? "unused");
        if (oldState === "unused") return;

        const oldKey = getDirectiveKeyFromValueId(oldId);
        const newKey = makeDirectiveKeyFromText(newText);

        const update = {};

        if (newId !== oldId) {
          update[`system.valueStates.${oldId}`] = "unused";
          update[`system.valueStates.${newId}`] = oldState;

          try {
            const curPrimary = String(
              log.getFlag?.(MODULE_ID, "primaryValueId") ?? ""
            );
            if (curPrimary === oldId)
              update[`flags.${MODULE_ID}.primaryValueId`] = newId;
          } catch (_) {
            // ignore
          }

          try {
            const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
            const linkVal = String(link?.valueId ?? "");
            if (linkVal === oldId) {
              update[`flags.${MODULE_ID}.callbackLink.valueId`] = newId;
            }
          } catch (_) {
            // ignore
          }

          try {
            const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
            const arcVal = String(arcInfo?.valueId ?? "");
            if (arcVal === oldId) {
              update[`flags.${MODULE_ID}.arcInfo.valueId`] = newId;
            }
          } catch (_) {
            // ignore
          }
        }

        try {
          const existingLabels =
            log.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
          const cloned =
            existingLabels && typeof existingLabels === "object"
              ? foundry.utils.deepClone(existingLabels)
              : {};
          if (oldKey) delete cloned[String(oldKey)];
          if (newKey) cloned[String(newKey)] = newText;
          update[`flags.${MODULE_ID}.directiveLabels`] = cloned;
        } catch (_) {
          // ignore
        }

        try {
          await log.update(update, { render: false, renderSheet: false });
        } catch (_) {
          // ignore
        }

        try {
          refreshMissionLogSortingForActorId(actor.id);
        } catch (_) {
          // ignore
        }

        // Re-render to rebuild the inline rows with the new id.
        try {
          log?.sheet?.render?.(false);
        } catch (_) {
          // ignore
        }
      };

      textInput.addEventListener("change", (ev) => {
        try {
          ev?.stopPropagation?.();
        } catch (_) {
          // ignore
        }
        void onTextChange();
      });

      removeBtn.addEventListener("click", async (ev) => {
        try {
          ev?.preventDefault?.();
          ev?.stopPropagation?.();
        } catch (_) {
          // ignore
        }

        const oldId = String(d.valueId);
        const oldKey = getDirectiveKeyFromValueId(oldId);

        const update = {
          [`system.valueStates.${oldId}`]: "unused",
        };

        // If this directive is referenced by log metadata, clear it.
        try {
          const curPrimary = String(
            log.getFlag?.(MODULE_ID, "primaryValueId") ?? ""
          );
          if (curPrimary === oldId) {
            update[`flags.${MODULE_ID}.primaryValueId`] = null;
            update[`flags.${MODULE_ID}.primaryDirectiveKey`] = null;

            // Clear callback link (cannot keep a link without a valueId).
            update[`flags.${MODULE_ID}.callbackLink`] = null;
            update[`flags.${MODULE_ID}.callbackLinkDisabled`] = true;

            // Clear arc info if it depended on this directive.
            update[`flags.${MODULE_ID}.arcInfo`] = null;

            // Restore default icon.
            if (STA_DEFAULT_ICON) update.img = STA_DEFAULT_ICON;
          }
        } catch (_) {
          // ignore
        }

        try {
          const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? null;
          const linkVal = String(link?.valueId ?? "");
          if (linkVal === oldId) {
            update[`flags.${MODULE_ID}.callbackLink`] = null;
            update[`flags.${MODULE_ID}.callbackLinkDisabled`] = true;
          }
        } catch (_) {
          // ignore
        }

        try {
          const arcInfo = log.getFlag?.(MODULE_ID, "arcInfo") ?? null;
          const arcVal = String(arcInfo?.valueId ?? "");
          if (arcVal === oldId) {
            update[`flags.${MODULE_ID}.arcInfo`] = null;
          }
        } catch (_) {
          // ignore
        }

        // Remove from directiveLabels map so it is no longer considered invoked/displayed.
        try {
          if (oldKey) {
            const existingLabels =
              log.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
            const cloned =
              existingLabels && typeof existingLabels === "object"
                ? foundry.utils.deepClone(existingLabels)
                : {};
            if (Object.prototype.hasOwnProperty.call(cloned, String(oldKey))) {
              delete cloned[String(oldKey)];
              update[`flags.${MODULE_ID}.directiveLabels`] = cloned;
            }
          }
        } catch (_) {
          // ignore
        }

        try {
          await log.update(update, { render: false, renderSheet: false });
        } catch (_) {
          // ignore
        }

        try {
          row.remove();
        } catch (_) {
          // ignore
        }

        try {
          refreshMissionLogSortingForActorId(actor.id);
        } catch (_) {
          // ignore
        }

        try {
          log?.sheet?.render?.(false);
        } catch (_) {
          // ignore
        }
      });

      anchor.after(row);
      anchor = row;
    }
  };

  installInlineInvokedDirectiveRows();
  installAddDirectiveButton();

  // On open: if we already have a callback target selected, align Primary Value
  // to match that target (legacy data normalization). Only auto-save if this
  // alignment actually changes the Primary Value.
  const _openFromLogId = String(fromSelect.value ?? "");
  const _openValueId = String(valueSelect.value ?? "");
  const _hasPersistedPrimary = Boolean(String(persistedPrimary ?? "").trim());
  if (!_hasPersistedPrimary && _openFromLogId) {
    alignPrimaryValueToCallbackTarget();
  }

  // Ensure hidden fields are initialized to match current UI.
  syncFormFields();

  if (
    !_hasPersistedPrimary &&
    _openFromLogId &&
    String(valueSelect.value ?? "") !== _openValueId
  ) {
    scheduleSave();
  }

  // No auto-save on open (except legacy normalization above).
}
