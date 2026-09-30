import { t } from "../core/i18n.js";

const warnedOwnershipAssignments = new Set();

function getHouseActors() {
  return [...(game.actors ?? [])]
    .filter((actor) => actor.type === "sta-officers-log.house")
    .sort((left, right) => left.name.localeCompare(right.name));
}

function rerenderHouse(uuid) {
  if (!uuid) return;
  fromUuid(uuid).then((house) => {
    if (house?.sheet?.rendered) house.sheet.render(true);
  });
}

export async function warnMissingHouseOwnership(users = game.users ?? []) {
  if (!game.user?.isGM) return;

  const warnings = [];
  for (const user of users) {
    if (!user || user.isGM) continue;
    const character = user.character;
    const houseUuid = String(character?.system?.houseActorUuid ?? "").trim();
    if (!character || !houseUuid) continue;

    const house = await fromUuid(houseUuid);
    if (!house || house.type !== "sta-officers-log.house") continue;

    const warningKey = `${user.id}:${character.id}:${house.id}`;
    const isOwner = house.testUserPermission?.(
      user,
      CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    );
    if (isOwner) {
      warnedOwnershipAssignments.delete(warningKey);
      continue;
    }
    if (warnedOwnershipAssignments.has(warningKey)) continue;

    warnedOwnershipAssignments.add(warningKey);
    warnings.push(
      t("sta-officers-log.house.missingOwnershipWarning")
        .replace("{user}", user.name)
        .replace("{character}", character.name)
        .replace("{house}", house.name),
    );
  }

  if (warnings.length) {
    ui.notifications?.warn?.(warnings.join("\n"), { permanent: true });
  }
}

async function applyAssignedHouseFields(root, actor) {
  const houseUuid = String(actor.system?.houseActorUuid ?? "").trim();
  if (!houseUuid) return;

  const house = await fromUuid(houseUuid);
  if (!house || house.type !== "sta-officers-log.house") return;

  const setReadonlyValue = (name, value) => {
    const input = root.querySelector(`[name="${name}"]`);
    if (!input) return;
    input.value = value ?? "";
    input.readOnly = true;
    input.classList.add("sta-house-derived-field");
    input.title = "Inherited from assigned House";
  };

  setReadonlyValue("system.influence", house.system?.influence);
  setReadonlyValue("system.might", house.system?.might);
  setReadonlyValue("system.wealth", house.system?.wealth);
  setReadonlyValue("system.status", house.system?.status?.value);
  setReadonlyValue("system.legacy", house.system?.legacy?.value);
  setReadonlyValue("system.temperament", house.system?.temperament?.value);
  setReadonlyValue("system.house", house.name);

  const row = root.querySelector(".sta-house-assignment-row");
  if (row && !row.querySelector(".sta-open-house-button")) {
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "sta-open-house-button";
    openButton.title = "Open House";
    openButton.setAttribute("aria-label", "Open House");
    openButton.innerHTML = '<i class="fas fa-landmark" aria-hidden="true"></i>';
    openButton.addEventListener("click", () => house.sheet?.render(true));
    row.querySelector(".sta-house-assignment-controls")?.append(openButton);
  }
}

export function installHouseAssignmentControl(root, actor) {
  if (!root || !actor || actor.type !== "character") return;
  const houseContainer = root.querySelector(".column.house");
  const klingonCheckbox = root.querySelector('[name="system.showklingon"]');
  if (!houseContainer) return;

  if (klingonCheckbox?.dataset.houseAssignmentWired !== "1") {
    klingonCheckbox.dataset.houseAssignmentWired = "1";
    klingonCheckbox.addEventListener("change", () => {
      houseContainer.classList.toggle("hidden", !klingonCheckbox.checked);
    });
  }

  if (!actor.system?.showklingon) return;
  if (!actor.isOwner || root.querySelector(".sta-house-assignment-row")) {
    applyAssignedHouseFields(root, actor);
    return;
  }

  const houses = getHouseActors();
  const currentUuid = actor.system?.houseActorUuid ?? "";
  const row = document.createElement("div");
  row.className = "sta-house-assignment-row";

  const label = document.createElement("div");
  label.className = "title";
  label.textContent = t("sta-officers-log.house.assignment") || "House";

  const select = document.createElement("select");
  select.id = `sta-house-assignment-${actor.id}`;
  select.name = "system.houseActorUuid";
  select.innerHTML = `<option value="">${
    t("sta-officers-log.house.noAssignment") || "No House"
  }</option>`;

  for (const house of houses) {
    const option = document.createElement("option");
    option.value = house.uuid;
    option.textContent = house.name;
    option.selected = house.uuid === currentUuid;
    select.appendChild(option);
  }

  select.addEventListener("change", async () => {
    const previousUuid = actor.system?.houseActorUuid ?? "";
    const house = houses.find((candidate) => candidate.uuid === select.value);
    await actor.update({
      "system.houseActorUuid": house?.uuid || null,
      "system.house": house?.name || "",
    });
    rerenderHouse(previousUuid);
    rerenderHouse(house?.uuid);
  });

  const controls = document.createElement("div");
  controls.className = "sta-house-assignment-controls";
  controls.append(select);
  row.append(label, controls);
  houseContainer.replaceChildren(row);

  applyAssignedHouseFields(root, actor);
}
