import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import {
  DIRECTIVE_MAX_LEN,
  getMissionDirectives,
  openDirectiveSettingsDialog,
  rerenderStaTracker,
  setMissionDirectives,
} from "../directives/directives.js";
import { promptUseDirective } from "../directives/useDirectiveButton.js";
import { hasActiveMission } from "../missions/mission.js";
import { MissionManagerApp } from "../missions/MissionManagerApp.mjs";
import {
  areSimpleTraitsEnabled,
  getSimpleTraits,
  setSimpleTraits,
  SIMPLE_TRAIT_MAX_LEN,
} from "../settings/clientSettings.js";

const TRACKER_BUTTONS_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-buttons.hbs`;
const TRACKER_DIRECTIVES_TEMPLATE = `modules/${MODULE_ID}/templates/tracker-directives.hbs`;
const STA_UTILS_MODULE_ID = "sta-utils";
let _traitTrackerRefreshHooksInstalled = false;
let _lastTrackerDirectivesView = "directives";
/** @type {foundry.applications.ux.ContextMenu|null} */
let _trackerTraitContextMenu = null;
let _sceneChangeTrackerRefreshHookInstalled = false;

/**
 * Find the Foundry player list element, trying v13 and v12 selectors.
 * @returns {HTMLElement|null}
 */
function _getPlayerListElement() {
  return (
    document.querySelector("#player-list") ??
    document.querySelector("#players") ??
    null
  );
}

/**
 * Position the tracker so its bottom edge sits just above the player list.
 * Measures live DOM positions, so it adapts to any scale and to the player
 * list being expanded or collapsed.
 *
 * @param {HTMLElement} trackerContainer
 */
function _anchorTrackerBottomEdge(trackerContainer) {
  if (!(trackerContainer instanceof HTMLElement)) return;

  // Clear any previous offset so getBoundingClientRect reflects natural flow.
  trackerContainer.style.removeProperty("position");
  trackerContainer.style.removeProperty("top");

  const playerList = _getPlayerListElement();
  if (!playerList) return;

  const trackerRect = trackerContainer.getBoundingClientRect();
  const playerRect = playerList.getBoundingClientRect();

  const GAP = 4; // px gap between tracker bottom and player list top
  const delta = trackerRect.bottom - (playerRect.top - GAP);
  if (Math.abs(delta) < 1) return; // already in position

  trackerContainer.style.position = "relative";
  trackerContainer.style.top = `${-delta}px`;
}

function _normalizeTrackerView(view) {
  if (view === "sceneTraits" || view === "worldTraits") return "traits";
  if (view === "traits") return "traits";
  return "directives";
}

function _isV14OrNewer() {
  const generation = Number(game.release?.generation ?? 0);
  if (Number.isFinite(generation) && generation > 0) return generation >= 14;

  const major = Number(String(game.version ?? "").split(".")[0] ?? 0);
  return Number.isFinite(major) && major >= 14;
}

async function _confirmDeleteTrait(itemName) {
  const title = t("sta-officers-log.tracker.deleteTraitTitle");
  const content = tf("sta-officers-log.tracker.deleteTraitConfirm", {
    name: String(itemName ?? ""),
  });

  const dialogV2 = foundry?.applications?.api?.DialogV2;
  if (dialogV2?.confirm) {
    return Boolean(
      await dialogV2.confirm({
        window: { title },
        content: `<p>${_escapeHtml(content)}</p>`,
      }),
    );
  }

  return Boolean(
    await Dialog.confirm({
      title,
      content: `<p>${_escapeHtml(content)}</p>`,
    }),
  );
}

function _escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

async function _getTraitDescriptionTooltip(item) {
  let rawDescription =
    foundry.utils.getProperty(item, "system.description.value") ??
    foundry.utils.getProperty(item, "system.description") ??
    "";
  if (typeof rawDescription !== "string") {
    rawDescription = rawDescription?.value ?? "";
  }
  rawDescription = String(rawDescription).trim();
  if (!rawDescription) return "";

  return foundry.applications.ux.TextEditor.enrichHTML(rawDescription, {
    async: true,
    documents: true,
    rolls: true,
    secrets: false,
  });
}

function _getRectOverlapArea(a, b) {
  const xOverlap = Math.max(
    0,
    Math.min(a.right, b.right) - Math.max(a.left, b.left),
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  );
  return xOverlap * yOverlap;
}

function _getViewportOverflowArea(rect, pad = 8) {
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const leftOverflow = Math.max(0, pad - rect.left);
  const topOverflow = Math.max(0, pad - rect.top);
  const rightOverflow = Math.max(0, rect.right - (vw - pad));
  const bottomOverflow = Math.max(0, rect.bottom - (vh - pad));

  return (
    leftOverflow * Math.max(1, rect.height) +
    rightOverflow * Math.max(1, rect.height) +
    topOverflow * Math.max(1, rect.width) +
    bottomOverflow * Math.max(1, rect.width)
  );
}

function _getLeftUiCollisionRects() {
  const roots = Array.from(
    document.querySelectorAll("#ui-left #ui-left-column-1 > *"),
  );

  return roots
    .map((el) => {
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity || "1") <= 0
      ) {
        return null;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return r;
    })
    .filter(Boolean);
}

function _evaluateDirectivesPlacement(section, blockers) {
  section.dataset.placement = "above";
  const rect = section.getBoundingClientRect();
  const overlapArea = blockers.reduce(
    (sum, blocker) => sum + _getRectOverlapArea(rect, blocker),
    0,
  );
  const overflowArea = _getViewportOverflowArea(rect, 8);
  const score = overlapArea * 5 + overflowArea;
  return { placement: "above", score, overlapArea, overflowArea };
}

function _layoutDirectivesSection(section) {
  if (!(section instanceof HTMLElement)) return;

  const viewportH =
    window.innerHeight || document.documentElement.clientHeight || 900;
  section.style.overflowY = "auto";
  section.dataset.compact = "false";

  const blockers = _getLeftUiCollisionRects();
  const trackerContainer = section.closest(".tracker-container");
  const trackerRect = trackerContainer?.getBoundingClientRect?.();
  const aboveSpace = trackerRect
    ? Math.max(0, Math.floor(trackerRect.top - 8))
    : Math.floor(viewportH * 0.45);
  const preferredMax = Math.max(
    145,
    Math.min(aboveSpace, Math.floor(viewportH * 0.4)),
  );

  section.dataset.placement = "above";
  section.style.maxHeight = `${preferredMax}px`;
  const best = _evaluateDirectivesPlacement(section, blockers);

  const finalMax = Math.max(
    145,
    Math.min(aboveSpace, Math.floor(viewportH * 0.4)),
  );
  section.style.maxHeight = `${finalMax}px`;

  const needsCompact = Boolean(
    (best && best.score > 0) ||
    section.scrollHeight > section.clientHeight + 2 ||
    finalMax < 190,
  );

  if (!needsCompact) return;

  section.dataset.compact = "true";
  section.style.maxHeight = `${Math.max(130, Math.min(finalMax, Math.floor(viewportH * 0.32)))}px`;

  _evaluateDirectivesPlacement(section, blockers);
}

function _closeTrackerTraitContextMenu() {
  try {
    if (_trackerTraitContextMenu?.element) {
      _trackerTraitContextMenu.close();
    }
  } catch (_) {
    // ignore
  } finally {
    _trackerTraitContextMenu = null;
  }
}

function _installTrackerTraitContextMenu(section, root) {
  if (!(section instanceof HTMLElement)) return;
  if (!game.user?.isGM) return;

  _closeTrackerTraitContextMenu();
  const isV14OrNewer = _isV14OrNewer();

  const resolveTargetElement = (target) =>
    target instanceof HTMLElement
      ? target
      : target?.[0] instanceof HTMLElement
        ? target[0]
        : null;

  const handleDeleteTraitClick = async (target) => {
    try {
      const element = resolveTargetElement(target);
      const uuid = element?.dataset?.uuid;
      if (!uuid) return;

      const item = await fromUuid(uuid);
      if (!item) return;

      const confirmed = await _confirmDeleteTrait(item.name);
      if (!confirmed) return;

      await item.delete();
      await installMissionDirectivesInStaTracker(root);
    } catch (err) {
      console.error(`${MODULE_ID} | delete trait failed`, err);
      ui.notifications?.warn?.(t("sta-officers-log.tracker.deleteTraitFailed"));
    }
  };

  /** @type {ContextMenuEntry[]} */
  const menuItems = [
    {
      ...(isV14OrNewer
        ? { label: t("sta-officers-log.tracker.deleteTrait") }
        : { name: t("sta-officers-log.tracker.deleteTrait") }),
      icon: '<i class="fa-solid fa-trash"></i>',
      ...(isV14OrNewer
        ? {
            onClick: async (_event, target) => handleDeleteTraitClick(target),
          }
        : {
            callback: async (target) => handleDeleteTraitClick(target),
          }),
    },
  ];

  _trackerTraitContextMenu = new foundry.applications.ux.ContextMenu(
    section,
    ".sta-tracker-trait-btn",
    menuItems,
    { fixed: true, jQuery: false },
  );
}

function _isSceneOrWorldTraitActor(actor) {
  if (!actor || actor.type !== "scenetraits") return false;

  const sceneTraitActor = _getSceneTraitActor();
  if (actor.id === sceneTraitActor?.id) return true;

  if (actor.getFlag(STA_UTILS_MODULE_ID, "isWorldTraitActor") === true) {
    return true;
  }

  const worldTraitUuid = game.settings.get(
    STA_UTILS_MODULE_ID,
    "worldTraitsActorUuid",
  );
  return Boolean(worldTraitUuid && actor.uuid === worldTraitUuid);
}

function _installTraitTrackerRefreshHooks() {
  if (_traitTrackerRefreshHooksInstalled) return;
  _traitTrackerRefreshHooksInstalled = true;

  const maybeRefresh = (item) => {
    try {
      if (item?.type !== "trait") return;
      const actor = item.parent;
      if (!_isSceneOrWorldTraitActor(actor)) return;
      rerenderStaTracker();
    } catch (_) {
      // best-effort tracker refresh
    }
  };

  Hooks.on("createItem", (item) => maybeRefresh(item));
  Hooks.on("updateItem", (item) => maybeRefresh(item));
  Hooks.on("deleteItem", (item) => maybeRefresh(item));

  Hooks.on("createActor", (actor) => {
    if (actor?.type !== "scenetraits") return;
    rerenderStaTracker();
  });

  Hooks.on("deleteActor", (actor) => {
    if (actor?.type !== "scenetraits") return;
    rerenderStaTracker();
  });

  Hooks.on("updateScene", (scene, changes) => {
    if (scene?.id !== canvas?.scene?.id) return;
    if (
      !foundry.utils.hasProperty(
        changes,
        `flags.${STA_UTILS_MODULE_ID}.sceneTraitsActorId`,
      )
    )
      return;
    rerenderStaTracker();
  });
}

function _installSceneChangeTrackerRefreshHook() {
  if (_sceneChangeTrackerRefreshHookInstalled) return;
  _sceneChangeTrackerRefreshHookInstalled = true;

  Hooks.on("canvasReady", async () => {
    try {
      await game.staUtils?.ensureActiveSceneTraitsActor?.();
    } catch (_) {
      // Trait actor ensure is best-effort.
    }

    try {
      await rerenderStaTracker();
    } catch (_) {
      // Tracker rerender is optional.
    }
  });
}

// Lazy-resolved helpers from sta-utils — avoids a hard import-time dependency.
function _getSceneTraitActor() {
  const scene = canvas?.scene;
  if (!scene) return null;

  const sharedResolver = game.staUtils?.getSceneTraitsActor;
  if (typeof sharedResolver === "function") {
    return sharedResolver() ?? null;
  }

  const configuredActorId = scene.getFlag(
    STA_UTILS_MODULE_ID,
    "sceneTraitsActorId",
  );
  if (configuredActorId) {
    const configuredActor = game.actors.get(configuredActorId);
    if (configuredActor) return configuredActor;
  }

  return (
    Array.from(game.actors ?? []).find(
      (a) =>
        a?.type === "scenetraits" &&
        a.getFlag(STA_UTILS_MODULE_ID, "proxyForSceneId") === scene.id,
    ) ?? null
  );
}

async function _getWorldTraitActor() {
  const sharedResolver = game.staUtils?.getWorldTraitsActor;
  if (typeof sharedResolver === "function") {
    return (await sharedResolver()) ?? null;
  }

  let actor = null;
  try {
    const uuid = game.settings.get(STA_UTILS_MODULE_ID, "worldTraitsActorUuid");
    if (uuid) actor = (await fromUuid(uuid)) ?? null;
  } catch (_) {
    // setting read is best-effort
  }
  if (!actor) {
    actor =
      Array.from(game.actors ?? []).find(
        (a) => a?.getFlag(STA_UTILS_MODULE_ID, "isWorldTraitActor") === true,
      ) ?? null;
  }
  return actor;
}

function _getSceneTraitItems() {
  const sharedList = game.staUtils?.getSceneTraitItems;
  if (typeof sharedList === "function") return sharedList();

  const actor = _getSceneTraitActor();
  if (!actor) return [];
  return Array.from(actor.items ?? [])
    .filter((item) => item?.type === "trait")
    .filter(
      (item) =>
        game.user?.isGM ||
        (item.getFlag(STA_UTILS_MODULE_ID, "visible") ?? true) !== false,
    )
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

async function _getWorldTraitItems() {
  const sharedList = game.staUtils?.getWorldTraitItems;
  if (typeof sharedList === "function") return sharedList();

  const actor = await _getWorldTraitActor();
  if (!actor) return [];
  return Array.from(actor.items ?? [])
    .filter((item) => item?.type === "trait")
    .filter(
      (item) =>
        game.user?.isGM ||
        (item.getFlag(STA_UTILS_MODULE_ID, "visible") ?? true) !== false,
    )
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

async function _ensureObserverOwnership(actor) {
  if (!actor || actor.pack || !actor.isOwner) return;
  const observer = Number(CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2);
  const current = Number(actor?.ownership?.default ?? 0);
  if (Number.isFinite(current) && current >= observer) return;

  try {
    await actor.update({
      ownership: {
        ...(actor.ownership ?? {}),
        default: observer,
      },
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Failed to set observer ownership`, err);
  }
}

