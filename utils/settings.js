import { defineSettings } from "@kud/webext"

/**
 * The one declaration of what Gmeet Unmirror persists.
 *
 * Imported by both the popup and the content script, so the default lives in a
 * single place.
 */
export const settings = defineSettings({ auto: true }, { area: "local" })
