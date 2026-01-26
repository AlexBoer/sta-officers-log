export const MODULE_ID = "sta-officers-log";

// STA system default icon handling
export const STA_DEFAULT_ICON_FALLBACK =
  "systems/sta/assets/icons/voyagercombadgeicon.svg";
export const STA_DEFAULT_ICON_LEGACY =
  "systems/sta/assets/icons/VoyagerCombadgeIcon.png";

export function getStaDefaultIcon() {
  try {
    const g = globalThis?.game;
    const sysDefault = g?.sta?.defaultImage;
    if (typeof sysDefault === "string" && sysDefault.trim()) {
      return sysDefault.trim();
    }

    const fu = globalThis?.foundry?.utils;

    // Some systems expose defaults in CONFIG (defensive lookup).
    const cfgStaDefault = fu?.getProperty?.(
      globalThis?.CONFIG,
      "sta.defaultImage",
    );
    if (typeof cfgStaDefault === "string" && cfgStaDefault.trim()) {
      return cfgStaDefault.trim();
    }

    // If the system overrides the global item default icon and it's STA-scoped,
    // prefer that over our hard-coded fallback.
    const itemDefault = fu?.getProperty?.(
      globalThis?.CONFIG,
      "Item.documentClass.DEFAULT_ICON",
    );
    if (
      typeof itemDefault === "string" &&
      itemDefault.trim() &&
      itemDefault.includes("/systems/sta/")
    ) {
      return itemDefault.trim();
    }
  } catch (_) {
    // ignore
  }

  return STA_DEFAULT_ICON_FALLBACK;
}

export const VALUE_ICON_COUNT = 8;
export const VALUE_ICON_EXT = "webp";

export function valueIconPath(n) {
  return `modules/${MODULE_ID}/assets/ValueIcons/V${n}.${VALUE_ICON_EXT}`;
}

export function traumaIconPath(n) {
  return `modules/${MODULE_ID}/assets/ValueIcons/T${n}.${VALUE_ICON_EXT}`;
}
