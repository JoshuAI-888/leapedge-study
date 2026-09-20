import { notFound, redirect } from "next/navigation";
import { Today } from "../../../features/youtube-intelligence/ui/pages/Today.tsx";
import { Channels } from "../../../features/youtube-intelligence/ui/pages/Channels.tsx";
import { Saved } from "../../../features/youtube-intelligence/ui/pages/Saved.tsx";
import { Settings } from "../../../features/youtube-intelligence/ui/pages/Settings.tsx";
import { Analysis } from "../../../features/youtube-intelligence/ui/pages/Analysis.tsx";
import { Lab } from "../../../features/youtube-intelligence/ui/pages/Lab.tsx";
import { Methodology } from "../../../features/youtube-intelligence/ui/pages/Methodology.tsx";
import { ProcessingProfiles } from "../../../features/youtube-intelligence/ui/pages/ProcessingProfiles.tsx";
import { Leaderboard } from "../../../features/youtube-intelligence/ui/pages/Leaderboard.tsx";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path = [] } = await params;
  if (!path.length) redirect("/youtube-intelligence/today");
  if (path[0] === "analysis" && path.length === 2)
    return <Analysis id={path[1]} />;
  if (path.length !== 1) notFound();
  const pages = {
    today: Today,
    channels: Channels,
    saved: Saved,
    settings: Settings,
    "processing-profiles": ProcessingProfiles,
    lab: Lab,
    methodology: Methodology,
    leaderboard: Leaderboard,
  };
  const Component = pages[path[0] as keyof typeof pages];
  if (!Component) notFound();
  return <Component />;
}
