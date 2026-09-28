import {z} from 'zod';
import {RecallReconciliation} from '../../../features/youtube-intelligence/source-recall.ts';
import {extractionResponseSchema} from './extraction.ts';

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
