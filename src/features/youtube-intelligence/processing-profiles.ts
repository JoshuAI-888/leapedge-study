import { z } from "zod";

export const ProcessingProfileSetting = z.enum([
  "deployment-default",
  "off",
  "conservative",
  "experimental-overlap",
]);
export type ProcessingProfileSettingData = z.infer<typeof ProcessingProfileSetting>;

export const PROCESSING_PROFILES: ReadonlyArray<{
  value: ProcessingProfileSettingData;
  label: string;
  description: string;
  details: readonly string[];
}> = [
  {
    value: "deployment-default",
    label: "Deployment default",
    description: "Use the processing profile configured for the app that admits the analysis.",
    details: [
      "Useful when an administrator manages the profile through deployment configuration.",
      "Different deployments can have different defaults. Choose a named profile to make this workspace's choice explicit.",
    ],
  },
  {
    value: "off",
    label: "Standard",
    description: "Use the standard research path without optional evidence encoding, focused auditing, cross-run research reuse or research overlap.",
    details: [
      "Keep the complete evidence and independent research audit path.",
      "Existing protections still apply, including skipping unnecessary English translation and stopping untouched chunks after fatal account errors.",
    ],
  },
  {
    value: "conservative",
    label: "Efficient (recommended)",
    description: "Reduce avoidable work with exact evidence reuse, focused audit prechecks and eligible cached research.",
    details: [
      "Reuse an exact evidence dictionary only when it makes the request smaller; retain the original quotes and references.",
      "Reject deterministically invalid statements before model auditing. The independent audit still checks the remaining statements against the complete available evidence.",
      "Reuse eligible research only when its query, source constraints, date cutoff, version and freshness match. Retain the original retrieval provenance and cost attribution.",
      "Research waits for the extraction critique before starting. Savings depend on the input and eligible reuse; they are not guaranteed for every analysis.",
    ],
  },
  {
    value: "experimental-overlap",
    label: "Research overlap (experimental)",
    description: "Add early research planning and retrieval while the extraction critique is still running.",
    details: [
      "Includes the Efficient profile's safeguards and reuse rules.",
      "Early research is provisional. Final synthesis and publication still wait for the accepted evidence and required audits.",
      "Research that cannot be reused may add cost. The latest comparison did not establish quality parity, so keep Efficient for routine research.",
    ],
  },
];
