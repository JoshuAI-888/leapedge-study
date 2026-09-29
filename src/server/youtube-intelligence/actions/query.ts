import {
  CallsQuery,
  SearchIndexQuery,
  SeriesQuery,
  VideosQuery,
  queryCalls,
  querySearchIndex,
  querySeries,
  queryVideos,
} from "../repos/research-query.ts";
import { reads, type ActionTable } from "./types.ts";
/**
 * F56: the research query API. Every action only reads, so all of them answer
 * GET (input as JSON in `?input=`) and stay available in a read-only preview.
 * Search, Trends, channel pages, the report archive, Export and quick search
 * read these instead of the capped workspace snapshot.
 */
export const query: ActionTable = {
  calls: reads(CallsQuery, (v) => queryCalls(v)),
  videos: reads(VideosQuery, (v) => queryVideos(v)),
  series: reads(SeriesQuery, (v) => querySeries(v)),
  searchIndex: reads(SearchIndexQuery, (v) => querySearchIndex(v)),
};
