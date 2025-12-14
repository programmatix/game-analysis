#!/usr/bin/env node
const path = require('path');
const { program } = require('commander');
const { readDeckText, parseDeckList } = require('../../shared/deck-utils');
const { loadCardDatabase, buildCardLookup } = require('./card-data');
const { expandDeck, drawOpeningHandWithWeaknessRedraw, shuffle } = require('./hand-sim-helpers');

function positiveInt(value, label) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return num;
}

function nonNegativeInt(value, label) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return num;
}

function positiveNumber(value, label) {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return num;
}

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');

program
  .name('arkham-hand-sim')
  .description('Sample Arkham opening hands and early draws from an annotated deck list')
  .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
  .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
  .option('-o, --opening-hand <n>', 'Opening hand size', v => positiveInt(v, 'opening hand'), 5)
  .option('-n, --next-draws <n>', 'Number of draws to simulate after the opening hand', v => nonNegativeInt(v, 'next draws'), 10)
  .option('-s, --samples <n>', 'Number of simulated hands', v => positiveInt(v, 'samples'), 10000)
  .option('--cards-per-turn <n>', 'Cards spent per turn when projecting hand size', v => positiveNumber(v, 'cards per turn'), 1.5)
  .parse(process.argv);

async function main() {
  const opts = program.opts();
  const deckText = await readDeckText(opts.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = opts.input ? path.dirname(path.resolve(opts.input)) : process.cwd();
  const entries = parseDeckList(deckText, { baseDir: deckBaseDir });
  if (!entries.length) {
    throw new Error('No valid deck entries were found.');
  }

  const cards = await loadCardDatabase(path.resolve(opts.dataDir));
  const lookup = buildCardLookup(cards);
  const deck = expandDeck(entries, lookup);
  const deckSize = deck.length;
  const { openingHand, nextDraws, samples, cardsPerTurn } = opts;
  const weaknessCount = deck.filter(card => card.weakness).length;
  const nonWeakCount = deckSize - weaknessCount;

  if (openingHand > nonWeakCount) {
    throw new Error('Opening hand size cannot exceed the number of non-weakness cards in the deck.');
  }

  if (openingHand + nextDraws > deckSize) {
    throw new Error('Opening hand plus next draws cannot exceed the deck size.');
  }

  const rows = simulateHands(deck, { openingHand, nextDraws, samples, cardsPerTurn });
  printResults(rows, { deckSize, openingHand, nextDraws, samples, cardsPerTurn, weaknessCount });
}

function simulateHands(deck, { openingHand, nextDraws, samples, cardsPerTurn }) {
  const totals = Array.from({ length: nextDraws + 1 }, () => ({
    weapons: 0,
    resourceBonus: 0,
    drawBonus: 0,
    cost: 0,
  }));

  for (let i = 0; i < samples; i += 1) {
    const order = shuffle(deck);
    const { openingHandCards, drawPile } = drawOpeningHandWithWeaknessRedraw(order, openingHand);
    const seen = openingHandCards.slice();
    addRowTotals(totals, seen, 0);

    for (let drawIndex = 1; drawIndex <= nextDraws; drawIndex += 1) {
      const nextCard = drawPile[drawIndex - 1];
      seen.push(nextCard);
      addRowTotals(totals, seen, drawIndex);
    }
  }

  return totals.map((row, idx) => {
    const drawsSoFar = idx;
    const baseResources = 5 + drawsSoFar;
    const baseDraws = openingHand + drawsSoFar;
    const turns = drawsSoFar;
    const cardsPlayed = cardsPerTurn * turns;
    const resourceBonus = row.resourceBonus / samples;
    const drawBonus = row.drawBonus / samples;
    const costTotal = row.cost / samples;
    const resourceTotal = baseResources + resourceBonus;
    const cardsInHand = Math.max(0, baseDraws + drawBonus - cardsPlayed);

    return {
      label: idx === 0 ? 'Opening hand' : `Draw ${idx}`,
      avgWeapons: row.weapons / samples,
      avgResourceBonus: resourceBonus,
      avgResourceTotal: resourceTotal,
      avgCostTotal: costTotal,
      avgResourceNet: resourceTotal - costTotal,
      avgDrawBonus: drawBonus,
      avgDrawTotal: baseDraws + drawBonus,
      avgCardsInHand: cardsInHand,
    };
  });
}

function addRowTotals(totals, seenCards, rowIndex) {
  let weapons = 0;
  let resourceBonus = 0;
  let drawBonus = 0;
  let costTotal = 0;

  for (const card of seenCards) {
    if (card.weapon) {
      weapons += 1;
    }
    resourceBonus += Number(card.resources) || 0;
    drawBonus += Number(card.draw) || 0;
    costTotal += Number(card.cost) || 0;
  }

  totals[rowIndex].weapons += weapons;
  totals[rowIndex].resourceBonus += resourceBonus;
  totals[rowIndex].drawBonus += drawBonus;
  totals[rowIndex].cost += costTotal;
}

function printResults(rows, { deckSize, openingHand, nextDraws, samples, cardsPerTurn, weaknessCount }) {
  console.log('Arkham hand sampler (Monte Carlo)');
  console.log(`Deck size: ${deckSize}`);
  console.log(`Opening hand: ${openingHand}`);
  console.log(`Next draws: ${nextDraws}`);
  console.log(`Samples: ${samples}`);
  if (weaknessCount) {
    console.log(`Weaknesses: ${weaknessCount} (redraw during opening hand, then shuffled back)`);
  }
  console.log('');
  console.log('Res total = 5 start + upkeep (+1 per draw) + resources on drawn cards.');
  console.log('Draw total = opening hand + draws so far + draw on drawn cards.');
  console.log(`Hand size assumes you play ${cardsPerTurn} cards per turn.`);
  console.log('');
  console.log('Columns:');
  console.log('- Weapons: average number of weapon cards drawn so far.');
  console.log('- Res drawn / Res total: resource gain from drawn cards / with upkeep and starting 5.');
  console.log('- Cost total: total resource cost of all drawn cards.');
  console.log('- Res net: resources left after paying all costs.');
  console.log('- Draw gain / Draw total: extra draws from drawn cards / total cards seen.');
  console.log('- Cards in hand: projected hand size after playing cards each turn.');
  console.log('');

  const headers = [
    'Step',
    'Weapons',
    'Res drawn',
    'Res total',
    'Cost total',
    'Res net',
    'Draw gain',
    'Draw total',
    'Cards in hand',
  ];
  const widths = [16, 10, 12, 12, 12, 12, 12, 12, 14];
  console.log(formatRow(headers, widths));
  for (const row of rows) {
    console.log(
      formatRow(
        [
          row.label,
          formatNumber(row.avgWeapons),
          formatNumber(row.avgResourceBonus),
          formatNumber(row.avgResourceTotal),
          formatNumber(row.avgCostTotal),
          formatNumber(row.avgResourceNet),
          formatNumber(row.avgDrawBonus),
          formatNumber(row.avgDrawTotal),
          formatNumber(row.avgCardsInHand),
        ],
        widths
      )
    );
  }
}

function formatRow(cells, widths) {
  return cells
    .map((cell, idx) => {
      const text = String(cell);
      return text.padEnd(widths[idx], ' ');
    })
    .join('');
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
