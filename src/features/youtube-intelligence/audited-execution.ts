import { z } from 'zod';
/** Frozen at admission; absence means historical execution, never a retroactive opt-in. */
export const AuditedExecutionPlan = z.object({
 version:z.literal('audited-speed.v1'), metadataCache:z.boolean().default(true), recallOverlap:z.boolean().default(true),
 recallPacking:z.boolean().default(true), weightedAudit:z.boolean().default(true), checkedFindings:z.boolean().default(true),
 criticRouting:z.enum(['default','latency','throughput']).default('default'),
});
export type AuditedExecutionPlanData=z.infer<typeof AuditedExecutionPlan>;
export function auditedExecution(input:Record<string,unknown>){return input.auditedExecutionPlan === undefined ? null : AuditedExecutionPlan.parse(input.auditedExecutionPlan);}
