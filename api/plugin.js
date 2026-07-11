'use strict';

const CLIENT_PLUGIN = `(() => {
    'use strict';

    if (window.__CHAINVERS_GLOBAL_PLUGIN__) return;
    window.__CHAINVERS_GLOBAL_PLUGIN__ = true;

    const cfg = Object.assign({
        sourceLanguage: 'sk',
        defaultCurrency: 'EUR',
        translate: true,
        convertCurrency: true,
        debug: false,
        translationApi: 'https://api.mymemory.translated.net/get',
        exchangeApi: 'https://api.frankfurter.dev/v1/latest',
        minimumTextLength: 2,
        protectedTerms: [],
        userContentSelectors: []
    }, window.CHAINVERS_PLUGIN_CONFIG || {});

    const log = (...args) =>
        cfg.debug && console.log('[CHAINVERS plugin]', ...args);

    const targetLanguage = String(
        navigator.language ||
        navigator.userLanguage ||
        cfg.sourceLanguage
    ).toLowerCase().split('-')[0];

    const sourceLanguage = String(
        cfg.sourceLanguage || 'sk'
    ).toLowerCase().split('-')[0];

    const noTranslateSelector = [
        'script',
        'style',
        'noscript',
        'template',
        'svg',
        'canvas',
        'code',
        'pre',
        'textarea',
        'input',
        'select',
        'option',
        '[data-no-translate]',
        '[translate="no"]',
        '.notranslate',
        ...(Array.isArray(cfg.userContentSelectors)
            ? cfg.userContentSelectors
            : [])
    ].filter(Boolean).join(',');

    const protectedTerms = Array.isArray(cfg.protectedTerms)
        ? cfg.protectedTerms
        : [];

    const originalText = new WeakMap();
    const translatedCache = new Map();
    const pending = new Map();

    let observer = null;
    let exchangeRates = null;
    let exchangePromise = null;

    function isExcluded(node) {
        const element = node.nodeType === Node.ELEMENT_NODE
            ? node
            : node.parentElement;

        if (!element) {
            return true;
        }

        try {
            return Boolean(element.closest(noTranslateSelector));
        } catch (_) {
            return false;
        }
    }

    function hasProtectedTerm(text) {
        return protectedTerms.some(term =>
            term &&
            text.toLowerCase().includes(
                String(term).toLowerCase()
            )
        );
    }

    function isTranslatable(text) {
        const value = String(text || '').trim();

        if (
            value.length <
            Number(cfg.minimumTextLength || 2)
        ) {
            return false;
        }

        if (!/[\p{L}]/u.test(value)) {
            return false;
        }

        if (
            /^(https?:\/\/|www\.|0x[a-f0-9]{8,}|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i
                .test(value)
        ) {
            return false;
        }

        if (
            hasProtectedTerm(value) &&
            value.split(/\s+/).length <= 2
        ) {
            return false;
        }

        return true;
    }

    async function translateText(text) {
        const key =
            `${sourceLanguage}>${targetLanguage}:${text}`;

        if (translatedCache.has(key)) {
            return translatedCache.get(key);
        }

        if (pending.has(key)) {
            return pending.get(key);
        }

        const request = (async () => {
            try {
                const url =
                    new URL(cfg.translationApi);

                url.searchParams.set('q', text);

                url.searchParams.set(
                    'langpair',
                    `${sourceLanguage}|${targetLanguage}`
                );

                const response = await fetch(
                    url.toString(),
                    {
                        cache: 'force-cache'
                    }
                );

                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status}`
                    );
                }

                const data =
                    await response.json();

                const result = String(
                    data?.responseData?.translatedText || ''
                ).trim();

                const finalText =
                    result &&
                    !/MYMEMORY WARNING/i.test(result)
                        ? result
                        : text;

                translatedCache.set(
                    key,
                    finalText
                );

                return finalText;

            } catch (error) {
                log(
                    'Translation failed',
                    error
                );

                translatedCache.set(
                    key,
                    text
                );

                return text;

            } finally {
                pending.delete(key);
            }
        })();

        pending.set(
            key,
            request
        );

        return request;
    }

    async function translateNode(node) {
        if (
            !node ||
            node.nodeType !== Node.TEXT_NODE ||
            isExcluded(node)
        ) {
            return;
        }

        const raw =
            node.nodeValue || '';

        const trimmed =
            raw.trim();

        if (!isTranslatable(trimmed)) {
            return;
        }

        if (!originalText.has(node)) {
            originalText.set(
                node,
                raw
            );
        }

        const leading =
            raw.match(/^\s*/)?.[0] || '';

        const trailing =
            raw.match(/\s*$/)?.[0] || '';

        const translated =
            await translateText(trimmed);

        if (
            document.contains(node) &&
            translated
        ) {
            node.nodeValue =
                leading +
                translated +
                trailing;
        }
    }

    function collectTextNodes(root) {
        const nodes = [];

        if (
            !root ||
            isExcluded(root)
        ) {
            return nodes;
        }

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        return (
                            !isExcluded(node) &&
                            isTranslatable(node.nodeValue)
                        )
                            ? NodeFilter.FILTER_ACCEPT
                            : NodeFilter.FILTER_REJECT;
                    }
                }
            );

        while (walker.nextNode()) {
            nodes.push(
                walker.currentNode
            );
        }

        return nodes;
    }

    async function translateRoot(
        root = document.body
    ) {
        if (
            !cfg.translate ||
            targetLanguage === sourceLanguage ||
            !root
        ) {
            return;
        }

        const nodes =
            collectTextNodes(root).slice(0, 250);

        for (const node of nodes) {
            await translateNode(node);
        }
    }

    const currencyMap = {
        '€': 'EUR',
        '$': 'USD',
        '£': 'GBP',
        'KČ': 'CZK',
        'CZK': 'CZK',
        'EUR': 'EUR',
        'USD': 'USD',
        'GBP': 'GBP',
        'PLN': 'PLN',
        'HUF': 'HUF',
        'CHF': 'CHF',
        'SEK': 'SEK',
        'NOK': 'NOK',
        'DKK': 'DKK'
    };

    function deviceCurrency() {
        const region = String(
            navigator.language || ''
        ).split('-')[1]?.toUpperCase() || '';

        return ({
            US: 'USD',
            GB: 'GBP',
            CZ: 'CZK',
            PL: 'PLN',
            HU: 'HUF',
            CH: 'CHF',
            SE: 'SEK',
            NO: 'NOK',
            DK: 'DKK'
        })[region] ||
            cfg.defaultCurrency ||
            'EUR';
    }

    async function getRates() {
        if (exchangeRates) {
            return exchangeRates;
        }

        if (exchangePromise) {
            return exchangePromise;
        }

        exchangePromise = fetch(
            `${cfg.exchangeApi}?base=EUR`,
            {
                cache: 'force-cache'
            }
        )
            .then(response => {
                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status}`
                    );
                }

                return response.json();
            })
            .then(data => {
                exchangeRates = Object.assign(
                    {
                        EUR: 1
                    },
                    data.rates || {}
                );

                return exchangeRates;
            })
            .catch(error => {
                log(
                    'Exchange rate failed',
                    error
                );

                return null;
            })
            .finally(() => {
                exchangePromise = null;
            });

        return exchangePromise;
    }

    function parseNumber(value) {
        let normalized =
            String(value).replace(/\s/g, '');

        const lastComma =
            normalized.lastIndexOf(',');

        const lastDot =
            normalized.lastIndexOf('.');

        if (lastComma > lastDot) {
            normalized = normalized
                .replace(/\./g, '')
                .replace(',', '.');
        } else {
            normalized = normalized
                .replace(/,/g, '');
        }

        return Number(normalized);
    }

    async function convertCurrencyNode(
        node,
        target
    ) {
        if (
            !node ||
            node.nodeType !== Node.TEXT_NODE ||
            isExcluded(node)
        ) {
            return;
        }

        const raw =
            node.nodeValue || '';

        const regex =
            /(?:([€$£])\s*([0-9][0-9\s.,]*))|(?:([0-9][0-9\s.,]*)\s*(EUR|USD|GBP|CZK|Kč|PLN|HUF|CHF|SEK|NOK|DKK)\b)/gi;

        if (!regex.test(raw)) {
            return;
        }

        regex.lastIndex = 0;

        const rates =
            await getRates();

        if (
            !rates ||
            !rates[target]
        ) {
            return;
        }

        const replaced =
            raw.replace(
                regex,
                (
                    full,
                    symbol,
                    numberOne,
                    numberTwo,
                    code
                ) => {
                    const source = currencyMap[
                        String(
                            symbol ||
                            code ||
                            ''
                        ).toUpperCase()
                    ];

                    const amount =
                        parseNumber(
                            numberOne ||
                            numberTwo
                        );

                    if (
                        !source ||
                        !Number.isFinite(amount) ||
                        !rates[source]
                    ) {
                        return full;
                    }

                    if (source === target) {
                        return full;
                    }

                    const eur =
                        amount / rates[source];

                    const converted =
                        eur * rates[target];

                    try {
                        return new Intl.NumberFormat(
                            navigator.language ||
                            'sk-SK',
                            {
                                style: 'currency',
                                currency: target,
                                maximumFractionDigits: 2
                            }
                        ).format(converted);

                    } catch (_) {
                        return `${converted.toFixed(2)} ${target}`;
                    }
                }
            );

        if (replaced !== raw) {
            node.nodeValue =
                replaced;
        }
    }

    async function convertRoot(
        root = document.body
    ) {
        if (
            !cfg.convertCurrency ||
            !root
        ) {
            return;
        }

        const target =
            deviceCurrency();

        if (!target) {
            return;
        }

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT
            );

        const nodes = [];

        while (walker.nextNode()) {
            if (
                !isExcluded(
                    walker.currentNode
                )
            ) {
                nodes.push(
                    walker.currentNode
                );
            }
        }

        for (
            const node of nodes.slice(0, 500)
        ) {
            await convertCurrencyNode(
                node,
                target
            );
        }
    }

    async function processRoot(root) {
        await translateRoot(root);
        await convertRoot(root);
    }

    function startObserver() {
        if (
            !document.body ||
            observer
        ) {
            return;
        }

        observer =
            new MutationObserver(
                mutations => {
                    const roots =
                        new Set();

                    for (
                        const mutation of mutations
                    ) {
                        if (
                            mutation.type ===
                            'characterData'
                        ) {
                            roots.add(
                                mutation.target.parentElement
                            );
                        }

                        for (
                            const node of
                            mutation.addedNodes
                        ) {
                            if (
                                node.nodeType ===
                                Node.ELEMENT_NODE
                            ) {
                                roots.add(node);
                            }
                        }
                    }

                    roots.forEach(root => {
                        if (root) {
                            processRoot(root);
                        }
                    });
                }
            );

        observer.observe(
            document.body,
            {
                subtree: true,
                childList: true,
                characterData: true
            }
        );
    }

    async function init() {
        try {
            await processRoot(
                document.body
            );

            startObserver();

            document.documentElement.dataset
                .chainversPlugin = 'ready';

            window.dispatchEvent(
                new CustomEvent(
                    'chainvers:plugin-ready',
                    {
                        detail: {
                            language:
                                targetLanguage,
                            currency:
                                deviceCurrency()
                        }
                    }
                )
            );

            log('Ready');

        } catch (error) {
            log(
                'Initialization failed',
                error
            );
        }
    }

    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            init,
            {
                once: true
            }
        );
    } else {
        init();
    }
})();`;

module.exports = function handler(req, res) {
    res.setHeader(
        'Content-Type',
        'application/javascript; charset=utf-8'
    );

    res.setHeader(
        'Cache-Control',
        'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
    );

    res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
    );

    res.status(200).send(
        CLIENT_PLUGIN
    );
};