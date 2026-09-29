"use client";
import { Empty, PageTitle } from "../components.tsx";

/** Placeholder route (F57). The daily report lane (F64) replaces this page. */
export function Report({ date }: { date: string | null }) {
  return (
    <>
      <PageTitle
        title="Daily report"
        description={
          date
            ? "What creators said in one US session, with the evidence behind it."
            : "What creators said in the latest US session, with the evidence behind it."
        }
      />
      <Empty title="This page is being built in phase 5">
        The daily report will appear here. Today and the calls behind it remain
        available on the Today page.
      </Empty>
    </>
  );
}
