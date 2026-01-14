import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";
import { isCallbackTargetCompatibleWithValue } from "./callbackEligibility.js";
import { escapeHTML } from "./values.js";

// Use the Handlebars mixin so the app is renderable (provides _renderHTML/_replaceHTML).
const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);

export class CallbackRequestApp extends Base {
  constructor(data, options = {}) {
    super(options);
    this.data = data ?? {};
  }

  static DEFAULT_OPTIONS = {
    id: "sta-callbacks-request",
    window: {
      title: t("sta-officers-log.callback.title") ?? "Making a callback",
    },
    classes: ["sta-callbacks", "sta-officers-log", "callback-request"],
    position: { width: 560 },
    resizable: true,
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/callback-request.hbs`,
    },
  };

  get title() {
    return (
      this.data?.title ??
      t("sta-officers-log.callback.title") ??
      "Making a callback"
    );
  }

  async _prepareContext(_options) {
    const dvs = this.data.defaultValueState ?? "positive";
    const dvi = this.data.defaultValueId
      ? String(this.data.defaultValueId)
      : "";

    const markSelected = (arr) =>
      (arr ?? []).map((v) => ({
        ...v,
        selected: dvi && String(v.id) === dvi && !v.disabled,
      }));

    const values = markSelected(this.data.values);
    const directives = markSelected(this.data.directives);
    const hasDirectives = directives.some((d) => d && d.id);

    return {
      requestId: this.data.requestId,
      targetUserId: this.data.targetUserId,
      actorUuid: this.data.actorUuid,
      bodyHtml: this.data.bodyHtml,
      logs: this.data.logs ?? [],
      hasLogs: Boolean(this.data.hasLogs),
      values,
      directives,
      hasDirectives,
      isPositiveDefault: dvs === "positive",
      isNegativeDefault: dvs === "negative",
      isChallengedDefault: dvs === "challenged",
    };
  }

  _renderInvokedValues(logId, rootEl) {
    const list = rootEl.querySelector('[data-hook="invokedList"]');
    if (!list) return;

    const log = (this.data.logs ?? []).find((l) => l.id === logId);
    const invoked = log?.invoked ?? [];

    if (!invoked.length) {
      const msg =
        t("sta-officers-log.callback.noInvokedValues") ??
        "No invoked values recorded in this log.";
      list.innerHTML = `<li><em>${escapeHTML(msg)}</em></li>`;
      return;
    }

    list.innerHTML = invoked
      .map(
        (v) =>
          `<li><strong>${escapeHTML(
            v.name
          )}</strong> <span style="opacity:.8">(${escapeHTML(
            v.state
          )})</span></li>`
      )
      .join("");
  }

  _attachPartListeners(partId, htmlElement, _options) {
    if (partId !== "form") return;

    // htmlElement is the root of the "form" part for ApplicationV2
    const root = htmlElement;
    if (!root) return;

    // Prevent duplicate bindings on the same DOM node
    if (root.dataset.staCallbacksBound === "1") return;
    root.dataset.staCallbacksBound = "1";

    const form = root.querySelector("form") ?? root; // depending on template wrapper
    const yesBtn = root.querySelector('[data-action="yes"]');
    const noBtn = root.querySelector('[data-action="no"]');

    const valueSel = root.querySelector('[name="valueId"]');
    const logSel = root.querySelector('[name="logId"]');
    const hintEl = root.querySelector("[data-callback-log-hint]");

    // ----- Invoked-values list under the log selector -----
    if (logSel) this._renderInvokedValues(String(logSel.value ?? ""), root);
    logSel?.addEventListener("change", (ev) => {
      this._renderInvokedValues(String(ev.target?.value ?? ""), root);
    });

    // ----- Eligibility filtering (throttled to 1/frame) -----
    const logs = this.data.logs ?? [];
    const logsById = new Map(logs.map((l) => [String(l.id), l]));
    const logInvokedMap = new Map(
      logs.map((l) => [
        l.id,
        new Set(l.invokedIds ?? (l.invoked ?? []).map((x) => x.id)),
      ])
    );

    const logOptions = Array.from(logSel?.options ?? []).filter((o) => o.value);

    let rafScheduled = false;

    const applyEligibility = () => {
      rafScheduled = false;

      const valueId = String(valueSel?.value ?? "");
      const hasValue = Boolean(valueId);

      let anyEligible = false;

      for (const opt of logOptions) {
        if (!hasValue) {
          opt.disabled = true;
          continue;
        }

        const invokedSet = logInvokedMap.get(opt.value);
        const invokedOk = invokedSet ? invokedSet.has(valueId) : false;

        const meta = logsById.get(String(opt.value)) ?? null;
        const targetPrimary = meta?.primaryValueId
          ? String(meta.primaryValueId)
          : "";
        const isArcEnd = meta?.isCompletedArcEnd === true;
        const chainOk = isCallbackTargetCompatibleWithValue({
          valueId,
          targetPrimaryValueId: targetPrimary,
          isCompletedArcEnd: isArcEnd,
        });

        const eligible = invokedOk && chainOk;

        // Add a small hint in the option label when it is blocked by primary value.
        if (!opt.dataset.staBaseLabel)
          opt.dataset.staBaseLabel = opt.textContent;
        opt.textContent = eligible
          ? opt.dataset.staBaseLabel
          : invokedOk && !chainOk
          ? `${opt.dataset.staBaseLabel} (part of another value's arc)`
          : opt.dataset.staBaseLabel;

        opt.disabled = !eligible;
        if (eligible) anyEligible = true;
      }

      // Clear selection if it became disabled
      const selectedOpt = logSel?.selectedOptions?.[0];
      if (selectedOpt?.disabled) logSel.value = "";

      // Auto-select the first eligible log if none is selected, or show placeholder if none eligible
      const eligibleOpts = logOptions.filter((o) => !o.disabled);
      const noEligibleOpt = Array.from(logSel?.options ?? []).find(
        (o) => o.dataset.staNoEligibleLogs
      );

      if (eligibleOpts.length > 0 && !logSel?.value) {
        logSel.value = eligibleOpts[0].value;
        // Update invoked values list to reflect the auto-selected log
        this._renderInvokedValues(String(logSel.value ?? ""), root);
        if (logSel) logSel.disabled = false;
      } else if (anyEligible === false && hasValue && noEligibleOpt) {
        // No eligible logs for the selected value; show placeholder
        logSel.value = "";
        if (logSel) logSel.disabled = true;
      }

      // Hint when a value is selected but no logs match it
      if (hintEl) hintEl.style.display = hasValue && !anyEligible ? "" : "none";

      // Enable YES only if value selected AND selected log is eligible
      const hasLog = Boolean(logSel?.value);
      const selectedOk = hasLog && !logSel?.selectedOptions?.[0]?.disabled;
      if (yesBtn) yesBtn.disabled = !(hasValue && selectedOk);
    };

