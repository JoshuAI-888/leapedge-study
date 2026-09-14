// Dated standard rates verified 2026-09-15; reverify before future campaigns.
export function textReservation(
  model: string,
  prompt: string,
  maxOutputTokens: number,
) {
  const rates =
    model === "gemini-3.8-flash"
      ? { input: 0.75, output: 3.75 }
      : model === "gemini-3.5-flash"
        ? { input: 1.5, output: 9 }
        : null;
  if (!rates || !Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0)
    throw Error("Unsupported text cost bound");
  const inputUpperBound = Buffer.byteLength(prompt, "utf8") + 4096;
  if (inputUpperBound + 2 * maxOutputTokens > 1_000_000)
    throw Error("Text context bound exceeded");
  // UTF-8 bytes plus overhead as a conservative input bound; duplicate the output
  // cap as a thought allowance. NZ$2/US$1 plus 25% margin, not a live FX quote.
  const reservedNzd = Math.max(
    0.1,
    Math.ceil(
      ((inputUpperBound * rates.input + 2 * maxOutputTokens * rates.output) /
        1e6) *
        2 *
        1.25 *
        100,
    ) / 100,
  );
  if (reservedNzd > 2.5)
    throw Error("Per-call reservation exceeds approved bound");
  return {
    reservedNzd,
    inputUpperBound,
    maxOutputTokens,
    additionalThoughtAllowance: maxOutputTokens,
    rates,
    conversionAssumption: 2,
    margin: 1.25,
  };
}