async function _createTraitOnActor(actor, root) {
  if (!actor) return;
  await _ensureObserverOwnership(actor);
  const createData = {
    name: t("sta-officers-log.tracker.newTraitDefaultName"),
    type: "trait",
  };

  const [created] = await actor.createEmbeddedDocuments("Item", [createData]);
  await installMissionDirectivesInStaTracker(root);
  created?.sheet?.render(true);
}

async function _listTraitItems(items, emptyLabel) {
  if (!items.length) {
    return `<ul class="sta-tracker-directives-list"><li class="sta-tracker-directive-item sta-tracker-directive-empty">${_escapeHtml(emptyLabel)}</li></ul>`;
  }
  const rows = (
    await Promise.all(
      items.map(async (item) => {
        const rawQty =
          item?.system?.quantity?.value ?? item?.system?.quantity ?? null;
        const qty =
          rawQty === null || rawQty === undefined || rawQty === ""
            ? null
            : Number(rawQty);
        const displayName =
          Number.isFinite(qty) && qty >= 0 && qty !== 1
            ? `${String(item?.name ?? "")} ${qty}`
            : String(item?.name ?? "");
        const descriptionTooltip = await _getTraitDescriptionTooltip(item);
        const tooltipAttributes = descriptionTooltip
          ? ` data-tooltip="${_escapeHtml(descriptionTooltip)}" data-tooltip-direction="UP"`
          : "";

        return (
          `<li class="sta-tracker-directive-item">` +
          `<button type="button" class="sta-tracker-trait-btn" data-action="openTraitSheet" data-uuid="${_escapeHtml(item.uuid)}"${tooltipAttributes}>${_escapeHtml(displayName)}</button>` +
          `</li>`
        );
      }),
    )
  ).join("");
  return `<ul class="sta-tracker-directives-list">${rows}</ul>`;
}

