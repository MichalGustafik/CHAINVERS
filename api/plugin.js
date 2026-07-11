'use strict';

/**
 * CHAINVERS global language and currency plugin.
 * Vercel endpoint:
 * https://chainvers.vercel.app/api/plugin
 */

function chainversClientPlugin() {
    'use strict';

    if (window.__CHAINVERS_GLOBAL_PLUGIN_V4__) {
        return;
    }

    window.__CHAINVERS_GLOBAL_PLUGIN_V4__ = true;

    const config = Object.assign(
        {
            sourceLanguage: 'sk',
            defaultCurrency: 'EUR',
            translate: true,
            convertCurrency: true,
            debug: false,
            pluginApi: 'https://chainvers.vercel.app/api/plugin',
            minimumTextLength: 2,
            protectedTerms: [],
            userContentSelectors: []
        },
        window.CHAINVERS_PLUGIN_CONFIG || {}
    );

    const debug = (...args) => {
        if (config.debug) {
            console.log('[CHAINVERS plugin]', ...args);
        }
    };

    function normalizeLanguage(value) {
        let language = String(value || '')
            .trim()
            .toLowerCase()
            .replace('_', '-')
            .split('-')[0];

        if (language === 'cz') {
            language = 'cs';
        }

        if (language === 'ua') {
            language = 'uk';
        }

        return /^[a-z]{2,3}$/.test(language)
            ? language
            : '';
    }

    function getDeviceLanguage() {
        const languages = [
            ...(Array.isArray(navigator.languages)
                ? navigator.languages
                : []),
            navigator.language,
            navigator.userLanguage,
            Intl.DateTimeFormat().resolvedOptions().locale
        ];

        for (const item of languages) {
            const language = normalizeLanguage(item);

            if (language) {
                return language;
            }
        }

        return normalizeLanguage(config.sourceLanguage) || 'sk';
    }

    const sourceLanguage =
        normalizeLanguage(config.sourceLanguage) || 'sk';

    const targetLanguage =
        getDeviceLanguage();

    document.documentElement.lang =
        targetLanguage;

    document.documentElement.dir =
        ['ar', 'fa', 'he', 'ur'].includes(targetLanguage)
            ? 'rtl'
            : 'ltr';

    const excludedSelector = [
        'script',
        'style',
        'noscript',
        'template',
        'svg',
        'canvas',
        'code',
        'pre',
        'textarea',
        'input[type="password"]',
        'input[type="email"]',
        'input[type="tel"]',
        '[data-no-translate]',
        '[translate="no"]',
        '.notranslate',
        ...(Array.isArray(config.userContentSelectors)
            ? config.userContentSelectors
            : [])
    ]
        .filter(Boolean)
        .join(',');

    const protectedTerms =
        Array.isArray(config.protectedTerms)
            ? config.protectedTerms
            : [];

    const translationCache =
        new Map();

    const processingNodes =
        new WeakSet();

    let observer = null;
    let observerTimer = null;
    let exchangeRates = null;
    let exchangePromise = null;

    function isExcluded(node) {
        const element =
            node?.nodeType === Node.ELEMENT_NODE
                ? node
                : node?.parentElement;

        if (!element) {
            return true;
        }

        try {
            return Boolean(
                element.closest(excludedSelector)
            );
        } catch (error) {
            return false;
        }
    }

    function containsProtectedTerm(text) {
        const lowercase =
            String(text || '').toLowerCase();

        return protectedTerms.some(term => {
            const protectedTerm =
                String(term || '').toLowerCase();

            return (
                protectedTerm &&
                lowercase.includes(protectedTerm)
            );
        });
    }

    function canTranslate(text) {
        const value =
            String(text || '').trim();

        if (
            value.length <
            Number(config.minimumTextLength || 2)
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
            containsProtectedTerm(value) &&
            value.split(/\s+/).length <= 2
        ) {
            return false;
        }

        return true;
    }

    async function apiRequest(parameters) {
        const url =
            new URL(config.pluginApi);

        for (
            const [key, value]
            of Object.entries(parameters)
        ) {
            url.searchParams.set(
                key,
                String(value)
            );
        }

        const response =
            await fetch(url.toString(), {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store'
            });

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        return response.json();
    }

    async function translateText(text) {
        const value =
            String(text || '').trim();

        const cacheKey =
            `${sourceLanguage}>${targetLanguage}:${value}`;

        if (translationCache.has(cacheKey)) {
            return translationCache.get(cacheKey);
        }

        try {
            const response =
                await apiRequest({
                    mode: 'translate',
                    q: value,
                    source: sourceLanguage,
                    target: targetLanguage
                });

            const translated =
                String(
                    response?.translatedText || ''
                ).trim() || value;

            translationCache.set(
                cacheKey,
                translated
            );

            return translated;
        } catch (error) {
            debug(
                'Translation failed:',
                error
            );

            translationCache.set(
                cacheKey,
                value
            );

            return value;
        }
    }

    async function translateTextNode(node) {
        if (
            !node ||
            node.nodeType !== Node.TEXT_NODE ||
            isExcluded(node)
        ) {
            return;
        }

        const original =
            node.nodeValue || '';

        const trimmed =
            original.trim();

        if (!canTranslate(trimmed)) {
            return;
        }

        processingNodes.add(node);

        const leadingWhitespace =
            original.match(/^\s*/)?.[0] || '';

        const trailingWhitespace =
            original.match(/\s*$/)?.[0] || '';

        const translated =
            await translateText(trimmed);

        if (
            document.contains(node) &&
            node.nodeValue === original &&
            translated
        ) {
            node.nodeValue =
                leadingWhitespace +
                translated +
                trailingWhitespace;
        }

        queueMicrotask(() => {
            processingNodes.delete(node);
        });
    }

    async function translateAttributes(element) {
        if (
            !element ||
            element.nodeType !== Node.ELEMENT_NODE ||
            isExcluded(element)
        ) {
            return;
        }

        const attributes = [
            'placeholder',
            'title',
            'aria-label'
        ];

        if (
            element.tagName === 'INPUT' &&
            ['button', 'submit', 'reset']
                .includes(element.type)
        ) {
            attributes.push('value');
        }

        for (const attribute of attributes) {
            if (!element.hasAttribute(attribute)) {
                continue;
            }

            const original =
                element.getAttribute(attribute) || '';

            if (!canTranslate(original)) {
                continue;
            }

            const translated =
                await translateText(original);

            if (
                translated &&
                element.getAttribute(attribute) === original
            ) {
                element.setAttribute(
                    attribute,
                    translated
                );
            }
        }
    }

    function collectTextNodes(root) {
        const nodes = [];

        if (!root || isExcluded(root)) {
            return nodes;
        }

        if (root.nodeType === Node.TEXT_NODE) {
            if (canTranslate(root.nodeValue)) {
                nodes.push(root);
            }

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
                            canTranslate(node.nodeValue)
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
            !config.translate ||
            targetLanguage === sourceLanguage ||
            !root
        ) {
            return;
        }

        const textNodes =
            collectTextNodes(root).slice(0, 500);

        for (const node of textNodes) {
            await translateTextNode(node);
        }

        const elements =
            root.nodeType === Node.ELEMENT_NODE
                ? [
                    root,
                    ...root.querySelectorAll('*')
                ]
                : [];

        for (
            const element
            of elements.slice(0, 800)
        ) {
            await translateAttributes(element);
        }
    }

    function getDeviceCurrency() {
        const locale =
            String(
                navigator.languages?.[0] ||
                navigator.language ||
                Intl.DateTimeFormat()
                    .resolvedOptions()
                    .locale ||
                ''
            ).replace('_', '-');

        const region =
            locale
                .split('-')[1]
                ?.toUpperCase() || '';

        const currencyByRegion = {
            US: 'USD',
            GB: 'GBP',
            CZ: 'CZK',
            PL: 'PLN',
            HU: 'HUF',
            CH: 'CHF',
            SE: 'SEK',
            NO: 'NOK',
            DK: 'DKK',
            RO: 'RON',
            BG: 'BGN'
        };

        return (
            currencyByRegion[region] ||
            config.defaultCurrency ||
            'EUR'
        );
    }

    async function getExchangeRates() {
        if (exchangeRates) {
            return exchangeRates;
        }

        if (exchangePromise) {
            return exchangePromise;
        }

        exchangePromise =
            apiRequest({
                mode: 'rates',
                base: 'EUR'
            })
                .then(response => {
                    exchangeRates =
                        Object.assign(
                            {
                                EUR: 1
                            },
                            response?.rates || {}
                        );

                    return exchangeRates;
                })
                .catch(error => {
                    debug(
                        'Exchange-rate error:',
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
            String(value)
                .replace(/\s/g, '');

        const commaPosition =
            normalized.lastIndexOf(',');

        const dotPosition =
            normalized.lastIndexOf('.');

        if (commaPosition > dotPosition) {
            normalized =
                normalized
                    .replace(/\./g, '')
                    .replace(',', '.');
        } else {
            normalized =
                normalized.replace(/,/g, '');
        }

        return Number(normalized);
    }

    async function convertCurrencyNode(
        node,
        targetCurrency
    ) {
        if (
            !node ||
            node.nodeType !== Node.TEXT_NODE ||
            isExcluded(node)
        ) {
            return;
        }

        const original =
            node.nodeValue || '';

        const currencyPattern =
            /(?:([€$£])\s*([0-9][0-9\s.,]*))|(?:([0-9][0-9\s.,]*)\s*(EUR|USD|GBP|CZK|Kč|PLN|HUF|CHF|SEK|NOK|DKK|RON|BGN)\b)/gi;

        if (!currencyPattern.test(original)) {
            return;
        }

        currencyPattern.lastIndex = 0;

        const rates =
            await getExchangeRates();

        if (
            !rates ||
            !rates[targetCurrency]
        ) {
            return;
        }

        const currencies = {
            '€': 'EUR',
            '$': 'USD',
            '£': 'GBP',
            'KČ': 'CZK',
            CZK: 'CZK',
            EUR: 'EUR',
            USD: 'USD',
            GBP: 'GBP',
            PLN: 'PLN',
            HUF: 'HUF',
            CHF: 'CHF',
            SEK: 'SEK',
            NOK: 'NOK',
            DKK: 'DKK',
            RON: 'RON',
            BGN: 'BGN'
        };

        const replaced =
            original.replace(
                currencyPattern,
                (
                    full,
                    currencySymbol,
                    firstNumber,
                    secondNumber,
                    currencyCode
                ) => {
                    const sourceCurrency =
                        currencies[
                            String(
                                currencySymbol ||
                                currencyCode ||
                                ''
                            ).toUpperCase()
                        ];

                    const amount =
                        parseNumber(
                            firstNumber ||
                            secondNumber
                        );

                    if (
                        !sourceCurrency ||
                        !Number.isFinite(amount) ||
                        !rates[sourceCurrency] ||
                        sourceCurrency === targetCurrency
                    ) {
                        return full;
                    }

                    const amountInEur =
                        amount /
                        rates[sourceCurrency];

                    const converted =
                        amountInEur *
                        rates[targetCurrency];

                    try {
                        return new Intl.NumberFormat(
                            navigator.languages?.[0] ||
                            navigator.language ||
                            'sk-SK',
                            {
                                style: 'currency',
                                currency: targetCurrency,
                                maximumFractionDigits: 2
                            }
                        ).format(converted);
                    } catch (error) {
                        return (
                            converted.toFixed(2) +
                            ' ' +
                            targetCurrency
                        );
                    }
                }
            );

        if (replaced !== original) {
            node.nodeValue =
                replaced;
        }
    }

    async function convertRoot(
        root = document.body
    ) {
        if (
            !config.convertCurrency ||
            !root
        ) {
            return;
        }

        const targetCurrency =
            getDeviceCurrency();

        const textNodes =
            collectTextNodes(root).slice(0, 700);

        for (const node of textNodes) {
            await convertCurrencyNode(
                node,
                targetCurrency
            );
        }
    }

    async function processRoot(root) {
        await translateRoot(root);
        await convertRoot(root);
    }

    function scheduleProcessing(root) {
        clearTimeout(observerTimer);

        observerTimer =
            setTimeout(() => {
                processRoot(
                    root || document.body
                );
            }, 150);
    }

    function startObserver() {
        if (
            observer ||
            !document.body
        ) {
            return;
        }

        observer =
            new MutationObserver(mutations => {
                let changedRoot = null;

                for (const mutation of mutations) {
                    if (
                        mutation.type === 'characterData' &&
                        processingNodes.has(mutation.target)
                    ) {
                        continue;
                    }

                    if (
                        mutation.type === 'characterData'
                    ) {
                        changedRoot =
                            mutation.target.parentElement ||
                            changedRoot;
                    }

                    for (
                        const node
                        of mutation.addedNodes
                    ) {
                        if (
                            node.nodeType === Node.ELEMENT_NODE ||
                            node.nodeType === Node.TEXT_NODE
                        ) {
                            changedRoot =
                                node.nodeType === Node.ELEMENT_NODE
                                    ? node
                                    : node.parentElement;
                        }
                    }
                }

                if (changedRoot) {
                    scheduleProcessing(changedRoot);
                }
            });

        observer.observe(
            document.body,
            {
                subtree: true,
                childList: true,
                characterData: true
            }
        );
    }

    async function initialize() {
        try {
            await processRoot(
                document.body
            );

            startObserver();

            document.documentElement.dataset
                .chainversPlugin = 'ready';

            document.documentElement.dataset
                .chainversLanguage = targetLanguage;

            window.dispatchEvent(
                new CustomEvent(
                    'chainvers:plugin-ready',
                    {
                        detail: {
                            language:
                                targetLanguage,

                            sourceLanguage:
                                sourceLanguage,

                            currency:
                                getDeviceCurrency()
                        }
                    }
                )
            );

            debug('Plugin ready', {
                sourceLanguage,
                targetLanguage,
                currency:
                    getDeviceCurrency()
            });
        } catch (error) {
            debug(
                'Plugin initialization failed:',
                error
            );
        }
    }

    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }
}

const CLIENT_PLUGIN =
    `(${chainversClientPlugin.toString()})();`;

function setCorsHeaders(response) {
    response.setHeader(
        'Access-Control-Allow-Origin',
        '*'
    );

    response.setHeader(
        'Access-Control-Allow-Methods',
        'GET, OPTIONS'
    );

    response.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type'
    );

    response.setHeader(
        'X-Content-Type-Options',
        'nosniff'
    );
}

export default async function handler(
    request,
    response
) {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
        return response
            .status(204)
            .end();
    }

    if (request.method !== 'GET') {
        return response
            .status(405)
            .json({
                ok: false,
                error: 'method_not_allowed'
            });
    }

    const mode =
        String(request.query?.mode || '');

    if (mode === 'translate') {
        const text =
            String(request.query?.q || '')
                .trim();

        const sourceLanguage =
            String(
                request.query?.source || 'sk'
            )
                .trim()
                .toLowerCase();

        const targetLanguage =
            String(
                request.query?.target || ''
            )
                .trim()
                .toLowerCase();

        if (
            !text ||
            !targetLanguage ||
            text.length > 800
        ) {
            return response
                .status(400)
                .json({
                    ok: false,
                    error: 'bad_request'
                });
        }

        if (
            sourceLanguage === targetLanguage
        ) {
            return response
                .status(200)
                .json({
                    ok: true,
                    translatedText: text
                });
        }

        try {
            const translationUrl =
                new URL(
                    'https://api.mymemory.translated.net/get'
                );

            translationUrl.searchParams.set(
                'q',
                text
            );

            translationUrl.searchParams.set(
                'langpair',
                `${sourceLanguage}|${targetLanguage}`
            );

            const translationResponse =
                await fetch(
                    translationUrl.toString(),
                    {
                        headers: {
                            'User-Agent':
                                'CHAINVERS/1.0'
                        }
                    }
                );

            if (!translationResponse.ok) {
                throw new Error(
                    `HTTP ${translationResponse.status}`
                );
            }

            const translationData =
                await translationResponse.json();

            const translatedText =
                String(
                    translationData
                        ?.responseData
                        ?.translatedText || ''
                ).trim();

            response.setHeader(
                'Cache-Control',
                'public, max-age=3600, s-maxage=86400'
            );

            return response
                .status(200)
                .json({
                    ok: true,

                    translatedText:
                        translatedText &&
                        !/MYMEMORY WARNING/i
                            .test(translatedText)
                            ? translatedText
                            : text
                });
        } catch (error) {
            return response
                .status(502)
                .json({
                    ok: false,
                    error: 'translation_failed'
                });
        }
    }

    if (mode === 'rates') {
        try {
            const ratesResponse =
                await fetch(
                    'https://api.frankfurter.dev/v1/latest?base=EUR'
                );

            if (!ratesResponse.ok) {
                throw new Error(
                    `HTTP ${ratesResponse.status}`
                );
            }

            const ratesData =
                await ratesResponse.json();

            response.setHeader(
                'Cache-Control',
                'public, max-age=900, s-maxage=21600'
            );

            return response
                .status(200)
                .json({
                    ok: true,
                    base: 'EUR',
                    rates:
                        ratesData?.rates || {}
                });
        } catch (error) {
            return response
                .status(502)
                .json({
                    ok: false,
                    error: 'rates_failed'
                });
        }
    }

    response.setHeader(
        'Content-Type',
        'application/javascript; charset=utf-8'
    );

    response.setHeader(
        'Cache-Control',
        'public, max-age=0, s-maxage=300, must-revalidate'
    );

    return response
        .status(200)
        .send(CLIENT_PLUGIN);
}