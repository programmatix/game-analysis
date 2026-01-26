const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
const { StandardFonts } = require('pdf-lib');

const DEFAULT_FONT_FILES = {
  title: ['Exo2-Bold.ttf', 'Exo2-Bold.otf', 'Exo2[wght].ttf', 'Exo 2 - Bold.ttf', 'Exo 2 – Bold.ttf', 'Exo2[wght].otf'],
  statNumbers: ['ElektraMediumPro-BoldItalic.ttf', 'Elektra Medium Pro - Bold Italic.ttf', 'Elektra Medium Pro – Bold Italic.ttf'],
  statAbbr: ['FuturaLTBT-ExtraBlack.ttf', 'Futura LT BT - ExtraBlack.ttf', 'Futura LT BT – ExtraBlack.ttf'],
  heroAlterEgo: ['FuturaCondensedBT-Medium.ttf', 'Futura Condensed BT - Medium.ttf', 'Futura Condensed BT – Medium.ttf'],
  traits: ['KomikaTitle-Regular.ttf', 'Komika Title - Regular.ttf', 'Komika Title – Regular.ttf'],
  abilityNames: ['AvenirNextLTPro-Italic.ttf', 'Avenir Next LT Pro - Italic.ttf', 'Avenir Next LT Pro – Italic.ttf'],
  abilityTypes: ['AvenirNextLTPro-Demi.ttf', 'Avenir Next LT Pro - Demi.ttf', 'Avenir Next LT Pro – Demi.ttf'],
  body: ['AvenirNextLTPro-Regular.ttf', 'AvenirNextLTPro-Regular.otf', 'Avenir Next LT Pro - Regular.ttf', 'Avenir Next LT Pro – Regular.ttf'],
  flavor: ['KomikaTextTight-Italic.ttf', 'Komika Text Tight - Italic.ttf', 'Komika Text Tight – Italic.ttf'],
  handSizeHp: ['FuturaCondensedBT-Medium.ttf', 'Futura Condensed BT - Medium.ttf', 'Futura Condensed BT – Medium.ttf'],
  mouseprint: ['AvenirNextCondensed-Medium.ttf', 'AvenirNextCondensed-Medium.otf', 'Avenir Next Condensed - Medium.ttf', 'Avenir Next Condensed – Medium.ttf'],
};

async function loadMarvelChampionsFonts(pdfDoc, options = {}) {
  const fontsDir = resolveDir(options.fontsDir);
  const overrides = normalizeOverrides(options.overrides);
  const neededKeys = Array.isArray(options.neededKeys) ? options.neededKeys.map(String) : null;
  const neededSet = neededKeys ? new Set(neededKeys) : null;

  const warnings = [];
  const foundPaths = {};

  for (const key of Object.keys(DEFAULT_FONT_FILES)) {
    if (neededSet && !neededSet.has(key)) {
      foundPaths[key] = null;
      continue;
    }

    const override = overrides[key];
    if (override === null) {
      foundPaths[key] = null;
      continue;
    }

    if (typeof override === 'string' && override.trim()) {
      const resolved = path.resolve(override.trim());
      if (fs.existsSync(resolved)) {
        foundPaths[key] = resolved;
      } else {
        warnings.push(`Font override for "${key}" not found at: ${resolved} (falling back)`);
        foundPaths[key] = null;
      }
      continue;
    }

    const candidate = findFirstExisting(fontsDir, DEFAULT_FONT_FILES[key]);
    foundPaths[key] = candidate;
    if (!candidate) {
      const lookedFor = DEFAULT_FONT_FILES[key].join(', ');
      warnings.push(
        `Missing font "${key}" in ${fontsDir || '(no fonts dir)'} (looked for: ${lookedFor}; falling back)`
      );
    }
  }

  pdfDoc.registerFontkit(fontkit);

  const fallbackRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fallbackBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const embedded = {
    title: await embedOrFallback(pdfDoc, foundPaths.title, fallbackBold),
    statNumbers: await embedOrFallback(pdfDoc, foundPaths.statNumbers, fallbackBold),
    statAbbr: await embedOrFallback(pdfDoc, foundPaths.statAbbr, fallbackBold),
    heroAlterEgo: await embedOrFallback(pdfDoc, foundPaths.heroAlterEgo, fallbackBold),
    traits: await embedOrFallback(pdfDoc, foundPaths.traits, fallbackBold),
    abilityNames: await embedOrFallback(pdfDoc, foundPaths.abilityNames, fallbackRegular),
    abilityTypes: await embedOrFallback(pdfDoc, foundPaths.abilityTypes, fallbackBold),
    body: await embedOrFallback(pdfDoc, foundPaths.body, fallbackRegular),
    flavor: await embedOrFallback(pdfDoc, foundPaths.flavor, fallbackRegular),
    handSizeHp: await embedOrFallback(pdfDoc, foundPaths.handSizeHp, fallbackBold),
    mouseprint: await embedOrFallback(pdfDoc, foundPaths.mouseprint, fallbackRegular),
  };

  return {
    fonts: embedded,
    fontPaths: foundPaths,
    warnings,
  };
}

function resolveDir(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) return resolved;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return resolved;
  } catch (_) {
    return resolved;
  }
  return resolved;
}

function normalizeOverrides(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = v;
  }
  return out;
}

function findFirstExisting(fontsDir, candidates) {
  const base = typeof fontsDir === 'string' && fontsDir.trim() ? fontsDir.trim() : '';
  for (const fileName of Array.isArray(candidates) ? candidates : []) {
    const rel = base ? path.join(base, fileName) : fileName;
    const resolved = path.resolve(rel);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

async function embedOrFallback(pdfDoc, filePath, fallbackFont) {
  if (!filePath) return fallbackFont;
  try {
    const bytes = await fs.promises.readFile(filePath);
    const isOtf = /\.otf$/i.test(filePath);
    // Some OTF/CFF fonts have poor compatibility when subsetted; prefer full embedding for OTF.
    return await pdfDoc.embedFont(bytes, { subset: !isOtf });
  } catch (_) {
    return fallbackFont;
  }
}

module.exports = {
  loadMarvelChampionsFonts,
  DEFAULT_FONT_FILES,
};
