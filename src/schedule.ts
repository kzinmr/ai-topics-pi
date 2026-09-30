/** UTC five-field cron with Vixie day-of-month/day-of-week semantics. */
export function fieldValues(field: string, low: number, high: number): Set<number> {
  const result = new Set<number>();
  for (const item of field.split(',')) {
    if (!/^(\*|\d+(?:-\d+)?)(?:\/\d+)?$/.test(item)) throw new Error(`invalid cron field: ${field}`);
    const [base, stride] = item.split('/');
    const step = stride === undefined ? 1 : Number(stride);
    const [a, b] = (base ?? '').split('-').map(Number);
    const start = base === '*' ? low : a!;
    const end = base === '*' ? high : b ?? (stride ? high : start);
    if (step <= 0 || start < low || end > high || end < start) throw new Error(`cron field out of range: ${field}`);
    for (let n = start; n <= end; n += step) result.add(n);
  }
  return result;
}
export function cronMatches(expr: string, when: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('cron requires five fields');
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const;
  const [minute, hour, dom, month, dow] = fields.map((f, i) => fieldValues(f, bounds[i]![0], bounds[i]![1]));
  const dm = dom!.has(when.getUTCDate());
  const dw = dow!.has(when.getUTCDay()) || (when.getUTCDay() === 0 && dow!.has(7));
  const day = fields[2]!.startsWith('*') || fields[4]!.startsWith('*') ? dm && dw : dm || dw;
  return minute!.has(when.getUTCMinutes()) && hour!.has(when.getUTCHours()) && month!.has(when.getUTCMonth() + 1) && day;
}
