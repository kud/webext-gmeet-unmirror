// gmeet-unmirror — hides the Google Meet presentation tile so sharing the whole
// screen doesn't feed it back into itself (the "hall of mirrors").
//
// CORRECTNESS BAR: only ever hide the presentation feed, and only while YOU are
// actively screen-sharing. Never a camera tile, never your self-view, never
// Meet's controls.
//
// "Am I presenting?" is answered by two cooperating, local-only signals:
//   - src/share-hook.js (MAIN world) patches getDisplayMedia and fires a
//     start/stop CustomEvent — a precise transition signal, but only for shares
//     that begin after the page loads.
//   - the local "Stop presentation" control, found in the DOM by its
//     language-independent Material Symbol ligature (cancel_presentation) — a
//     state signal that is true the instant we look, so it also covers rejoining
//     a call while a share is already live.
// Both are local-only: getDisplayMedia runs in the sharer's browser, and the
// stop-present control exists only for the local presenter — so someone else
// presenting can never engage the extension. The DOM is the source of truth;
// the getDisplayMedia event is an accelerant that makes the transition snappier.

const HIDDEN_CLASS = "gmeet-unmirror-hidden"
const PLACEHOLDER_CLASS = "gmeet-unmirror-placeholder"
const POSITION_PATCHED_ATTR = "data-gmeet-unmirror-position-patched"
const STYLE_ID = "gmeet-unmirror-styles"
const SHARE_EVENT = "gmeet-unmirror:share"
const STORAGE_KEY = "auto"

const MAX_ANCESTOR_HOPS = 6
const CONTAINER_AREA_GROWTH_LIMIT = 1.6
const RECONCILE_DEBOUNCE_MS = 300

// Meet wraps every tile — camera or presentation — in an element carrying a
// stable data-tile-media-id (confirmed against a live call). Its class names are
// randomised per build, but this attribute is semantic and survives rebuilds.
const TILE_SELECTOR = "[data-tile-media-id]"

// The local "Stop presentation" control carries this Material Symbol ligature in
// its text. The glyph name is language-independent (unlike the aria-label prose)
// and only present while THIS user is presenting.
const PRESENT_STOP_LIGATURE = "cancel_presentation"

// Self-view camera tiles carry their own controls (Reframe, Backgrounds) — the
// presentation tile never does. Confirmed against a live call. Excluding any
// tile with these ligatures guarantees the self-view is never chosen as the
// presentation, even in the split-second before the presentation tile mounts.
const SELF_VIEW_LIGATURES = ["frame_person", "visual_effects"]

const debounce = (fn, waitMs) => {
  let timeoutId
  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), waitMs)
  }
}

const videoArea = (video) => {
  const rect = video.getBoundingClientRect()
  return rect.width * rect.height
}

const isVisible = (el) => {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && el.offsetParent !== null
}

const findLargestVideo = (videos) =>
  videos.reduce((largest, video) =>
    videoArea(video) > videoArea(largest) ? video : largest,
  )

const isSelfViewVideo = (video) => {
  const tile = video.closest(TILE_SELECTOR)
  const text = tile?.textContent ?? ""
  return SELF_VIEW_LIGATURES.some((ligature) => text.includes(ligature))
}

// While sharing, the presentation is Meet's spotlighted main stage, so it's the
// largest visible <video> — once the self-view is excluded. Returns null until a
// non-self-view video exists, which is how we avoid hiding our own face during
// the moment before the presentation tile mounts.
const findPresentationVideo = () => {
  const videos = Array.from(document.querySelectorAll("video"))
    .filter(isVisible)
    .filter((video) => !isSelfViewVideo(video))
  return videos.length ? findLargestVideo(videos) : null
}

// The tile container Meet lays out in its grid. Prefer the semantic attribute;
// fall back to a geometric walk up the ancestors — stopping as soon as a box
// grows past the video's own — for the day Meet drops or renames the attribute.
const findTileContainerByWalk = (video) => {
  const baseArea = videoArea(video)
  let container = video
  let node = video.parentElement
  let hops = 0

  while (node && hops < MAX_ANCESTOR_HOPS) {
    if (videoArea(node) > baseArea * CONTAINER_AREA_GROWTH_LIMIT) break
    container = node
    node = node.parentElement
    hops += 1
  }

  return container
}

const findTileContainer = (video) =>
  video.closest(TILE_SELECTOR) ?? findTileContainerByWalk(video)

// Is THIS user presenting right now, per the DOM? True iff the local
// "Stop presentation" control is on screen.
const isPresentingByDom = () =>
  Array.from(document.querySelectorAll("button")).some(
    (button) =>
      button.offsetParent !== null &&
      button.textContent.includes(PRESENT_STOP_LIGATURE),
  )

const ensureRelativePositioning = (el) => {
  if (getComputedStyle(el).position === "static") {
    el.style.position = "relative"
    el.setAttribute(POSITION_PATCHED_ATTR, "true")
  }
}

