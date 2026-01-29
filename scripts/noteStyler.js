import { MODULE_ID } from "./core/index.js";

/**
 * Note Styler - Allows customizing the text styling of selected map note placeables
 * Persists styles to:
 * - Core Foundry note document: fontFamily, fontSize, textColor, texture.tint
 * - Pin Cushion flags (if active): numberHsSuffixOnNameplate (vertical offset)
 * - Our own flags: fontWeight, fontStyle, stroke, strokeThickness, dropShadow*, iconAlpha
 */

const FLAG_KEY = "noteTextStyle";
const PIN_CUSHION_ID = "pin-cushion";

/**
 * Check if Pin Cushion module is active
 */
function isPinCushionActive() {
  return game.modules.get(PIN_CUSHION_ID)?.active ?? false;
}

/**
 * Style properties that we manage (Pin Cushion doesn't support these)
 * These are PIXI text style properties stored in flags
 */
const OUR_STYLE_PROPS = [
  "fontWeight",
  "fontStyle",
  "stroke",
  "strokeThickness",
  "dropShadow",
  "dropShadowColor",
  "dropShadowBlur",
  "dropShadowDistance",
  "iconAlpha",
];

const DEFAULT_STYLE = {
  fontFamily: "Signika",
  fontSize: 14,
  fill: "#ffffff",
  stroke: "#000000",
  strokeThickness: 4,
  dropShadow: false,
  dropShadowColor: "#000000",
  dropShadowBlur: 4,
  dropShadowDistance: 2,
  fontWeight: "normal",
  fontStyle: "normal",
  yOffset: 0,
  iconTint: null, // null = no tint
  iconAlpha: 1, // stored in our flags
};

/**
 * Get the saved style from a note's flags, falling back to current tooltip style or defaults
 */
function getCurrentStyle(note) {
  // Get our custom style flags
  const saved = note?.document?.getFlag(MODULE_ID, FLAG_KEY) || {};

  // Get core document properties
  const doc = note?.document;
  const coreProps = {
    fontFamily: doc?.fontFamily || DEFAULT_STYLE.fontFamily,
    fontSize: doc?.fontSize || DEFAULT_STYLE.fontSize,
    fill: doc?.textColor || DEFAULT_STYLE.fill,
    iconTint: doc?.texture?.tint || DEFAULT_STYLE.iconTint,
    iconAlpha: saved.iconAlpha ?? DEFAULT_STYLE.iconAlpha,
  };

  // Get Pin Cushion vertical offset if available
  let yOffset = DEFAULT_STYLE.yOffset;
  if (isPinCushionActive()) {
    const pcOffset = doc?.getFlag(PIN_CUSHION_ID, "numberHsSuffixOnNameplate");
    if (pcOffset !== undefined) {
      // Pin Cushion uses negative values to move down, we use positive
      yOffset = (pcOffset ?? 0) * -5; // Convert from their scale to pixels
    }
  }

  // Fall back to current tooltip style for PIXI properties we manage
  const tooltipStyle = note?.tooltip?.style || {};

  return {
    ...DEFAULT_STYLE,
    ...coreProps,
    fontWeight:
      saved.fontWeight || tooltipStyle.fontWeight || DEFAULT_STYLE.fontWeight,
    fontStyle:
      saved.fontStyle || tooltipStyle.fontStyle || DEFAULT_STYLE.fontStyle,
    stroke: saved.stroke || tooltipStyle.stroke || DEFAULT_STYLE.stroke,
    strokeThickness:
      saved.strokeThickness ??
      tooltipStyle.strokeThickness ??
      DEFAULT_STYLE.strokeThickness,
    dropShadow:
      saved.dropShadow ?? tooltipStyle.dropShadow ?? DEFAULT_STYLE.dropShadow,
    dropShadowColor:
      saved.dropShadowColor ||
      tooltipStyle.dropShadowColor ||
      DEFAULT_STYLE.dropShadowColor,
    dropShadowBlur:
      saved.dropShadowBlur ??
      tooltipStyle.dropShadowBlur ??
      DEFAULT_STYLE.dropShadowBlur,
    dropShadowDistance:
      saved.dropShadowDistance ??
      tooltipStyle.dropShadowDistance ??
      DEFAULT_STYLE.dropShadowDistance,
    yOffset,
  };
}

/**
 * Apply style visually to a note's PIXI tooltip (does not persist)
 */
function applyStyleVisually(note, style) {
  if (!note?.tooltip?.style) return false;

  Object.assign(note.tooltip.style, {
    fontFamily: style.fontFamily,
    fontSize: Number(style.fontSize),
    fill: style.fill,
    stroke: style.stroke,
    strokeThickness: Number(style.strokeThickness),
    dropShadow: Boolean(style.dropShadow),
    dropShadowColor: style.dropShadowColor,
    dropShadowBlur: Number(style.dropShadowBlur),
    dropShadowDistance: Number(style.dropShadowDistance),
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
  });

  // Apply vertical offset to the tooltip position
  const yOffset = Number(style.yOffset) || 0;
  if (note.tooltip.anchor) {
    // Store original anchor if not already stored
    if (note._originalTooltipY === undefined) {
      note._originalTooltipY = note.tooltip.y;
    }
    note.tooltip.y = note._originalTooltipY + yOffset;
  }

  // Apply icon opacity
  if (style.iconAlpha !== undefined) {
    const alpha = Number(style.iconAlpha) ?? 1;
    note.tooltip.alpha = alpha;
    if (note.controlIcon) note.controlIcon.alpha = alpha;
  }

  return true;
}

