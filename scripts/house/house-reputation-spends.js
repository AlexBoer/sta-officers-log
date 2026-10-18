import { isHouseReputationSpendsEnabled } from "./house-settings.js";
import {
  getCustomHouseGloryOptions,
  getCustomHouseShameOptions,
} from "../acclaim/customSpendOptions.js";
import {
  applyKlingonMode,
  isKlingonModeEnabled,
  t,
} from "../core/i18n.js";

export function isHouseReputationSurveyEnabled(actor) {
  return (
    isKlingonModeEnabled() &&
    actor?.type === "character" &&
    actor.system?.showklingon === true
  );
}

export async function resolveCharacterHouse(actor) {
  const uuid = actor?.system?.houseActorUuid;
  if (!uuid) return null;
  const house = (await fromUuid(uuid)) ?? game.actors?.get?.(uuid);
  return house?.type === "sta-officers-log.house" ? house : null;
}

export async function getCharacterHouseReputationInfluence(actor) {
  if (!isHouseReputationSurveyEnabled(actor)) return null;
  const house = await resolveCharacterHouse(actor);
  if (!house) return null;

  const characterReputation = Number(actor.system?.reputation);
  const houseReputation = Number(house.system?.reputation);
  if (!Number.isFinite(characterReputation) || !Number.isFinite(houseReputation))
    return null;
  if (characterReputation < houseReputation) {
    return {
      type: "negative",
      question:
        t("sta-officers-log.acclaimSurvey.houseDisgraces") ||
        "Your Reputation is lower than your House's Reputation, disgracing your House (+1 negative influence).",
    };
  }
  if (characterReputation > houseReputation) {
    return {
      type: "positive",
      question:
        t("sta-officers-log.acclaimSurvey.houseElevates") ||
        "Your Reputation exceeds your House's Reputation, elevating your House (+1 positive influence).",
    };
  }
  return null;
}

export async function getHouseReputationSpendOptions(actor, type) {
  if (!actor?.system?.showklingon) return [];
  if (!isHouseReputationSpendsEnabled()) return [];
  const house = await resolveCharacterHouse(actor);
  if (!house || house.system?.dissolved) return [];

  const reputation = Math.max(0, Number(house.system?.reputation ?? 0));
  const markHouseSpendOptions = (options) =>
    options.map((option) => {
      return {
        ...option,
        isHouseReputationSpend: true,
        isHouseManualSpend: true,
        houseUuid: house.uuid,
      };
    });
  const hasMembers =
    (house.system?.dummyMembers?.length ?? 0) > 0 ||
    (game.actors ?? []).some((candidate) => {
      const assignedHouse = String(candidate.system?.houseActorUuid ?? "");
      return (
        candidate.type === "character" &&
        (assignedHouse === house.uuid || assignedHouse === house.id)
      );
    });
  const options = [];
  if (type === "acclaim") {
    options.push(
      ...markHouseSpendOptions(getCustomHouseGloryOptions()),
    );
    if (reputation < 12) {
      options.push({
        action: "houseIncreaseStanding",
        cost: reputation,
        label: "Increase House Standing",
        desc: `Increase the House's Reputation by 1. The whole party may use this only once per adventure.`,
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    if (!house.system?.isGreatHouse) {
      options.push({
        action: "houseAscendancy",
        cost: 5,
        label: "Ascendancy",
        desc: "Elevate your family to the status of Great House, if you were not part of a Great House before. Create a new Great House. Your character does not gain any of the Lifepath benefits of the new House, though you do now have access to House talents.",
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    if (!house.system?.highCouncilSeat && hasMembers) {
      options.push({
        action: "houseHighestStatus",
        cost: 5,
        label: "Highest Status",
        desc: "Secure a seat on the High Council for the House. The GM determines which House member holds the seat (normally an NPC).",
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
  } else if (type === "reprimand") {
    options.push(
      ...markHouseSpendOptions(getCustomHouseShameOptions()),
    );
    if (reputation > 0) {
      options.push({
        action: "houseReduceStanding",
        cost: reputation,
        label: "Reduce House Standing",
        desc: `Reduce the House's Reputation by 1. This option may be chosen only once per adventure by the whole party.`,
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    if (house.system?.highCouncilSeat) {
      options.push({
        action: "houseLoseCouncilSeat",
        cost: 5,
        label: "Lose High Council Seat",
        desc: applyKlingonMode("Expend Reprimands to lose the House's High Council seat."),
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    options.push({
      action: "houseDissolution",
      cost: 5,
      label: "Dissolution",
      desc: "Dissolve the House. The GM and players must manually remove House traits and reduce each member's Reputation by 1. Previously acquired talents remain.",
      isHouseReputationSpend: true,
      houseUuid: house.uuid,
    });
  }

  return options;
}

export async function applyHouseReputationSpend(option) {
  if (!option?.houseUuid) return false;
  const house = await fromUuid(option.houseUuid);
  if (
    !house ||
    house.type !== "sta-officers-log.house" ||
    !house.isOwner ||
    house.system?.dissolved
  )
    return false;

  const system = house.system;
  let update = null;
  const description = option.desc ?? option.label ?? "House advancement";
  if (!option.isHouseManualSpend) {
    switch (option.action) {
      case "houseIncreaseStanding":
        if (Number(system.reputation ?? 0) >= 12) return false;
        update = {
          "system.reputation": Math.min(
            12,
            Number(system.reputation ?? 0) + 1,
          ),
        };
        break;
      case "houseReduceStanding":
        if (Number(system.reputation ?? 0) <= 0) return false;
        update = {
          "system.reputation": Math.max(
            0,
            Number(system.reputation ?? 0) - 1,
          ),
        };
        break;
      case "houseAscendancy":
        if (system.isGreatHouse) return false;
        update = { "system.isGreatHouse": true };
        break;
      case "houseHighestStatus":
        if (system.highCouncilSeat) return false;
        update = {
          "system.highCouncilSeat": true,
          "system.highCouncilSeatHolder": null,
        };
        break;
      case "houseLoseCouncilSeat":
        if (!system.highCouncilSeat) return false;
        update = {
          "system.highCouncilSeat": false,
          "system.highCouncilSeatHolder": null,
        };
        break;
      case "houseDissolution":
        if (system.dissolved) return false;
        update = {
          "system.dissolved": true,
          "system.isGreatHouse": false,
          "system.highCouncilSeat": false,
          "system.highCouncilSeatHolder": null,
        };
        break;
      default:
        return false;
    }
  }

  const cost = Number(option.cost ?? 0);
  const spendLabel =
    option.spendType === "acclaim"
      ? applyKlingonMode("Acclaim")
      : option.spendType === "reprimand"
        ? applyKlingonMode("Reprimands")
        : null;
  if (!Number.isFinite(cost) || !spendLabel || !option.spentBy) return false;
  const milestoneDescription = `${description}\n\nCost: ${cost} ${spendLabel}.\nChosen by: ${option.spentBy}.`;
  let milestone;
  try {
    [milestone] = await house.createEmbeddedDocuments("Item", [
      {
        name: option.label ?? "House Development",
        type: "milestone",
        system: { description: milestoneDescription },
      },
    ]);
    if (update) await house.update(update);
  } catch (error) {
    if (milestone) {
      try {
        await milestone.delete();
      } catch (rollbackError) {
        console.error(
          "sta-officers-log | failed to roll back House spend milestone",
          rollbackError,
        );
      }
    }
    throw error;
  }

  return true;
}
