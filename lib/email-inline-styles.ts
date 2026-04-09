import juice from "juice";

/**
 * Converts all <style> block CSS rules into inline style="" attributes.
 * This ensures email clients that strip <style> blocks (e.g. Gmail) still
 * render the correct styling for buttons, links, fonts, etc.
 *
 * Should be called AFTER renderTemplate() and injectPreheader(), but BEFORE
 * per-subscriber merge tags so that {{variables}} in href/src are not mangled.
 */
export function inlineStyles(html: string): string {
    return juice(html, {
        // Keep <style> blocks as well — some clients (Apple Mail) use them
        removeStyleTags: false,
        // Preserve !important declarations
        preserveImportant: true,
    });
}
