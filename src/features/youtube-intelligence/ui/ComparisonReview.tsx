"use client";
import { useState } from "react";
import { action } from "./api.ts";
import { useWorkspace } from "./workspace.tsx";
export function ComparisonReview({ id }: { id: string }) {
  const { data, perform, busy } = useWorkspace();
  const [winner, setWinner] = useState("inconclusive"),
    [reviewer, setReviewer] = useState(""),
    [notes, setNotes] = useState(""),
    [accuracy, setAccuracy] = useState(0),
    [completeness, setCompleteness] = useState(0),
    [evidence, setEvidence] = useState(0);
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            () =>
              action("research", "review", {
                comparisonId: id,
                winner,
                reviewer,
                notes,
                accuracy,
                completeness,
                evidence,
              }),
            "Comparison review recorded.",
          );
        }}
      >
        <p className="yi-muted">
          This is a comparison assessment. It does not assign a human-verified
          badge to any call.
        </p>
        <div className="yi-settings-fields">
          <label>
            Preferred output
            <select value={winner} onChange={(e) => setWinner(e.target.value)}>
              <option value="inconclusive">Inconclusive</option>
              <option value="left">Baseline</option>
              <option value="right">Candidate</option>
              <option value="tie">Tie</option>
            </select>
          </label>
          <label>
            Reviewer name
            <input
              required
              maxLength={100}
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
          </label>
          {(
            [
              ["Accuracy", accuracy, setAccuracy],
              ["Completeness", completeness, setCompleteness],
              ["Evidence", evidence, setEvidence],
            ] as const
          ).map(([label, value, update]) => (
            <label key={label}>
              {label} (0–5)
              <input
                required
                type="number"
                min={0}
                max={5}
                step={1}
                value={value}
                onChange={(e) => update(Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <label>
          Findings and limitations
          <textarea
            required
            minLength={20}
            maxLength={12000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button disabled={busy}>Record review</button>
      </form>
      {data?.snapshot.reviews
        .filter((r) => r.comparisonId === id)
        .map((review, index) => (
          <blockquote key={String(review.id ?? index)}>
            {String(review.notes)}
            <footer>
              {String(review.reviewer)} · {String(review.winner)}
            </footer>
          </blockquote>
        ))}
    </>
  );
}
