/**
 * Creation in Play Tab Injector
 *
 * Injects a "Creation in Play" tab into 2e character sheets when the actor
 * has the `creationInPlay` flag active. Simultaneously hides the Development tab.
 *
 * Compatible with:
 *   - STACharacterSheet2e (default STA sheet)
 *   - LcarsCharacterSheet2e (sta-utils LCARS sheet)
 *
 * @module creation/creationTab
 */

import { MODULE_ID } from "../core/constants.js";
import {
  DISCIPLINE_KEYS,
  DISCIPLINE_LABELS,
  CREATION_TARGETS,
  REMAINING_DEPT_RATINGS,
} from "./creation-wizard-data.mjs";

const TAB_ID = "creation-in-play";
const TEMPLATE = `modules/${MODULE_ID}/templates/creation-tab.hbs`;

/**
 * Compute the current creation-in-play audit for an actor.
 *
 * @param {Actor} actor
 * @param {object} cipFlag  The creationInPlay flag object.
 * @returns {object} Audit data for the template.
 */
function computeAudit(actor, cipFlag) {
  const allItems = Array.from(actor.items ?? []);
  const bonusTalentIds = new Set(cipFlag.bonusTalentIds ?? []);

  const valueCount = allItems.filter((i) => i.type === "value").length;
  const focusCount = allItems.filter((i) => i.type === "focus").length;
  // Exclude species / role bonus talents from the 4-talent count.
  const talentCount = allItems.filter(
    (i) => i.type === "talent" && !bonusTalentIds.has(i.id),
  ).length;

  // Disciplines: all 6 must be > 0 to be "fully defined"
  const system = actor.system;
  const allDisciplines = DISCIPLINE_KEYS.map((k) => ({
    key: k,
    label: DISCIPLINE_LABELS[k],
    value: system?.disciplines?.[k]?.value ?? 0,
  }));
  const undefinedDepts = allDisciplines.filter((d) => d.value === 0);
  const definedDeptCount = allDisciplines.length - undefinedDepts.length;

  const remainingDeptRatings = cipFlag.remainingDeptRatings ?? [
    ...REMAINING_DEPT_RATINGS,
  ];

  const valuesNeeded = Math.max(0, CREATION_TARGETS.values - valueCount);
  const focusesNeeded = Math.max(0, CREATION_TARGETS.focuses - focusCount);
  const talentsNeeded = Math.max(0, CREATION_TARGETS.talents - talentCount);
  const deptsNeeded = undefinedDepts.length;

  const isComplete =
    valuesNeeded === 0 &&
    focusesNeeded === 0 &&
    talentsNeeded === 0 &&
    deptsNeeded === 0;

  return {
    // Values
    valueCount,
    valueTarget: CREATION_TARGETS.values,
    valuesNeeded,
    valueDots: _buildDots(valueCount, CREATION_TARGETS.values),
    // Departments
    definedDeptCount,
    deptTarget: CREATION_TARGETS.departments,
    deptsNeeded,
    undefinedDepts,
    remainingDeptRatings,
    deptDots: _buildDots(definedDeptCount, CREATION_TARGETS.departments),
    // Focuses
    focusCount,
    focusTarget: CREATION_TARGETS.focuses,
    focusesNeeded,
    focusDots: _buildDots(focusCount, CREATION_TARGETS.focuses),
    // Talents
    talentCount,
    talentTarget: CREATION_TARGETS.talents,
    talentsNeeded,
    talentDots: _buildDots(talentCount, CREATION_TARGETS.talents),
    // Pastime (informational only)
    hasPasstime: false,
    // Overall
    isComplete,
    equipmentNotes: cipFlag.equipmentNotes ?? "",
    division: cipFlag.division ?? "",
    primaryDepartments: cipFlag.primaryDepartments ?? [],
  };
}

function _buildDots(filled, total) {
  return Array.from({ length: total }, (_, i) => ({ filled: i < filled }));
}

/**
 * Pre-load the creation tab Handlebars template so that subsequent renders
 * can use the compiled partial synchronously via Handlebars.partials.
 * Call once during module initialisation (Hooks.once("init", ...)).
 */
export function preloadCreationTabTemplate() {
  const fn =
    foundry.applications.handlebars?.loadTemplates ??
    (typeof loadTemplates === "function" ? loadTemplates : null);
  fn?.([TEMPLATE])?.catch?.(() => {});
}

const CIP_DEBUG = true; // set to false to silence debug output
const _cipLog = (...args) => CIP_DEBUG && console.log("[CIP-debug]", ...args);

