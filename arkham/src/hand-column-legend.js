function printColumnLegend({ averaged } = {}) {
  const legendLines = [
    '- Step: opening hand or draw number.',
    averaged ? '- Weapons: average number of weapon cards drawn so far.' : '- Weapons: weapon cards seen so far.',
    averaged ? '- Res drawn: average resources granted by seen cards.' : '- Res drawn: resources granted by seen cards.',
    '- Res total: 5 start + upkeep + Res drawn.',
    averaged ? '- Cost total: average resource cost of seen cards.' : '- Cost total: resource cost of seen cards.',
    '- Res net: Res total minus Cost total.',
    averaged ? '- Draw gain: average extra draws from seen cards.' : '- Draw gain: extra draws from seen cards.',
    '- Draw total: opening hand + draws so far + Draw gain.',
    '- Cards in hand: projected hand size after playing cards each turn.',
  ];

  console.log('Columns:');
  legendLines.forEach(line => console.log(line));
  console.log('');
}

module.exports = { printColumnLegend };