function _listSimpleTraits(traits, emptyLabel) {
  if (!traits.length) {
    return `<ul class="sta-tracker-directives-list"><li class="sta-tracker-directive-item sta-tracker-directive-empty">${_escapeHtml(emptyLabel)}</li></ul>`;
  }

  const rows = traits
    .map(
      (trait) =>
        `<li class="sta-tracker-directive-item">${_escapeHtml(trait)}</li>`,
    )
    .join("");
  return `<ul class="sta-tracker-directives-list">${rows}</ul>`;
}

const TRACKER_INFO_CONFIG = [
  {
    label: "Momentum",
    key: "momentum",
    title: "Momentum",
  },
  {
    label: "Threat",
    key: "threat",
    title: "Threat",
  },
];

/**
 * Open the Manage Missions dialog (ApplicationV2 with history list).
 */
function _manageMissions() {
  new MissionManagerApp().render(true);
}

/**
 * Install Officers Log buttons in the STA Tracker panel.
 * GM-only feature that adds buttons for conflict reference, mission manager, and roll request.
 */
export async function installOfficersLogButtonsInStaTracker(app, root) {
  try {
    // Tracker button injection has been moved to sta-utils.
    // Officers Log still exposes the API and tracker dialogs, but does not
    // own the tracker button layout anymore.
    void app;
    void root;
  } catch (_) {
    // tracker integration is optional
  }
}

