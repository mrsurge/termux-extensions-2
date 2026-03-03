// @ts-check

/**
 * Shared host runtime context used during main.js decomposition.
 * Keep this additive so legacy closure-based code can migrate gradually.
 *
 * @typedef {Object} AppContext
 * @property {HTMLElement} rootEl
 * @property {any} api
 * @property {any} host
 * @property {Record<string, any>} state
 * @property {Record<string, HTMLElement | null>} elements
 * @property {Record<string, any>} services
 */

/**
 * @param {{ rootEl: HTMLElement, api: any, host: any }} params
 * @returns {AppContext}
 */
export function createAppContext({ rootEl, api, host }) {
  return {
    rootEl,
    api,
    host,
    state: {},
    elements: {},
    services: {},
  };
}
