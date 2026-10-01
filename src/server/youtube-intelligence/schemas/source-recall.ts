import {z} from 'zod';
import {RecallReconciliation} from '../../../features/youtube-intelligence/source-recall.ts';
import {extractionResponseSchema, structuredExtractionResponseSchema} from './extraction.ts';

// This is embedded inside the manual native extraction schema. A nested
// $schema marker is not a native Gemini Schema field: the SDK only switches
// to responseJsonSchema when that marker is at the overall root.
const reconciliationSchema = z.toJSONSchema(RecallReconciliation);
delete reconciliationSchema.$schema;
export const sourceRecallResponseSchema = {
 ...extractionResponseSchema,
 properties:{...extractionResponseSchema.properties,reconciliation:reconciliationSchema},
 required:[...extractionResponseSchema.required,'reconciliation'],
};
/** Prompt v9: the same reconciliation around the structured-ideas extraction schema. */
export const structuredSourceRecallResponseSchema = {
 ...structuredExtractionResponseSchema,
 properties:{...structuredExtractionResponseSchema.properties,reconciliation:reconciliationSchema},
 required:[...structuredExtractionResponseSchema.required,'reconciliation'],
};
export function sourceRecallSchemaFor(prompts:{structuredIdeas?:boolean}){
 return prompts.structuredIdeas ? structuredSourceRecallResponseSchema : sourceRecallResponseSchema;
}
