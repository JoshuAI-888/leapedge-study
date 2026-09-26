import { externalComparisonEstablished, reviewFinancialFact } from "./research-brief.ts";
import type { AcceptedSentence } from "./research-brief.ts";

/** Read-time review also protects legacy records without rewriting their audit. */
export function financialFactRows(
  sentence: Pick<AcceptedSentence, "financialFacts" | "financialFactChecks" | "evidenceIds">,
  evidence: {id:string;quotes:{text:string}[]}[],
) {
  const key=(fact:object)=>JSON.stringify(Object.entries(fact).sort(([a],[b])=>a.localeCompare(b)));
  const checks=sentence.financialFactChecks ?? [];
  const originals=(sentence.financialFacts ?? []).map(fact=>
    checks.find(check=>check.fact && key(check.fact)===key(fact))?.original ?? fact);
  originals.push(...checks.filter(check=>!check.fact).map(check=>check.original));
  return originals.map(fact=>reviewFinancialFact(fact,
    sentence.evidenceIds.includes(fact.evidenceId)
      ? (evidence.find(item=>item.id===fact.evidenceId)?.quotes ?? []).map(quote=>quote.text)
      : []));
}

type SupportLink = Parameters<typeof externalComparisonEstablished>[0] & {
  relationship: "supports" | "contradicts";
};
type AssessedSentence = {
  factualStatus: "unverified" | "corroborated" | "partial" | "disputed";
  externalSupport?: SupportLink[];
  financialFacts?: unknown[];
};

export function externalRelationshipLabel(link: SupportLink, hasFinancialFacts = false) {
  const established = externalComparisonEstablished(link, hasFinancialFacts);
  if (link.relationship === "contradicts")
    return established ? "Contradicts · comparable evidence" : "Potential conflict · comparison unverified";
  return established ? "Supports · comparable evidence" : "Proposed support · comparison unverified";
}

/** Historical records keep their audit, but absence of comparison metadata is
 * never upgraded to a factual conclusion by the presentation layer. */
export function factualSupportLabel(sentence: AssessedSentence) {
  const links = sentence.externalSupport ?? [];
  const comparable = (link: SupportLink) => externalComparisonEstablished(link, !!sentence.financialFacts?.length);
  const conflicts = links.filter(link => link.relationship === "contradicts");
  if (conflicts.length) {
    if (conflicts.some(comparable))
      return sentence.factualStatus === "disputed"
        ? "Disputed · comparable retained contradiction"
        : "Potential conflict · factual assessment unverified";
    return "Potential conflict · comparison unverified";
  }
  if (sentence.factualStatus === "disputed") return "Unverified · no retained contradiction support";
  const support = links.filter(link => link.relationship === "supports");
  if (support.length && !support.some(comparable)) return "Unverified · comparison not established";
  if (sentence.factualStatus === "unverified") return "Unverified";
  if (!support.length) return "Unverified · no retained assertion support";
  return sentence.factualStatus === "partial" ? "Partially corroborated" : "Corroborated · model assessed";
}

export function thesisRobustnessLabel(sentence: AssessedSentence & {
  robustness: "insufficient" | "fragile" | "supported";
}) {
  const links = sentence.externalSupport ?? [];
  const comparable = (link: SupportLink) => externalComparisonEstablished(link, !!sentence.financialFacts?.length);
  if (links.some(link => !comparable(link))) return "Not established · comparison unverified";
  if (sentence.robustness === "insufficient") return "Not established";
  if (sentence.robustness === "fragile") {
    if (sentence.factualStatus === "disputed" && !links.some(link => link.relationship === "contradicts" && comparable(link)))
      return "Not established · no retained contradiction support";
    return "Fragility flagged · model assessed";
  }
  if (links.some(link => link.relationship === "contradicts"))
    return "Not established · conflicting factual support";
  if (sentence.factualStatus !== "corroborated" || !links.some(link => link.relationship === "supports"))
    return "Not established · no retained assertion support";
  return "Supported · model assessed";
}