/**
 * Install the Mission Directives section in the STA Tracker.
 * Shows current directives with edit capability for GMs.
 *
 * @param {HTMLElement} root - The root element to search for the tracker container.
 */
export async function installMissionDirectivesInStaTracker(root) {
  try {
    if (!(root instanceof HTMLElement)) return;
    _installTraitTrackerRefreshHooks();
    _installSceneChangeTrackerRefreshHook();

    const directives = getMissionDirectives();
    const traitsSimpleMode = areSimpleTraitsEnabled();
    const traitsItemMode = !traitsSimpleMode;
    const simpleTraits = traitsSimpleMode ? getSimpleTraits() : [];

    // Find the tracker container to append to.
    const trackerContainer =
      root.querySelector?.(".tracker-container[data-application-part]") ??
      root.querySelector?.(".tracker-container") ??
      null;
    if (!trackerContainer) return;

    // Remove any existing section so we always rebuild with fresh data.
    // This ensures the directives list updates when directives are edited.
    const existingSection = trackerContainer.querySelector?.(
      ".sta-tracker-directives-section",
    );
    const activeView =
      existingSection?.dataset?.view ||
      trackerContainer.dataset?.staDirectivesView ||
      _lastTrackerDirectivesView ||
      "directives";
    const normalizedView = _normalizeTrackerView(activeView);
    _lastTrackerDirectivesView = normalizedView;
    trackerContainer.dataset.staDirectivesView = normalizedView;
    if (existingSection) {
      _closeTrackerTraitContextMenu();
      existingSection.remove();
    }

    // Render the directives section from template.
    // Resolve trait sources before stringifying so async world lookups work.
    const sceneTraitActor = traitsItemMode ? _getSceneTraitActor() : null;
    const worldTraitActor = traitsItemMode ? await _getWorldTraitActor() : null;
    const sceneTraitItems = traitsItemMode
      ? await Promise.resolve(_getSceneTraitItems())
      : [];
    const worldTraitItems = traitsItemMode
      ? await Promise.resolve(_getWorldTraitItems())
      : [];
    const sceneTraitsHtml = traitsItemMode
      ? await _listTraitItems(sceneTraitItems, "No scene traits yet.")
      : "";
    const worldTraitsHtml = traitsItemMode
      ? await _listTraitItems(worldTraitItems, "No world traits yet.")
      : "";
    const simpleTraitsHtml = traitsSimpleMode
      ? _listSimpleTraits(
          simpleTraits,
          t("sta-officers-log.tracker.noSimpleTraits"),
        )
      : "";
    const html = await foundry.applications.handlebars.renderTemplate(
      TRACKER_DIRECTIVES_TEMPLATE,
      {
        isGM: game.user?.isGM ?? false,
        directives,
        hasDirectives: directives.length > 0,
        directivesText: directives.join("\n"),
        activeView: normalizedView,
        viewIsDirectives: normalizedView === "directives",
        viewIsTraits: normalizedView === "traits",
        showUseDirective: normalizedView === "directives",
        showEditDirectives: normalizedView === "directives",
        showEditSimpleTraits:
          normalizedView === "traits" &&
          traitsSimpleMode &&
          (game.user?.isGM ?? false),
        traitsSimpleMode,
        traitsItemMode,
        simpleTraitsText: simpleTraits.join("\n"),
        simpleTraitsHtml,
        canCreateSceneTrait: Boolean(game.user?.isGM && sceneTraitActor),
        canCreateWorldTrait: Boolean(game.user?.isGM && worldTraitActor),
        sceneTraitsHtml,
        worldTraitsHtml,
      },
    );

    // Parse the HTML and append to get a direct reference to the section
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const section = temp.firstElementChild;
    if (!section) return;
    section.dataset.view = normalizedView;
    trackerContainer.appendChild(section);
    _layoutDirectivesSection(section);
    _anchorTrackerBottomEdge(trackerContainer);
    if (traitsItemMode) {
      _installTrackerTraitContextMenu(section, root);
    }

    // Attach event listeners
    const editButton = section.querySelector('[data-action="toggleEdit"]');
    const saveButton = section.querySelector('[data-action="saveDirectives"]');
    const editSimpleTraitsButton = section.querySelector(
      '[data-action="toggleSimpleTraitsEdit"]',
    );
    const saveSimpleTraitsButton = section.querySelector(
      '[data-action="saveSimpleTraits"]',
    );
    const useDirectiveButton = section.querySelector(
      '[data-action="useDirective"]',
    );
    const viewTabs = section.querySelectorAll('[data-action="switchView"]');
    const createSceneTraitButton = section.querySelector(
      '[data-action="createSceneTrait"]',
    );
    const createWorldTraitButton = section.querySelector(
      '[data-action="createWorldTrait"]',
    );
    const traitLinks = section.querySelectorAll(
      '[data-action="openTraitSheet"]',
    );
    const textarea = section.querySelector(".sta-tracker-directives-textarea");
    const simpleTraitsTextarea = section.querySelector(
      ".sta-tracker-simple-traits-textarea",
    );

    editButton?.addEventListener("click", () => {
      toggleDirectivesEditMode(section, trackerContainer, root);
    });

    editSimpleTraitsButton?.addEventListener("click", () => {
      toggleSimpleTraitsEditMode(section);
    });

    // "Use Directive" button – resolve the user's character and invoke the flow.
    useDirectiveButton?.addEventListener("click", async (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (_) {
        // event may be synthetic
      }

      const actor = game.user?.character ?? null;
      if (!actor) {
        ui.notifications?.warn?.(t("sta-officers-log.errors.noCharacter"));
        return;
      }

      await promptUseDirective(actor);
    });

    viewTabs.forEach((tab) => {
      tab.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const nextView = _normalizeTrackerView(
          tab.dataset.view || "directives",
        );
        section.dataset.view = nextView;
        trackerContainer.dataset.staDirectivesView = nextView;
        _lastTrackerDirectivesView = nextView;
        installMissionDirectivesInStaTracker(root);
      });

      tab.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const tabView = tab.dataset.view || "directives";
        if (tabView === "traits") {
          const openTraitsDialog = game.staUtils?.openTraitsDialog;
          if (typeof openTraitsDialog === "function") {
            openTraitsDialog(traitsSimpleMode ? null : "sceneTraits");
          } else {
            ui.notifications?.warn?.("Traits dialog is unavailable.");
          }
          return;
        }

        if (tabView === "directives") {
          openDirectiveSettingsDialog();
        }
      });
    });

    createSceneTraitButton?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await _createTraitOnActor(_getSceneTraitActor(), root);
      } catch (err) {
        console.error(`${MODULE_ID} | create scene trait failed`, err);
        ui.notifications?.warn?.(
          t("sta-officers-log.tracker.createTraitFailed"),
        );
      }
    });

    createWorldTraitButton?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await _createTraitOnActor(await _getWorldTraitActor(), root);
      } catch (err) {
        console.error(`${MODULE_ID} | create world trait failed`, err);
        ui.notifications?.warn?.(
          t("sta-officers-log.tracker.createTraitFailed"),
        );
      }
    });

    traitLinks.forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const item = await fromUuid(btn.dataset.uuid);
        item?.sheet?.render(true);
      });
    });

    // Prevent input that would exceed the max character limit per line.
    textarea?.addEventListener("keydown", (event) => {
      // Always allow: Enter, Backspace, Delete, arrow keys, and modifier combos.
      if (
        event.key === "Enter" ||
        event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key.startsWith("Arrow") ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      // For printable characters, check if the current line would exceed the limit.
      if (event.key.length === 1) {
        const lines = textarea.value.split("\n");
        const cursorPos = textarea.selectionStart;

        // Find which line the cursor is on.
        let charCount = 0;
        let currentLineIndex = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineEnd = charCount + lines[i].length;
          if (cursorPos <= lineEnd) {
            currentLineIndex = i;
            break;
          }
          charCount += lines[i].length + 1; // +1 for newline
        }

        const currentLine = lines[currentLineIndex] || "";

        // Block input if this line is already at the max length.
        if (currentLine.length >= DIRECTIVE_MAX_LEN) {
          event.preventDefault();
        }
      }
    });

    simpleTraitsTextarea?.addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" ||
        event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key.startsWith("Arrow") ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      if (event.key.length === 1) {
        const lines = simpleTraitsTextarea.value.split("\n");
        const cursorPos = simpleTraitsTextarea.selectionStart;

        let charCount = 0;
        let currentLineIndex = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineEnd = charCount + lines[i].length;
          if (cursorPos <= lineEnd) {
            currentLineIndex = i;
            break;
          }
          charCount += lines[i].length + 1;
        }

        const currentLine = lines[currentLineIndex] || "";
        if (currentLine.length >= SIMPLE_TRAIT_MAX_LEN) {
          event.preventDefault();
        }
      }
    });

    saveButton?.addEventListener("click", async () => {
      if (!textarea) return;

      const newDirectives = textarea.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await setMissionDirectives(newDirectives);
      // Rebuild the section with fresh data.
      await installMissionDirectivesInStaTracker(root);

      // Notify other connected clients to refresh their tracker so
      // the updated directives appear for everyone.
      try {
        const { getModuleSocket } = await import("../core/socket.js");
        const sock = getModuleSocket();
        if (sock) await sock.executeForOthers("refreshTracker");
      } catch (_) {
        // socket broadcast is best-effort
      }
    });

    saveSimpleTraitsButton?.addEventListener("click", async () => {
      if (!simpleTraitsTextarea) return;

      const newTraits = simpleTraitsTextarea.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      await setSimpleTraits(newTraits);
      await installMissionDirectivesInStaTracker(root);

      try {
        const { getModuleSocket } = await import("../core/socket.js");
        const sock = getModuleSocket();
        if (sock) await sock.executeForOthers("refreshTracker");
      } catch (_) {
        // socket broadcast is best-effort
      }
    });

    // The section is positioned with CSS `position: absolute; bottom: 100%`
    // relative to the app element (the nearest positioned ancestor), so it
    // floats above the tracker and expands upward — no JS positioning needed.
  } catch (_) {
    // directives section is optional
  }
}

