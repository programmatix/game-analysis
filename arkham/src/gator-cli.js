#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { normalizeName } = require('../../shared/deck-utils');
const { buildCardCodeIndex, loadCardDatabase } = require('./card-data');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');
const PLAYER_FACTIONS = new Set(['guardian', 'seeker', 'rogue', 'mystic', 'survivor', 'neutral']);

async function main() {
  const program = new Command();
  program
    .name('arkham-gator')
    .description('Output a decklist containing an investigator ("gator") and their special/signature cards')
    .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
    .option('--name <query>', 'Investigator name (substring match; case-insensitive)')
    .option('--code <code>', 'Investigator code (e.g. 01001)')
    .option('-f, --faction <codes...>', 'Output all investigators with these factions (guardian, seeker, rogue, mystic, survivor, neutral)')
    .option('--no-pagebreak', 'Do not insert [ProxyPageBreak] between investigators')
    .option('--output <file>', 'Write decklist to a file (defaults to stdout)')
    .option('--sort <field>', 'Sort investigators by name|code|pack', 'name')
    .option('--limit <n>', 'Limit investigator count (only when using --faction)', '0')
    .parse(process.argv);

  const options = program.opts();
  const dataDir = path.resolve(options.dataDir);
  const cards = await loadCardDatabase(dataDir);
  const codeIndex = buildCardCodeIndex(cards);

  const problems = [];
  const investigators = cards.filter(card => String(card?.type_code || '').toLowerCase() === 'investigator');

  const factions = parseFactions(options.faction, problems);
  const limit = parseLimit(options.limit, problems);
  const sortField = String(options.sort || 'name').trim().toLowerCase();

  let selectedInvestigators = [];
  if (options.code || options.name) {
    if (options.code && options.name) {
      problems.push('Use only one of --code or --name.');
    } else {
      const match = resolveSingleInvestigator(investigators, options.code || options.name, Boolean(options.code));
      if (match.problems.length) {
        problems.push(...match.problems);
      } else {
        selectedInvestigators = [match.investigator];
      }
    }
  } else if (factions.length) {
    selectedInvestigators = investigators.filter(inv => matchesFaction(inv, factions));
    selectedInvestigators = sortInvestigators(selectedInvestigators, sortField);
    if (limit > 0) {
      selectedInvestigators = selectedInvestigators.slice(0, limit);
    }
    if (!selectedInvestigators.length) {
      problems.push(`No investigators matched faction filter: ${factions.join(', ')}`);
    }
  } else {
    problems.push('Provide --name/--code to select an investigator, or --faction to output all investigators for an aspect.');
  }

  if (problems.length) {
    printProblems(problems);
    process.exitCode = 1;
    return;
  }

  const output = buildDecklistOutput(selectedInvestigators, cards, codeIndex, {
    pageBreak: options.pagebreak !== false,
  });

  if (options.output) {
    await fs.promises.writeFile(path.resolve(options.output), output, 'utf8');
  } else {
    process.stdout.write(output);
  }
}

function parseFactions(raw, problems) {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const tokens = values
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean);

  const normalized = [];
  const invalid = [];
  for (const token of tokens) {
    const value = normalizeFaction(token);
    if (!value) {
      invalid.push(token);
      continue;
    }
    normalized.push(value);
  }

  if (invalid.length) {
    problems.push(`Invalid --faction value(s): ${invalid.join(', ')}`);
  }

  return Array.from(new Set(normalized));
}

function normalizeFaction(value) {
  const lowered = String(value || '').trim().toLowerCase();
  if (!lowered) return '';
  if (PLAYER_FACTIONS.has(lowered)) return lowered;
  return '';
}

function parseLimit(raw, problems) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    problems.push('--limit must be a non-negative integer.');
    return 0;
  }
  return value;
}

function resolveSingleInvestigator(investigators, query, queryIsCode) {
  const problems = [];
  const raw = String(query || '').trim();
  if (!raw) {
    problems.push(queryIsCode ? '--code must not be empty.' : '--name must not be empty.');
    return { problems, investigator: null };
  }

  if (queryIsCode) {
    const matches = investigators.filter(inv => String(inv?.code || '').trim() === raw);
    if (!matches.length) {
      problems.push(`No investigator matched code "${raw}".`);
      return { problems, investigator: null };
    }
    if (matches.length > 1) {
      problems.push(`Multiple investigators matched code "${raw}".`);
      return { problems, investigator: null };
    }
    return { problems, investigator: matches[0] };
  }

  const normalized = normalizeName(raw);
  const matches = investigators.filter(inv => matchesInvestigatorQuery(inv, normalized));
  if (!matches.length) {
    problems.push(`No investigator matched name query "${raw}".`);
    return { problems, investigator: null };
  }
  if (matches.length > 1) {
    const suggestions = matches
      .slice(0, 25)
      .map(inv => `${formatInvestigatorName(inv)} [${inv.code || '?'}]`)
      .join('\n');
    problems.push(
      `Name query "${raw}" matched ${matches.length} investigators; use --code to disambiguate.\n${suggestions}`
    );
    return { problems, investigator: null };
  }

  return { problems, investigator: matches[0] };
}

function matchesInvestigatorQuery(investigator, normalizedQuery) {
  if (!normalizedQuery) return false;
  const name = normalizeName(investigator?.name || '');
  const subname = normalizeName(investigator?.subname || '');
  const combined = normalizeName(`${investigator?.name || ''} ${investigator?.subname || ''}`);
  return name.includes(normalizedQuery) || subname.includes(normalizedQuery) || combined.includes(normalizedQuery);
}

