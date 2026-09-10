# YouTube Transcript Cleaner

A tiny personal-use Chrome extension. When you open the transcript panel on a
YouTube video page, a **"Copy cleaned transcript"** button appears at the top
of the panel. Clicking it extracts the visible transcript, strips timestamps,
joins the broken lines into normal flowing text, and copies the result to
your clipboard.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open any YouTube video, click **...more** under the video, then
   **Show transcript** (or use the transcript panel however you normally
   open it).
5. Click **Copy cleaned transcript** at the top of the panel, then paste
   anywhere.

## How it works

- `content.js` watches the page for YouTube's transcript panel
  (`ytd-transcript-renderer`) and injects a button into it when it's open.
- On click, it reads each `ytd-transcript-segment-renderer` entry's text
  (ignoring the timestamp element entirely), joins the segments with
  spaces, collapses whitespace/line breaks, and copies the result via the
  Clipboard API (with a `document.execCommand('copy')` fallback).
- No data leaves your browser; the extension only reads the DOM of the
  currently open YouTube tab.
