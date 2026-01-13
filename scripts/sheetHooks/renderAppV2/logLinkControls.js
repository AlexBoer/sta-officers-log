import { MODULE_ID } from "../../constants.js";
import { STA_DEFAULT_ICON, escapeHTML } from "../../values.js";
import { isLogUsed } from "../../mission.js";
import { isCallbackTargetCompatibleWithValue } from "../../callbackEligibility.js";
import { t } from "../../i18n.js";
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
        <option value="">-</option>
        ${values
          .map((v) => {
            const sel =
              String(v.id) === String(selectedValueId) ? " selected" : "";
            return `<option value="${escapeHTML(v.id)}"${sel}>${escapeHTML(
              v.name
            )}</option>`;
          })
          .join("")}
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

  const refreshFromOptions = () => {
    const curVal = String(valueSelect.value ?? "");
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
    const valueId = String(valueSelect.value ?? "");
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
    const valueId = String(valueSelect.value ?? "");
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
          const v = actor.items.get(String(arcValueId));
          const name = v?.type === "value" ? String(v.name ?? "") : "";
          if (name) arcLabel = name;
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
      const valueItem = valueId ? actor.items.get(valueId) : null;
      const desiredImg =
        valueItem?.type === "value" && valueItem?.img
          ? String(valueItem.img)
          : STA_DEFAULT_ICON;
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
