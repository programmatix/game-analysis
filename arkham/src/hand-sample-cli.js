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
  .name('arkham-hand-sample')
  .description('Draw a single Arkham opening hand and early draws from an annotated deck list')
  .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
  .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
  .option('-o, --opening-hand <n>', 'Opening hand size', v => positiveInt(v, 'opening hand'), 5)
  .option('-n, --next-draws <n>', 'Number of draws to play out after the opening hand', v => nonNegativeInt(v, 'next draws'), 10)
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
  const { openingHand, nextDraws, cardsPerTurn } = opts;
  const weaknessCount = deck.filter(card => card.weakness).length;
  const nonWeakCount = deckSize - weaknessCount;

  if (openingHand > nonWeakCount) {
    throw new Error('Opening hand size cannot exceed the number of non-weakness cards in the deck.');
  }

  if (openingHand + nextDraws > deckSize) {
    throw new Error('Opening hand plus next draws cannot exceed the deck size.');
  }

  const order = shuffle(deck);
  const { openingHandCards, drawPile } = drawOpeningHandWithWeaknessRedraw(order, openingHand);
  const rows = buildRows(openingHandCards, drawPile, { openingHand, nextDraws, cardsPerTurn });

  printSample(rows, { deckSize, openingHand, nextDraws, cardsPerTurn, weaknessCount }, { openingHandCards, drawPile });
}

function buildRows(openingHandCards, drawPile, { openingHand, nextDraws, cardsPerTurn }) {
  const rows = [];
  const seen = openingHandCards.slice();
  const seenAtDrawIndex = new Map();
  
  // Track when cards in opening hand were seen (drawIndex 0)
  for (const card of openingHandCards) {
    const key = getCardKey(card);
    if (!seenAtDrawIndex.has(key)) {
      seenAtDrawIndex.set(key, 0);
    }
  }
  
  rows.push(buildRow('Opening hand', seen, seenAtDrawIndex, 0, { openingHand, cardsPerTurn }));

  for (let drawIndex = 1; drawIndex <= nextDraws; drawIndex += 1) {
    const nextCard = drawPile[drawIndex - 1];
    seen.push(nextCard);
    const key = getCardKey(nextCard);
    if (!seenAtDrawIndex.has(key)) {
      seenAtDrawIndex.set(key, drawIndex);
    }
    rows.push(buildRow(`Draw ${drawIndex}`, seen, seenAtDrawIndex, drawIndex, { openingHand, cardsPerTurn }));
  }

  return rows;
}

function getCardKey(card) {
  return card.code || card.name;
}

function buildRow(label, seenCards, seenAtDrawIndex, drawsSoFar, { openingHand, cardsPerTurn }) {
  const totals = summarizeCards(seenCards, seenAtDrawIndex, drawsSoFar);
  const baseResources = 5 + drawsSoFar;
  const baseDraws = openingHand + drawsSoFar;
  const resourceTotal = baseResources + totals.resourceBonus + totals.resourcesPerTurnBonus;
  const cardsPlayed = cardsPerTurn * drawsSoFar;
  const cardsInHand = Math.max(0, baseDraws + totals.drawBonus + totals.drawPerTurnBonus - cardsPlayed);

  return {
    label,
    weapons: totals.weapons,
    resourceBonus: totals.resourceBonus + totals.resourcesPerTurnBonus,
    resourceTotal,
    costTotal: totals.cost,
    resourceNet: resourceTotal - totals.cost,
    drawBonus: totals.drawBonus + totals.drawPerTurnBonus,
    drawTotal: baseDraws + totals.drawBonus + totals.drawPerTurnBonus,
    cardsInHand,
  };
}

