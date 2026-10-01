import { notFound, redirect } from "next/navigation";
import { Today } from "../../../features/youtube-intelligence/ui/pages/Today.tsx";
import { Channels } from "../../../features/youtube-intelligence/ui/pages/Channels.tsx";
import { Saved } from "../../../features/youtube-intelligence/ui/pages/Saved.tsx";
import { Settings } from "../../../features/youtube-intelligence/ui/pages/Settings.tsx";
import { Analysis } from "../../../features/youtube-intelligence/ui/pages/Analysis.tsx";
import { Lab } from "../../../features/youtube-intelligence/ui/pages/Lab.tsx";
import { Methodology } from "../../../features/youtube-intelligence/ui/pages/Methodology.tsx";
import { AnalysisPipelines } from "../../../features/youtube-intelligence/ui/pages/AnalysisPipelines.tsx";
import { ProcessingProfiles } from "../../../features/youtube-intelligence/ui/pages/ProcessingProfiles.tsx";
import { Comparison } from "../../../features/youtube-intelligence/ui/pages/Comparison.tsx";
import { Leaderboard } from "../../../features/youtube-intelligence/ui/pages/Leaderboard.tsx";
import { Report } from "../../../features/youtube-intelligence/ui/pages/Report.tsx";
import { Search } from "../../../features/youtube-intelligence/ui/pages/Search.tsx";
import { Trends } from "../../../features/youtube-intelligence/ui/pages/Trends.tsx";
import { Channel } from "../../../features/youtube-intelligence/ui/pages/Channel.tsx";
import { resolveRoute } from "../../../features/youtube-intelligence/ui/navigation.ts";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path = [] } = await params;
  if (!path.length) redirect("/youtube-intelligence/today");
  const route = resolveRoute(path);
  if (!route) notFound();
  if (route.page === "analysis") return <Analysis id={route.id} />;
  if (route.page === "channel") return <Channel id={route.id} />;
  if (route.page === "report") return <Report date={route.date} />;
  const pages = {
    today: Today,
    search: Search,
    trends: Trends,
    channels: Channels,
    saved: Saved,
    settings: Settings,
    "processing-profiles": ProcessingProfiles,
    "analysis-pipelines": AnalysisPipelines,
    lab: Lab,
    comparison: Comparison,
    methodology: Methodology,
    leaderboard: Leaderboard,
  } satisfies Record<typeof route.page, unknown>;
  const Component = pages[route.page];
  return <Component />;
}
