import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import {
  getTalentPickerCustomCompendiumKeys,
  getTalentPickerCustomFolderFilterEnabled,
} from "../settings/pickerSettings.js";
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_KEYS,
  DISCIPLINE_LABELS,
} from "./dialogs.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

const SPECIES_TALENT_NAMES = new Set(
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
  ].map((name) => name.toLowerCase()),
);

// STA v2.4.6+: talents are stored in sta.items-1e / sta.items-2e.
// Backward-compatible (STA v2.4.5): talents were stored across multiple packs.
//
// NOTE: Order matters. When de-duping by name, later packs win.
// Place 2e after 1e so 2e overrides on collisions.
export const TALENT_BASE_PACKS = [
  // STA v2.4.5 legacy packs (crew)
  "sta.species-talents-core",
  "sta.general-talents-core",
  "sta.discipline-talents-core",
  "sta.talents-crew",
  // STA v2.4.6+ consolidated packs
  "sta.items-1e",
  "sta.items-2e",
];

export const SHIP_TALENT_BASE_PACKS = [
  // STA v2.4.5 legacy packs (ship)
  "sta.starship-talents-core",
  "sta.talents-starship",
  // STA v2.4.6+ consolidated packs
  "sta.items-1e",
  "sta.items-2e",
];

// Kept for weighting: when present, prefer 2e as the "tie-break" source.
const TALENT_CREW_PACK = "sta.items-2e";

// Takes a image and returns a key and a lebla for a cateogry
// eg. engineering-talent.svg -> {key, label: "Engineering"}
function _deriveTalentCategoryFromImg(img, talentName) {
  const name = String(talentName ?? "")
    .trim()
    .toLowerCase();
  if (name && SPECIES_TALENT_NAMES.has(name)) {
    return { key: "species", label: "Species", img: String(img ?? "") };
  }

  const raw = String(img ?? "");
  if (!raw) return { key: "misc", label: "Misc", img: null };

  const lower = raw.toLowerCase();
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
  const normalized = base.replace(/^talent[-_]/i, "");
  const label = normalized
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const key = (label || normalized || base || "misc").toLowerCase();
  return { key, label: label || "Misc", img: raw };
}

export async function loadTalentPickerTalents(options = {}) {
  return _collectTalentPickerEntries(options);
}

// Just a wrapper around _deriveTalentCategoryFromImg for talent entries.
function _deriveCategoryFromEntry(entry) {
  return _deriveTalentCategoryFromImg(entry?.img, entry?.name);
}

