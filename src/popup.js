// gmeet-unmirror — popup. The single control surface: an "automatic" toggle
// (persisted in storage; the content script reacts to it live) and a manual
// show/hide button that messages the active Meet tab's content script.

const dotEl = document.getElementById("dot")
const statusEl = document.getElementById("status")
const autoEl = document.getElementById("auto")
const toggleEl = document.getElementById("toggle")

// Ask the content script for the live state. No receiver resolves undefined,
// which render() already treats as "no Meet tab" — and that covers both cases
// the old URL check and try/catch covered separately: a non-Meet tab has no
// content script, and neither does a Meet tab that hasn't finished loading.
const fetchState = (message = { type: "getState" }) =>
  webext.sendToActiveTab(message)

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
  await settings.set({ auto: autoEl.checked })
  render(await fetchState())
})

toggleEl.addEventListener("click", async () => {
  render(await fetchState({ type: "toggle" }))
})

const load = async () => {
  autoEl.checked = (await settings.get()).auto
  render(await fetchState())
}

load()
