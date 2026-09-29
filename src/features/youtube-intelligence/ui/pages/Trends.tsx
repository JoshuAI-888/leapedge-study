"use client";
import { Empty, PageTitle } from "../components.tsx";

/** Placeholder route (F57). The trends lane (F65) replaces this page. */
export function Trends() {
  return (
    <>
      <PageTitle
        title="Trends"
        description="How creator sentiment on an instrument or theme moves over time."
      />
      <Empty title="This page is being built in phase 5">
        Until it is ready, the Sentiment shift panel on Today compares this
        period with the one before.
      </Empty>
    </>
  );
}
