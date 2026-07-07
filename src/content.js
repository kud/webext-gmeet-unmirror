// gmeet-unmirror — hides the Google Meet presentation tile so sharing the whole
// screen doesn't feed it back into itself (the "hall of mirrors").
//
// CORRECTNESS BAR: only ever hide the presentation feed, and only while YOU are
// actively screen-sharing. Never a camera tile, never your self-view, never
// Meet's controls. The share gate is what guarantees it — the extension stays
// inert unless a screen-share is live, so it structurally cannot grab a face
// when nobody is presenting.
//
// Two cooperating scripts:
//   - src/share-hook.js (MAIN world) patches getDisplayMedia and announces share
//     start/stop on a window CustomEvent.
//   - this script (isolated world) listens for that, and only then finds the
//     presentation tile (the spotlighted largest <video>) and hides it.

const HIDDEN_CLASS = "gmeet-unmirror-hidden"
const PLACEHOLDER_CLASS = "gmeet-unmirror-placeholder"
const BUTTON_VISIBLE_CLASS = "gmeet-unmirror-visible"
const POSITION_PATCHED_ATTR = "data-gmeet-unmirror-position-patched"
const STYLE_ID = "gmeet-unmirror-styles"
const TOGGLE_BUTTON_ID = "gmeet-unmirror-toggle"
const SHARE_EVENT = "gmeet-unmirror:share"

const MAX_ANCESTOR_HOPS = 6
const CONTAINER_AREA_GROWTH_LIMIT = 1.6
const RETRY_DEBOUNCE_MS = 300

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

// While sharing, the presentation is Meet's spotlighted main stage, so it's the
// largest visible <video>. This is only ever called during an active share (see
// the share gate below), which is what keeps it off camera tiles.
const findPresentationVideo = () => {
  const videos = Array.from(document.querySelectorAll("video")).filter(
    isVisible,
  )
  return videos.length ? findLargestVideo(videos) : null
}

// Walk up from the <video> to the tile container Meet lays out in its grid,
// stopping as soon as an ancestor's box grows past the video's own — that jump
// means we've stepped out of the tile into the surrounding stage.
const findTileContainer = (video) => {
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

// Button and placeholder are styled to sit inside Meet's dark control aesthetic
// (round, #202124-ish, Google Sans) rather than announce themselves.
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

    #${TOGGLE_BUTTON_ID} {
      position: fixed;
      left: 16px;
      bottom: 24px;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border: none;
      border-radius: 24px;
      background: rgba(32, 33, 36, 0.92);
      color: #e8eaed;
      font: 500 14px/1 "Google Sans", Roboto, system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    #${TOGGLE_BUTTON_ID}.${BUTTON_VISIBLE_CLASS} {
      display: inline-flex;
    }

    #${TOGGLE_BUTTON_ID}:hover {
      background: rgba(60, 64, 67, 0.95);
    }
  `
  document.head.appendChild(style)
}

let isSharing = false
let userWantsVisible = false
let hiddenContainer = null
let placeholderEl = null
let toggleButtonEl = null
let retryObserver = null

const updateToggleButton = () => {
  if (!toggleButtonEl) return
  const isHidden = Boolean(hiddenContainer)
  toggleButtonEl.setAttribute("aria-pressed", String(isHidden))
  toggleButtonEl.textContent = isHidden
    ? "Show presentation"
    : "Hide presentation"
}

const showPresentationTile = () => {
  if (!hiddenContainer) return

  hiddenContainer.classList.remove(HIDDEN_CLASS)
  restorePositioning(hiddenContainer)
  placeholderEl?.remove()
  hiddenContainer = null
  placeholderEl = null
  updateToggleButton()
}

const hidePresentationTile = () => {
  const video = findPresentationVideo()
  if (!video) return false

  const container = findTileContainer(video)
  if (hiddenContainer === container) return true

  showPresentationTile()
  ensureRelativePositioning(container)
  container.classList.add(HIDDEN_CLASS)
  container.appendChild(createPlaceholder())
  hiddenContainer = container
  placeholderEl = container.querySelector(`.${PLACEHOLDER_CLASS}`)
  updateToggleButton()
  return true
}

// Re-assert the hide while sharing: the presentation tile mounts a beat after
// the share starts, and Meet re-mounts it on layout changes (leaving our old
// reference detached, which would let the mirror back in).
const tryHide = () => {
  if (!isSharing || userWantsVisible) return
  if (hiddenContainer && document.contains(hiddenContainer)) return
  if (hiddenContainer) showPresentationTile()
  hidePresentationTile()
}

// Manual toggle (button + shortcut) only means anything during a share. Showing
// a tile the user explicitly asked to see wins until the share ends.
const toggleManual = () => {
  if (!isSharing) return
  if (hiddenContainer) {
    userWantsVisible = true
    showPresentationTile()
  } else {
    userWantsVisible = false
    hidePresentationTile()
  }
}

const showButton = (visible) => {
  toggleButtonEl?.classList.toggle(BUTTON_VISIBLE_CLASS, visible)
}

const createToggleButton = () => {
  const button = document.createElement("button")
  button.id = TOGGLE_BUTTON_ID
  button.type = "button"
  button.title = "Hide/show the presentation tile (Alt+Shift+H)"
  button.addEventListener("click", toggleManual)
  document.body.appendChild(button)
  return button
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

// Share gate: engage only while THIS user is screen-sharing (the only time the
// hall-of-mirrors exists). Announced by src/share-hook.js from the page's MAIN
// world, where the real getDisplayMedia lives.
const onShareStart = () => {
  if (isSharing) return
  isSharing = true
  userWantsVisible = false
  showButton(true)
  tryHide()
  retryObserver = new MutationObserver(debounce(tryHide, RETRY_DEBOUNCE_MS))
  retryObserver.observe(document.body, { childList: true, subtree: true })
}

const onShareStop = () => {
  isSharing = false
  userWantsVisible = false
  retryObserver?.disconnect()
  retryObserver = null
  showPresentationTile()
  showButton(false)
}

const handleShareEvent = (event) => {
  if (event.detail?.active) onShareStart()
  else onShareStop()
}

const init = () => {
  injectStyles()
  toggleButtonEl = createToggleButton()
  updateToggleButton()
  document.addEventListener("keydown", handleKeydown)
  window.addEventListener(SHARE_EVENT, handleShareEvent)
}

init()
