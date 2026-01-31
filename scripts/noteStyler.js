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
 * Only applies properties that are defined (not undefined)
 */
function applyStyleVisually(note, style) {
  if (!note?.tooltip?.style) return false;

  const tooltipStyle = note.tooltip.style;

  if (style.fontFamily !== undefined)
    tooltipStyle.fontFamily = style.fontFamily;
  if (style.fontSize !== undefined)
    tooltipStyle.fontSize = Number(style.fontSize);
  if (style.fill !== undefined) tooltipStyle.fill = style.fill;
  if (style.stroke !== undefined) tooltipStyle.stroke = style.stroke;
  if (style.strokeThickness !== undefined)
    tooltipStyle.strokeThickness = Number(style.strokeThickness);
  if (style.dropShadow !== undefined)
    tooltipStyle.dropShadow = Boolean(style.dropShadow);
  if (style.dropShadowColor !== undefined)
    tooltipStyle.dropShadowColor = style.dropShadowColor;
  if (style.dropShadowBlur !== undefined)
    tooltipStyle.dropShadowBlur = Number(style.dropShadowBlur);
  if (style.dropShadowDistance !== undefined)
    tooltipStyle.dropShadowDistance = Number(style.dropShadowDistance);
  if (style.fontWeight !== undefined)
    tooltipStyle.fontWeight = style.fontWeight;
  if (style.fontStyle !== undefined) tooltipStyle.fontStyle = style.fontStyle;

  // Apply vertical offset to the tooltip position
  if (style.yOffset !== undefined) {
    const yOffset = Number(style.yOffset) || 0;
    if (note.tooltip.anchor) {
      if (note._originalTooltipY === undefined) {
        note._originalTooltipY = note.tooltip.y;
      }
      note.tooltip.y = note._originalTooltipY + yOffset;
    }
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
 * Only persists properties that are defined (not undefined)
 */
async function applyStyleToNote(note, style, persist = true) {
  const applied = applyStyleVisually(note, style);

  // Save to appropriate locations for persistence
  if (applied && persist && note?.document) {
    const doc = note.document;

    // Update core Foundry note document properties (only defined ones)
    const updateData = {};
    if (style.fontFamily !== undefined)
      updateData.fontFamily = style.fontFamily;
    if (style.fontSize !== undefined)
      updateData.fontSize = Number(style.fontSize);
    if (style.fill !== undefined) updateData.textColor = style.fill;

    // Update texture properties (tint)
    if (style.iconTint !== undefined) {
      const textureUpdate = { ...doc?.texture };
      textureUpdate.tint = style.iconTint || null;
      updateData.texture = textureUpdate;
    }

    if (Object.keys(updateData).length > 0) {
      await doc.update(updateData);
    }

    // Update Pin Cushion flag for vertical offset if Pin Cushion is active
    if (isPinCushionActive() && style.yOffset !== undefined) {
      const pcOffset = Math.round((Number(style.yOffset) || 0) / -5);
      await note.document.setFlag(
        PIN_CUSHION_ID,
        "numberHsSuffixOnNameplate",
        pcOffset,
      );
    }

    // Save only our custom style properties to our flags (merge with existing)
    const existingFlags = note.document.getFlag(MODULE_ID, FLAG_KEY) || {};
    const ourStyleData = { ...existingFlags };
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

// Track which notes are currently hovered (by document ID for stability)
const hoveredNotes = new Set();

/**
 * Set up hover listeners directly on a note's PIXI objects
 */
function setupNoteHoverListeners(note) {
  if (!note) return;

  const target = note.controlIcon;
  if (!target) return;

  // Cache the alpha value from flags to avoid slow flag reads on hover
  const saved = note?.document?.getFlag(MODULE_ID, FLAG_KEY) || {};
  const savedAlpha = saved.iconAlpha ?? 1;

  // Store it on the note for quick access
  note._noteStylerAlpha = savedAlpha;

  // Remove old listeners if re-setting up
  if (note._noteStylerHoverIn) {
    target.off("pointerover", note._noteStylerHoverIn);
    target.off("pointerout", note._noteStylerHoverOut);
  }

  const onHoverIn = () => {
    const alpha = note._noteStylerAlpha ?? 1;
    const noteId = note.document?.id;
    if (noteId) hoveredNotes.add(noteId);

    if (alpha < 1) {
      if (note.tooltip) note.tooltip.alpha = 1;
      if (note.controlIcon) note.controlIcon.alpha = 1;
    }
  };

  const onHoverOut = () => {
    const alpha = note._noteStylerAlpha ?? 1;
    const noteId = note.document?.id;
    if (noteId) hoveredNotes.delete(noteId);

    if (alpha < 1) {
      if (note.tooltip) note.tooltip.alpha = alpha;
      if (note.controlIcon) note.controlIcon.alpha = alpha;
    }
  };

  // Store references for cleanup
  note._noteStylerHoverIn = onHoverIn;
  note._noteStylerHoverOut = onHoverOut;

  target.on("pointerover", onHoverIn);
  target.on("pointerout", onHoverOut);
}

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
    const noteId = note.document?.id;
    if (noteId && hoveredNotes.has(noteId) && savedAlpha < 1) {
      if (note.tooltip) note.tooltip.alpha = 1;
      if (note.controlIcon) note.controlIcon.alpha = 1;
    }
  }

  // Set up hover listeners
  setupNoteHoverListeners(note);
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
    // Clear hover state on scene change
    hoveredNotes.clear();

    const notes = canvas.notes?.placeables || [];
    for (const note of notes) {
      reapplySavedStyle(note);
    }
  });
}

