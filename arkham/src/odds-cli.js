#!/usr/bin/env node
const { program } = require('commander');

function toInt(value, label) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return num;
}

function combination(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

function probabilityNoHits(population, successes, draws) {
  if (draws < 0 || draws > population) return 0;
  return combination(population - successes, draws) / combination(population, draws);
}

function openingDistribution({ deckSize, weaknesses, targetCopies, openingHand }) {
  const nonWeakDeck = deckSize - weaknesses;
  const denom = combination(nonWeakDeck, openingHand);
  const maxHits = Math.min(openingHand, targetCopies);
  const distribution = [];

  for (let hits = 0; hits <= maxHits; hits += 1) {
    const waysWithHits = combination(targetCopies, hits) * combination(nonWeakDeck - targetCopies, openingHand - hits);
    distribution.push({
      hits,
      probability: waysWithHits / denom,
    });
  }

  const openingHitChance = 1 - probabilityNoHits(nonWeakDeck, targetCopies, openingHand);
  return { distribution, openingHitChance };
}

function nextDrawsProbability({ deckSize, targetCopies, openingHand, nextDraws, distribution }) {
  const remainingDeck = deckSize - openingHand;
  let probability = 0;

  distribution.forEach(({ hits, probability: weight }) => {
    const remainingTargets = targetCopies - hits;
    const missChance = probabilityNoHits(remainingDeck, remainingTargets, nextDraws);
    probability += weight * (1 - missChance);
  });

  return probability;
}

function main() {
  program
    .name('arkham-odds')
    .description('Hypergeometric draw odds with Arkham weakness redraws')
    .option('-d, --deck-size <n>', 'Total deck size', v => toInt(v, 'deck size'), 33)
    .option('-w, --weaknesses <n>', 'Weakness count (discard and redraw for opening hand)', v => toInt(v, 'weakness count'), 2)
    .option('-t, --target-copies <n>', 'Copies of the card you care about', v => toInt(v, 'target copies'), 1)
    .option('-o, --opening-hand <n>', 'Opening hand size (non-weakness cards kept)', v => toInt(v, 'opening hand'), 5)
    .option('-n, --next-draws <n>', 'Draws to check after the opening hand', v => toInt(v, 'next draws'), 10)
    .parse(process.argv);

  const opts = program.opts();
  const { deckSize, weaknesses, targetCopies, openingHand, nextDraws } = opts;

  if (weaknesses >= deckSize) {
    throw new Error('Weakness count must be less than deck size.');
  }

  const nonWeakDeck = deckSize - weaknesses;
  if (targetCopies > nonWeakDeck) {
    throw new Error('Target copies cannot exceed non-weakness cards in the deck.');
  }

  if (openingHand > nonWeakDeck) {
    throw new Error('Opening hand size cannot exceed non-weakness cards in the deck.');
  }

  if (openingHand + nextDraws > deckSize) {
    throw new Error('Opening hand plus next draws cannot exceed total deck size.');
  }

  const { distribution, openingHitChance } = openingDistribution({
    deckSize,
    weaknesses,
    targetCopies,
    openingHand,
  });

  const nextHitChance = nextDrawsProbability({
    deckSize,
    targetCopies,
    openingHand,
    nextDraws,
    distribution,
  });

  const missOpening = probabilityNoHits(nonWeakDeck, targetCopies, openingHand);
  const conditionalNextIfMiss = missOpening === 0
    ? 0
    : 1 - probabilityNoHits(deckSize - openingHand, targetCopies, nextDraws);

  const pct = value => (value * 100).toFixed(2);

  console.log('Arkham draw odds (weaknesses discarded during opening, then shuffled back)');
  console.log(`Deck size: ${deckSize} (${weaknesses} weaknesses)`);
  console.log(`Target copies: ${targetCopies}`);
  console.log(`Opening hand: ${openingHand} kept cards`);
  console.log(`Next draws: ${nextDraws}`);
  console.log('');
  console.log(`P(hit in opening hand): ${pct(openingHitChance)}%`);
  console.log(`P(hit in next ${nextDraws} draws): ${pct(nextHitChance)}%`);
  console.log(`P(hit in next ${nextDraws} given miss in opening): ${pct(conditionalNextIfMiss)}%`);
}

main();
