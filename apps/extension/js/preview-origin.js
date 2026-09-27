/* Captured Origin and Referer belong only to an open, trusted source-preview session. */
(function(root) {
  'use strict';
  const FIRST_RULE_ID = 2400000;
  const MAX_CONTEXTS = 16;
  const SESSION_TIMEOUT_MS = 30000;
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function httpOrigin(value, exact = false) {
    if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return null;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
      return !exact || value === url.origin ? url.origin : null;
    } catch { return null; }
  }

  function httpReferer(value) {
    if (typeof value !== 'string' || value.length > 8192 || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) return null;
      return value;
    } catch { return null; }
  }

  function registerPreviewOriginSessions({ readPage, trustedPage }) {
    if (!chrome.runtime.onConnect || !chrome.declarativeNetRequest) return;
    const contexts = new Map();
    const dnr = chrome.declarativeNetRequest;
    let startupError = false;
    // Session rules outlive an idle worker. Remove only this helper's reserved
    // IDs before accepting new previews after a worker restart.
    let mutations = (async () => {
      const rules = await dnr.getSessionRules();
      const removeRuleIds = rules.filter(rule => rule.id >= FIRST_RULE_ID && rule.id < FIRST_RULE_ID + MAX_CONTEXTS).map(rule => rule.id);
      if (removeRuleIds.length) await dnr.updateSessionRules({ removeRuleIds });
    })().catch(() => { startupError = true; });
    function serialize(task) {
      const result = mutations.then(task);
      mutations = result.catch(() => {});
      return result;
    }
    async function release(session) {
      const context = session.context;
      session.context = null;
      if (!context) return;
      context.sessions.delete(session);
      if (context.sessions.size) return;
      await dnr.updateSessionRules({ removeRuleIds: [context.ruleId] });
      contexts.delete(context.key);
    }

    chrome.runtime.onConnect.addListener(port => {
      if (port.name !== 'snagthis-source-preview') return;
      if (!trustedPage(port.sender || {})) { port.disconnect(); return; }
      const session = { closed: false, started: false, context: null, timer: null };
      function close() {
        if (session.closed) return;
        session.closed = true;
        clearTimeout(session.timer);
        port.onMessage.removeListener(onMessage);
        port.onDisconnect.removeListener(close);
        // Serialized after registration, including a disconnect while Chrome
        // is still adding the rule. No late registration can strand a rule.
        void serialize(() => release(session)).catch(() => {});
        try { port.disconnect(); } catch { /* Already disconnected. */ }
      }
      function keepalive() {
        clearTimeout(session.timer);
        session.timer = setTimeout(close, SESSION_TIMEOUT_MS);
      }
      function respond(ok, error) {
        if (session.closed) return;
        try { port.postMessage({ cmd: 'ready', ok, ...(error ? { error } : {}) }); }
        catch { close(); }
      }
      async function start(message) {
        if (session.closed) return;
        if (startupError) throw new Error('Preview request context is unavailable.');
        if (!Number.isInteger(message.tabId) || message.tabId < 0 || typeof message.mediaId !== 'string' || !message.mediaId || message.mediaId.length > 256) {
          throw new Error('Invalid preview source.');
        }
        const page = await readPage(message.tabId);
        if (session.closed) return;
        const item = page?.items?.find(value => value.id === message.mediaId);
        if (!item) throw new Error('The preview source is no longer available.');
        // Only context Chrome captured for a response it delivered to this tab
        // is restored; a page-reported URL never gains Origin or Referer.
        const headers = item.networkObserved === true ? Object.entries(item.requestHeaders || {}) : [];
        const origins = headers.filter(([name]) => name.toLowerCase() === 'origin').map(([, value]) => value);
        const referers = headers.filter(([name]) => name.toLowerCase() === 'referer').map(([, value]) => value);
        if (!origins.length && !referers.length) { respond(true); return; }
        const capturedOrigin = origins.length ? httpOrigin(origins[0], true) : null;
        const capturedReferer = referers.length ? httpReferer(referers[0]) : null;
        const mediaOrigin = httpOrigin(item.requestHeadersOrigin || item.url);
        if (!mediaOrigin
          || (origins.length && (!capturedOrigin || origins.some(value => value !== origins[0])))
          || (referers.length && (!capturedReferer || referers.some(value => value !== referers[0])))) {
          throw new Error('Invalid captured preview context.');
        }
        const requestTabId = Number.isInteger(port.sender?.tab?.id) ? port.sender.tab.id : -1;
        const key = `${requestTabId}:${mediaOrigin}`;
        let context = contexts.get(key);
        if (context && (context.capturedOrigin !== capturedOrigin || context.capturedReferer !== capturedReferer)) {
          throw new Error('Another preview is using a different request context for this host.');
        }
        if (!context) {
          if (contexts.size >= MAX_CONTEXTS) throw new Error('Too many previews are open.');
          const usedIds = new Set([...contexts.values()].map(value => value.ruleId));
          let ruleId = FIRST_RULE_ID;
          while (usedIds.has(ruleId)) ruleId++;
          // Restore only headers observed for this media's own origin. A
          // playlist's segments on another origin never inherit this context.
          const requestHeaders = [];
          if (capturedOrigin) requestHeaders.push({ header: 'Origin', operation: 'set', value: capturedOrigin });
          if (capturedReferer) requestHeaders.push({ header: 'Referer', operation: 'set', value: capturedReferer });
          await dnr.updateSessionRules({ addRules: [{
            id: ruleId,
            priority: 1,
            action: { type: 'modifyHeaders', requestHeaders },
            condition: {
              regexFilter: `^${escapeRegex(mediaOrigin)}(?:/|$)`,
              isUrlFilterCaseSensitive: true,
              initiatorDomains: [chrome.runtime.id],
              requestMethods: ['get'],
              resourceTypes: ['xmlhttprequest'],
              tabIds: [requestTabId],
            },
          }] });
          context = { key, ruleId, capturedOrigin, capturedReferer, sessions: new Set() };
          contexts.set(key, context);
        }
        context.sessions.add(session);
        session.context = context;
        respond(true);
      }
      function onMessage(message) {
        if (session.closed || !message || typeof message !== 'object') return;
        if (message.cmd === 'keepalive') { keepalive(); return; }
        if (message.cmd !== 'start' || session.started) return;
        session.started = true;
        keepalive();
        void serialize(() => start(message)).catch(error => {
          respond(false, error.message);
          close();
        });
      }
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(close);
      keepalive();
    });
  }

  root.registerPreviewOriginSessions = registerPreviewOriginSessions;
  if (typeof module === 'object' && module.exports) module.exports = { registerPreviewOriginSessions };
})(typeof globalThis !== 'undefined' ? globalThis : this);