/**
 * Install the Creation in Play tab into a character sheet.
 *
 * Designed to be called synchronously from a renderApplicationV2 hook so that
 * the tab is injected into the DOM before Foundry's post-render tab activation
 * runs. Uses the pre-compiled Handlebars partial for a synchronous render when
 * the template has been loaded (via preloadCreationTabTemplate); falls back to
 * the async renderTemplate path on the very first call before loading completes.
 *
 * @param {HTMLElement} root   The sheet root element.
 * @param {Actor} actor        The character actor.
 * @param {Application} app    The application instance.
 */
export function installCreationInPlayTab(root, actor, app) {
  // Guard: only for character actors on 2e-compatible sheets
  if (!actor || actor.type !== "character") return;

  const cipFlag = actor.getFlag(MODULE_ID, "creationInPlay");
  if (!cipFlag?.active) return;

  const alreadyPresent = !!root.querySelector(`[data-tab="${TAB_ID}"]`);
  _cipLog(
    `installCreationInPlayTab called — actor: ${actor.name}, tab already in DOM: ${alreadyPresent}, root connected: ${root.isConnected}`,
  );

  // Avoid double-injection
  if (alreadyPresent) return;

  // ── 1. Hide the Development tab ────────────────────────────────────────────
  const devTabBtn = root.querySelector('a[data-tab="development"]');
  const devTabContent = root.querySelector(`.tab[data-tab="development"]`);
  if (devTabBtn) devTabBtn.style.display = "none";
  if (devTabContent) devTabContent.style.display = "none";

  // ── 2. Inject the new tab nav button ───────────────────────────────────────
  const tabNav = root.querySelector("nav.sheet-tabs.tabs");
  if (!tabNav) return;

  const tabBtn = document.createElement("a");
  tabBtn.className = "item";
  tabBtn.dataset.group = "primary";
  tabBtn.dataset.action = "tab";
  tabBtn.dataset.tab = TAB_ID;
  tabBtn.innerHTML = `<i class="fa-solid fa-user-clock"></i> Creation`;
  // Restore active state if this tab was active before the re-render.
  const tabWasActive = app?.tabGroups?.primary === TAB_ID;
  if (tabWasActive) tabBtn.classList.add("active");
  tabNav.appendChild(tabBtn);

  // ── 3. Compute audit and render tab content ─────────────────────────────────
  const audit = computeAudit(actor, cipFlag);
  const templateData = { actor, audit, actorId: actor.id };

  // Prefer synchronous render via the pre-compiled Handlebars partial.
  // This ensures the tab div is in the DOM when Foundry's tab activation runs,
  // which prevents the "blank tab" flicker every time the sheet re-renders.
  const compiled = Handlebars.partials[TEMPLATE];
  _cipLog(
    `template compiled partial available: ${typeof compiled === "function"}`,
  );
  if (typeof compiled === "function") {
    const html = compiled(templateData, {
      allowProtoPropertiesByDefault: true,
    });
    _injectTabContent(root, html, actor, cipFlag, app);
  } else {
    // First-load async fallback (only happens before loadTemplates completes).
    renderTemplate(TEMPLATE, templateData)
      .then((html) => _injectTabContent(root, html, actor, cipFlag, app))
      .catch(console.error);
  }
}

/**
 * Inject the rendered tab HTML into the sheet and wire up button events.
 */