/**
 * Install info buttons next to Momentum and Threat labels in the STA Tracker.
 *
 * @param {HTMLElement} root - The root element to search for the tracker container.
 */
export function installTrackerInfoButtonsInStaTracker(root) {
  try {
    if (!(root instanceof HTMLElement)) return;

    const trackerContainer =
      root.querySelector?.(".tracker-container[data-application-part]") ??
      root.querySelector?.(".tracker-container") ??
      null;
    if (!trackerContainer) return;

    for (const config of TRACKER_INFO_CONFIG) {
      const parents = findTrackerLabelParents(trackerContainer, config.label);
      for (const parent of parents) {
        if (!parent || !(parent instanceof HTMLElement)) continue;

        if (
          parent.querySelector?.(
            `.sta-officers-log-info-btn[data-info="${config.key}"]`,
          )
        ) {
          continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "sta-officers-log-info-btn";
        button.dataset.info = config.key;
        button.title = `${config.title} info`;
        button.setAttribute("aria-label", `${config.title} info`);
        button.innerHTML = '<i class="fas fa-info-circle"></i>';

        button.addEventListener("click", async (event) => {
          try {
            event?.preventDefault?.();
            event?.stopPropagation?.();
          } catch (_) {
            // ignore synthetic event
          }

          try {
            const openReference = game.staUtils?.trackerReference;
            if (typeof openReference !== "function") {
              ui.notifications?.warn?.(
                "STA-Utils tracker reference dialogs are unavailable.",
              );
              return;
            }
            await openReference(config.key);
          } catch (err) {
            console.error(`${MODULE_ID} | tracker info dialog failed`, err);
          }
        });

        parent.appendChild(button);
      }
    }
  } catch (_) {
    // info buttons are optional
  }
}

/**
 * Toggle between display and edit mode for the directives section.
 */
function toggleDirectivesEditMode(section, trackerContainer, root) {
  const displayContainer = section.querySelector(
    ".sta-tracker-directives-display",
  );
  const editContainer = section.querySelector(".sta-tracker-directives-edit");
  const editButton = section.querySelector(".sta-tracker-directives-edit-btn");

  if (!displayContainer || !editContainer) return;

  const isEditing = editContainer.style.display !== "none";

  if (isEditing) {
    // Switch to display mode.
    displayContainer.style.display = "";
    editContainer.style.display = "none";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.title = t("sta-officers-log.tracker.editDirectives");
    }
  } else {
    // Switch to edit mode.
    displayContainer.style.display = "none";
    editContainer.style.display = "";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-times"></i>';
      editButton.title = t("sta-officers-log.tracker.cancelEdit");
    }
    // Focus the textarea.
    const textarea = editContainer.querySelector("textarea");
    if (textarea) {
      textarea.focus();
    }
  }

  _layoutDirectivesSection(section);
}