function formatInvestigatorName(investigator) {
  const name = investigator?.name || '(unknown)';
  const subname = investigator?.subname ? ` — ${investigator.subname}` : '';
  return `${name}${subname}`;
}

function sortInvestigators(investigators, field) {
  const copy = [...investigators];
  const getKey = inv => {
    if (field === 'code') return String(inv?.code || '');
    if (field === 'pack') return String(inv?.pack_code || '');
    return formatInvestigatorName(inv);
  };
  copy.sort((a, b) => getKey(a).localeCompare(getKey(b)));
  return copy;
}

function matchesFaction(investigator, factions) {
  if (!factions.length) return true;
  const faction = String(investigator?.faction_code || '').toLowerCase();
  return factions.includes(faction);
}

function buildDecklistOutput(investigators, cards, codeIndex, options = {}) {
  const pageBreak = options.pageBreak !== false;
  const sections = [];
  const problems = [];

  investigators.forEach((investigator, index) => {
    const { lines, sectionProblems } = buildInvestigatorSection(investigator, cards, codeIndex);
    if (sectionProblems.length) {
      problems.push(...sectionProblems.map(problem => `${formatInvestigatorName(investigator)}: ${problem}`));
    }
    sections.push(lines.join('\n'));
    if (pageBreak && index < investigators.length - 1) {
      sections.push('[ProxyPageBreak]');
    }
  });

  if (problems.length) {
    printProblems(problems);
    process.exitCode = 1;
  }

  return `${sections.join('\n')}\n`;
}

function buildInvestigatorSection(investigator, cards, codeIndex) {
  const problems = [];
  const requirement = parseDeckRequirements(investigator?.deck_requirements);

  const requiredCodes = new Set();
  for (const group of requirement.cardCodeGroups) {
    for (const code of group) {
      requiredCodes.add(code);
    }
  }

  const specialCards = [];
  for (const code of requiredCodes) {
    const card = codeIndex.get(code);
    if (!card) {
      problems.push(`Required card code "${code}" was not found in arkhamdb-json-data.`);
      continue;
    }
    if (String(card?.type_code || '').toLowerCase() === 'investigator') {
      continue;
    }
    specialCards.push(card);
  }

  const restrictionNeedle = `investigator:${String(investigator?.code || '').trim()}`;
  const restrictedCards = cards.filter(card =>
    typeof card?.restrictions === 'string'
    && restrictionNeedle
    && card.restrictions.includes(restrictionNeedle)
  );
  specialCards.push(...restrictedCards);

  const byCode = new Map();
  for (const card of specialCards) {
    if (!card?.code) continue;
    if (!byCode.has(card.code)) {
      byCode.set(card.code, card);
    }
  }

  const uniqueSpecialCards = Array.from(byCode.values()).sort((a, b) => {
    const typeA = String(a?.type_code || '').toLowerCase();
    const typeB = String(b?.type_code || '').toLowerCase();
    if (typeA !== typeB) return typeA.localeCompare(typeB);
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });

  const lines = [];
  lines.push(`# Investigator: ${formatInvestigatorName(investigator)} [${investigator?.code || '?'}]`);
  if (requirement.deckSize) {
    lines.push(`# Deck size: ${requirement.deckSize}`);
  }
  if (requirement.randomBasicWeaknessCount) {
    lines.push(`# Requires: ${requirement.randomBasicWeaknessCount} random basic weakness`);
  }
  if (requirement.unknownParts.length) {
    problems.push(`Unrecognized deck_requirements parts: ${requirement.unknownParts.join(', ')}`);
  }

  lines.push(`1 ${formatInvestigatorName(investigator)}[${investigator?.code || ''}] [ignorefordecklimit]`);

  for (const card of uniqueSpecialCards) {
    const count = requiredCopiesForSpecialCard(card);
    const name = String(card?.name || '').trim();
    const code = String(card?.code || '').trim();
    if (!name || !code) continue;
    lines.push(`${count} ${name}[${code}] [ignorefordecklimit]`);
  }

  return { lines, sectionProblems: problems };
}

function requiredCopiesForSpecialCard(card) {
  const deckLimit = Number(card?.deck_limit);
  if (Number.isInteger(deckLimit) && deckLimit > 0) return deckLimit;
  return 1;
}

function parseDeckRequirements(raw) {
  const result = {
    deckSize: null,
    cardCodeGroups: [],
    randomBasicWeaknessCount: 0,
    unknownParts: [],
  };

  if (!raw) return result;

  const parts = String(raw)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.startsWith('size:')) {
      const value = Number(part.slice('size:'.length));
      if (Number.isInteger(value) && value > 0) {
        result.deckSize = value;
      } else {
        result.unknownParts.push(part);
      }
      continue;
    }

    if (part.startsWith('card:')) {
      const codes = part
        .slice('card:'.length)
        .split(':')
        .map(code => code.trim())
        .filter(Boolean);
      if (codes.length) {
        result.cardCodeGroups.push(codes);
      } else {
        result.unknownParts.push(part);
      }
      continue;
    }

    if (part === 'random:subtype:basicweakness') {
      result.randomBasicWeaknessCount += 1;
      continue;
    }

    if (part.startsWith('random:')) {
      result.unknownParts.push(part);
      continue;
    }

    result.unknownParts.push(part);
  }

  return result;
}

function printProblems(problems) {
  const unique = Array.from(new Set(problems.map(problem => String(problem).trim()).filter(Boolean)));
  if (!unique.length) return;
  console.error(unique.map(problem => `- ${problem}`).join('\n'));
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
