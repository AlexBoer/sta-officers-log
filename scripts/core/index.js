// Core module infrastructure
export {
  MODULE_ID,
  STA_DEFAULT_ICON_FALLBACK,
  STA_DEFAULT_ICON_LEGACY,
  getStaDefaultIcon,
  VALUE_ICON_COUNT,
  VALUE_ICON_EXT,
  valueIconPath,
  traumaIconPath,
} from "./constants.js";

export { t, tf } from "./i18n.js";

export { getModuleSocket, initSocket } from "./socket.js";

export {
  ATTRIBUTE_KEYS,
  DISCIPLINE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
  SHIP_SYSTEM_KEYS,
  SHIP_DEPARTMENT_KEYS,
  SHIP_SYSTEM_LABELS,
  SHIP_DEPARTMENT_LABELS,
} from "./gameConstants.js";
