/** Pure sample statistics. Returns decimal fractions, not percentage points. */
export function wilsonInterval(wins: number, n: number, z = 1.959963984540054) {
  if (!n) return null;
  const p = wins / n,
    den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z / den) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: wins === 0 ? 0 : Math.max(0, centre - half),
    high: wins === n ? 1 : Math.min(1, centre + half),
  };
}
function logGamma(z: number): number {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5)
    return (
      Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  z--;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
  );
}
function betaFraction(a: number, b: number, x: number) {
  const tiny = 1e-300;
  let c = 1,
    d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    for (const aa of [
      (m * (b - m) * x) / ((a - 1 + m2) * (a + m2)),
      (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2)),
    ]) {
      d = 1 + aa * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (aa < 0 && Math.abs(delta - 1) < 3e-14) return h;
    }
  }
  return h;
}
function beta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log1p(-x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (factor * betaFraction(a, b, x)) / a
    : 1 - (factor * betaFraction(b, a, 1 - x)) / b;
}
export function statistics(values: number[]) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b),
    n = xs.length;
  const meanExcess = n ? xs.reduce((a, b) => a + b, 0) / n : null;
  const medianExcess = n
    ? (xs[Math.floor((n - 1) / 2)] + xs[Math.floor(n / 2)]) / 2
    : null;
  const stddev =
    n >= 2
      ? Math.sqrt(xs.reduce((a, x) => a + (x - meanExcess!) ** 2, 0) / (n - 1))
      : null;
  const t =
    stddev && meanExcess !== null
      ? meanExcess / (stddev / Math.sqrt(n))
      : meanExcess === 0 && n >= 2
        ? 0
        : null;
  const p =
    t === null
      ? null
      : Math.max(
          0,
          Math.min(1, beta((n - 1) / (n - 1 + t * t), (n - 1) / 2, 0.5)),
        );
  const wins = xs.filter((x) => x > 0).length;
  return {
    n,
    winRate: n ? wins / n : null,
    wilson: wilsonInterval(wins, n),
    meanExcess,
    medianExcess,
    stddev,
    t,
    p,
  };
}
export function benjaminiHochberg(
  values: Array<number | null>,
): Array<number | null> {
  const entries = values
    .flatMap((p, i) =>
      p !== null && Number.isFinite(p) && p >= 0 && p <= 1 ? [{ p, i }] : [],
    )
    .sort((a, b) => a.p - b.p || a.i - b.i);
  const result: Array<number | null> = values.map(() => null);
  let last = 1;
  for (let j = entries.length - 1; j >= 0; j--) {
    last = Math.min(last, (entries[j].p * entries.length) / (j + 1));
    result[entries[j].i] = last;
  }
  return result;
}