    const scheduleEligibility = () => {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(applyEligibility);
    };

    valueSel?.addEventListener("change", scheduleEligibility);
    logSel?.addEventListener("change", scheduleEligibility);

    // Initial state
    scheduleEligibility();

    // ----- SocketLib RPC response (Player -> GM) -----
    const sendResponse = (payload) => {
      const sock = game.staCallbacksHelperSocket;
      if (!sock?.executeAsGM) {
        ui.notifications?.error(
          t("sta-officers-log.errors.socketNotAvailable") ??
            "SocketLib socket not available. Is the module initialized on GM and player?"
        );
        return;
      }

      // Defer off the click handler to reduce input-jank warnings
      setTimeout(() => {
        try {
          sock.executeAsGM("deliverCallbackResponse", payload);
        } catch (e) {
          console.error(`${MODULE_ID} | sendResponse failed`, e);
        }
      }, 0);

      this.close();
    };

    noBtn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      sendResponse({
        module: MODULE_ID,
        type: "callback:response",
        requestId: this.data.requestId,
        action: "no",
        targetUserId: this.data.targetUserId,
        actorUuid: this.data.actorUuid,
      });
    });

    yesBtn?.addEventListener("click", (ev) => {
      ev.preventDefault();

      // Read current inputs at click-time
      const logId = String(root.querySelector('[name="logId"]')?.value ?? "");
      const valueId = String(
        root.querySelector('[name="valueId"]')?.value ?? ""
      );
      const valueState =
        root.querySelector('[name="valueState"]:checked')?.value ??
        String(root.querySelector('[name="valueState"]')?.value ?? "") ??
        this.data.defaultValueState ??
        "positive";

      if (!valueId)
        return ui.notifications.warn(
          t("sta-officers-log.warnings.selectValueFirst") ??
            "Select a value first."
        );
      if (!logId)
        return ui.notifications.warn(
          t("sta-officers-log.warnings.selectLogFirst") ?? "Select a log first."
        );
      if (yesBtn?.disabled) return;

      sendResponse({
        module: MODULE_ID,
        type: "callback:response",
        requestId: this.data.requestId,
        targetUserId: this.data.targetUserId,
        actorUuid: this.data.actorUuid,
        action: "yes",
        logId,
        valueId,
        valueState,
      });
    });
  }
}