function toggleSimpleTraitsEditMode(section) {
  const displayContainer = section.querySelector(
    ".sta-tracker-simple-traits-display",
  );
  const editContainer = section.querySelector(
    ".sta-tracker-simple-traits-edit",
  );
  const editButton = section.querySelector(
    '[data-action="toggleSimpleTraitsEdit"]',
  );

  if (!displayContainer || !editContainer) return;

  const isEditing = editContainer.style.display !== "none";

  if (isEditing) {
    displayContainer.style.display = "";
    editContainer.style.display = "none";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.title = t("sta-officers-log.tracker.editTraits");
    }
  } else {
    displayContainer.style.display = "none";
    editContainer.style.display = "";
    if (editButton) {
      editButton.innerHTML = '<i class="fas fa-times"></i>';
      editButton.title = t("sta-officers-log.tracker.cancelEdit");
    }

    const textarea = editContainer.querySelector("textarea");
    if (textarea) textarea.focus();
  }

  _layoutDirectivesSection(section);
}

/**
 * Find parent elements that contain a text node matching the target label.
 *
 * @param {HTMLElement} root - Root element to search within.
 * @param {string} label - Exact label to match.
 * @returns {HTMLElement[]} Parent elements containing matching text nodes.
 */
function findTrackerLabelParents(root, label) {
  const matches = new Set();
  const target = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!target) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = String(node?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return text === target
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent) matches.add(parent);
    current = walker.nextNode();
  }

  return Array.from(matches);
}
