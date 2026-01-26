const { PDFDocument, rgb } = require('pdf-lib');
const { mmToPt, A4_WIDTH_PT, A4_HEIGHT_PT } = require('../../shared/pdf-layout');
const { loadMarvelChampionsFonts } = require('./mc-fonts');

async function buildFontSheetPdf(options = {}) {
  const pdfDoc = await PDFDocument.create();
  const { fonts, warnings, fontPaths } = await loadMarvelChampionsFonts(pdfDoc, {
    fontsDir: options.fontsDir,
    overrides: options.fontOverrides,
  });

  const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
    color: rgb(1, 1, 1),
  });

  const marginMm = 10;
  const cursor = {
    x: marginMm,
    y: ptToMm(page.getHeight()) - marginMm,
  };

  const title = 'Marvel Champions Font Sheet';
  drawText(page, fonts.title, title, cursor.x, cursor.y, { sizeMm: 10, color: rgb(0.1, 0.1, 0.1) });
  cursor.y -= 14;

  const subtitle = 'This page tries to embed the official fonts (falls back to Helvetica when missing).';
  drawText(page, fonts.mouseprint, subtitle, cursor.x, cursor.y, { sizeMm: 3.2, color: rgb(0.2, 0.2, 0.2) });
  cursor.y -= 10;

  const entries = [
    { label: 'Title', font: fonts.title, sample: 'CYCLOPS — EXO 2 BOLD' },
    { label: 'Stat Numbers', font: fonts.statNumbers, sample: '0123456789' },
    { label: 'Stat Abbreviations', font: fonts.statAbbr, sample: 'ATK  THW  DEF' },
    { label: 'Hero/Alter-Ego', font: fonts.heroAlterEgo, sample: 'HERO / ALTER-EGO' },
    { label: 'Traits', font: fonts.traits, sample: 'MUTANT • X-MEN' },
    { label: 'Ability Names', font: fonts.abilityNames, sample: 'TACTICAL GENIUS' },
    { label: 'Ability Types', font: fonts.abilityTypes, sample: 'ACTION • RESPONSE • INTERRUPT' },
    { label: 'Body', font: fonts.body, sample: 'Draw 1 card. If you are in hero form, ready an ally.' },
    { label: 'Flavour', font: fonts.flavor, sample: '“To me, my X-Men!”' },
    { label: 'Hand Size / HP', font: fonts.handSizeHp, sample: 'HAND 5   •   HP 12' },
    { label: 'Mouseprint', font: fonts.mouseprint, sample: 'ILLUS. JOHN DOE • © MARVEL • 001' },
  ];

  const boxW = ptToMm(page.getWidth()) - marginMm * 2;
  const boxH = 21;
  const gap = 6;

  for (const entry of entries) {
    if (cursor.y - boxH < marginMm) {
      break;
    }

    drawPanel(page, cursor.x, cursor.y - boxH, boxW, boxH);
    drawText(page, fonts.mouseprint, entry.label, cursor.x + 3, cursor.y - 5.5, { sizeMm: 3.2, color: rgb(0.25, 0.25, 0.25) });
    drawText(page, entry.font, entry.sample, cursor.x + 3, cursor.y - 16.5, { sizeMm: 7, color: rgb(0.05, 0.05, 0.05) });

    cursor.y -= boxH + gap;
  }

  if (warnings.length) {
    const note = `Missing fonts (${warnings.length}): see console output for details.`;
    drawText(page, fonts.mouseprint, note, marginMm, marginMm, { sizeMm: 3.2, color: rgb(0.5, 0.1, 0.1) });
  } else {
    drawText(page, fonts.mouseprint, 'All fonts embedded.', marginMm, marginMm, { sizeMm: 3.2, color: rgb(0.1, 0.4, 0.1) });
  }

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, warnings, fontPaths };
}

function drawPanel(page, xMm, yMm, wMm, hMm) {
  page.drawRectangle({
    x: mmToPt(xMm),
    y: mmToPt(yMm),
    width: mmToPt(wMm),
    height: mmToPt(hMm),
    borderColor: rgb(0.15, 0.15, 0.18),
    borderWidth: 0.6,
    color: rgb(0.98, 0.98, 0.99),
  });
}

function drawText(page, font, text, xMm, yMm, { sizeMm, color } = {}) {
  page.drawText(String(text || ''), {
    x: mmToPt(xMm),
    y: mmToPt(yMm),
    size: mmToPt(Number(sizeMm) || 4),
    font,
    color: color || rgb(0, 0, 0),
  });
}

function ptToMm(pt) {
  return pt / (72 / 25.4);
}

module.exports = {
  buildFontSheetPdf,
};

