import { isHouseReputationSpendsEnabled } from "./house-settings.js";
import {
  getCustomHouseGloryOptions,
  getCustomHouseShameOptions,
} from "../acclaim/customSpendOptions.js";

export async function resolveCharacterHouse(actor) {
  const uuid = actor?.system?.houseActorUuid;
  if (!uuid) return null;
  const house = await fromUuid(uuid);
  return house?.type === "sta-officers-log.house" ? house : null;
}

export async function getHouseReputationSpendOptions(actor, type) {
  if (!isHouseReputationSpendsEnabled()) return [];
  const house = await resolveCharacterHouse(actor);
  if (!house || house.system?.dissolved) return [];

  const reputation = Math.max(0, Number(house.system?.reputation ?? 0));
  const options = [];
  if (type === "acclaim") {
    options.push(
      ...getCustomHouseGloryOptions().map((option) => ({
        ...option,
        isHouseReputationSpend: true,
        isHouseManualSpend: true,
        houseUuid: house.uuid,
      })),
    );
    if (reputation > 0) {
      options.push({
        action: "houseIncreaseStanding",
        cost: reputation,
        label: "Increase House Standing",
        desc: `Increase the House's Reputation by 1. Cost: ${reputation} Glory. Once per adventure.`,
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    if (!house.system?.isGreatHouse) {
      options.push({
        action: "houseAscendancy",
        cost: 5,
        label: "Ascendancy",
        desc: "Elevate the family to Great House status. The character does not gain the House Lifepath benefits retroactively.",
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    if (house.system?.isGreatHouse && !house.system?.highCouncilSeat) {
      options.push({
        action: "houseHighestStatus",
        cost: 5,
        label: "Highest Status",
        desc: "Secure a seat on the High Council for the House.",
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
  } else if (type === "reprimand") {
    options.push(
      ...getCustomHouseShameOptions().map((option) => ({
        ...option,
        isHouseReputationSpend: true,
        isHouseManualSpend: true,
        houseUuid: house.uuid,
      })),
    );
    if (reputation > 0) {
      options.push({
        action: "houseReduceStanding",
        cost: reputation,
        label: "Reduce House Standing",
        desc: `Reduce the House's Reputation by 1. Cost: ${reputation} Shame. Once per adventure.`,
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    if (house.system?.highCouncilSeat) {
      options.push({
        action: "houseLoseCouncilSeat",
        cost: 5,
        label: "Lose High Council Seat",
        desc: "Expend Shame to lose the House's High Council seat.",
        isHouseReputationSpend: true,
        houseUuid: house.uuid,
      });
    }
    options.push({
      action: "houseDissolution",
      cost: 5,
      label: "Dissolution",
      desc: "Dissolve the House. Members lose the House trait and immediately reduce Reputation by 1.",
      isHouseReputationSpend: true,
      houseUuid: house.uuid,
    });
  }

  return options;
}

export async function applyHouseReputationSpend(option) {
  if (!option?.houseUuid) return false;
  const house = await fromUuid(option.houseUuid);
  if (!house || house.type !== "sta-officers-log.house") return false;

  const system = house.system;
  let update = null;
  switch (option.action) {
    case "houseIncreaseStanding":
      update = {
        "system.reputation": Math.min(12, Number(system.reputation ?? 0) + 1),
      };
      break;
    case "houseReduceStanding":
      update = {
        "system.reputation": Math.max(0, Number(system.reputation ?? 0) - 1),
      };
      break;
    case "houseAscendancy":
      update = { "system.isGreatHouse": true };
      break;
    case "houseHighestStatus":
      update = { "system.highCouncilSeat": true };
      break;
    case "houseLoseCouncilSeat":
      update = { "system.highCouncilSeat": false };
      break;
    case "houseDissolution":
      update = {
        "system.dissolved": true,
        "system.isGreatHouse": false,
        "system.highCouncilSeat": false,
      };
      break;
    default:
      return false;
  }

  await house.update(update);

  const cost = Number(option.cost ?? 0);
  const description = `${option.desc ?? option.label ?? "House advancement"}\n\nCost: ${cost}.`;
  await house.createEmbeddedDocuments("Item", [
    {
      name: option.label ?? "House Development",
      type: "milestone",
      system: { description },
    },
  ]);

  return true;
}
