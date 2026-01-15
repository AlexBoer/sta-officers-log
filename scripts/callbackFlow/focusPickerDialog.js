import { MODULE_ID } from "../constants.js";
import { t, tf } from "../i18n.js";
import { getFocusPickerCustomCompendiumKeys } from "../focusPickerSettings.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
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
  ].map((s) => s.toLowerCase())
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
  const key = String(packKey ?? "sta.focuses-core");
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
  if (typeof fromUuid !== "function") return null;
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
  if (!data || typeof data !== "object") return null;
  delete data._id;
  return data;
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

    const searchInput = root.querySelector('input[name="q"]');
    const listItems = Array.from(
      root.querySelectorAll(".sta-focus-picker-item[data-name]")
    );
    const groupEls = Array.from(
      root.querySelectorAll(".sta-focus-picker-group[data-group]")
    );
    const countEl = root.querySelector('[data-hook="foundCount"]');

    const applyFilter = () => {
      const q = String(searchInput?.value ?? "")
        .trim()
        .toLowerCase();
      for (const li of listItems) {
        const name = String(li.dataset.name ?? "");
        const match = !q || name.includes(q);
        li.style.display = match ? "" : "none";
      }

      for (const g of groupEls) {
        const anyVisible = Array.from(
          g.querySelectorAll(".sta-focus-picker-item")
        ).some((li) => li.style.display !== "none");
        g.style.display = anyVisible ? "" : "none";
      }

      if (countEl) {
        const visible = listItems.filter(
          (li) => li.style.display !== "none"
        ).length;
        const key = "sta-officers-log.dialog.focusPicker.found";
        const formatted = tf(key, { count: visible });
        if (formatted && formatted !== key) {
          countEl.textContent = formatted;
        } else {
          const template = t(key) ?? "Found: {count}";
          countEl.textContent = String(template).replace(
            "{count}",
            String(visible)
          );
        }
      }
    };

    searchInput?.addEventListener("input", applyFilter);

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
        if (uuid) {
          const selectedFocus = this._focuses.find(
            (focus) => String(focus?.uuid ?? "") === uuid
          );
          focusItem = selectedFocus?.item ?? null;
          if (!focusItem) {
            const doc = await _getFocusDocumentByUuid(uuid);
            focusItem = _extractFocusItemData(doc);
          }
        }

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

    // Initial filter (in case template has prefilled input later)
    applyFilter();

    // Autofocus for "spotlight" feel
    try {
      searchInput?.focus?.();
      searchInput?.select?.();
    } catch (_) {
      // ignore
    }
  }
}

export async function promptFocusChoiceFromCompendium({
  packKey = "sta.focuses-core",
} = {}) {
  // Always include the two STA packs, plus:
  // - optional explicit packKey passed by caller
  // - optional GM-configured extra pack
  const packKeys = ["sta.focuses-core", "sta.focuses"];

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

  for (const key of packKeys) {
    const { entries, error } = await _getFocusIndexEntries({ packKey: key });
    if (error) errors.push(error);
    if (entries?.length) allEntries.push(...entries);
  }

  // Warn about missing packs, but don't block if at least one pack exists.
  // (Some worlds may have only one of these packs present.)
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
    ui.notifications?.warn?.("No focuses found in the focuses compendium.");
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
    })
  );

  return new Promise((resolve) => {
    const app = new FocusPickerApp({ focuses: focusesWithData, resolve });
    app.render(true);
  });
}
