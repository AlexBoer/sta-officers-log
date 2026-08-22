import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import { escapeHTML, isPlainObject } from "../core/utils.js";
import { getFocusPickerCustomCompendiumKeys } from "../settings/pickerSettings.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

const SPECIES_FOCUS_NAMES_WITH_IMAGES = new Set(
  [
    "Human",
    "Vulcan",
    "Denobulan",
    "Romulan",
    "Andorian",
    "Bajoran",
    "Betazoid",
    "Borg",
    "Cardassian",
    "Dominion",
    "Ferengi",
    "Klingon",
    "Tellarite",
    "Trill",
  ].map((s) => s.toLowerCase()),
);

function _normalizeIndexEntries(indexLike) {
  if (!indexLike) return [];
  if (Array.isArray(indexLike)) return indexLike;

  // Foundry Collections often have .contents
  const contents = indexLike.contents;
  if (Array.isArray(contents)) return contents;

  try {
    if (typeof indexLike.values === "function") {
      return Array.from(indexLike.values());
    }
  } catch (_) {
    // ignore
  }

  return [];
}

async function _getFocusIndexEntries({ packKey }) {
  const key = String(packKey ?? "sta.items-2e");
  const pack = game.packs?.get?.(key) ?? null;
  if (!pack) return { entries: [], error: `Missing compendium pack: ${key}` };

  try {
    // getIndex exists on CompendiumCollection in newer Foundry; pack.index may already be populated.
    if (typeof pack.getIndex === "function") {
      await pack.getIndex({ fields: ["name", "img", "type", "uuid"] });
    }
  } catch (_) {
    // ignore (we can still try pack.index)
  }

  const entries = _normalizeIndexEntries(pack.index);
  return { entries, error: null };
}

