import {
  MODULE_ID,
  WORLD_HOUSE_REPUTATION_SPENDS_SETTING,
} from "../core/constants.js";
import { t } from "../core/i18n.js";

export function isHouseReputationSpendsEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, WORLD_HOUSE_REPUTATION_SPENDS_SETTING),
    );
  } catch (_) {
    return false;
  }
}

export function registerHouseSettings() {
  game.settings.register(MODULE_ID, WORLD_HOUSE_REPUTATION_SPENDS_SETTING, {
    name: t("sta-officers-log.settings.houseReputationSpends.name"),
    hint: t("sta-officers-log.settings.houseReputationSpends.hint"),
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: false,
    onChange: () => {
      for (const actor of game.actors ?? []) {
        try {
          if (
            actor.type === "sta-officers-log.house" &&
            actor.sheet?.rendered
          ) {
            actor.sheet.render(true);
          }
        } catch (_) {
          // A sheet may close while settings are being synchronized.
        }
      }
    },
  });
}
