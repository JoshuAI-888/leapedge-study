import test from "node:test";
import assert from "node:assert/strict";
import { factualSupportLabel, thesisRobustnessLabel } from "../src/features/youtube-intelligence/research-presentation.ts";

test("old corroboration labels without retained assertion support are not displayed as verified", () => {
  assert.equal(factualSupportLabel({ factualStatus: "corroborated" }), "Unverified · no retained assertion support");
  assert.equal(factualSupportLabel({ factualStatus: "partial", externalSupport: [] }), "Unverified · no retained assertion support");
});
test("disputes remain prominent and supported assessments remain qualified", () => {
  assert.equal(factualSupportLabel({ factualStatus: "disputed" }), "Unverified · no retained contradiction support");
  assert.equal(factualSupportLabel({ factualStatus: "disputed", externalSupport: [{ relationship: "supports" }] }), "Unverified · no retained contradiction support");
  assert.equal(factualSupportLabel({ factualStatus: "disputed", externalSupport: [{ relationship: "contradicts" }] }), "Disputed · retained contradiction");
  assert.equal(factualSupportLabel({ factualStatus: "partial", externalSupport: [{ relationship: "supports" }] }), "Partially corroborated");
  assert.equal(factualSupportLabel({ factualStatus: "corroborated", externalSupport: [{ relationship: "contradicts" }] }), "Disputed · conflicting retained support");
  assert.equal(factualSupportLabel({ factualStatus: "corroborated", externalSupport: [{ relationship: "supports" }] }), "Corroborated · model assessed");
});

test("legacy supported thesis cannot retain a supported badge without assertion support", () => {
  assert.equal(thesisRobustnessLabel({ robustness: "supported", factualStatus: "corroborated" }), "Not established · no retained assertion support");
  assert.equal(thesisRobustnessLabel({ robustness: "supported", factualStatus: "corroborated", externalSupport: [{ relationship: "supports" }] }), "Supported · model assessed");
  assert.equal(thesisRobustnessLabel({ robustness: "supported", factualStatus: "corroborated", externalSupport: [{ relationship: "contradicts" }] }), "Not established · conflicting factual support");
  assert.equal(thesisRobustnessLabel({ robustness: "insufficient", factualStatus: "unverified" }), "Not established");
});
