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

function organizeCharacterFields(root) {
  const biography = root.querySelector('.tab[data-tab="biography"]');
  if (!biography || biography.querySelector(".sta-character-profile-pair")) return;

  const selectors = {
    pronouns: ".column.pronouns",
    species: ".column.species",
    career: ".column.careerpath",
    experience: ".column.experience",
    assignment: ".column.assignment",
    division: ".column.division",
    rank: ".column.rank",
    role: ".column.characterrole",
    environment: ".column.environment",
    upbringing: ".column.upbringing",
    pastimes: ".column.pastimes",
    careerEvents: ".column.careerevents",
  };
  const fields = Object.fromEntries(
    Object.entries(selectors).map(([key, selector]) => [
      key,
      biography.querySelector(selector),
    ]),
  );
  const anchor = fields.pronouns?.closest(".row");
  if (!anchor) return;

  const originalRows = [
    ...new Set(
      Object.values(fields)
        .filter(Boolean)
        .map((field) => field.closest(".row"))
        .filter((row) => row && row !== anchor),
    ),
  ];

  const divisionCustom = fields.division?.querySelector(".custom-division");
  if (divisionCustom) fields.division.append(divisionCustom);

  const rows = [
    {
      className: "sta-character-profile-pair",
      fields: [fields.pronouns, fields.species],
    },
    {
      className: "sta-character-profile-pair",
      fields: [fields.career, fields.experience],
    },
    {
      className: "sta-character-assignment-row",
      fields: [
        fields.assignment,
        fields.division,
        fields.rank,
        fields.role,
      ],
    },
    {
      className: "sta-character-profile-pair",
      fields: [fields.environment, fields.upbringing],
    },
    {
      className: "sta-character-profile-pair",
      fields: [fields.pastimes, fields.careerEvents],
    },
  ].filter((row) =>
    row.className === "sta-character-assignment-row"
      ? Boolean(fields.assignment && fields.rank && fields.role)
      : row.fields.every(Boolean),
  );

  if (fields.assignment && fields.division && fields.rank && fields.role) {
    fields.division.classList.add("sta-character-division-field");
  }

  const reference = anchor.nextSibling;
  rows.forEach(({ className, fields: rowFields }) => {
    const row = document.createElement("div");
    row.className = `row ${className}`;
    const visibleFields = rowFields.filter(Boolean);
    if (
      className === "sta-character-assignment-row" &&
      visibleFields.length === 3
    ) {
      row.classList.add("sta-character-assignment-row-three");
    }
    row.append(...visibleFields);
    anchor.parentElement.insertBefore(row, reference);
  });

  originalRows.forEach((row) => {
    if (!row.children.length) row.remove();
  });
  if (!anchor.children.length) anchor.remove();
}

function organizeKlingonHouseFields(root, actor) {
  const house = root.querySelector(".column.house");
  const caste = root.querySelector(".column.caste");
  const status = root.querySelector(".column.status");
  const legacy = root.querySelector(".column.legacy");
  const temperament = root.querySelector(".column.temperament");
  const history = root.querySelector(".column.househistory");
  const houseRow = house?.closest(".row");
  const originalFieldRows = [
    status?.closest(".row"),
    legacy?.closest(".row"),
    temperament?.closest(".row"),
    history?.closest(".row"),
  ].filter((row, index, rows) => row && row !== houseRow && rows.indexOf(row) === index);
  if (
    !houseRow ||
    !caste ||
    !status ||
    !legacy ||
    !temperament ||
    !history ||
    root.querySelector(".sta-house-role-column")
  ) {
    return;
  }

  const roleColumn = document.createElement("div");
  roleColumn.className = "column house-role sta-house-role-column";
  const roleHeader = document.createElement("div");
  roleHeader.className = "title";
  roleHeader.textContent = t("sta-officers-log.house.role") || "House Role";
  const roleInput = document.createElement("input");
  roleInput.type = "text";
  roleInput.className = "text-entry";
  roleInput.dataset.houseRoleInput = "true";
  roleInput.value = String(actor.system?.houseRole ?? "");
  roleInput.placeholder =
    t("sta-officers-log.house.rolePlaceholder") || "House Role";
  roleInput.readOnly = !actor.isOwner;
  roleInput.addEventListener("change", async () => {
    if (!actor.isOwner) return;
    try {
      await actor.update({ "system.houseRole": roleInput.value.trim() });
    } catch (error) {
      console.error("sta-officers-log | failed to update House role", error);
      ui.notifications?.error?.(
        t("sta-officers-log.house.roleUpdateFailed") ||
          "Could not update House role.",
      );
    }
  });
  roleColumn.append(roleHeader, roleInput);

  const houseSection = document.createElement("div");
  houseSection.className = "section sta-klingon-house-section";
  const sectionHeader = document.createElement("div");
  sectionHeader.className =
    "title sta-klingon-house-section-header";
  sectionHeader.textContent =
    t("sta-officers-log.house.sectionHeader") || "Klingon House";

  const statusRow = document.createElement("div");
  statusRow.className = "row sta-klingon-house-row";
  statusRow.append(status, legacy, temperament);
  const historyRow = document.createElement("div");
  historyRow.className = "row sta-klingon-house-history-row";
  historyRow.append(history);

  houseRow.classList.add("sta-klingon-house-row");
  houseRow.replaceChildren(house, roleColumn, caste);
  houseRow.before(houseSection);
  houseSection.append(sectionHeader, houseRow, statusRow, historyRow);
  originalFieldRows.forEach((row) => {
    if (!row.children.length) row.remove();
  });

  const klingonCheckbox = root.querySelector('[name="system.showklingon"]');
  houseSection.classList.toggle(
    "hidden",
    !(klingonCheckbox?.checked ?? actor.system?.showklingon),
  );
  for (const column of [
    house,
    roleColumn,
    caste,
    status,
    legacy,
    temperament,
    history,
  ]) {
    column.classList.toggle(
      "hidden",
      !(klingonCheckbox?.checked ?? actor.system?.showklingon),
    );
  }
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

  if (!house.system?.dissolved) {
    setReadonlyValue("system.influence", house.system?.influence);
    setReadonlyValue("system.might", house.system?.might);
    setReadonlyValue("system.wealth", house.system?.wealth);
    setReadonlyValue("system.status", house.system?.status?.value);
    setReadonlyValue("system.legacy", house.system?.legacy?.value);
    setReadonlyValue("system.temperament", house.system?.temperament?.value);
    setReadonlyValue("system.house", house.name);
  }

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

  organizeCharacterFields(root);
  organizeKlingonHouseFields(root, actor);
  const roleColumn = root.querySelector(".sta-house-role-column");

  if (klingonCheckbox?.dataset.houseAssignmentWired !== "1") {
    klingonCheckbox.dataset.houseAssignmentWired = "1";
    klingonCheckbox.addEventListener("change", () => {
      houseContainer.classList.toggle("hidden", !klingonCheckbox.checked);
      root
        .querySelector(".sta-klingon-house-section")
        ?.classList.toggle("hidden", !klingonCheckbox.checked);
      roleColumn?.classList.toggle("hidden", !klingonCheckbox.checked);
      root
        .querySelectorAll(
          ".sta-klingon-house-row .column, .sta-klingon-house-history-row .column",
        )
        .forEach((column) =>
          column.classList.toggle("hidden", !klingonCheckbox.checked),
        );
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