/**
 * Extract style values from a form element (only includes checked properties)
 */
function extractStyleFromElement(element) {
  const form = element.querySelector("form") || element;

  // Use Foundry's FormDataExtended to extract all form values at once
  const formData = new foundry.applications.ux.FormDataExtended(form);
  const data = formData.object;

  // Helper to get a value only if its apply checkbox is checked
  const getIfChecked = (propName, value, defaultValue) => {
    return data[`apply_${propName}`] ? (value ?? defaultValue) : undefined;
  };

  return {
    fontFamily: getIfChecked(
      "fontFamily",
      data.fontFamily || DEFAULT_STYLE.fontFamily,
      DEFAULT_STYLE.fontFamily,
    ),
    fontSize: getIfChecked(
      "fontSize",
      Number(data.fontSize) || DEFAULT_STYLE.fontSize,
      DEFAULT_STYLE.fontSize,
    ),
    fill: getIfChecked(
      "fill",
      data.fill || DEFAULT_STYLE.fill,
      DEFAULT_STYLE.fill,
    ),
    stroke: getIfChecked(
      "stroke",
      data.stroke || DEFAULT_STYLE.stroke,
      DEFAULT_STYLE.stroke,
    ),
    strokeThickness: getIfChecked(
      "strokeThickness",
      Number(data.strokeThickness) ?? DEFAULT_STYLE.strokeThickness,
      DEFAULT_STYLE.strokeThickness,
    ),
    dropShadow: getIfChecked(
      "dropShadow",
      data.dropShadow ?? DEFAULT_STYLE.dropShadow,
      DEFAULT_STYLE.dropShadow,
    ),
    dropShadowColor: getIfChecked(
      "dropShadowColor",
      data.dropShadowColor || DEFAULT_STYLE.dropShadowColor,
      DEFAULT_STYLE.dropShadowColor,
    ),
    dropShadowBlur: getIfChecked(
      "dropShadowBlur",
      Number(data.dropShadowBlur) ?? DEFAULT_STYLE.dropShadowBlur,
      DEFAULT_STYLE.dropShadowBlur,
    ),
    dropShadowDistance: getIfChecked(
      "dropShadowDistance",
      Number(data.dropShadowDistance) ?? DEFAULT_STYLE.dropShadowDistance,
      DEFAULT_STYLE.dropShadowDistance,
    ),
    fontWeight: getIfChecked(
      "fontWeight",
      data.fontWeight || DEFAULT_STYLE.fontWeight,
      DEFAULT_STYLE.fontWeight,
    ),
    fontStyle: getIfChecked(
      "fontStyle",
      data.fontStyle || DEFAULT_STYLE.fontStyle,
      DEFAULT_STYLE.fontStyle,
    ),
    yOffset: getIfChecked(
      "yOffset",
      Number(data.yOffset) ?? DEFAULT_STYLE.yOffset,
      DEFAULT_STYLE.yOffset,
    ),
    iconTint: getIfChecked(
      "iconTint",
      data.iconTintEnabled ? data.iconTint || null : null,
      null,
    ),
    iconAlpha: getIfChecked(
      "iconAlpha",
      Number(data.iconAlpha) ?? DEFAULT_STYLE.iconAlpha,
      DEFAULT_STYLE.iconAlpha,
    ),
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

    // Live preview on input change (exclude apply checkboxes and group checkboxes)
    this.element
      .querySelectorAll(
        "input:not(.apply-checkbox):not(.group-checkbox), select",
      )
      .forEach((input) => {
        input.addEventListener("input", () => {
          this.#autoCheckInput(input);
          this.#onPreview();
        });
        input.addEventListener("change", () => {
          this.#autoCheckInput(input);
          this.#onPreview();
        });
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

    // Group checkbox toggle behavior
    this.element
      .querySelectorAll(".group-checkbox")
      .forEach((groupCheckbox) => {
        groupCheckbox.addEventListener("change", () => {
          const group = groupCheckbox.dataset.group;
          const checked = groupCheckbox.checked;
          this.element
            .querySelectorAll(
              `.form-group[data-group="${group}"] .apply-checkbox`,
            )
            .forEach((cb) => {
              cb.checked = checked;
            });
          this.#onPreview();
        });
      });

    // Individual apply checkbox triggers preview
    this.element.querySelectorAll(".apply-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        this.#updateGroupCheckbox(checkbox);
        this.#onPreview();
      });
    });
  }

  #autoCheckInput(input) {
    const formGroup = input.closest(".form-group");
    if (!formGroup) return;
    const applyCheckbox = formGroup.querySelector(".apply-checkbox");
    if (applyCheckbox && !applyCheckbox.checked) {
      applyCheckbox.checked = true;
      this.#updateGroupCheckbox(applyCheckbox);
    }
  }

  #updateGroupCheckbox(checkbox) {
    const formGroup = checkbox.closest(".form-group");
    const group = formGroup?.dataset.group;
    if (!group) return;

    const allInGroup = this.element.querySelectorAll(
      `.form-group[data-group="${group}"] .apply-checkbox`,
    );
    const allChecked = Array.from(allInGroup).every((cb) => cb.checked);
    const groupCheckbox = this.element.querySelector(
      `.group-checkbox[data-group="${group}"]`,
    );
    if (groupCheckbox) {
      groupCheckbox.checked = allChecked;
    }
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