const restorePositioning = (el) => {
  if (el.getAttribute(POSITION_PATCHED_ATTR) === "true") {
    el.style.position = ""
    el.removeAttribute(POSITION_PATCHED_ATTR)
  }
}

const createPlaceholder = () => {
  const el = document.createElement("div")
  el.className = PLACEHOLDER_CLASS
  el.textContent = "Presentation hidden — unmirror"
  return el
}

const injectStyles = () => {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    .${HIDDEN_CLASS} {
      visibility: hidden !important;
    }

    .${PLACEHOLDER_CLASS} {
      visibility: visible !important;
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      background: rgba(15, 15, 15, 0.85);
      color: #e8eaed;
      font: 500 14px/1.4 "Google Sans", Roboto, system-ui, sans-serif;
      text-align: center;
      z-index: 2147483647;
      pointer-events: none;
    }
  `
  document.head.appendChild(style)
}

let autoHide = true // popup setting; default on
let isSharing = false // are we presenting right now?
let hideRequested = false // effective intent: should the tile be hidden?
let hiddenContainer = null
let placeholderEl = null

const showPresentationTile = () => {
  if (!hiddenContainer) return
  hiddenContainer.classList.remove(HIDDEN_CLASS)
  restorePositioning(hiddenContainer)
  placeholderEl?.remove()
  hiddenContainer = null
  placeholderEl = null
}

// Hide the current presentation tile, re-targeting if the largest non-self-view
// video has changed (Meet re-mounts the tile on layout changes, and the stage
// settles onto the presentation a beat after a share starts).
const hidePresentationTile = () => {
  const video = findPresentationVideo()
  if (!video) return

  const container = findTileContainer(video)
  if (hiddenContainer === container && document.contains(container)) return

  showPresentationTile()
  ensureRelativePositioning(container)
  container.classList.add(HIDDEN_CLASS)
  container.appendChild(createPlaceholder())
  hiddenContainer = container
  placeholderEl = container.querySelector(`.${PLACEHOLDER_CLASS}`)
}

// Bring the DOM in line with our intent. Safe to call on every mutation.
const applyIntent = () => {
  if (isSharing && hideRequested) hidePresentationTile()
  else showPresentationTile()
}

const onShareStart = () => {
  if (isSharing) return
  isSharing = true
  hideRequested = autoHide // auto → hide now; manual → wait for the popup
  applyIntent()
}

const onShareStop = () => {
  if (!isSharing) return
  isSharing = false
  hideRequested = false
  applyIntent()
}

// The DOM is authoritative for whether we're presenting; reconcile our state
// with it, then re-assert the hide (covers Meet re-mounting the tile).
const reconcile = () => {
  if (isPresentingByDom()) onShareStart()
  else onShareStop()
  applyIntent()
}

// Manual show/hide from the popup and the Alt+Shift+H shortcut. Only meaningful
// while presenting; flips the intent and re-asserts it.
const toggleManual = () => {
  if (!isSharing) return
  hideRequested = !hideRequested
  applyIntent()
}

const getState = () => ({
  presenting: isSharing,
  hidden: Boolean(hiddenContainer),
  auto: autoHide,
})

const handleShareEvent = (event) => {
  if (event.detail?.active) onShareStart()
  else onShareStop()
}

const isEditableTarget = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))

const handleKeydown = (event) => {
  if (
    event.altKey &&
    event.shiftKey &&
    event.code === "KeyH" &&
    !isEditableTarget(event.target)
  ) {
    event.preventDefault()
    toggleManual()
  }
}

const applyAutoSetting = (value) => {
  autoHide = value !== false // default on when unset
  // Toggling the setting mid-share takes effect immediately: on → hide, off →
  // show. A subsequent manual toggle still wins until the setting changes again.
  if (isSharing) {
    hideRequested = autoHide
    applyIntent()
  }
}

const watchAutoSetting = async () => {
  const stored = await browser.storage.local.get(STORAGE_KEY)
  applyAutoSetting(stored[STORAGE_KEY])
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && STORAGE_KEY in changes) {
      applyAutoSetting(changes[STORAGE_KEY].newValue)
    }
  })
}

const init = () => {
  injectStyles()
  document.addEventListener("keydown", handleKeydown)
  window.addEventListener(SHARE_EVENT, handleShareEvent)

  // Popup ↔ content bridge: report state, and toggle on request.
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "toggle") toggleManual()
    return Promise.resolve(getState())
  })

  // Persistent, debounced reconciler: the DOM decides whether we're presenting
  // and re-asserts the hide when Meet re-mounts the tile.
  const observer = new MutationObserver(
    debounce(reconcile, RECONCILE_DEBOUNCE_MS),
  )
  observer.observe(document.body, { childList: true, subtree: true })

  watchAutoSetting()
  reconcile() // catch "already presenting when the page loaded"
}

init()
