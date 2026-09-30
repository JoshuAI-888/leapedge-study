import {
  ArchiveInput,
  SessionInput,
  SynthesizeInput,
  loadDailyReport,
  loadReportArchive,
  synthesizeReport,
} from "../daily-report.ts";
import { reads, writes, type ActionTable } from "./types.ts";
/**
 * F64: the daily report. `session` and `archive` only read (GET, no model
 * calls); `synthesize` starts the briefing pipeline for one session, which
 * may spend, and so is a POST.
 */
export const report: ActionTable = {
  session: reads(SessionInput, (v) => loadDailyReport(v)),
  archive: reads(ArchiveInput, (v) => loadReportArchive(v)),
  synthesize: writes(SynthesizeInput, (v) => synthesizeReport(v)),
};