/**
 * Apply style to a single note and save to flags for persistence
 */
async function applyStyleToNote(note, style, persist = true) {
  const applied = applyStyleVisually(note, style);

  // Save to appropriate locations for persistence
  if (applied && persist && note?.document) {
    const doc = note.document;

    // Update core Foundry note document properties
    const updateData = {
      fontFamily: style.fontFamily,
      fontSize: Number(style.fontSize),
      textColor: style.fill,
    };

    // Update texture properties (tint)
    const textureUpdate = { ...doc?.texture };
    if (style.iconTint !== undefined) {
      textureUpdate.tint = style.iconTint || null;
    }
    if (Object.keys(textureUpdate).length > 0) {
      updateData.texture = textureUpdate;
    }

    await doc.update(updateData);

    // Update Pin Cushion flag for vertical offset if Pin Cushion is active
    if (isPinCushionActive()) {
      // Pin Cushion uses numberHsSuffixOnNameplate where each unit = 5px, negative = down
      const pcOffset = Math.round((Number(style.yOffset) || 0) / -5);
      await note.document.setFlag(
        PIN_CUSHION_ID,
        "numberHsSuffixOnNameplate",
        pcOffset,
      );
    }

    // Save only our custom style properties to our flags
    const ourStyleData = {};
    for (const prop of OUR_STYLE_PROPS) {
      if (style[prop] !== undefined) {
        ourStyleData[prop] = style[prop];
      }
    }
    await note.document.setFlag(MODULE_ID, FLAG_KEY, ourStyleData);
  }

  return applied;
}

/**
 * Apply style to all selected notes (with persistence)
 */
async function applyStyleToSelectedNotes(style, persist = true) {
  const selected = canvas.notes?.controlled || [];
  let count = 0;

  for (const note of selected) {
    if (await applyStyleToNote(note, style, persist)) count++;
  }

  return count;
}

/**
 * Apply style to all notes on the canvas (with persistence)
 */
async function applyStyleToAllNotes(style, persist = true) {
  const notes = canvas.notes?.placeables || [];
  let count = 0;

  for (const note of notes) {
    if (await applyStyleToNote(note, style, persist)) count++;
  }

  return count;
}

// Track which notes are currently hovered
const hoveredNotes = new Set();

/**
 * Reapply saved style to a single note from its flags
 */
function reapplySavedStyle(note) {
  // Only reapply properties that we exclusively manage (not in core doc or Pin Cushion)
  const saved = note?.document?.getFlag(MODULE_ID, FLAG_KEY);
  if (saved) {
    // Merge with current style from all sources
    const currentStyle = getCurrentStyle(note);
    applyStyleVisually(note, currentStyle);

    // If this note is currently hovered, restore full opacity
    const savedAlpha = saved.iconAlpha ?? 1;
    if (hoveredNotes.has(note.id) && savedAlpha < 1) {
      if (note.tooltip) note.tooltip.alpha = 1;
      if (note.controlIcon) note.controlIcon.alpha = 1;
    }
  }
}

/**
 * Handle hover state change for opacity
 */
function handleNoteHover(note, isHovering) {
  // Track hover state
  if (isHovering) {
    hoveredNotes.add(note.id);
  } else {
    hoveredNotes.delete(note.id);
  }

  const saved = note?.document?.getFlag(MODULE_ID, FLAG_KEY) || {};
  const savedAlpha = saved.iconAlpha ?? 1;

  // Only do hover effect if alpha is less than 1
  if (savedAlpha < 1) {
    const alpha = isHovering ? 1 : savedAlpha;
    if (note.tooltip) note.tooltip.alpha = alpha;
    if (note.controlIcon) note.controlIcon.alpha = alpha;
  }
}

/**
 * Register hook to reapply saved styles when notes are refreshed
 */
export function registerNoteStylerHooks() {
  // Reapply styles when a note is refreshed/drawn
  Hooks.on("refreshNote", (note) => {
    reapplySavedStyle(note);
  });

  // Also handle when canvas is ready (initial load)
  Hooks.on("canvasReady", () => {
    const notes = canvas.notes?.placeables || [];
    for (const note of notes) {
      reapplySavedStyle(note);
    }
  });

  // Handle hover - show full opacity
  Hooks.on("hoverNote", (note, isHovering) => {
    handleNoteHover(note, isHovering);
  });
}

/**
 * Extract style values from a form element
 */
