// The statistics behind an `efaimo test` verdict.
//
// The verdict used to be a bare threshold on the difference in pass rates:
// >= +15 points "helps", <= -15 "hurts", exit code 1 on "hurts". With the
// default 5 trials per arm, 5/5 against 4/5 is +20 points and would have been
// reported as "helps" with a two-sided Fisher p of 1.0000 - the least
// significant result the test can produce, labelled as a finding. At 8 trials
// per arm the 95% interval on a difference of proportions is roughly +-49
// points wide, so the whole +-15 band sits inside the noise for every trial
// count the tool supports below about 25 per arm.
//
// A tool whose argument is that people publish numbers they cannot support
// should not do that itself. So the verdict is now gated on a p-value, the
// interval is reported, and both are printed rather than hidden.
//
// Fisher's exact test, not chi-squared: the counts here are single digits, and
// chi-squared's approximation is not trustworthy at that size.

/** ln(n!) via lgamma, so the 2x2 table math stays exact enough at small n. */
function lnFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/** Probability of exactly this 2x2 table under the hypergeometric null. */
function lnHypergeom(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  return (
    lnFactorial(a + b) + lnFactorial(c + d) + lnFactorial(a + c) + lnFactorial(b + d) -
    lnFactorial(n) - lnFactorial(a) - lnFactorial(b) - lnFactorial(c) - lnFactorial(d)
  );
}

/**
 * Two-sided Fisher exact test on
 *   [withPass, withFail]
 *   [withoutPass, withoutFail]
 *
 * Sums the probability of every table at least as extreme as the observed one,
 * which is the standard two-sided construction and needs no normal
 * approximation.
 */
export function fisherExactTwoSided(
  withPass: number, withTrials: number,
  withoutPass: number, withoutTrials: number,
): number {
  const a = withPass, b = withTrials - withPass;
  const c = withoutPass, d = withoutTrials - withoutPass;
  if (withTrials <= 0 || withoutTrials <= 0) return 1;

  const obs = lnHypergeom(a, b, c, d);
  const rowTop = a + b, rowBot = c + d, colPass = a + c;
  const lo = Math.max(0, colPass - rowBot);
  const hi = Math.min(rowTop, colPass);

  // A tiny epsilon so floating point does not drop the observed table itself.
  const EPS = 1e-9;
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const l = lnHypergeom(x, rowTop - x, colPass - x, rowBot - (colPass - x));
    if (l <= obs + EPS) p += Math.exp(l);
  }
  return Math.min(1, p);
}

/**
 * Wilson score interval for one proportion. Chosen over the normal-approximation
 * interval because that one produces a zero-width interval at 0/n and n/n,
 * which is exactly where these runs land (8/8 and 0/8 both occur in the two
 * committed example runs).
 */
export function wilson(passes: number, trials: number, z = 1.96): { lo: number; hi: number } {
  if (trials <= 0) return { lo: 0, hi: 1 };
  const p = passes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const half = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return { lo: Math.max(0, (centre - half) / denom), hi: Math.min(1, (centre + half) / denom) };
}

/**
 * Interval on the DIFFERENCE of two proportions, in percentage points, by the
 * Newcombe method: combine each arm's Wilson interval. Reported so a reader can
 * see how wide the uncertainty actually is instead of inferring it from a
 * point estimate.
 */
export function deltaInterval(
  withPass: number, withTrials: number,
  withoutPass: number, withoutTrials: number,
): { lo: number; hi: number } {
  const w = wilson(withPass, withTrials);
  const o = wilson(withoutPass, withoutTrials);
  const p1 = withPass / withTrials, p2 = withoutPass / withoutTrials;
  const d = p1 - p2;
  const lo = d - Math.sqrt((p1 - w.lo) ** 2 + (o.hi - p2) ** 2);
  const hi = d + Math.sqrt((w.hi - p1) ** 2 + (p2 - o.lo) ** 2);
  return { lo: Math.round(Math.max(-1, lo) * 1000) / 10, hi: Math.round(Math.min(1, hi) * 1000) / 10 };
}

/** The smallest per-arm trial count at which a total separation (n/n vs 0/n) reaches p < 0.05. */
export const MIN_TRIALS_FOR_SIGNIFICANCE = 4;
