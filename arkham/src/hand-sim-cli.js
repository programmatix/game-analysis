#!/usr/bin/env node
const path = require('path');
const { program } = require('commander');
const { readDeckText, parseDeckList } = require('../../shared/deck-utils');
const { loadCardDatabase, buildCardLookup } = require('./card-data');
const { expandDeck, drawOpeningHandWithWeaknessRedraw, shuffle } = require('./hand-sim-helpers');
const { printColumnLegend } = require('./hand-column-legend');

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

  const { rows, cardSummaries, byDrawThreshold } = simulateHands(deck, { openingHand, nextDraws, samples, cardsPerTurn });
  printResults(rows, { deckSize, openingHand, nextDraws, samples, cardsPerTurn, weaknessCount }, { cardSummaries, byDrawThreshold });
}

function simulateHands(deck, { openingHand, nextDraws, samples, cardsPerTurn }) {
  const totals = Array.from({ length: nextDraws + 1 }, () => ({
    weapons: 0,
    weaponHits: 0,
    resourceBonus: 0,
    drawBonus: 0,
    cost: 0,
  }));
  const cardStats = buildCardStatMap(deck);
  const byDrawThreshold = Math.min(nextDraws, 10);

  for (let i = 0; i < samples; i += 1) {
    const order = shuffle(deck);
    const { openingHandCards, drawPile } = drawOpeningHandWithWeaknessRedraw(order, openingHand);
    const seen = openingHandCards.slice();
    const openingSeenThisSample = new Set();
    const byDrawSeenThisSample = new Set();

    addRowTotals(totals, seen, 0);
    for (const card of openingHandCards) {
      recordCardStats(cardStats, card, { openingSeenThisSample, byDrawSeenThisSample, byDrawThreshold, drawIndex: 0 });
    }

    for (let drawIndex = 1; drawIndex <= nextDraws; drawIndex += 1) {
      const nextCard = drawPile[drawIndex - 1];
      seen.push(nextCard);
      recordCardStats(cardStats, nextCard, { openingSeenThisSample, byDrawSeenThisSample, byDrawThreshold, drawIndex });
      addRowTotals(totals, seen, drawIndex);
    }
  }

  const rows = totals.map((row, idx) => {
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
      weaponHitRate: row.weaponHits / samples,
      avgResourceBonus: resourceBonus,
      avgResourceTotal: resourceTotal,
      avgCostTotal: costTotal,
      avgResourceNet: resourceTotal - costTotal,
      avgDrawBonus: drawBonus,
      avgDrawTotal: baseDraws + drawBonus,
      avgCardsInHand: cardsInHand,
    };
  });

  const cardSummaries = summarizeCardStats(cardStats, samples);
  return { rows, cardSummaries, byDrawThreshold };
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
  totals[rowIndex].weaponHits += weapons > 0 ? 1 : 0;
  totals[rowIndex].resourceBonus += resourceBonus;
  totals[rowIndex].drawBonus += drawBonus;
  totals[rowIndex].cost += costTotal;
}

function buildCardStatMap(deck) {
  const map = new Map();
  for (const card of deck) {
    const key = getCardKey(card);
    if (!map.has(key)) {
      map.set(key, {
        name: card.name,
        code: card.code,
        openingSeenSamples: 0,
        byDrawSeenSamples: 0,
        totalDrawGain: 0,
      });
    }
  }
  return map;
}

function recordCardStats(cardStats, card, { openingSeenThisSample, byDrawSeenThisSample, byDrawThreshold, drawIndex }) {
  const key = getCardKey(card);
  const stats = cardStats.get(key);
  if (!stats) return;

  const drawGain = Number(card.draw) || 0;
  stats.totalDrawGain += drawGain;

  if (drawIndex === 0 && !openingSeenThisSample.has(key)) {
    stats.openingSeenSamples += 1;
    openingSeenThisSample.add(key);
  }

  if (drawIndex <= byDrawThreshold && !byDrawSeenThisSample.has(key)) {
    stats.byDrawSeenSamples += 1;
    byDrawSeenThisSample.add(key);
  }
}

function summarizeCardStats(cardStats, samples) {
  return Array.from(cardStats.values())
    .map(stat => ({
      label: stat.code ? `${stat.name} (${stat.code})` : stat.name,
      openingRate: stat.openingSeenSamples / samples,
      byDrawRate: stat.byDrawSeenSamples / samples,
      avgDrawGain: stat.totalDrawGain / samples,
    }))
    .sort((a, b) => {
      if (b.byDrawRate !== a.byDrawRate) return b.byDrawRate - a.byDrawRate;
      if (b.openingRate !== a.openingRate) return b.openingRate - a.openingRate;
      return a.label.localeCompare(b.label);
    });
}

function getCardKey(card) {
  return card.code || card.name;
}

function printResults(rows, { deckSize, openingHand, nextDraws, samples, cardsPerTurn, weaknessCount }, { cardSummaries, byDrawThreshold }) {
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
  printColumnLegend({ averaged: true });

  const headers = [
    'Step',
    'Weapons',
    'Weapon ≥1%',
    'Res drawn',
    'Res total',
    'Cost total',
    'Res net',
    'Draw gain',
    'Draw total',
    'Cards in hand',
  ];
  const widths = [16, 10, 12, 12, 12, 12, 12, 12, 12, 14];
  console.log(formatRow(headers, widths));
  for (const row of rows) {
    console.log(
      formatRow(
        [
          row.label,
          formatNumber(row.avgWeapons),
          formatPercent(row.weaponHitRate),
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

  if (cardSummaries.length) {
    console.log('');
    printCardContributions(cardSummaries, byDrawThreshold);
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

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '0.0%';
}

function printCardContributions(cardSummaries, byDrawThreshold) {
  console.log('Card contributions (per-sample averages):');
  console.log('- Percentages = share of samples where at least one copy appeared.');
  console.log(`- By draw ${byDrawThreshold}: opening hand + first ${byDrawThreshold} draws.`);
  console.log('');

  const headers = ['Card', 'In opening %', `By draw ${byDrawThreshold} %`, 'Avg draw gain'];
  const widths = [32, 16, 18, 16];
  console.log(formatRow(headers, widths));

  cardSummaries.forEach(card => {
    console.log(
      formatRow(
        [card.label, formatPercent(card.openingRate), formatPercent(card.byDrawRate), formatNumber(card.avgDrawGain)],
        widths
      )
    );
  });
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
