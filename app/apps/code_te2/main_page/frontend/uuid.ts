// Reuse the pinned Monaco implementation: secure random bytes also work on
// ordinary HTTP origins where crypto.randomUUID is unavailable.
export { generateUuid } from '../../../../static/vendor/monaco-editor-core/esm/vs/base/common/uuid.js';
