import { MODULE_ID } from "../../constants.js";
import { STA_DEFAULT_ICON } from "../../values.js";
import { isLogUsed } from "../../mission.js";
import { isCallbackTargetCompatibleWithValue } from "../../callbackEligibility.js";
import {
  computeBestChainEndingAt,
  getCallbackLogEdgesForValue,
} from "../../arcChains.js";
import {
  canCurrentUserChangeActor,
  rerenderOpenStaSheetsForActorId,
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
        await log.update({ img: STA_DEFAULT_ICON });
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
      await log.update({ img: desiredImg });
    } catch (_) {
      // ignore
    }
  }
}

export async function promptLinkLogToChain({ actor, log }) {
  if (!actor || actor.type !== "character") return;
  if (!log || log.type !== "log") return;
  if (!canCurrentUserChangeActor(actor)) return;

  const escapeHTML = (s) => foundry.utils.escapeHTML(String(s ?? ""));

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
    await log.unsetFlag?.(MODULE_ID, "callbackLink");

    // Mark an explicit override so milestone-derived edges don't keep it in a chain.
    try {
      await log.setFlag?.(MODULE_ID, "callbackLinkDisabled", true);
    } catch (_) {
      // ignore
    }

    // Still allow the user to change the icon via the Value dropdown.
    await _syncLogImgToValue(actor, log, valueId);
  } else {
    // Clear explicit override when setting a link.
    try {
      await log.unsetFlag?.(MODULE_ID, "callbackLinkDisabled");
    } catch (_) {
      // ignore
    }

    await log.setFlag(MODULE_ID, "callbackLink", { fromLogId, valueId });

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

  if (sheetRoot.querySelector(":scope > .sta-log-link-controls")) return;

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

  const escapeHTML = (s) => foundry.utils.escapeHTML(String(s ?? ""));

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

  const completedArcEndLogIds = getCompletedArcEndLogIds(actor);

  const isEligibleFromLogId = (targetLogId, currentValueId) => {
    const tId = targetLogId ? String(targetLogId) : "";
    const vId = currentValueId ? String(currentValueId) : "";
    if (!tId) return true;

    // Prevent linking to logs that have already been used for a callback.
    // Keep the current selection available so existing data isn't broken.
    if (tId !== String(selectedFromLogId)) {
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
      if (!eligible && id !== String(selectedFromLogId)) continue;

      const sel = id === String(selectedFromLogId) ? " selected" : "";

      const disabled = eligible ? "" : " disabled";
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
      <label style="display:flex;align-items:center;gap:0.35rem;">
        <input type="checkbox" data-sta-callbacks-field="isArcEnd" ${
          isArcEnd ? "checked" : ""
        } />
        <span>Mark as arc end</span>
      </label>

      <label style="display:flex;align-items:center;gap:0.35rem;margin-top:0.25rem;">
        <span style="opacity:0.85;">Steps</span>
        <input type="number" data-sta-callbacks-field="arcSteps" min="1" step="1" value="${escapeHTML(
          String(initialArcSteps)
        )}" style="width:64px;" />
      </label>
    </div>
  `;

  const firstRow = sheetRoot.querySelector(":scope > .row");
  const insertBeforeEl = firstRow?.nextElementSibling ?? null;
  if (insertBeforeEl) sheetRoot.insertBefore(wrapper, insertBeforeEl);
  else sheetRoot.prepend(wrapper);

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
  if (!(fromSelect instanceof HTMLSelectElement)) return;
  if (!(valueSelect instanceof HTMLSelectElement)) return;
  if (!(arcToggle instanceof HTMLInputElement)) return;
  if (!(arcStepsInput instanceof HTMLInputElement)) return;

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

  const apply = async () => {
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
    if (fromLogId) {
      const target = actor.items.get(String(fromLogId));
      if (target?.type === "log" && isLogUsed(target)) {
        ui.notifications?.warn?.(
          "That log has already been used for a callback."
        );
        fromSelect.value = "";
        fromLogId = "";
      }
    }

    // Persist the primary value selection (even if not linked).
    try {
      if (!valueId) await log.unsetFlag?.(MODULE_ID, "primaryValueId");
      else await log.setFlag?.(MODULE_ID, "primaryValueId", valueId);
    } catch (_) {
      // ignore
    }

    // Arc end toggle: allow manual completion marking even if logs are edited later.
    // Requires a stable Primary Value so arc/chain rules remain consistent.
    if (wantsArcEnd) {
      const arcValueId = valueId || existingArcValueId || existingValue;
      if (!arcValueId) {
        ui.notifications?.warn?.(
          "Select a Primary Value before marking an Arc end."
        );
        arcToggle.checked = false;
        try {
          await log.unsetFlag?.(MODULE_ID, "arcInfo");
        } catch (_) {
          // ignore
        }
      } else {
        const steps = parseSteps();

        // Disallow reusing nodes already consumed by OTHER arcs.
        const disallowNodeIds = new Set();
        try {
          const actorLogs = Array.from(actor.items ?? []).filter(
            (i) => i?.type === "log"
          );
          for (const other of actorLogs) {
            if (String(other.id) === String(log.id)) continue;
            const otherArc = other.getFlag?.(MODULE_ID, "arcInfo") ?? null;
            if (otherArc?.isArc !== true) continue;
            const otherChain = Array.isArray(otherArc.chainLogIds)
              ? otherArc.chainLogIds
              : [];
            for (const id of otherChain) {
              if (id) disallowNodeIds.add(String(id));
            }
          }
        } catch (_) {
          // ignore
        }

        let chainLogIds = [];
        try {
          const { incoming } = getCallbackLogEdgesForValue(
            actor,
            String(arcValueId)
          );
          const computed = computeBestChainEndingAt({
            incoming,
            endLogId: String(log.id),
            disallowNodeIds,
          });
          const full = Array.isArray(computed?.chainLogIds)
            ? computed.chainLogIds.map((x) => String(x)).filter(Boolean)
            : [];
          chainLogIds = full.length > steps ? full.slice(-steps) : full;
        } catch (_) {
          chainLogIds = [];
        }

        await log.setFlag(MODULE_ID, "arcInfo", {
          isArc: true,
          steps,
          chainLogIds,
          valueId: String(arcValueId),
        });
      }
    } else {
      // Unmark arc completion
      try {
        await log.unsetFlag?.(MODULE_ID, "arcInfo");
      } catch (_) {
        // ignore
      }
    }

    if (!fromLogId) {
      await log.unsetFlag?.(MODULE_ID, "callbackLink");
      try {
        await log.setFlag?.(MODULE_ID, "callbackLinkDisabled", true);
      } catch (_) {
        // ignore
      }
    } else {
      try {
        await log.unsetFlag?.(MODULE_ID, "callbackLinkDisabled");
      } catch (_) {
        // ignore
      }
      await log.setFlag?.(MODULE_ID, "callbackLink", { fromLogId, valueId });
    }

    await _syncLogImgToValue(actor, log, valueId);

    rerenderOpenStaSheetsForActorId(actor.id);
  };

  fromSelect.addEventListener("change", () => void apply());
  valueSelect.addEventListener("change", () => {
    refreshFromOptions();
    void apply();
  });

  arcToggle.addEventListener("change", () => void apply());
  arcStepsInput.addEventListener("change", () => void apply());

  // Ensure the fromLog options reflect the current primary value on initial render.
  refreshFromOptions();
}
