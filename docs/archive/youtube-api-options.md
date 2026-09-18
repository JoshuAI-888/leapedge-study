# YouTube APIs for this project

An individual can create a Google Cloud project, enable YouTube Data API v3 and obtain credentials. A company account or YouTube Premium subscription is not needed. Our personal tool can use our project key for public metadata; future app users need not bring their own API keys. Private account data and operations require OAuth authorization. [Getting started](https://developers.google.com/youtube/v3/getting-started).

| Official service | Useful functions | Fit here |
|---|---|---|
| Data API v3: channels | Resolve @handles, channel IDs and uploads playlists | Canonical creator identity |
| Data API v3: playlistItems | Enumerate a channel's uploads playlist | New-video discovery and backfill |
| Data API v3: videos | Retrieve titles, descriptions, publication time, duration and other metadata | Source manifest and independent duration checks |
| Data API v3: search | Discover videos and creators by query | Optional discovery; unnecessary for polling known channels |
| Push notifications | Receive upload/title/description changes through an Atom callback | Later hosted ingestion without frequent polling |
| IFrame Player API | Embed playback and seek to specified times | Click a citation and verify its source |
| Captions API | List/manage/download caption tracks under required authorization | Suitable for videos the authorized user can edit; not arbitrary creator transcripts |

[Channel API](https://developers.google.com/youtube/v3/docs/channels/list), [Playlist API](https://developers.google.com/youtube/v3/docs/playlistItems/list), [Video API](https://developers.google.com/youtube/v3/docs/videos/list), [Push notifications](https://developers.google.com/youtube/v3/guides/push_notifications), [Player API](https://developers.google.com/youtube/iframe_api_reference).

## Cost and availability

The Data API is quota-limited rather than a normal pay-per-request product. Current documentation specifies default daily allocations of 100 search calls, 100 video-upload calls and 10,000 combined units for other endpoints. Typical list reads cost one unit. Quota extensions require a request; do not assume that adding billing buys unlimited access. Check the project's actual console quotas, as defaults can change. [Current quotas](https://developers.google.com/youtube/v3/getting-started).

YouTube API quota units are separate from Gemini/OpenRouter tokens and billing. The AI ingestion/transcription/synthesis is the paid component in our prototype, alongside any hosting or third-party transcript service.

## The transcript limitation

The official caption-download method requires the authenticated user to have permission to edit the video. Being able to watch a public video, subscribe to a channel or read its transcript in YouTube's interface does not grant that API permission. [Caption download requirements](https://developers.google.com/youtube/v3/docs/captions/download).

LeapEdge's documentation says it tries three caption libraries and then hands the YouTube URL to a multimodal model. Exact library names and endpoints are undisclosed. The caption path is likely unofficial YouTube caption access; that is an inference. The fallback is consistent with Gemini's documented public-YouTube-URL input, which we have successfully tested through OpenRouter. [LeapEdge pipeline](https://leapedge.app/how-it-works), [Gemini video input](https://ai.google.dev/gemini-api/docs/video-understanding).

Recommended split: official YouTube metadata/discovery/playback plus a replaceable source-evidence adapter. Prefer authorized timed captions where available. For remote model transcription, verify duration and section coverage, and label machine-generated timestamps honestly. The long English pilot demonstrates that a successful JSON response can still omit an entire company section.
