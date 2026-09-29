"use client";
import Link from "next/link";
import { useWorkspace } from "../workspace.tsx";
import { Empty, PageTitle } from "../components.tsx";

/** Placeholder route (F57). The channel page lane (F66) replaces this page. */
export function Channel({ id }: { id: string }) {
  const { data } = useWorkspace();
  const channel = data?.snapshot.channels.find((c) => c.id === id);
  return (
    <>
      <PageTitle
        title={channel?.title || channel?.handle || "Channel"}
        description="One creator's calls, lean and record against your benchmark."
      />
      <Empty title="This page is being built in phase 5">
        <Link href="/youtube-intelligence/channels">Back to Channels</Link>
      </Empty>
    </>
  );
}