async function _getFocusDocumentByUuid(uuid) {
  if (!uuid) return null;
  try {
    const doc = await fromUuid(uuid);
    return doc ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | failed to load focus document`, err);
    return null;
  }
}

function _extractFocusItemData(document) {
  if (!document || typeof document.toObject !== "function") return null;
  const data = document.toObject();
  if (!isPlainObject(data)) return null;
  delete data._id;
  return data;
}

function _extractFocusDescription(source) {
  if (!source) return null;

  const rawDescription =
    foundry.utils.getProperty(source, "system.description.value") ??
    foundry.utils.getProperty(source, "system.description") ??
    source?.system?.description ??
    "";
  if (!rawDescription) return null;
  if (typeof rawDescription === "string") return rawDescription;
  if (
    isPlainObject(rawDescription) &&
    typeof rawDescription.value === "string"
  ) {
    return rawDescription.value;
  }
  return null;
}

function _descriptionHtmlToText(rawDescription) {
  const html = String(rawDescription ?? "").trim();
  if (!html) return "";

  let normalized = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  try {
    const TextEditorImpl =
      globalThis.foundry?.applications?.ux?.TextEditor?.implementation ??
      globalThis.TextEditor ??
      null;
    if (TextEditorImpl && typeof TextEditorImpl.getTextContent === "function") {
      normalized = TextEditorImpl.getTextContent(normalized);
    } else {
      normalized = normalized.replace(/<[^>]*>/g, " ");
    }
  } catch (_) {
    normalized = normalized.replace(/<[^>]*>/g, " ");
  }

  return String(normalized)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function _confirmFocusChoice({ name = "", description = "" } = {}) {
  const unnamedFocusLabel =
    t("sta-officers-log.dialog.focusPicker.confirmUnnamed") ??
    "(Unnamed Focus)";
  const noDescriptionLabel =
    t("sta-officers-log.dialog.focusPicker.confirmNoDescription") ??
    "No description available for this focus.";
  const safeName = escapeHTML(name || unnamedFocusLabel);
  const safeDescription = escapeHTML(description || noDescriptionLabel).replace(
    /\n/g,
    "<br />",
  );

  const result = await foundry.applications.api.DialogV2.wait({
    classes: ["sta-officers-log"],
    window: {
      title:
        t("sta-officers-log.dialog.focusPicker.confirmTitle") ??
        "Confirm Focus Choice",
    },
    content: `<div class="sta-picker-confirm-dialog"><p><strong>${safeName}</strong></p><p>${safeDescription}</p></div>`,
    buttons: [
      {
        action: "confirm",
        label:
          t("sta-officers-log.dialog.focusPicker.confirmButton") ?? "Confirm",
        default: true,
        callback: () => true,
      },
      {
        action: "cancel",
        label:
          t("sta-officers-log.dialog.focusPicker.cancelButton") ?? "Cancel",
        callback: () => false,
      },
    ],
    rejectClose: false,
    modal: true,
  });

  return result === true || result === "confirm";
}

class FocusPickerApp extends Base {
  constructor({ focuses = [], resolve = null } = {}, options = {}) {
    super(options);
    this._focuses = Array.isArray(focuses) ? focuses : [];
    this._resolve = typeof resolve === "function" ? resolve : null;
    this._resolved = false;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-focus-picker`,
    window: { title: "Choose Focus" },
    classes: ["sta-officers-log", "focus-picker"],
    position: { width: 520, height: "auto" },
    resizable: false,
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/focus-picker.hbs`,
    },
  };

  _deriveCategoryFromImg(img, focusName) {
    const name = String(focusName ?? "")
      .trim()
      .toLowerCase();
    if (name && SPECIES_FOCUS_NAMES_WITH_IMAGES.has(name)) {
      return { key: "species", label: "Species", img: String(img ?? "") };
    }

    const raw = String(img ?? "");
    if (!raw) return { key: "misc", label: "Miscellaneous", img: null };

    const lower = raw.toLowerCase();
    // Heuristic: some icons are species images; group them together.
    if (
      lower.includes("/species/") ||
      lower.includes("species-") ||
      lower.includes("species_") ||
      lower.includes("-species") ||
      lower.includes("_species")
    ) {
      return { key: "species", label: "Species", img: raw };
    }

    const file = raw.split("/").pop() ?? raw;
    const base = file.replace(/\.[a-z0-9]+$/i, "");
    const normalized = base.replace(/^focus[-_]/i, "");
    const label = normalized
      .split(/[-_]/g)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    const key = (label || normalized || base || "misc").toLowerCase();
    return { key, label: label || "Miscellaneous", img: raw };
  }

  async _prepareContext(_options) {
    const groupsMap = new Map();
    for (const f of this._focuses) {
      const cat = this._deriveCategoryFromImg(f?.img, f?.name);
      const entry = {
        name: f.name,
        img: f.img,
        uuid: f.uuid,
        lcName: String(f.name ?? "").toLowerCase(),
      };

      if (!groupsMap.has(cat.key)) {
        groupsMap.set(cat.key, {
          key: cat.key,
          label: cat.label,
          img: cat.img,
          items: [],
        });
      }
      groupsMap.get(cat.key).items.push(entry);
    }

    // Merge small categories into Miscellaneous (except Species).
    const miscKey = "misc";
    const miscLabel = "Miscellaneous";
    const miscGroup = groupsMap.get(miscKey) ?? {
      key: miscKey,
      label: miscLabel,
      img: null,
      items: [],
    };

    // Ensure misc exists in the map (so we can merge into it).
    if (!groupsMap.has(miscKey)) groupsMap.set(miscKey, miscGroup);
    // Normalize misc label in case it was created earlier.
    miscGroup.label = miscLabel;

    for (const [key, group] of Array.from(groupsMap.entries())) {
      if (!group?.items?.length) continue;
      if (key === "species" || key === miscKey) continue;

      if (group.items.length <= 3) {
        miscGroup.items.push(...group.items);
        groupsMap.delete(key);
      }
    }

    const groups = Array.from(groupsMap.values());
    for (const g of groups) {
      g.items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    // Put Species first if present, then alphabetical.
    groups.sort((a, b) => {
      if (a.key === "species" && b.key !== "species") return -1;
      if (b.key === "species" && a.key !== "species") return 1;
      return String(a.label).localeCompare(String(b.label));
    });

    return {
      searchLabel: t("sta-officers-log.dialog.focusPicker.search") ?? "Search",
      searchPlaceholder:
        t("sta-officers-log.dialog.focusPicker.searchPlaceholder") ??
        "Type to filter focuses…",
      createCustomLabel:
        t("sta-officers-log.dialog.focusPicker.createCustom") ??
        "Create Custom Focus",
      emptyLabel:
        t("sta-officers-log.dialog.focusPicker.none") ?? "No focuses found.",
      groups,
    };
  }

  _resolveOnce(value) {
    if (this._resolved) return;
    this._resolved = true;
    try {
      this._resolve?.(value);
    } catch (err) {
      console.error(`${MODULE_ID} | FocusPickerApp resolve failed`, err);
    }
  }

  async close(options = {}) {
    // If closed via X, treat as cancel.
    this._resolveOnce(null);
    return super.close(options);
  }

  _attachPartListeners(partId, htmlElement, _options) {
    super._attachPartListeners?.(partId, htmlElement, _options);
    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;

    if (root.dataset.staFocusPickerBound === "1") return;
    root.dataset.staFocusPickerBound = "1";

    const listItems = Array.from(
      root.querySelectorAll(".sta-focus-picker-item[data-name]"),
    );
    const groupEls = Array.from(
      root.querySelectorAll(".sta-focus-picker-group[data-group]"),
    );
    const countEl = root.querySelector('[data-hook="foundCount"]');

    const applyFilter = (query, rgx) => {
      for (const li of listItems) {
        const name = String(li.dataset.name ?? "");
        const match =
          !query || foundry.applications.ux.SearchFilter.testQuery(rgx, name);
        li.style.display = match ? "" : "none";
      }

      for (const g of groupEls) {
        const anyVisible = Array.from(
          g.querySelectorAll(".sta-focus-picker-item"),
        ).some((li) => li.style.display !== "none");
        g.style.display = anyVisible ? "" : "none";
      }

      if (countEl) {
        const visible = listItems.filter(
          (li) => li.style.display !== "none",
        ).length;
        const key = "sta-officers-log.dialog.focusPicker.found";
        const formatted = tf(key, { count: visible });
        if (formatted && formatted !== key) {
          countEl.textContent = formatted;
        } else {
          const template = t(key) ?? "Found: {count}";
          countEl.textContent = String(template).replace(
            "{count}",
            String(visible),
          );
        }
      }
    };

    // Use Foundry's SearchFilter for debounced, standardized filtering
    const searchFilter = new foundry.applications.ux.SearchFilter({
      inputSelector: 'input[name="q"]',
      contentSelector: ".sta-focus-picker-list",
      callback: (_event, query, rgx, _content) => applyFilter(query, rgx),
    });
    searchFilter.bind(root);

    root.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-action]");
      if (!(btn instanceof HTMLButtonElement)) return;

      const action = String(btn.getAttribute("data-action") ?? "");
      if (!action) return;

      ev.preventDefault();
      ev.stopPropagation();

      if (action === "cancel") {
        this._resolveOnce(null);
        await super.close();
        return;
      }

      if (action === "choose") {
        const name = String(btn.getAttribute("data-name") ?? "").trim();
        const img = String(btn.getAttribute("data-img") ?? "").trim();
        const uuid = String(btn.getAttribute("data-uuid") ?? "").trim();
        if (!name) return;

        let focusItem = null;
        let focusDescription = null;
        if (uuid) {
          const selectedFocus = this._focuses.find(
            (focus) => String(focus?.uuid ?? "") === uuid,
          );
          focusItem = selectedFocus?.item ?? null;
          focusDescription = _extractFocusDescription(focusItem);
          if (!focusItem) {
            const doc = await _getFocusDocumentByUuid(uuid);
            focusItem = _extractFocusItemData(doc);
            focusDescription =
              focusDescription ?? _extractFocusDescription(doc);
          }
        }

        const confirmed = await _confirmFocusChoice({
          name,
          description: _descriptionHtmlToText(focusDescription),
        });
        if (!confirmed) return;

        this._resolveOnce({
          name,
          img: img || null,
          uuid: uuid || null,
          item: focusItem,
        });
        await super.close();
      }

      if (action === "custom") {
        this._resolveOnce({ custom: true });
        await super.close();
      }
    });

    // Initial filter to set up the count display
    applyFilter("", null);

    // Autofocus for "spotlight" feel
    const searchInput = root.querySelector('input[name="q"]');
    try {
      searchInput?.focus?.();
      searchInput?.select?.();
    } catch (_) {
      // ignore
    }
  }
}

export async function promptFocusChoiceFromCompendium({ packKey = "" } = {}) {
  // STA v2.4.6+: focuses are stored in sta.items-1e / sta.items-2e.
  // Backward-compat (STA v2.4.5): focuses were stored in sta.focuses-core / sta.focuses.
  // Always include the STA defaults, plus:
  // - optional explicit packKey passed by caller
  // - optional GM-configured extra pack
  //
  // NOTE: Order matters. We de-dupe by name and let later packs win.
  // Place 2e after 1e so 2e overrides on collisions.
  const packKeys = [
    "sta.focuses-core",
    "sta.focuses",
    "sta.items-1e",
    "sta.items-2e",
  ];

  const explicit = String(packKey ?? "").trim();
  if (explicit && !packKeys.includes(explicit)) packKeys.push(explicit);

  const customPackKeys = getFocusPickerCustomCompendiumKeys();
  for (const custom of customPackKeys) {
    if (custom && !packKeys.includes(custom)) packKeys.push(custom);
  }

  /** @type {any[]} */
  const allEntries = [];
  /** @type {string[]} */
  const errors = [];

  // Avoid warning spam in mixed STA versions: only warn for missing
  // explicit/custom packs (not the default candidates).
  const missingShouldWarn = new Set(
    [
      explicit || null,
      ...(Array.isArray(customPackKeys) ? customPackKeys : []),
    ].filter(Boolean),
  );

  for (const key of packKeys) {
    const pack = game.packs?.get?.(key) ?? null;
    if (!pack) {
      if (missingShouldWarn.has(key)) {
        errors.push(`Missing compendium pack: ${key}`);
      }
      continue;
    }

    const { entries, error } = await _getFocusIndexEntries({ packKey: key });
    if (error) errors.push(error);
    if (entries?.length) allEntries.push(...entries);
  }

  for (const msg of errors) ui.notifications?.warn?.(msg);

  // Remove duplicates by focus name (case-insensitive). Later packs win.
  const byName = new Map();
  for (const e of allEntries) {
    if (String(e?.type ?? "") !== "focus") continue;
    const name = String(e?.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    byName.set(key, {
      name,
      img: e?.img ?? null,
      uuid: e?.uuid ?? null,
    });
  }

  const focuses = Array.from(byName.values());

  if (!focuses.length) {
    ui.notifications?.warn?.("No focuses found in the available compendiums.");
    return null;
  }

  const focusesWithData = await Promise.all(
    focuses.map(async (focus) => {
      if (!focus?.uuid) return focus;
      const doc = await _getFocusDocumentByUuid(focus.uuid);
      return {
        ...focus,
        item: _extractFocusItemData(doc),
      };
    }),
  );

  // Prefer the browser-styled picker from sta-utils; fall back to the built-in
  // list picker when sta-utils is inactive or the delegation fails.
  try {
    const { runFocusBrowserPicker } = await import("./focusPickerBridge.js");
    const bridged = await runFocusBrowserPicker({ focuses: focusesWithData });
    if (!bridged.fallback) return bridged.chosen;
  } catch (err) {
    console.error(
      `${MODULE_ID} | focus browser picker failed; using fallback`,
      err,
    );
  }

  return new Promise((resolve) => {
    const app = new FocusPickerApp({ focuses: focusesWithData, resolve });
    app.render(true);
  });
}
