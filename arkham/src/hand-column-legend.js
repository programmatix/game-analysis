function printColumnLegend({ averaged } = {}) {
  const legendLines = [
    '- Step: opening hand or draw number.',
    averaged ? '- Weapons: average number of weapon cards drawn so far.  (Note this won`\'t match the hypergeometric output, as I can whiff completely, but can also draw multiple weapons raising the avg)' : '- Weapons: weapon cards seen so far.',
    averaged ? '- Weapon ≥1%: chance you have seen at least one weapon by this point. (Hypergeometric output - probs more useful for weapons)' : '- Weapon ≥1%: unused in per-sample output.',
    '- Res drawn: average resources granted by seen cards (one-time + per-turn accumulated).',
    '- Res total: 5 start + upkeep + Res drawn.',
    averaged ? '- Cost total: average resource cost of seen cards.' : '- Cost total: resource cost of seen cards.',
    '- Res net: Res total minus Cost total.',
    averaged ? '- Draw gain: average extra draws from seen cards (one-time + per-turn accumulated).' : '- Draw gain: extra draws from seen cards (one-time + per-turn accumulated).',
    '- Draw total: opening hand + draws so far + Draw gain.',
    '- Cards in hand: projected hand size after playing cards each turn.',
  ];

  console.log('Columns:');
  legendLines.forEach(line => console.log(line));
  console.log('');
}

module.exports = { printColumnLegend };