function _injectTabContent(root, html, actor, cipFlag, app) {
  _cipLog(
    `_injectTabContent called — root connected: ${root.isConnected}, already has tab: ${!!root.querySelector(`.tab[data-tab="${TAB_ID}"]`)}`,
  );
  // Guard against double-injection in the async fallback path.
  if (root.querySelector(`.tab[data-tab="${TAB_ID}"]`)) return;

  // ── 4. Inject the tab content div ──────────────────────────────────────────
  const sheetBody =
    root.querySelector(".sheet-body") ??
    root.querySelector("section.sheet-body") ??
    root.querySelector(".window-content");
  if (!sheetBody) return;

  const tabDiv = document.createElement("div");
  tabDiv.className = "tab";
  tabDiv.dataset.group = "primary";
  tabDiv.dataset.tab = TAB_ID;
  // Restore active state if this tab was active before the re-render.
  // app.tabGroups.primary holds the last active tab name across re-renders.
  if (app?.tabGroups?.primary === TAB_ID) {
    tabDiv.classList.add("active");
    _cipLog("restoring active class on tabDiv (was active before re-render)");
  }
  tabDiv.innerHTML = html;

  // Prevent change/input events from bubbling to the parent sheet <form>.
  // Without this, any interaction within the tab triggers _onChangeForm on
  // the sheet, which re-renders the entire window and wipes the injected tab.
  // (Same technique used by the embedded action-chooser in sta-utils.)
  tabDiv.addEventListener("change", (e) => {
    _cipLog(
      `change event on tabDiv — target: ${e.target?.tagName} name="${e.target?.name}" — stopping propagation`,
    );
    e.stopPropagation();
  });
  tabDiv.addEventListener("input", (e) => {
    _cipLog(
      `input event on tabDiv — target: ${e.target?.tagName} name="${e.target?.name}" — stopping propagation`,
    );
    e.stopPropagation();
  });
  // Also stop click propagation for submit-type buttons that might trigger form submit
  tabDiv.addEventListener("click", (e) => {
    _cipLog(
      `click event on tabDiv — target: ${e.target?.tagName}.${e.target?.className} action="${e.target?.dataset?.action ?? e.target?.closest("[data-action]")?.dataset?.action}"`,
    );
  });

  // ── MutationObserver: detect when tabDiv is removed from the DOM ─────────
  if (CIP_DEBUG) {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.removedNodes) {
          if (node === tabDiv || node.contains?.(tabDiv)) {
            console.warn(
              "[CIP-debug] tabDiv was REMOVED from DOM!",
              "\n  mutation target:",
              m.target,
              "\n  stack:",
              new Error().stack.split("\n").slice(1, 6).join("\n"),
            );
            obs.disconnect();
          }
        }
      }
    });
    obs.observe(sheetBody, { childList: true, subtree: true });
  }

  sheetBody.appendChild(tabDiv);

  // ── 5. Wire up button events ────────────────────────────────────────────────
  _wireTabEvents(tabDiv, actor, cipFlag, root);
}

/**
 * Wire up all interactive buttons within the creation-in-play tab.
 */
function _wireTabEvents(tabDiv, actor, cipFlag, sheetRoot) {
  // Define Value
  tabDiv
    .querySelector("[data-action='define-value']")
    ?.addEventListener("click", async () => {
      const { openDefineValueDialog } = await import("./define-dialogs.mjs");
      await openDefineValueDialog(actor);
      // Foundry auto-rerenders the sheet when items change.
    });

  // Define Department (multiple buttons, one per undefined dept)
  for (const btn of tabDiv.querySelectorAll(
    "[data-action='define-department']",
  )) {
    btn.addEventListener("click", async () => {
      const { openDefineDepartmentDialog } =
        await import("./define-dialogs.mjs");
      // Re-fetch the flag so we always use the latest remainingDeptRatings.
      const latestFlag = actor.getFlag(MODULE_ID, "creationInPlay") ?? cipFlag;
      await openDefineDepartmentDialog(actor, latestFlag);
      // Foundry auto-rerenders when actor flags change.
    });
  }

  // Define Focus
  tabDiv
    .querySelector("[data-action='define-focus']")
    ?.addEventListener("click", async () => {
      const { openDefineFocusDialog } = await import("./define-dialogs.mjs");
      await openDefineFocusDialog(actor);
    });

  // Define Talent
  tabDiv
    .querySelector("[data-action='define-talent']")
    ?.addEventListener("click", async () => {
      const { openDefineTalentDialog } = await import("./define-dialogs.mjs");
      await openDefineTalentDialog(actor);
    });

  // Define Pastime
  tabDiv
    .querySelector("[data-action='define-pastime']")
    ?.addEventListener("click", async () => {
      const { openDefinePastimeDialog } = await import("./define-dialogs.mjs");
      await openDefinePastimeDialog(actor);
      // actor.update triggers auto-rerender.
    });

  // Finish Character Creation
  tabDiv
    .querySelector("[data-action='finish-creation']")
    ?.addEventListener("click", async (e) => {
      if (e.currentTarget.disabled) return;
      const confirmed = await Dialog.confirm({
        title: "Finish Character Creation",
        content:
          "<p>This will remove the Creation in Play tab and restore the Development tab. This cannot be undone.</p><p>Are you sure the character is complete?</p>",
        yes: () => true,
        no: () => false,
      });
      if (!confirmed) return;
      await actor.unsetFlag(MODULE_ID, "creationInPlay");
      // unsetFlag triggers auto-rerender.
    });
}
