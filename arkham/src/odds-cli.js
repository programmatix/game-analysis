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

function hypergeometricProbability(population, successes, draws, hits) {
  if (draws < 0 || draws > population) return 0;
  if (hits < 0 || hits > draws) return 0;
  if (hits > successes) return 0;
  const denom = combination(population, draws);
  if (denom === 0) return 0;
  return (
    (combination(successes, hits) * combination(population - successes, draws - hits)) / denom
  );
}

function probabilityAtLeast(population, successes, draws, minHits) {
  if (minHits <= 0) return 1;
  const maxHits = Math.min(successes, draws);
  if (minHits > maxHits) return 0;

  let probability = 0;
  for (let hits = minHits; hits <= maxHits; hits += 1) {
    probability += hypergeometricProbability(population, successes, draws, hits);
  }
  return probability;
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

  const openingTwoPlusChance = distribution.reduce(
    (sum, { hits, probability }) => sum + (hits >= 2 ? probability : 0),
    0,
  );

  const cumulativeAtLeastByThisPoint = (draws, minHits) => {
    if (minHits <= 0) return 1;
    if (minHits > targetCopies) return 0;

    const remainingDeck = deckSize - openingHand;
    let probability = 0;

    distribution.forEach(({ hits: openingHits, probability: weight }) => {
      const remainingTargets = targetCopies - openingHits;
      const neededFromDraws = minHits - openingHits;
      if (neededFromDraws <= 0) {
        probability += weight;
      } else {
        probability += weight * probabilityAtLeast(remainingDeck, remainingTargets, draws, neededFromDraws);
      }
    });

    return probability;
  };

  const missOpening = probabilityNoHits(nonWeakDeck, targetCopies, openingHand);
  const conditionalNextIfMiss = missOpening === 0
    ? 0
    : 1 - probabilityNoHits(deckSize - openingHand, targetCopies, nextDraws);

  const pct = value => (value * 100).toFixed(2);

  console.log('Arkham draw odds (weaknesses discarded during opening, then shuffled back)');
  console.log(`Deck size: ${deckSize} (${weaknesses} weaknesses)`);
  console.log(`Target copies: ${targetCopies}`);
  console.log(`Opening hand: ${openingHand} kept cards (models auto discarding weaknesses)`);
  console.log(`Next draws: ${nextDraws}`);
  console.log('');
  console.log('Step\t\tP(1+ hit)\tP(2+ hits)');
  console.log(`Opening hand\t${pct(openingHitChance)}%\t\t${pct(openingTwoPlusChance)}%`);
  for (let i = 1; i <= nextDraws; i += 1) {
    const onePlus = cumulativeAtLeastByThisPoint(i, 1);
    const twoPlus = cumulativeAtLeastByThisPoint(i, 2);
    console.log(`Draw ${i}\t\t${pct(onePlus)}%\t\t${pct(twoPlus)}%`);
  }
  console.log('');
  console.log(`P(hit in next ${nextDraws} given miss in opening): ${pct(conditionalNextIfMiss)}%`);
}

main();
