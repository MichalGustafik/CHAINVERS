'use strict';

const CLIENT_PLUGIN = "(() => {\n  'use strict';\n\n  if (window.__CHAINVERS_GLOBAL_PLUGIN_V2__) return;\n  window.__CHAINVERS_GLOBAL_PLUGIN_V2__ = true;\n\n  const cfg = Object.assign({\n    sourceLanguage: 'sk',\n    defaultCurrency: 'EUR',\n    translate: true,\n    convertCurrency: true,\n    debug: false,\n    pluginApi: 'https://chainvers.vercel.app/api/plugin',\n    minimumTextLength: 2,\n    protectedTerms: [],\n    userContentSelectors: []\n  }, window.CHAINVERS_PLUGIN_CONFIG || {});\n\n  const log = (...args) => cfg.debug && console.log('[CHAINVERS plugin]', ...args);\n\n  function normalizeLanguage(value) {\n    let code = String(value || '').trim().toLowerCase().replace('_', '-').split('-')[0];\n    if (code === 'cz') code = 'cs';\n    if (code === 'ua') code = 'uk';\n    return /^[a-z]{2,3}$/.test(code) ? code : '';\n  }\n\n  function getDeviceLanguage() {\n    const candidates = [\n      ...(Array.isArray(navigator.languages) ? navigator.languages : []),\n      navigator.language,\n      navigator.userLanguage,\n      document.documentElement.lang\n    ];\n\n    for (const candidate of candidates) {\n      const language = normalizeLanguage(candidate);\n      if (language) return language;\n    }\n\n    return normalizeLanguage(cfg.sourceLanguage) || 'sk';\n  }\n\n  const sourceLanguage = normalizeLanguage(cfg.sourceLanguage) || 'sk';\n  const targetLanguage = getDeviceLanguage();\n\n  document.documentElement.lang = targetLanguage;\n  document.documentElement.dir = ['ar', 'fa', 'he', 'ur'].includes(targetLanguage) ? 'rtl' : 'ltr';\n\n  const noTranslateSelector = [\n    'script','style','noscript','template','svg','canvas','code','pre','textarea',\n    'input[type=\"password\"]','input[type=\"email\"]','input[type=\"tel\"]',\n    '[data-no-translate]','[translate=\"no\"]','.notranslate',\n    ...(Array.isArray(cfg.userContentSelectors) ? cfg.userContentSelectors : [])\n  ].filter(Boolean).join(',');\n\n  const protectedTerms = Array.isArray(cfg.protectedTerms) ? cfg.protectedTerms : [];\n  const translatedTextCache = new Map();\n  const translatedAttributeCache = new Map();\n  const processingNodes = new WeakSet();\n  let observer = null;\n  let exchangeRates = null;\n  let exchangePromise = null;\n  let mutationTimer = null;\n\n  function isExcluded(node) {\n    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;\n    if (!el) return true;\n    try { return Boolean(el.closest(noTranslateSelector)); }\n    catch (_) { return false; }\n  }\n\n  function hasProtectedTerm(text) {\n    const lower = String(text || '').toLowerCase();\n    return protectedTerms.some(term => term && lower.includes(String(term).toLowerCase()));\n  }\n\n  function isTranslatable(text) {\n    const value = String(text || '').trim();\n    if (value.length < Number(cfg.minimumTextLength || 2)) return false;\n    if (!/[\\p{L}]/u.test(value)) return false;\n    if (/^(https?:\\/\\/|www\\.|0x[a-f0-9]{8,}|[\\w.+-]+@[\\w.-]+\\.[a-z]{2,})/i.test(value)) return false;\n    if (hasProtectedTerm(value) && value.split(/\\s+/).length <= 2) return false;\n    return true;\n  }\n\n  async function apiRequest(params) {\n    const url = new URL(cfg.pluginApi);\n    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));\n\n    const response = await fetch(url.toString(), {\n      mode: 'cors',\n      credentials: 'omit',\n      cache: 'force-cache'\n    });\n\n    if (!response.ok) throw new Error(`HTTP ${response.status}`);\n    return response.json();\n  }\n\n  async function translateText(text) {\n    const value = String(text || '').trim();\n    const key = `${sourceLanguage}>${targetLanguage}:${value}`;\n\n    if (translatedTextCache.has(key)) return translatedTextCache.get(key);\n\n    try {\n      const data = await apiRequest({\n        mode: 'translate',\n        q: value,\n        source: sourceLanguage,\n        target: targetLanguage\n      });\n\n      const translated = String(data?.translatedText || '').trim() || value;\n      translatedTextCache.set(key, translated);\n      return translated;\n    } catch (error) {\n      log('Translation failed', error);\n      translatedTextCache.set(key, value);\n      return value;\n    }\n  }\n\n  async function translateTextNode(node) {\n    if (!node || node.nodeType !== Node.TEXT_NODE || isExcluded(node)) return;\n\n    const raw = node.nodeValue || '';\n    const trimmed = raw.trim();\n    if (!isTranslatable(trimmed)) return;\n\n    processingNodes.add(node);\n\n    const leading = raw.match(/^\\s*/)?.[0] || '';\n    const trailing = raw.match(/\\s*$/)?.[0] || '';\n    const translated = await translateText(trimmed);\n\n    if (document.contains(node) && translated && node.nodeValue === raw) {\n      node.nodeValue = leading + translated + trailing;\n    }\n\n    queueMicrotask(() => processingNodes.delete(node));\n  }\n\n  async function translateAttributes(element) {\n    if (!element || element.nodeType !== Node.ELEMENT_NODE || isExcluded(element)) return;\n\n    const attributes = ['placeholder', 'title', 'aria-label'];\n    if (element.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(element.type)) {\n      attributes.push('value');\n    }\n\n    for (const attr of attributes) {\n      if (!element.hasAttribute(attr)) continue;\n\n      const original = element.getAttribute(attr) || '';\n      if (!isTranslatable(original)) continue;\n\n      const key = `${attr}:${sourceLanguage}>${targetLanguage}:${original}`;\n      let translated = translatedAttributeCache.get(key);\n\n      if (!translated) {\n        translated = await translateText(original);\n        translatedAttributeCache.set(key, translated);\n      }\n\n      if (translated && element.getAttribute(attr) === original) {\n        element.setAttribute(attr, translated);\n      }\n    }\n  }\n\n  function collectTextNodes(root) {\n    const nodes = [];\n    if (!root || isExcluded(root)) return nodes;\n\n    if (root.nodeType === Node.TEXT_NODE) {\n      if (isTranslatable(root.nodeValue)) nodes.push(root);\n      return nodes;\n    }\n\n    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {\n      acceptNode(node) {\n        return !isExcluded(node) && isTranslatable(node.nodeValue)\n          ? NodeFilter.FILTER_ACCEPT\n          : NodeFilter.FILTER_REJECT;\n      }\n    });\n\n    while (walker.nextNode()) nodes.push(walker.currentNode);\n    return nodes;\n  }\n\n  async function translateRoot(root = document.body) {\n    if (!cfg.translate || targetLanguage === sourceLanguage || !root) return;\n\n    const textNodes = collectTextNodes(root).slice(0, 400);\n    for (const node of textNodes) await translateTextNode(node);\n\n    const elements = root.nodeType === Node.ELEMENT_NODE\n      ? [root, ...root.querySelectorAll('*')]\n      : [];\n\n    for (const element of elements.slice(0, 700)) {\n      await translateAttributes(element);\n    }\n  }\n\n  function deviceCurrency() {\n    const locale = String(\n      (Array.isArray(navigator.languages) && navigator.languages[0]) ||\n      navigator.language ||\n      ''\n    );\n\n    const region = locale.replace('_', '-').split('-')[1]?.toUpperCase() || '';\n\n    const byRegion = {\n      US:'USD', GB:'GBP', CZ:'CZK', PL:'PLN', HU:'HUF', CH:'CHF',\n      SE:'SEK', NO:'NOK', DK:'DKK', RO:'RON', BG:'BGN'\n    };\n\n    return byRegion[region] || cfg.defaultCurrency || 'EUR';\n  }\n\n  async function getRates() {\n    if (exchangeRates) return exchangeRates;\n    if (exchangePromise) return exchangePromise;\n\n    exchangePromise = apiRequest({ mode: 'rates', base: 'EUR' })\n      .then(data => {\n        exchangeRates = Object.assign({ EUR: 1 }, data?.rates || {});\n        return exchangeRates;\n      })\n      .catch(error => {\n        log('Exchange rate failed', error);\n        return null;\n      })\n      .finally(() => { exchangePromise = null; });\n\n    return exchangePromise;\n  }\n\n  function parseNumber(value) {\n    let normalized = String(value).replace(/\\s/g, '');\n    const lastComma = normalized.lastIndexOf(',');\n    const lastDot = normalized.lastIndexOf('.');\n\n    if (lastComma > lastDot) {\n      normalized = normalized.replace(/\\./g, '').replace(',', '.');\n    } else {\n      normalized = normalized.replace(/,/g, '');\n    }\n\n    return Number(normalized);\n  }\n\n  async function convertCurrencyNode(node, target) {\n    if (!node || node.nodeType !== Node.TEXT_NODE || isExcluded(node)) return;\n\n    const raw = node.nodeValue || '';\n    const regex = /(?:([€$£])\\s*([0-9][0-9\\s.,]*))|(?:([0-9][0-9\\s.,]*)\\s*(EUR|USD|GBP|CZK|Kč|PLN|HUF|CHF|SEK|NOK|DKK|RON|BGN)\\b)/gi;\n\n    if (!regex.test(raw)) return;\n    regex.lastIndex = 0;\n\n    const rates = await getRates();\n    if (!rates || !rates[target]) return;\n\n    const currencyMap = {\n      '€':'EUR','$':'USD','£':'GBP','KČ':'CZK','CZK':'CZK','EUR':'EUR',\n      'USD':'USD','GBP':'GBP','PLN':'PLN','HUF':'HUF','CHF':'CHF',\n      'SEK':'SEK','NOK':'NOK','DKK':'DKK','RON':'RON','BGN':'BGN'\n    };\n\n    const replaced = raw.replace(regex, (full, symbol, n1, n2, code) => {\n      const source = currencyMap[String(symbol || code || '').toUpperCase()];\n      const amount = parseNumber(n1 || n2);\n\n      if (!source || !Number.isFinite(amount) || !rates[source] || source === target) return full;\n\n      const converted = (amount / rates[source]) * rates[target];\n\n      try {\n        return new Intl.NumberFormat(\n          (Array.isArray(navigator.languages) && navigator.languages[0]) || navigator.language || 'sk-SK',\n          { style: 'currency', currency: target, maximumFractionDigits: 2 }\n        ).format(converted);\n      } catch (_) {\n        return `${converted.toFixed(2)} ${target}`;\n      }\n    });\n\n    if (replaced !== raw) node.nodeValue = replaced;\n  }\n\n  async function convertRoot(root = document.body) {\n    if (!cfg.convertCurrency || !root) return;\n\n    const target = deviceCurrency();\n    const nodes = collectTextNodes(root).slice(0, 700);\n\n    for (const node of nodes) await convertCurrencyNode(node, target);\n  }\n\n  async function processRoot(root) {\n    await translateRoot(root);\n    await convertRoot(root);\n  }\n\n  function scheduleProcess(root) {\n    clearTimeout(mutationTimer);\n    mutationTimer = setTimeout(() => processRoot(root || document.body), 120);\n  }\n\n  function startObserver() {\n    if (!document.body || observer) return;\n\n    observer = new MutationObserver(mutations => {\n      let root = null;\n\n      for (const mutation of mutations) {\n        if (mutation.type === 'characterData' && processingNodes.has(mutation.target)) continue;\n\n        if (mutation.type === 'characterData') {\n          root = mutation.target.parentElement || root;\n        }\n\n        for (const node of mutation.addedNodes) {\n          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {\n            root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;\n          }\n        }\n      }\n\n      if (root) scheduleProcess(root);\n    });\n\n    observer.observe(document.body, {\n      subtree: true,\n      childList: true,\n      characterData: true\n    });\n  }\n\n  async function init() {\n    try {\n      await processRoot(document.body);\n      startObserver();\n\n      document.documentElement.dataset.chainversPlugin = 'ready';\n      document.documentElement.dataset.chainversLanguage = targetLanguage;\n\n      window.dispatchEvent(new CustomEvent('chainvers:plugin-ready', {\n        detail: {\n          language: targetLanguage,\n          sourceLanguage,\n          currency: deviceCurrency()\n        }\n      }));\n\n      log('Ready', { sourceLanguage, targetLanguage, currency: deviceCurrency() });\n    } catch (error) {\n      log('Initialization failed', error);\n    }\n  }\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', init, { once: true });\n  } else {\n    init();\n  }\n})();";

