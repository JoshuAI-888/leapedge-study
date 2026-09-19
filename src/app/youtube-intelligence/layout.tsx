import type { ReactNode } from "react";
import { Shell } from "../../features/youtube-intelligence/ui/Shell.tsx";
import "../../features/youtube-intelligence/ui/workspace.css";
export default function Layout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