function extractStyleFromElement(element) {
  const form = element.querySelector("form") || element;
  return {
    fontFamily:
      form.querySelector('[name="fontFamily"]')?.value ||
      DEFAULT_STYLE.fontFamily,
    fontSize:
      Number(form.querySelector('[name="fontSize"]')?.value) ||
      DEFAULT_STYLE.fontSize,
    fill: form.querySelector('[name="fill"]')?.value || DEFAULT_STYLE.fill,
    stroke:
      form.querySelector('[name="stroke"]')?.value || DEFAULT_STYLE.stroke,
    strokeThickness:
      Number(form.querySelector('[name="strokeThickness"]')?.value) ??
      DEFAULT_STYLE.strokeThickness,
    dropShadow:
      form.querySelector('[name="dropShadow"]')?.checked ??
      DEFAULT_STYLE.dropShadow,
    dropShadowColor:
      form.querySelector('[name="dropShadowColor"]')?.value ||
      DEFAULT_STYLE.dropShadowColor,
    dropShadowBlur:
      Number(form.querySelector('[name="dropShadowBlur"]')?.value) ??
      DEFAULT_STYLE.dropShadowBlur,
    dropShadowDistance:
      Number(form.querySelector('[name="dropShadowDistance"]')?.value) ??
      DEFAULT_STYLE.dropShadowDistance,
    fontWeight:
      form.querySelector('[name="fontWeight"]')?.value ||
      DEFAULT_STYLE.fontWeight,
    fontStyle:
      form.querySelector('[name="fontStyle"]')?.value ||
      DEFAULT_STYLE.fontStyle,
    yOffset:
      Number(form.querySelector('[name="yOffset"]')?.value) ??
      DEFAULT_STYLE.yOffset,
    iconTint: form.querySelector('[name="iconTintEnabled"]')?.checked
      ? form.querySelector('[name="iconTint"]')?.value || null
      : null,
    iconAlpha:
      Number(form.querySelector('[name="iconAlpha"]')?.value) ??
      DEFAULT_STYLE.iconAlpha,
  };
}

/**
 * Note Styler Application (V2)
 */
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class NoteStylerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.initialStyle = options.initialStyle || { ...DEFAULT_STYLE };
    this.selectedCount = options.selectedCount || 0;
  }

  static DEFAULT_OPTIONS = {
    id: "note-styler",
    window: {
      title: "Note Text Styler",
      resizable: true,
    },
    classes: ["sta-officers-log", "note-styler-dialog"],
    position: { width: 400 },
    actions: {
      applySelected: NoteStylerApp.#onApplySelected,
      applyAll: NoteStylerApp.#onApplyAll,
      cancel: NoteStylerApp.#onCancel,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/note-styler.hbs`,
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  };

  async _prepareContext(options) {
    // Get available fonts from Foundry's FontConfig (namespaced in v13+)
    const fontChoices =
      foundry.applications.settings.menus.FontConfig.getAvailableFontChoices();
    const fontFamilies = Object.entries(fontChoices).map(([value, label]) => ({
      value,
      label,
      selected: value === this.initialStyle.fontFamily,
    }));

    return {
      ...this.initialStyle,
      selectedCount: this.selectedCount,
      fontFamilies,
      buttons: [
        {
          type: "button",
          action: "applySelected",
          icon: "fas fa-check",
          label: "Apply to Selected",
        },
        {
          type: "button",
          action: "applyAll",
          icon: "fas fa-globe",
          label: "Apply to All",
        },
        {
          type: "button",
          action: "cancel",
          icon: "fas fa-times",
          label: "Cancel",
        },
      ],
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Live preview on input change
    this.element.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", () => this.#onPreview());
      input.addEventListener("change", () => this.#onPreview());
    });

    // Update range value displays
    this.element.querySelectorAll('input[type="range"]').forEach((range) => {
      const valueDisplay = range.parentElement?.querySelector(".range-value");
      if (valueDisplay) {
        range.addEventListener("input", () => {
          valueDisplay.textContent = range.value;
        });
      }
    });
  }

  #onPreview() {
    const style = extractStyleFromElement(this.element);
    applyStyleToSelectedNotes(style, false); // false = don't persist during preview
  }

  static async #onApplySelected() {
    const style = extractStyleFromElement(this.element);
    const count = await applyStyleToSelectedNotes(style);
    ui.notifications.info(`Applied style to ${count} note(s).`);
    this.close();
  }

  static async #onApplyAll() {
    const style = extractStyleFromElement(this.element);
    const count = await applyStyleToAllNotes(style);
    ui.notifications.info(`Applied style to ${count} note(s).`);
    this.close();
  }

  static #onCancel() {
    this.close();
  }
}

/**
 * Open the Note Styler dialog
 */
export async function openNoteStylerDialog() {
  const selected = canvas.notes?.controlled || [];

  if (selected.length === 0) {
    ui.notifications.warn("Select one or more map notes first.");
    return;
  }

  // Get style from first selected note as initial values
  const initialStyle = getCurrentStyle(selected[0]);

  new NoteStylerApp({
    initialStyle,
    selectedCount: selected.length,
  }).render(true);
}

// Expose to the module API
export const noteStyler = {
  open: openNoteStylerDialog,
  applyToSelected: applyStyleToSelectedNotes,
  applyToAll: applyStyleToAllNotes,
  getDefaultStyle: () => ({ ...DEFAULT_STYLE }),
};