export function prepareTalentPickerContext(
  talents = [],
  actor = null,
  options = {},
) {
  const showCustomButton = options.showCustomButton !== false;
  const groupsMap = new Map();
  for (const talent of Array.isArray(talents) ? talents : []) {
    const cat = _deriveCategoryFromEntry(talent);
    const requirementLabel = formatTalentRequirementLabel(talent?.talenttype);
    const meets = doesActorMeetTalentRequirements(actor, talent);
    const entry = {
      name: talent.name,
      img: talent.img,
      uuid: talent.uuid,
      lcName: String(talent.name ?? "").toLowerCase(),
      meetsRequirements: meets,
      requirementLabel,
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

  const ROLE_GROUP_KEY = "role";
  const ROLE_GROUP_LABEL = "Role";
  const roleGroup = groupsMap.get(ROLE_GROUP_KEY) ?? {
    key: ROLE_GROUP_KEY,
    label: ROLE_GROUP_LABEL,
    img: null,
    items: [],
  };
  for (const [key, group] of Array.from(groupsMap.entries())) {
    if (key === "species" || key === ROLE_GROUP_KEY) continue;
    const label = String(group.label ?? "").toLowerCase();
    if (label.includes("role") || key.includes("role")) {
      roleGroup.items.push(...group.items);
      groupsMap.delete(key);
    }
  }
  // Always exclude role talents from the picker.
  groupsMap.delete(ROLE_GROUP_KEY);

  const MISC_GROUP_KEY = "misc";
  const MISC_GROUP_LABEL = "Miscellaneous";
  const miscGroup = groupsMap.get(MISC_GROUP_KEY) ?? {
    key: MISC_GROUP_KEY,
    label: MISC_GROUP_LABEL,
    img: null,
    items: [],
  };
  if (!groupsMap.has(MISC_GROUP_KEY)) {
    groupsMap.set(MISC_GROUP_KEY, miscGroup);
  }
  miscGroup.label = MISC_GROUP_LABEL;
  for (const [key, group] of Array.from(groupsMap.entries())) {
    if (key === "species" || key === ROLE_GROUP_KEY || key === MISC_GROUP_KEY)
      continue;
    if ((group.items?.length ?? 0) < 3) {
      miscGroup.items.push(...group.items);
      groupsMap.delete(key);
    }
  }

  const groups = Array.from(groupsMap.values());
  for (const group of groups) {
    group.items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  groups.sort((a, b) => {
    if (a.key === "species" && b.key !== "species") return -1;
    if (b.key === "species" && a.key !== "species") return 1;
    return String(a.label).localeCompare(String(b.label));
  });

  return {
    searchLabel: t("sta-officers-log.dialog.talentPicker.search") ?? "Search",
    searchPlaceholder:
      t("sta-officers-log.dialog.talentPicker.searchPlaceholder") ??
      "Type to filter talents…",
    createCustomLabel:
      t("sta-officers-log.dialog.talentPicker.createCustom") ??
      "Create Custom Talent",
    eligibleLabel:
      t("sta-officers-log.dialog.talentPicker.eligibleOnly") ??
      "Only show talents I qualify for",
    emptyLabel:
      t("sta-officers-log.dialog.talentPicker.none") ?? "No talents found.",
    groups,
    showCustomButton,
  };
}

export function bindTalentPickerInteractions(
  root,
  talents = [],
  { onChoose = null, onPreview = null, onCancel = null, onCustom = null } = {},
) {
  if (!root) return { applyFilter: () => {} };
  if (root.dataset.staTalentPickerBound === "1") {
    return { applyFilter: () => {} };
  }
  root.dataset.staTalentPickerBound = "1";

  const searchInput = root.querySelector('input[name="q"]');
  const listItems = Array.from(
    root.querySelectorAll(".sta-focus-picker-item[data-name]"),
  );
  const groupEls = Array.from(
    root.querySelectorAll(".sta-focus-picker-group[data-group]"),
  );
  const countEl = root.querySelector('[data-hook="foundCount"]');
  const eligibleToggle = root.querySelector('input[name="eligibleOnly"]');

  const applyFilter = () => {
    const q = String(searchInput?.value ?? "")
      .trim()
      .toLowerCase();
    const showEligibleOnly = Boolean(eligibleToggle?.checked);

    for (const li of listItems) {
      const name = String(li.dataset.name ?? "");
      const match = !q || name.includes(q);
      const meets = li.dataset.meets === "true";
      const failsEligibility = showEligibleOnly && !meets;
      if (match && !failsEligibility) {
        li.style.display = "";
      } else {
        li.style.display = "none";
      }
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
      const key = "sta-officers-log.dialog.talentPicker.found";
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

  const lookup = new Map();
  for (const talent of Array.isArray(talents) ? talents : []) {
    const uuid = String(talent?.uuid ?? "");
    if (uuid) lookup.set(uuid, talent);
  }

  const handlePreview = async (entry, button) => {
    if (onPreview) {
      await onPreview(entry, button);
      return;
    }
    const title =
      String(button?.getAttribute("data-name") ?? "") ||
      t("sta-officers-log.dialog.talentPicker.previewTitle") ||
      "Talent Preview";
    const desc = await _getTalentDescription(String(entry?.uuid ?? ""));
    await foundry.applications.api.DialogV2.wait({
      window: { title },
      content: `<div class="sta-talent-preview-dialog">${
        desc || "<p>No description available.</p>"
      }</div>`,
      buttons: [
        {
          action: "close",
          label:
            t("sta-officers-log.dialog.talentPicker.previewClose") ?? "Close",
        },
      ],
      rejectClose: true,
      modal: true,
    });
  };

  root.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.("button[data-action]");
    if (!(btn instanceof HTMLButtonElement)) return;

    const action = String(btn.getAttribute("data-action") ?? "");
    if (!action) return;

    ev.preventDefault();
    ev.stopPropagation();

    if (action === "custom") {
      if (onCustom) {
        await onCustom(btn);
      }
      return;
    }

    const item = btn.closest(".sta-focus-picker-item");
    const uuid = String(item?.dataset?.uuid ?? "").trim();
    const talentEntry = lookup.get(uuid) ?? null;
    const entry = {
      name: String(btn.getAttribute("data-name") ?? "").trim(),
      img: String(btn.getAttribute("data-img") ?? "").trim(),
      uuid,
      item: talentEntry?.item ?? null,
      talenttype: talentEntry?.talenttype ?? null,
    };

    if (action === "preview") {
      await handlePreview(entry, btn);
      return;
    }

    if (action === "cancel") {
      if (onCancel) onCancel();
      return;
    }

    if (action === "choose") {
      if (onChoose) {
        await onChoose(entry, btn);
      }
      return;
    }
  });

  searchInput?.addEventListener("input", applyFilter);
  eligibleToggle?.addEventListener("change", applyFilter);

  return { applyFilter };
}

// ensures the index of Talents is an array.
function _normalizeIndexEntries(indexLike) {
  if (!indexLike) return [];
  if (Array.isArray(indexLike)) return indexLike;

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

async function _getTalentIndexEntries({ packKey = "" } = {}) {
  const key = String(packKey ?? "").trim();
  if (!key) return { entries: [], error: "Missing compendium pack key" };

  const pack = game.packs?.get?.(key) ?? null;
  if (!pack) return { entries: [], error: `Missing compendium pack: ${key}` };

  try {
    if (typeof pack.getIndex === "function") {
      // Include folder so we can filter Crew vs Starship in consolidated packs.
      await pack.getIndex({
        fields: ["name", "img", "type", "uuid", "folder"],
      });
    }
  } catch (_) {
    // ignore - we can still try pack.index
  }

  const entries = _normalizeIndexEntries(pack.index);
  return { entries, error: null };
}

function _matchTalentFolderKindFromName(name) {
  const lower = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!lower) return null;
  if (/(^|\b)crew(\b|$)/i.test(lower)) return "crew";
  if (/(^|\b)star\s*ship(\b|$)/i.test(lower)) return "starship";
  if (/(^|\b)starship(\b|$)/i.test(lower)) return "starship";
  if (lower === "ship" || /(^|\b)ship(\b|$)/i.test(lower)) return "starship";
  return null;
}

function _classifyTalentFolder(pack, folderId) {
  const id = folderId ? String(folderId) : "";
  if (!pack || !id) return null;

  const folders = pack.folders;
  const getFolder = (fid) => {
    try {
      if (!folders) return null;
      if (typeof folders.get === "function") return folders.get(fid) ?? null;
      if (folders instanceof Map) return folders.get(fid) ?? null;
    } catch (_) {
      // ignore
    }
    return null;
  };

  let cur = id;
  for (let i = 0; i < 12 && cur; i++) {
    const f = getFolder(cur);
    if (!f) break;

    const kind = _matchTalentFolderKindFromName(f?.name);
    if (kind) return kind;

    const parent = f?.folder;
    cur = parent ? String(parent) : "";
  }

  return null;
}

function _packKeyFromUuid(uuid) {
  const raw = String(uuid ?? "");
  const prefix = "Compendium.";
  if (!raw.startsWith(prefix)) return "";
  const rest = raw.slice(prefix.length);
  const parts = rest.split(".");
  if (parts.length < 2) return "";
  parts.pop();
  return parts.join(".");
}

function _isConsolidatedTalentPackKey(packKey) {
  const key = String(packKey ?? "")
    .trim()
    .toLowerCase();
  return key.endsWith("items-1e") || key.endsWith("items-2e");
}

function _classifyTalentFolderFromDocument(doc) {
  let cur = doc?.folder ?? null;
  for (let i = 0; i < 12 && cur; i++) {
    const kind = _matchTalentFolderKindFromName(cur?.name);
    if (kind) return kind;
    cur = cur?.folder ?? null;
  }
  return null;
}

const EXCLUDED_SHIP_TALENT_NAMES = new Set(
  [
    "aging relic",
    "deluxe galley",
    "dependable workhorse",
    "hope ship",
    "legendary",
    "prototype",
    "survivor of (x)",
  ].map((n) => n.toLowerCase()),
);

function _isExcludedShipTalentName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (EXCLUDED_SHIP_TALENT_NAMES.has(lower)) return true;
  return false;
}

async function _getTalentDocumentByUuid(uuid) {
  if (!uuid) return null;
  if (typeof fromUuid !== "function") return null;
  try {
    const doc = await fromUuid(uuid);
    return doc ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | failed to load talent document`, err);
    return null;
  }
}

function _extractTalentItemData(document) {
  if (!document || typeof document.toObject !== "function") return null;
  const data = document.toObject();
  if (!data || typeof data !== "object") return null;
  delete data._id;
  return data;
}

function _extractTalentDescription(document) {
  if (!document) return null;

  const rawDescription =
    foundry.utils.getProperty(document, "system.description.value") ??
    foundry.utils.getProperty(document, "system.description") ??
    document?.system?.description ??
    "";
  if (!rawDescription) return null;
  if (typeof rawDescription === "string") return rawDescription;
  if (
    typeof rawDescription === "object" &&
    typeof rawDescription.value === "string"
  ) {
    return rawDescription.value;
  }
  return null;
}

function _isCharacterCreationOnlyTalentDescription(rawDescription) {
  const html = String(rawDescription ?? "");
  if (!html) return false;

  // Normalize some common HTML block/line separators into newlines first,
  // so we can interpret "same line" more reliably.
  let normalized = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  // Prefer Foundry's HTML->text routine when available.
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

  const lines = String(normalized)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      /requirement\s*:/i.test(line) &&
      /during character creation/i.test(line)
    ) {
      return true;
    }
  }
  return false;
}

async function _getTalentDescription(uuid) {
  const doc = await _getTalentDocumentByUuid(uuid);
  if (!doc) return null;

  return _extractTalentDescription(doc);
}

async function _collectTalentPickerEntries({
  packKey = "",
  basePackKeys = [],
  extraPackKeys = [],
  priorityEntries = [],
  extraPriorityEntries = [],
  folderKind = "", // "crew" | "starship" | "" (no filtering)
} = {}) {
  const packs = [];
  const addPack = (key) => {
    const normalized = String(key ?? "").trim();
    if (!normalized) return;
    if (!packs.includes(normalized)) packs.push(normalized);
  };

  for (const key of basePackKeys ?? []) addPack(key);
  for (const key of extraPackKeys ?? []) addPack(key);

  const explicit = String(packKey ?? "").trim();
  if (explicit) addPack(explicit);

  const customPackKeys = getTalentPickerCustomCompendiumKeys();
  const customFolderFilterEnabled = getTalentPickerCustomFolderFilterEnabled();
  for (const custom of customPackKeys) {
    if (custom) addPack(custom);
  }

  const errors = [];
  const allEntries = [];

  // Avoid warning spam in mixed STA versions: only warn for missing
  // explicit/custom packs (not the default candidates).
  const missingShouldWarn = new Set(
    [
      explicit || null,
      ...(Array.isArray(customPackKeys) ? customPackKeys : []),
    ].filter(Boolean),
  );

  const wantedKind = String(folderKind ?? "")
    .trim()
    .toLowerCase();

  for (const key of packs) {
    const pack = game.packs?.get?.(key) ?? null;
    if (!pack) {
      if (missingShouldWarn.has(key)) {
        errors.push(`Missing compendium pack: ${key}`);
      }
      continue;
    }

    const { entries, error } = await _getTalentIndexEntries({ packKey: key });
    if (error) errors.push(error);
    if (entries?.length) {
      // If the pack is consolidated (items-1e/items-2e), filter by folder lineage.
      // For legacy packs we usually already have crew-vs-ship separation by pack.
      // Custom compendiums can opt-in to folder filtering via settings.
      const isConsolidated =
        key.endsWith("items-1e") || key.endsWith("items-2e");
      const isCustomWithFolderFilter =
        customFolderFilterEnabled && customPackKeys.includes(key);
      const shouldFilterByFolder = isConsolidated || isCustomWithFolderFilter;
      if (!wantedKind || !shouldFilterByFolder) {
        allEntries.push({ key, entries });
      } else {
        const filtered = entries.filter((e) => {
          if (String(e?.type ?? "").toLowerCase() !== "talent") return false;
          const kind = _classifyTalentFolder(pack, e?.folder);
          // If we can't classify, keep it (safer than hiding content unexpectedly).
          if (!kind) return true;
          return kind === wantedKind;
        });
        allEntries.push({ key, entries: filtered });
      }
    }
  }

  const priorityMap = new Map();
  const applyPriority = (key, value) => {
    const normalized = String(key ?? "").trim();
    if (!normalized) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const existing = priorityMap.get(normalized);
    if (existing === undefined || numeric > existing) {
      priorityMap.set(normalized, numeric);
    }
  };

  for (const entry of priorityEntries ?? []) {
    applyPriority(entry?.[0], entry?.[1]);
  }
  for (const entry of extraPriorityEntries ?? []) {
    applyPriority(entry?.[0], entry?.[1]);
  }
  for (const custom of customPackKeys) {
    if (custom) applyPriority(custom, 4);
  }
  if (explicit) applyPriority(explicit, 4);

  const getPriority = (key) => priorityMap.get(key) ?? 3;

  const byName = new Map();
  for (const batch of allEntries) {
    const priority = getPriority(batch.key);
    if (priority === 0) continue;
    for (const entry of batch.entries) {
      if (String(entry?.type ?? "").toLowerCase() !== "talent") continue;
      const name = String(entry?.name ?? "").trim();
      if (!name) continue;

      if (wantedKind === "starship" && _isExcludedShipTalentName(name)) {
        continue;
      }

      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (existing && existing.priority > priority) continue;

      byName.set(key, {
        priority,
        value: {
          name,
          img: entry?.img ?? null,
          uuid: entry?.uuid ?? null,
          folder: entry?.folder ?? null,
        },
      });
    }
  }

  let talents = Array.from(byName.values()).map((item) => item.value);
  talents = await Promise.all(
    talents.map(async (talent) => {
      const packKey = _packKeyFromUuid(talent.uuid);
      const isConsolidated = _isConsolidatedTalentPackKey(packKey);
      const isCustomWithFolderFilter =
        customFolderFilterEnabled && customPackKeys.includes(packKey);
      const shouldFilterByFolder = isConsolidated || isCustomWithFolderFilter;
      const doc = await _getTalentDocumentByUuid(talent.uuid);
      const rawDescription = _extractTalentDescription(doc);
      if (
        wantedKind === "crew" &&
        _isCharacterCreationOnlyTalentDescription(rawDescription)
      ) {
        return null;
      }

      if (wantedKind && shouldFilterByFolder) {
        const kindFromDoc = _classifyTalentFolderFromDocument(doc);
        let kind = kindFromDoc;
        if (!kind) {
          const pack = packKey ? (game.packs?.get?.(packKey) ?? null) : null;
          kind = _classifyTalentFolder(pack, talent.folder);
        }
        if (kind !== wantedKind) return null;
      }

      return {
        ...talent,
        talenttype: doc?.system?.talenttype ?? null,
        item: _extractTalentItemData(doc),
      };
    }),
  );

  talents = talents.filter(Boolean);

  return { talents, errors };
}

class TalentPickerApp extends Base {
  constructor(
    { talents = [], resolve = null, actor = null } = {},
    options = {},
  ) {
    super(options);
    this._talents = Array.isArray(talents) ? talents : [];
    this._resolve = typeof resolve === "function" ? resolve : null;
    this._resolved = false;
    this._actor = actor ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-talent-picker`,
    window: { title: "Choose Talent" },
    classes: ["sta-officers-log", "focus-picker"],
    position: { width: 520, height: "auto" },
    resizable: false,
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/talent-picker.hbs`,
    },
  };

  _deriveCategoryFromImg(img, talentName) {
    return _deriveTalentCategoryFromImg(img, talentName);
  }

  async _prepareContext(_options) {
    return prepareTalentPickerContext(this._talents, this._actor);
  }

  _resolveOnce(value) {
    if (this._resolved) return;
    this._resolved = true;
    try {
      this._resolve?.(value);
    } catch (err) {
      console.error(`${MODULE_ID} | TalentPickerApp resolve failed`, err);
    }
  }

  async close(options = {}) {
    this._resolveOnce(null);
    return super.close(options);
  }

  _attachPartListeners(partId, htmlElement, _options) {
    super._attachPartListeners?.(partId, htmlElement, _options);
    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;

    const binding = bindTalentPickerInteractions(root, this._talents, {
      onChoose: async (entry) => {
        const name = String(entry?.name ?? "").trim();
        if (!name) return;

        let talentItem = entry?.item ?? null;
        let talentType = entry?.talenttype ?? null;
        const uuid = String(entry?.uuid ?? "").trim();
        if (uuid && !talentItem) {
          const selectedTalent = this._talents.find(
            (talent) => String(talent?.uuid ?? "") === uuid,
          );
          talentItem = talentItem ?? selectedTalent?.item ?? null;
          talentType = talentType ?? selectedTalent?.talenttype ?? null;
        }

        this._resolveOnce({
          name,
          img: entry?.img ? String(entry.img).trim() : null,
          uuid: uuid || null,
          item: talentItem,
          talenttype: talentType ?? null,
        });
        await super.close();
      },
      onCustom: async () => {
        this._resolveOnce({ custom: true });
        await super.close();
      },
      onCancel: async () => {
        this._resolveOnce(null);
        await super.close();
      },
    });

    binding.applyFilter();
  }
}

function _createTalentPickerLoadingDialog() {
  const title =
    t("sta-officers-log.dialog.talentPicker.loadingTitle") ?? "Loading Talents";
  const message =
    t("sta-officers-log.dialog.talentPicker.loadingMessage") ??
    "Loading talents from compendiums...";
  return new foundry.applications.api.DialogV2({
    window: { title },
    classes: ["sta-officers-log", "talent-loading-dialog"],
    content: `<div class="sta-talent-loading-dialog"><div class="sta-talent-loading-spinner" aria-hidden="true"></div><div class="sta-talent-loading-message">${message}</div></div>`,
    buttons: [
      {
        action: "loading",
        label: " ",
        callback: () => false,
      },
    ],
    default: "loading",
    closeOnSubmit: false,
    rejectClose: true,
    modal: true,
  });
}
async function _promptTalentPickerFromPackList(options = {}) {
  const loadingDialog = _createTalentPickerLoadingDialog();
  await loadingDialog.render(true);
  let loadResult;
  try {
    loadResult = await loadTalentPickerTalents(options);
  } finally {
    loadingDialog?.close();
  }

  const { talents, errors } = loadResult ?? { talents: [], errors: [] };

  for (const msg of errors ?? []) {
    ui.notifications?.warn?.(msg);
  }

  if (!talents.length) {
    ui.notifications?.warn?.("No talents found in the available compendiums.");
    return null;
  }

  return new Promise((resolve) => {
    const app = new TalentPickerApp({
      talents,
      resolve,
      actor: options.actor ?? null,
    });
    app.render(true);
  });
}

export async function promptTalentChoiceFromCompendium({
  actor = null,
  packKey = "",
} = {}) {
  return _promptTalentPickerFromPackList({
    actor,
    packKey,
    basePackKeys: TALENT_BASE_PACKS,
    extraPackKeys: [TALENT_CREW_PACK],
    priorityEntries: TALENT_BASE_PACKS.map((key, idx) => [key, idx + 1]),
    extraPriorityEntries: [[TALENT_CREW_PACK, 5]],
    folderKind: "crew",
  });
}

export async function promptShipTalentChoiceFromCompendium({
  actor = null,
  packKey = "",
} = {}) {
  return _promptTalentPickerFromPackList({
    actor,
    packKey,
    basePackKeys: SHIP_TALENT_BASE_PACKS,
    priorityEntries: SHIP_TALENT_BASE_PACKS.map((key, idx) => [key, idx + 1]),
    folderKind: "starship",
  });
}

/**************************************************
 *              TALENT REQUIREMENTS               *
 *************************************************/

// Retrieves a numeric property from an object, or null if not found/invalid.
// Used for grabbing attribute/discipline values from an actor.
// obj: should be an actor
// path: string path to the property (e.g., "system.attributes.strength.value")
const getNumeric = (obj, path) => {
  const v = foundry.utils.getProperty(obj, path);
  if (v === 0 || v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const ATTRIBUTE_NAME_TO_KEY = (() => {
  const map = new Map();
  for (const key of ATTRIBUTE_KEYS) {
    map.set(key.toLowerCase(), key);
    const label = ATTRIBUTE_LABELS[key];
    if (label) map.set(label.toLowerCase(), key);
  }
  return map;
})();

const DISCIPLINE_NAME_TO_KEY = (() => {
  const map = new Map();
  for (const key of DISCIPLINE_KEYS) {
    map.set(key.toLowerCase(), key);
    const label = DISCIPLINE_LABELS[key];
    if (label) map.set(label.toLowerCase(), key);
  }
  return map;
})();

const normalizeRequirementString = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const resolveAttributeKey = (value) => {
  if (!value) return null;
  return ATTRIBUTE_NAME_TO_KEY.get(normalizeRequirementString(value)) ?? null;
};

const resolveDisciplineKey = (value) => {
  if (!value) return null;
  return DISCIPLINE_NAME_TO_KEY.get(normalizeRequirementString(value)) ?? null;
};

const getTraitNames = (actor) => {
  const items = Array.from(actor?.items ?? []);
  return items
    .filter((item) => String(item?.type ?? "").toLowerCase() === "trait")
    .map((trait) => normalizeRequirementString(trait?.name));
};

const getLegacyHouse = (actor) => {
  const legacy = foundry.utils.getProperty(actor, "system.legacy");
  if (!legacy) return "";
  if (typeof legacy === "string") return normalizeRequirementString(legacy);
  const house = normalizeRequirementString(legacy?.house);
  if (house) return house;
  const label = normalizeRequirementString(legacy?.label);
  if (label) return label;
  return "";
};

const requirementTypeLabels = {
  attribute: "Attribute",
  discipline: "Discipline",
  species: "Species",
  house: "House",
  system: "System",
  general: "General",
};

const humanizeRequirementValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatTalentRequirementLabel = (talenttype) => {
  if (!talenttype) return "";
  const type = normalizeRequirementString(talenttype.typeenum);
  const description = String(talenttype.description ?? "").trim();
  const minimum = Number.isFinite(Number(talenttype.minimum))
    ? Number(talenttype.minimum)
    : null;

  if (!type) return "";
  const typeLabel =
    requirementTypeLabels[type] ?? humanizeRequirementValue(type);
  const minSuffix = minimum != null ? ` ≥ ${minimum}` : "";

  switch (type) {
    case "attribute": {
      const key = resolveAttributeKey(description);
      const label =
        (key && ATTRIBUTE_LABELS[key]) ||
        humanizeRequirementValue(description) ||
        humanizeRequirementValue(type);
      return `${typeLabel}: ${label}${minSuffix}`;
    }
    case "discipline": {
      const key = resolveDisciplineKey(description);
      const label =
        (key && DISCIPLINE_LABELS[key]) ||
        humanizeRequirementValue(description) ||
        humanizeRequirementValue(type);
      return `${typeLabel}: ${label}${minSuffix}`;
    }
    case "species": {
      const label = humanizeRequirementValue(description) || typeLabel;
      return `${typeLabel}: ${label}`;
    }
    case "house": {
      const label = humanizeRequirementValue(description) || typeLabel;
      return `${typeLabel}: ${label}`;
    }
    default:
      return typeLabel;
  }
};

export function doesActorMeetTalentRequirements(actor, talentEntry) {
  if (!actor) return true;
  const talenttype =
    talentEntry?.talenttype ?? talentEntry?.system?.talenttype ?? null;
  if (!talenttype) return true;

  const type = normalizeRequirementString(talenttype.typeenum);
  const description = normalizeRequirementString(talenttype.description);
  const minimum = Number.isFinite(Number(talenttype.minimum))
    ? Number(talenttype.minimum)
    : null;

  switch (type) {
    case "spell":
    case "general":
      return true;
    case "system":
      return true;
    case "discipline": {
      const key = resolveDisciplineKey(description);
      if (!key) return false;
      const value = getNumeric(actor, `system.disciplines.${key}.value`);
      if (value == null) return false;
      if (minimum == null) return true;
      return value >= minimum;
    }
    case "attribute": {
      const key = resolveAttributeKey(description);
      if (!key) return false;
      const value =
        getNumeric(actor, `system.attribute.${key}.value`) ??
        getNumeric(actor, `system.attributes.${key}.value`);
      if (value == null) return false;
      if (minimum == null) return true;
      return value >= minimum;
    }
    case "species": {
      if (!description) return true;
      const required = description;
      const traits = getTraitNames(actor);
      if (traits.some((name) => name.includes(required))) return true;
      const speciesDetail = normalizeRequirementString(
        foundry.utils.getProperty(actor, "system.details.species"),
      );
      return speciesDetail.includes(required);
    }
    case "house": {
      if (!description) return true;
      const house = getLegacyHouse(actor);
      return house.includes(description);
    }
    default:
      return true;
  }
}
