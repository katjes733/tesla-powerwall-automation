export function niceTickInterval(dataMin: number, dataMax: number): number {
  const range = Math.max(Math.abs(dataMax - dataMin), 1);
  const rough = range / 5;
  const exp = Math.floor(Math.log10(rough));
  const frac = rough / Math.pow(10, exp);
  const niceFrac = frac <= 1.5 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10;
  return niceFrac * Math.pow(10, exp);
}
