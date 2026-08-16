/**
 * The one declaration of what Gmeet Unmirror persists.
 *
 * Loaded as a classic script by both the popup and the content script, which
 * cannot share an ES module — a manifest content script is not a module, so an
 * `import` is a syntax error there. Declaring the schema in a plain script that
 * both contexts load is what keeps the default in a single place.
 */
const settings = webext.defineSettings({ auto: true }, { area: "local" })
