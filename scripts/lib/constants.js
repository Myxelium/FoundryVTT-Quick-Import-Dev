/**
 * Shared identifiers for the Quick Battlemap Importer.
 */

/** Foundry module id. Must match module.json. */
export const MODULE_ID = "quick-battlemap-importer";

/** Prefix used for console messages. */
export const MODULE_LOG_PREFIX = "Quick Battlemap Importer";

/** First scene level created by Foundry V14. Reusing it avoids a duplicate empty level. */
export const DEFAULT_LEVEL_ID = "defaultLevel0000";

/** Vertical size, in grid units, of each imported Universal VTT level. */
export const LEVEL_ELEVATION_STEP = 10;

/** localStorage key for the quick-import "no grid" preference. */
export const NO_GRID_STORAGE_KEY = "quick-battlemap:no-grid";
