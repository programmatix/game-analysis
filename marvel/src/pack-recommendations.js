const { normalizeForSearch } = require('../../shared/text-utils');

// MarvelCDB does not currently provide a machine-readable "recommended modular set"
// for villain/scenario sets, so we maintain a small curated mapping here.
//
// Keys and values are `card_set_code` strings from the MarvelCDB cards payload.
const RECOMMENDED_MODULAR_BY_VILLAIN_SET_CODE = new Map([
  // Mutant Genesis: Magneto recommends Brotherhood.
  [normalizeForSearch('magneto_villain'), ['brotherhood']],
]);

function getRecommendedModularSetCodesForVillainSet(setCode) {
  const normalized = normalizeForSearch(setCode);
  if (!normalized) return [];
  return RECOMMENDED_MODULAR_BY_VILLAIN_SET_CODE.get(normalized) || [];
}

module.exports = {
  getRecommendedModularSetCodesForVillainSet,
};
