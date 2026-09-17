import { registry, renderSteps, type MetricEntry } from "./registry.ts";
/**
 * Renders the whole registry as Markdown for the Methodology page. It reads
 * the same entries as renderHover, so the page and the hovers cannot disagree.
 */
export function renderMethodologyEntry(entry: MetricEntry) {
  const lines = [
    `## ${entry.label}`,
    "",
    `Registry id: \`${entry.id}\``,
    "",
    entry.definition,
    "",
    "How it is calculated:",
    "",
    renderSteps(entry),
    "",
    "Reads:",
    "",
    ...entry.inputs.map((i) => `- ${i.table}: ${i.columns.map((c) => `\`${c}\``).join(", ")}`),
    "",
    entry.settingsUsed.length
      ? `Settings that change it: ${entry.settingsUsed.map((s) => `\`${s}\``).join(", ")}`
      : "Settings that change it: none",
  ];
  return lines.join("\n");
}
export function renderMethodology(entries: MetricEntry[] = registry) {
  return [
    "# Methodology",
    "",
    "Every figure in the product is computed from stored rows by one registry entry; nothing is imported or copied. Each entry below is the same text shown when hovering the figure, and the CI test evaluates each entry against a fixture database.",
    "",
    ...entries.map(renderMethodologyEntry),
  ].join("\n\n");
}
