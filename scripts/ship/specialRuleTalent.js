// Special rule talents (e.g. a service record's special rule) are marked by
// sta-utils with this flag and may never be replaced.
const SPECIAL_RULE_MODULE = "sta-utils";
const SPECIAL_RULE_FLAG = "specialRule";

export function isSpecialRuleTalent(item) {
  return item?.flags?.[SPECIAL_RULE_MODULE]?.[SPECIAL_RULE_FLAG] === true;
}
