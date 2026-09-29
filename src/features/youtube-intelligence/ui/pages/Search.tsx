"use client";
import { Empty, PageTitle } from "../components.tsx";

/** Placeholder route (F57). The search lane (F62) replaces this page. */
export function Search() {
  return (
    <>
      <PageTitle
        title="Search"
        description="Find calls and videos by instrument, channel, stance or text."
      />
      <Empty title="This page is being built in phase 5">
        Until it is ready, use "Find a call" on the Today page.
      </Empty>
    </>
  );
}
