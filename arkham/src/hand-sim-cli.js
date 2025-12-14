#!/usr/bin/env node
const path = require('path');
const { program } = require('commander');
const { readDeckText, parseDeckList } = require('../../shared/deck-utils');

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

program
  .name('arkham-hand-sim')
  .description('Sample Arkham opening hands and early draws from an annotated deck list')
  .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
  .option('-o, --opening-hand <n>', 'Opening hand size', v => positiveInt(v, 'opening hand'), 5)
  .option('-n, --next-draws <n>', 'Number of draws to simulate after the opening hand', v => nonNegativeInt(v, 'next draws'), 10)
  .option('-s, --samples <n>', 'Number of simulated hands', v => positiveInt(v, 'samples'), 10000)
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

  const deck = expandDeck(entries);
  const deckSize = deck.length;
  const { openingHand, nextDraws, samples } = opts;

  if (openingHand > deckSize) {
    throw new Error('Opening hand size cannot exceed the deck size.');
  }

  if (openingHand + nextDraws > deckSize) {
    throw new Error('Opening hand plus next draws cannot exceed the deck size.');
  }

  const rows = simulateHands(deck, { openingHand, nextDraws, samples });
  printResults(rows, { deckSize, openingHand, nextDraws, samples });
}

function expandDeck(entries) {
  const cards = [];
  for (const entry of entries) {
    const annotations = normalizeAnnotations(entry.annotations);
    for (let i = 0; i < entry.count; i += 1) {
      cards.push({
        name: entry.name,
        code: entry.code,
        weapon: annotations.weapon,
        resources: annotations.resources,
        draw: annotations.draw,
      });
    }
  }
  return cards;
}

function normalizeAnnotations(annotations) {
  const keywords = Array.isArray(annotations?.keywords) ? annotations.keywords.map(k => String(k).toLowerCase()) : [];
  const keywordSet = new Set(keywords);
  const weapon = Boolean(annotations?.weapon) || keywordSet.has('weapon');
  const resources = Number(annotations?.resources) || 0;
  const draw = Number(annotations?.draw) || 0;

  return { weapon, resources, draw };
}

function simulateHands(deck, { openingHand, nextDraws, samples }) {
  const totals = Array.from({ length: nextDraws + 1 }, () => ({
    weapons: 0,
    resourceBonus: 0,
    drawBonus: 0,
  }));

  for (let i = 0; i < samples; i += 1) {
    const order = shuffle(deck);
    const seen = order.slice(0, openingHand);
    addRowTotals(totals, seen, 0);

    for (let drawIndex = 1; drawIndex <= nextDraws; drawIndex += 1) {
      const nextCard = order[openingHand + drawIndex - 1];
      seen.push(nextCard);
      addRowTotals(totals, seen, drawIndex);
    }
  }

  return totals.map((row, idx) => {
    const drawsSoFar = idx;
    const baseResources = 5 + drawsSoFar;
    const baseDraws = openingHand + drawsSoFar;
    const resourceBonus = row.resourceBonus / samples;
    const drawBonus = row.drawBonus / samples;

    return {
      label: idx === 0 ? 'Opening hand' : `Draw ${idx}`,
      avgWeapons: row.weapons / samples,
      avgResourceBonus: resourceBonus,
      avgResourceTotal: baseResources + resourceBonus,
      avgDrawBonus: drawBonus,
      avgDrawTotal: baseDraws + drawBonus,
    };
  });
}

function addRowTotals(totals, seenCards, rowIndex) {
  let weapons = 0;
  let resourceBonus = 0;
  let drawBonus = 0;

  for (const card of seenCards) {
    if (card.weapon) {
      weapons += 1;
    }
    resourceBonus += Number(card.resources) || 0;
    drawBonus += Number(card.draw) || 0;
  }

  totals[rowIndex].weapons += weapons;
  totals[rowIndex].resourceBonus += resourceBonus;
  totals[rowIndex].drawBonus += drawBonus;
}

function shuffle(deck) {
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function printResults(rows, { deckSize, openingHand, nextDraws, samples }) {
  console.log('Arkham hand sampler (Monte Carlo)');
  console.log(`Deck size: ${deckSize}`);
  console.log(`Opening hand: ${openingHand}`);
  console.log(`Next draws: ${nextDraws}`);
  console.log(`Samples: ${samples}`);
  console.log('');
  console.log('Res total = 5 start + upkeep (+1 per draw) + resources on drawn cards.');
  console.log('Draw total = opening hand + draws so far + draw on drawn cards.');
  console.log('');

  const headers = ['Step', 'Weapons', 'Res drawn', 'Res total', 'Draw gain', 'Draw total'];
  const widths = [16, 10, 12, 12, 12, 12];
  console.log(formatRow(headers, widths));
  for (const row of rows) {
    console.log(
      formatRow(
        [
          row.label,
          formatNumber(row.avgWeapons),
          formatNumber(row.avgResourceBonus),
          formatNumber(row.avgResourceTotal),
          formatNumber(row.avgDrawBonus),
          formatNumber(row.avgDrawTotal),
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
