export const MODULE_ID = "sta-officers-log";

export const VALUE_ICON_COUNT = 8;
export const VALUE_ICON_EXT = "webp";

export function valueIconPath(n) {
  return `modules/${MODULE_ID}/assets/ValueIcons/V${n}.${VALUE_ICON_EXT}`;
}