function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = async function handler(req, res) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const mode = String(req.query?.mode || '');

  if (mode === 'translate') {
    const q = String(req.query?.q || '').trim();
    const source = String(req.query?.source || 'sk').trim().toLowerCase();
    const target = String(req.query?.target || '').trim().toLowerCase();

    if (!q || !target || q.length > 800) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request'
      });
    }

    if (source === target) {
      return res.status(200).json({
        ok: true,
        translatedText: q
      });
    }

    try {
      const url = new URL(
        'https://api.mymemory.translated.net/get'
      );

      url.searchParams.set('q', q);
      url.searchParams.set(
        'langpair',
        `${source}|${target}`
      );

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CHAINVERS/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const data = await response.json();

      const translatedText = String(
        data?.responseData?.translatedText || ''
      ).trim();

      res.setHeader(
        'Cache-Control',
        'public, max-age=3600, s-maxage=86400'
      );

      return res.status(200).json({
        ok: true,
        translatedText:
          translatedText &&
          !/MYMEMORY WARNING/i.test(translatedText)
            ? translatedText
            : q
      });

    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'translation_failed'
      });
    }
  }

  if (mode === 'rates') {
    try {
      const response = await fetch(
        'https://api.frankfurter.dev/v1/latest?base=EUR'
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const data = await response.json();

      res.setHeader(
        'Cache-Control',
        'public, max-age=900, s-maxage=21600'
      );

      return res.status(200).json({
        ok: true,
        base: 'EUR',
        rates: data?.rates || {}
      });

    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'rates_failed'
      });
    }
  }

  res.setHeader(
    'Content-Type',
    'application/javascript; charset=utf-8'
  );

  res.setHeader(
    'Cache-Control',
    'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
  );

  return res.status(200).send(
    CLIENT_PLUGIN
  );
};