function summarizeCards(seenCards, seenAtDrawIndex, drawsSoFar) {
  const base = seenCards.reduce(
    (acc, card) => ({
      weapons: acc.weapons + (card.weapon ? 1 : 0),
      resourceBonus: acc.resourceBonus + (Number(card.resources) || 0),
      drawBonus: acc.drawBonus + (Number(card.draw) || 0),
      cost: acc.cost + (Number(card.cost) || 0),
    }),
    { weapons: 0, resourceBonus: 0, drawBonus: 0, cost: 0, resourcesPerTurnBonus: 0, drawPerTurnBonus: 0 }
  );

  // Calculate per-turn resources: for each card with resourcesPerTurn,
  // calculate how many turns it has been active
  const seenCardsWithPerTurn = new Set();
  for (const card of seenCards) {
    const resourcesPerTurn = Number(card.resourcesPerTurn) || 0;
    if (resourcesPerTurn !== 0) {
      const key = getCardKey(card);
      if (!seenCardsWithPerTurn.has(key)) {
        seenCardsWithPerTurn.add(key);
        const seenAt = seenAtDrawIndex.get(key);
        if (seenAt !== undefined) {
          const turnsActive = drawsSoFar - seenAt;
          if (turnsActive > 0) {
            base.resourcesPerTurnBonus += resourcesPerTurn * turnsActive;
          }
        }
      }
    }
  }

  // Calculate per-turn draws: for each card with drawPerTurn,
  // calculate how many turns it has been active
  const seenCardsWithDrawPerTurn = new Set();
  for (const card of seenCards) {
    const drawPerTurn = Number(card.drawPerTurn) || 0;
    if (drawPerTurn !== 0) {
      const key = getCardKey(card);
      if (!seenCardsWithDrawPerTurn.has(key)) {
        seenCardsWithDrawPerTurn.add(key);
        const seenAt = seenAtDrawIndex.get(key);
        if (seenAt !== undefined) {
          const turnsActive = drawsSoFar - seenAt;
          if (turnsActive > 0) {
            base.drawPerTurnBonus += drawPerTurn * turnsActive;
          }
        }
      }
    }
  }

  return base;
}

function printSample(rows, summary, detail) {
  const { deckSize, openingHand, nextDraws, cardsPerTurn, weaknessCount } = summary;
  const { openingHandCards, drawPile } = detail;

  console.log('Arkham hand sample (single run)');
  console.log(`Deck size: ${deckSize}`);
  console.log(`Opening hand: ${openingHand}`);
  console.log(`Next draws: ${nextDraws}`);
  if (weaknessCount) {
    console.log(`Weaknesses: ${weaknessCount} (redraw during opening hand, then shuffled back)`);
  }
  console.log('');
  console.log('Res total = 5 start + upkeep (+1 per draw) + resources on drawn cards (one-time + per-turn).');
  console.log('Draw total = opening hand + draws so far + draw on drawn cards (one-time + per-turn).');
  console.log(`Hand size assumes you play ${cardsPerTurn} cards per turn.`);
  console.log('Draws below show one literal shuffle, no averaging.');
  console.log('');
  printColumnLegend({ averaged: false });

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
          formatNumber(row.weapons),
          formatNumber(row.resourceBonus),
          formatNumber(row.resourceTotal),
          formatNumber(row.costTotal),
          formatNumber(row.resourceNet),
          formatNumber(row.drawBonus),
          formatNumber(row.drawTotal),
          formatNumber(row.cardsInHand),
        ],
        widths
      )
    );
  }

  console.log('');
  console.log('Opening hand cards:');
  openingHandCards.forEach(card => {
    console.log(`- ${describeCard(card)}`);
  });

  console.log('');
  console.log('Draws:');
  for (let i = 0; i < nextDraws; i += 1) {
    const card = drawPile[i];
    console.log(`- Draw ${i + 1}: ${describeCard(card)}`);
  }
}

function describeCard(card) {
  const tags = [];
  if (card.weapon) tags.push('weapon');
  if (card.weakness) tags.push('weakness');
  if (card.resources) tags.push(`res+${card.resources}`);
  if (card.resourcesPerTurn) tags.push(`res/turn+${card.resourcesPerTurn}`);
  if (card.draw) tags.push(`draw+${card.draw}`);
  if (card.drawPerTurn) tags.push(`draw/turn+${card.drawPerTurn}`);
  if (Number.isFinite(card.cost) && card.cost !== 0) tags.push(`cost ${card.cost}`);

  const suffix = tags.length ? ` (${tags.join(', ')})` : '';
  return `${card.name}${suffix}`;
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
