"use client";
import { useEffect, useRef, useState } from "react";
type Player = { destroy(): void };
type API = {
  Player: new (
    frame: HTMLIFrameElement,
    config: {
      events: { onReady: () => void; onError: (e: { data: number }) => void };
    },
  ) => Player;
};
declare global {
  interface Window {
    YT?: API;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let loading: Promise<API> | undefined;
function youtubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!loading)
    loading = new Promise<API>((resolve, reject) => {
      const timer = setTimeout(() => {
        loading = undefined;
        reject(Error("Player API could not load."));
      }, 15000);
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        clearTimeout(timer);
        if (window.YT) resolve(window.YT);
        else reject(Error("Player API unavailable"));
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        loading = undefined;
        reject(Error("Player API blocked by browser or network."));
      };
      document.head.appendChild(script);
    });
  return loading;
}
export function SourcePlayer({
  videoId,
  seconds,
}: {
  videoId: string;
  seconds: number;
}) {
  const frame = useRef<HTMLDivElement>(null),
    [origin, setOrigin] = useState(""),
    [status, setStatus] = useState("Loading source player…");
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!origin || !frame.current) return;
    let disposed = false,
      player: Player | undefined;
    setStatus("Loading source player…");
    const container = frame.current,
      iframe = document.createElement("iframe");
    iframe.title = "YouTube source at cited timestamp";
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.max(0, Math.floor(seconds))}&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    container.replaceChildren(iframe);
    youtubeAPI()
      .then((api) => {
        if (disposed || !frame.current) return;
        player = new api.Player(iframe, {
          events: {
            onReady: () => {
              if (!disposed)
                setStatus("Player ready. Verify the source wording yourself.");
            },
            onError: ({ data }) => {
              if (disposed) return;
              const reason: Record<number, string> = {
                100: "Video removed, private or unavailable.",
                101: "The owner disabled embedding.",
                150: "The owner disabled embedding.",
                153: "YouTube rejected the player client identification.",
                2: "Invalid video request.",
                5: "Playback failed in this browser.",
              };
              setStatus(
                `Playback unavailable (${data}). ${reason[data] || "YouTube could not play this source."} Use the timestamped source link.`,
              );
            },
          },
        });
      })
      .catch((e) => {
        if (!disposed) setStatus(e.message + " Use the source link.");
      });
    return () => {
      disposed = true;
      player?.destroy();
      container.replaceChildren();
    };
  }, [videoId, seconds, origin]);
  const start = Math.max(0, Math.floor(seconds));
  return (
    <section aria-label="Source verification">
      <div ref={frame} />
      <p role="status">{status}</p>
      <a
        href={`https://www.youtube.com/watch?v=${videoId}&t=${start}s`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open source on YouTube at {Math.floor(start / 60)}:
        {String(start % 60).padStart(2, "0")}
      </a>
      <p>
        Playback availability is separate from transcription and evidence
        accuracy.
      </p>
    </section>
  );
}
