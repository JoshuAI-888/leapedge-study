import type { ReactNode } from "react";
import { Shell } from "../../features/youtube-intelligence/ui/Shell.tsx";
import "../../features/youtube-intelligence/ui/workspace.css";
import "../../features/youtube-intelligence/ui/styles/foundations.css";
import "../../features/youtube-intelligence/ui/styles/research.css";
import "../../features/youtube-intelligence/ui/styles/report.css";
import "../../features/youtube-intelligence/ui/styles/analysis.css";
import "../../features/youtube-intelligence/ui/styles/today.css";
export default function Layout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
