// gmeet-unmirror — MAIN-world hook. Runs in Meet's own page context (not the
// isolated content-script world) so it can see the real getDisplayMedia the app
// calls. Announces when THIS user starts/stops sharing their screen — the only
// moment the hall-of-mirrors can occur — so the content script stays dormant
// otherwise and can never touch a plain camera tile.

const SHARE_EVENT = "gmeet-unmirror:share"

const announce = (active) =>
  window.dispatchEvent(new CustomEvent(SHARE_EVENT, { detail: { active } }))

const media = navigator.mediaDevices

if (
  media &&
  typeof media.getDisplayMedia === "function" &&
  !media.__gmeetUnmirrorHooked
) {
  media.__gmeetUnmirrorHooked = true
  const original = media.getDisplayMedia.bind(media)
  media.getDisplayMedia = async (...args) => {
    const stream = await original(...args)
    announce(true)
    // The share ends when the user hits "Stop sharing" or Meet drops the track —
    // either way the video track fires "ended".
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => announce(false), { once: true })
    }
    return stream
  }
}
