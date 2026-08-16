// gmeet-unmirror — popup. The single control surface: an "automatic" toggle
// (persisted in storage; the content script reacts to it live) and a manual
// show/hide button that messages the active Meet tab's content script.

const STORAGE_KEY = "auto"

const dotEl = document.getElementById("dot")
const statusEl = document.getElementById("status")
const autoEl = document.getElementById("auto")
const toggleEl = document.getElementById("toggle")

const activeMeetTab = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab?.url?.includes("meet.google.com") ? tab : null
}

// Ask the content script for the live state, tolerating a tab where it isn't
// running (non-Meet tab, or Meet not finished loading).
const fetchState = async (tab, message = { type: "getState" }) => {
  if (!tab) return null
  try {
    return await browser.tabs.sendMessage(tab.id, message)
  } catch {
    return null
  }
}

const render = (state) => {
  if (!state) {
    dotEl.dataset.tone = "idle"
    statusEl.textContent = "Open a Google Meet tab to use this."
    toggleEl.disabled = true
    toggleEl.textContent = "Show / hide presentation"
    return
  }

  autoEl.checked = state.auto

  if (!state.presenting) {
    dotEl.dataset.tone = "idle"
    statusEl.textContent = "Not presenting"
    toggleEl.disabled = true
    toggleEl.textContent = "Show / hide presentation"
    return
  }

  // The dot's three states have to differ in shape, not hue — at 10px, three
  // filled dots in three colours are one dot to a colourblind reader. The
  // design system supplies the shapes (thin ring / thick ring / solid) and
  // this maps our domain onto them: solid once the mirror is actually hidden,
  // which is the thing the extension exists to do.
  dotEl.dataset.tone = state.hidden ? "on" : "ready"
  statusEl.textContent = state.hidden
    ? "Presenting — mirror hidden"
    : "Presenting — mirror visible"
  toggleEl.disabled = false
  toggleEl.textContent = state.hidden
    ? "Show presentation"
    : "Hide presentation"
}

autoEl.addEventListener("change", async () => {
  await browser.storage.local.set({ [STORAGE_KEY]: autoEl.checked })
  render(await fetchState(await activeMeetTab()))
})

toggleEl.addEventListener("click", async () => {
  const tab = await activeMeetTab()
  render(await fetchState(tab, { type: "toggle" }))
})

const load = async () => {
  const stored = await browser.storage.local.get(STORAGE_KEY)
  autoEl.checked = stored[STORAGE_KEY] !== false // default on
  render(await fetchState(await activeMeetTab()))
}

load()
