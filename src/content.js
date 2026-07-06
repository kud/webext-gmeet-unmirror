// gmeet-unmirror — hides the Google Meet presentation tile so that sharing
// the whole screen doesn't feed it back into itself (the "hall of mirrors").
//
// CORRECTNESS BAR: only ever hide the presentation feed. Never the user's own
// self-view thumbnail, never another participant's tile, never Meet's
// controls/chat. Every heuristic below exists in service of that constraint.
//
// Meet's class names are randomised per build, so nothing here is pinned to a
// class name. Selection instead relies on:
//   1. Largest visible <video> on the page — when someone is presenting, the
//      presentation is the spotlighted main stage, so it's the largest video;
//      self-view is a small thumbnail and other participants are smaller too.
//   2. A backstop: an aria-label on the video or a nearby ancestor mentioning
//      "presenting"/"presentation"/"screen share", if Meet exposes one.
//
// !!! DEV TODO — CONFIRM AGAINST A LIVE MEET CALL !!!
// Heuristic 2 is a guess at what Meet *might* expose, not a confirmed signal.
// Open a real call, start presenting, and inspect the presentation tile's
// ancestors in devtools for a stable `aria-label` or `data-*` attribute. If
// one exists, tighten `PRESENTATION_LABEL_PATTERN` / `findTileContainer`
// below to use it directly instead of the largest-video fallback. Also worth
// checking: does "speaker view" ever make a single participant's camera the
// largest video with nobody presenting? If so, the label backstop needs to
// become a hard requirement rather than a preference, or auto-hide (Mode 2)
// needs a stricter trigger than "a big video appeared".

const HIDDEN_CLASS = "gmeet-unmirror-hidden"
const PLACEHOLDER_CLASS = "gmeet-unmirror-placeholder"
const POSITION_PATCHED_ATTR = "data-gmeet-unmirror-position-patched"
const STYLE_ID = "gmeet-unmirror-styles"
const TOGGLE_BUTTON_ID = "gmeet-unmirror-toggle"

const MAX_ANCESTOR_HOPS = 6
const CONTAINER_AREA_GROWTH_LIMIT = 1.6
const AUTO_HIDE_MIN_VIEWPORT_RATIO = 0.25
const MUTATION_DEBOUNCE_MS = 400

const PRESENTATION_LABEL_PATTERN = /presenting|presentation|screen\s*share/i

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

const findLabelledPresentationVideo = (videos) =>
  videos.find((video) => {
    const labelled = video.closest("[aria-label]")
    const label = labelled?.getAttribute("aria-label") ?? ""
    return PRESENTATION_LABEL_PATTERN.test(label)
  })

// The core lookup: which <video> on the page is the presentation feed, if any.
const findPresentationVideo = () => {
  const videos = Array.from(document.querySelectorAll("video")).filter(
    isVisible,
  )
  if (videos.length === 0) return null
  return findLabelledPresentationVideo(videos) ?? findLargestVideo(videos)
}

// Walk up from the <video> to the tile container Meet lays out in its grid,
// stopping as soon as an ancestor's box is meaningfully bigger than the
// video's own box — that jump means we've stepped out of the tile and into
// the surrounding grid/stage, which must stay visible (it holds every tile).
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
      color: #fff;
      font: 500 14px/1.4 system-ui, sans-serif;
      text-align: center;
      z-index: 2147483647;
      pointer-events: none;
    }

    #${TOGGLE_BUTTON_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      padding: 8px 14px;
      border: none;
      border-radius: 999px;
      background: #2b44c2;
      color: #fff;
      font: 600 13px/1 system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    }

    #${TOGGLE_BUTTON_ID}:hover {
      background: #4a6cf7;
    }

    #${TOGGLE_BUTTON_ID}[aria-pressed="true"] {
      background: #4a6cf7;
    }
  `
  document.head.appendChild(style)
}

let hiddenContainer = null
let placeholderEl = null
let toggleButtonEl = null
let userSuppressedAutoHide = false

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

// Both manual triggers (button, shortcut) and auto-hide funnel through here.
// A manual toggle always wins: showing a tile the user explicitly asked to
// see stays shown until the current presentation ends, even if auto-hide
// would otherwise want to re-hide it.
const toggleHidden = ({ manual = false } = {}) => {
  if (hiddenContainer) {
    showPresentationTile()
    if (manual) userSuppressedAutoHide = true
  } else {
    hidePresentationTile()
    if (manual) userSuppressedAutoHide = false
  }
}

const createToggleButton = () => {
  const button = document.createElement("button")
  button.id = TOGGLE_BUTTON_ID
  button.type = "button"
  button.title = "Hide/show the presentation tile (Alt+Shift+H)"
  button.addEventListener("click", () => toggleHidden({ manual: true }))
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
    toggleHidden({ manual: true })
  }
}

// Mode 2 — auto-hide. A MutationObserver is the simple, isolated-world-only
// signal: it can't tell a screen-share apart from "someone's camera just got
// spotlighted large", so it leans on a viewport-ratio threshold to only fire
// when a tile is dominating the page (as a full presentation would). The
// more reliable signal is hooking `navigator.mediaDevices.getDisplayMedia` in
// the page's MAIN world (fires exactly when a share starts/stops) — adopt
// that (via a `world: "MAIN"` content script) if this proves too eager or
// too shy once tested against real calls.
const looksLikePresentationActive = () => {
  const video = findPresentationVideo()
  if (!video) return false
  const viewportArea = window.innerWidth * window.innerHeight
  return videoArea(video) >= viewportArea * AUTO_HIDE_MIN_VIEWPORT_RATIO
}

const maybeAutoHide = () => {
  if (!looksLikePresentationActive()) {
    userSuppressedAutoHide = false
    return
  }
  if (userSuppressedAutoHide) return
  hidePresentationTile()
}

const observeDomChanges = () => {
  const observer = new MutationObserver(
    debounce(maybeAutoHide, MUTATION_DEBOUNCE_MS),
  )
  observer.observe(document.body, { childList: true, subtree: true })
}

const init = () => {
  injectStyles()
  toggleButtonEl = createToggleButton()
  updateToggleButton()
  document.addEventListener("keydown", handleKeydown)
  observeDomChanges()
}

init()
