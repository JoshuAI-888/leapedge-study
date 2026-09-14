# Supadata support draft — not sent

Subject: Generated YouTube transcripts return forbidden while native captions work

We are testing the `/v1/transcript` endpoint with a valid API key. Native caption requests work locally and from Vercel. Generated transcription (`mode=generate`, `text=false`) returns HTTP 403 with error `forbidden`.

Examples tested on 14 September 2026:

- YouTube video `J25UuUqHT3Y`: existing captions unavailable; generation failed with `forbidden`.
- YouTube video `SHMPiWbbR6E`: native captions available; generation failed. Detailed response: “This video is age-restricted and requires authentication.”

Please confirm whether this is a verified restriction on these videos, a limitation of your YouTube media retrieval, or an account/plan limitation. We have not independently verified the age classification. Which supported input path should we use for reliable multilingual transcription when native captions are absent? Does a paid plan change this specific media-access behavior?

Please do not request credentials by email. We can supply request times or authenticated dashboard identifiers through your secure support channel.
