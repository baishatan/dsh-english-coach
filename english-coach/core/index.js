/**
 * The plugin's one seam. Everything except the platform wiring lives here:
 * four agent tools, every panel read/write, and the scheduled job's writes all
 * call `execute(root, command, payload)`.
 */
export { execute, COMMANDS, expireStaleDrafts, DEFAULTS } from './commands.js'
export { ANCHOR_POOL, ANCHOR_HASH, anchorStore, hashAnchors } from './anchors.js'
export { BANDS, BAND_REFERENCES, BOX_DAYS, CHECKUP_DAYS } from './constants.js'
export { advance, countMastered, dueItems, isDue } from './review.js'
export { scoreAssessment, estimateOf, bandOf, referenceOf } from './scoring.js'
export { shuffleWords } from './lesson.js'
