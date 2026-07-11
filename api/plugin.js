(() => {
    'use strict';

    if (window.__CHAINVERS_GLOBAL_PLUGIN_STARTED__) return;
    window.__CHAINVERS_GLOBAL_PLUGIN_STARTED__ = true;

    const config = Object.assign({
        sourceLanguage: 'sk',
        defaultCurrency: 'EUR',
        translate: true,
        convertCurrency: true,
        debug: false,
        translationApi: 'https://api.mymemory.translated.net/get',
        exchangeApi: 'https://api.frankfurter.dev/v1/latest',
        minimumTextLength: 2,

        protectedTerms: [
            'CHAINVERS',
            'CopyMint',
            'OpenSea',
            'MetaMask',
            'Stripe',
            'Base',
            'Ethereum',
            'ETH',
            'NFT',
            'QR'
        ],

        userContentSelectors: [
            '[data-user-content]',
            '[data-no-translate]',
            '[translate="no"]',
            '.notranslate',
            '.user-content',
            '.profile-user-content',
            '.profile-bio',
            '.public-bio',
            '.bio-text',
            '.bio-content',
            '#bio',
            '#profile-bio',
            '#public-bio',
            '[name="bio"]',
            '[data-profile-field]',
            '.profile-field-value',
            '.profile-value',
            '.user-value',
            '.nickname',
            '.official-name',
            '.profile-name',
            '.profile-email',
            '.profile-phone',
            '.profile-address',
            '.profile-country',
            '.social-handle',
            '.social-link',
            '.wallet-address',
            '.eth-address',
            '.author-address',
            'code',
            'pre',
            'textarea',
            '[contenteditable="true"]'
        ]
    }, window.CHAINVERS_PLUGIN_CONFIG || {});

    const STORAGE_PREFIX = 'chainvers_plugin_v2_';

    const translationMemory = new Map();
    const currencyRates = new Map();
    const processingElements = new WeakSet();

    const locale = (
        navigator.languages?.[0] ||
        navigator.language ||
        document.documentElement.lang ||
        'sk-SK'
    ).replace('_', '-');

    const targetLanguage = detectTargetLanguage(locale);
    const targetCurrency = detectTargetCurrency(locale);

    document.documentElement.lang = targetLanguage;

    function log(...args) {
        if (config.debug) {
            console.log('[CHAINVERS plugin]', ...args);
        }
    }

    function detectTargetLanguage(value) {
        const language = String(value || 'sk')
            .toLowerCase()
            .split('-')[0];

        const supported = [
            'sk',
            'cs',
            'en',
            'de',
            'fr',
            'es',
            'it',
            'pl',
            'hu',
            'nl',
            'pt',
            'ro',
            'bg',
            'hr',
            'sl',
            'sv',
            'da',
            'fi',
            'el',
            'uk',
            'ru',
            'tr',
            'ja',
            'ko',
            'zh'
        ];

        return supported.includes(language)
            ? language
            : 'en';
    }

    function detectTargetCurrency(value) {
        const normalized = String(value || '').toUpperCase();

        const region = normalized.includes('-')
            ? normalized.split('-').pop()
            : '';

        const regionCurrency = {
            US: 'USD',
            GB: 'GBP',
            CZ: 'CZK',
            SK: 'EUR',
            DE: 'EUR',
            AT: 'EUR',
            FR: 'EUR',
            IT: 'EUR',
            ES: 'EUR',
            PT: 'EUR',
            NL: 'EUR',
            BE: 'EUR',
            IE: 'EUR',
            FI: 'EUR',
            EE: 'EUR',
            LV: 'EUR',
            LT: 'EUR',
            SI: 'EUR',
            HR: 'EUR',
            LU: 'EUR',
            MT: 'EUR',
            CY: 'EUR',
            PL: 'PLN',
            HU: 'HUF',
            RO: 'RON',
            BG: 'BGN',
            DK: 'DKK',
            SE: 'SEK',
            NO: 'NOK',
            CH: 'CHF',
            JP: 'JPY',
            CA: 'CAD',
            AU: 'AUD',
            NZ: 'NZD',
            IN: 'INR',
            TR: 'TRY',
            UA: 'UAH'
        };

        if (regionCurrency[region]) {
            return regionCurrency[region];
        }

        const language = normalized.split('-')[0];

        const languageFallback = {
            CS: 'CZK',
            SK: 'EUR',
            EN: 'USD',
            DE: 'EUR',
            PL: 'PLN',
            HU: 'HUF',
            RO: 'RON',
            BG: 'BGN',
            DA: 'DKK',
            SV: 'SEK',
            NO: 'NOK',
            JA: 'JPY',
            TR: 'TRY',
            UK: 'UAH'
        };

        return languageFallback[language] ||
            config.defaultCurrency ||
            'EUR';
    }

    function isExcludedElement(element) {
        if (!(element instanceof Element)) {
            return true;
        }

        const blockedTags = new Set([
            'SCRIPT',
            'STYLE',
            'NOSCRIPT',
            'SVG',
            'PATH',
            'CANVAS',
            'IFRAME',
            'OBJECT',
            'EMBED',
            'TEMPLATE',
            'OPTION'
        ]);

        if (blockedTags.has(element.tagName)) {
            return true;
        }

        const selector = config.userContentSelectors.join(',');

        try {
            if (
                element.matches(selector) ||
                element.closest(selector)
            ) {
                return true;
            }
        } catch (error) {
            log('Chybný ochranný selector:', error);
        }

        return false;
    }

    function looksLikeTechnicalOrUserValue(text) {
        const value = String(text || '').trim();

        if (!value) {
            return true;
        }

        if (
            value.length <
            Number(config.minimumTextLength || 2)
        ) {
            return true;
        }

        // Ethereum adresa alebo hash.
        if (/^0x[a-fA-F0-9]{16,}$/.test(value)) {
            return true;
        }

        if (/^[a-fA-F0-9]{32,}$/.test(value)) {
            return true;
        }

        // URL.
        if (
            /^(https?:\/\/|www\.|mailto:|tel:)/i.test(value)
        ) {
            return true;
        }

        // E-mail.
        if (
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ) {
            return true;
        }

        // Cesta alebo súbor.
        if (
            /^(\/|\.\/|\.\.\/)[^\s]+$/.test(value)
        ) {
            return true;
        }

        if (
            /\.(php|js|css|json|png|jpe?g|webp|gif|svg|mp4|pdf)(\?.*)?$/i.test(value)
        ) {
            return true;
        }

        // Čisté číslo, dátum alebo suma.
        if (
            /^[\d\s.,:+\-/#%€$£¥₽₴₺₹₩₿]+$/.test(value)
        ) {
            return true;
        }

        // NFT alebo token ID.
        if (
            /^(NFT|TOKEN|ORIGINÁL|ORIGINAL)\s*#?\s*\d+$/i.test(value)
        ) {
            return true;
        }

        // Sociálny handle.
        if (
            /^@[a-z0-9_.-]+$/i.test(value)
        ) {
            return true;
        }

        return false;
    }

    function protectTerms(text) {
        const replacements = [];
        let protectedText = text;

        config.protectedTerms.forEach((term, index) => {
            if (!term) return;

            const escaped = term.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            const regex = new RegExp(escaped, 'gi');

            protectedText = protectedText.replace(
                regex,
                match => {
                    const token =
                        `__CVTERM_${index}_${replacements.length}__`;

                    replacements.push([
                        token,
                        match
                    ]);

                    return token;
                }
            );
        });

        return {
            protectedText,
            replacements
        };
    }

    function restoreTerms(text, replacements) {
        let result = text;

        replacements.forEach(([token, original]) => {
            result = result
                .split(token)
                .join(original);
        });

        return result;
    }

    function simpleHash(value) {
        let hash = 2166136261;

        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(36);
    }

    function translationCacheKey(text) {
        return [
            STORAGE_PREFIX,
            'tr_',
            config.sourceLanguage,
            '_',
            targetLanguage,
            '_',
            simpleHash(text)
        ].join('');
    }

    function readCache(key, maxAgeMs) {
        try {
            const raw = localStorage.getItem(key);

            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);

            if (
                !parsed ||
                Date.now() - parsed.savedAt > maxAgeMs
            ) {
                localStorage.removeItem(key);
                return null;
            }

            return parsed.value;
        } catch {
            return null;
        }
    }

    function writeCache(key, value) {
        try {
            localStorage.setItem(
                key,
                JSON.stringify({
                    savedAt: Date.now(),
                    value
                })
            );
        } catch {
            // Cache môže byť vypnutá alebo plná.
        }
    }

    function decodeHtmlEntities(value) {
        const textarea =
            document.createElement('textarea');

        textarea.innerHTML = value;

        return textarea.value;
    }

    async function translateText(text) {
        const source = String(
            config.sourceLanguage || 'sk'
        ).toLowerCase();

        if (!config.translate) {
            return text;
        }

        if (source === targetLanguage) {
            return text;
        }

        if (looksLikeTechnicalOrUserValue(text)) {
            return text;
        }

        const memoryKey =
            `${source}|${targetLanguage}|${text}`;

        if (translationMemory.has(memoryKey)) {
            return translationMemory.get(memoryKey);
        }

        const cacheKey =
            translationCacheKey(text);

        const cached = readCache(
            cacheKey,
            30 * 24 * 60 * 60 * 1000
        );

        if (typeof cached === 'string') {
            translationMemory.set(
                memoryKey,
                cached
            );

            return cached;
        }

        const {
            protectedText,
            replacements
        } = protectTerms(text);

        const url = new URL(
            config.translationApi
        );

        url.searchParams.set(
            'q',
            protectedText
        );

        url.searchParams.set(
            'langpair',
            `${source}|${targetLanguage}`
        );

        const response = await fetch(
            url.toString(),
            {
                method: 'GET',
                headers: {
                    Accept: 'application/json'
                },
                cache: 'no-store'
            }
        );

        if (!response.ok) {
            throw new Error(
                `Translation HTTP ${response.status}`
            );
        }

        const data = await response.json();

        let translated =
            data?.responseData?.translatedText;

        if (
            typeof translated !== 'string' ||
            !translated.trim()
        ) {
            return text;
        }

        translated =
            decodeHtmlEntities(translated);

        translated =
            restoreTerms(
                translated,
                replacements
            );

        translationMemory.set(
            memoryKey,
            translated
        );

        writeCache(
            cacheKey,
            translated
        );

        return translated;
    }

    function collectTextNodes(root = document.body) {
        if (!root) {
            return [];
        }

        const nodes = [];

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        const parent =
                            node.parentElement;

                        if (
                            !parent ||
                            isExcludedElement(parent)
                        ) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        const value =
                            node.nodeValue || '';

                        if (
                            looksLikeTechnicalOrUserValue(value)
                        ) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

        while (walker.nextNode()) {
            nodes.push(walker.currentNode);
        }

        return nodes;
    }

    async function translateNode(node) {
        const parent = node.parentElement;

        if (
            !parent ||
            isExcludedElement(parent)
        ) {
            return;
        }

        if (
            processingElements.has(parent)
        ) {
            return;
        }

        const original = node.nodeValue;

        if (
            !original ||
            looksLikeTechnicalOrUserValue(original)
        ) {
            return;
        }

        processingElements.add(parent);

        try {
            const leading =
                original.match(/^\s*/)?.[0] || '';

            const trailing =
                original.match(/\s*$/)?.[0] || '';

            const core = original.trim();

            const translated =
                await translateText(core);

            if (
                node.isConnected &&
                translated &&
                translated !== core
            ) {
                node.nodeValue =
                    leading +
                    translated +
                    trailing;
            }
        } catch (error) {
            log('Preklad zlyhal:', error);
        } finally {
            processingElements.delete(parent);
        }
    }

    async function translateAttributes(
        root = document
    ) {
        const selector = [
            'input[placeholder]',
            'input[type="button"][value]',
            'input[type="submit"][value]',
            'button[title]',
            '[aria-label]',
            '[title]'
        ].join(',');

        const elements =
            root.querySelectorAll
                ? root.querySelectorAll(selector)
                : [];

        for (const element of elements) {
            if (isExcludedElement(element)) {
                continue;
            }

            const attributes = [
                'placeholder',
                'aria-label',
                'title'
            ];

            if (
                element.matches(
                    'input[type="button"], input[type="submit"]'
                )
            ) {
                attributes.push('value');
            }

            for (const attribute of attributes) {
                if (
                    !element.hasAttribute(attribute)
                ) {
                    continue;
                }

                const original =
                    element.getAttribute(attribute);

                if (
                    !original ||
                    looksLikeTechnicalOrUserValue(original)
                ) {
                    continue;
                }

                try {
                    const translated =
                        await translateText(original);

                    if (
                        translated &&
                        translated !== original
                    ) {
                        element.setAttribute(
                            attribute,
                            translated
                        );
                    }
                } catch (error) {
                    log(
                        `Preklad ${attribute} zlyhal:`,
                        error
                    );
                }
            }
        }
    }

    function sleep(ms) {
        return new Promise(
            resolve => setTimeout(resolve, ms)
        );
    }

    async function translateRoot(
        root = document.body
    ) {
        if (
            !config.translate ||
            !root
        ) {
            return;
        }

        const nodes =
            collectTextNodes(root);

        for (
            let index = 0;
            index < nodes.length;
            index += 4
        ) {
            const batch =
                nodes.slice(index, index + 4);

            await Promise.allSettled(
                batch.map(translateNode)
            );

            await sleep(120);
        }

        await translateAttributes(
            root instanceof Element
                ? root
                : document
        );
    }

    const currencySymbols = {
        EUR: '€',
        USD: '$',
        GBP: '£',
        CZK: 'Kč',
        PLN: 'zł',
        HUF: 'Ft',
        RON: 'lei',
        BGN: 'лв',
        CHF: 'CHF',
        DKK: 'kr',
        SEK: 'kr',
        NOK: 'kr',
        JPY: '¥',
        CAD: 'CA$',
        AUD: 'A$',
        NZD: 'NZ$',
        INR: '₹',
        TRY: '₺',
        UAH: '₴'
    };

    const amountRegex =
        /(?:CA\$|A\$|NZ\$|€|\$|£|¥|₹|₺|₴)\s*\d[\d\s.,]*|\d[\d\s.,]*\s*(?:EUR|USD|GBP|CZK|Kč|PLN|zł|HUF|Ft|RON|lei|BGN|лв|CHF|DKK|SEK|NOK|JPY|CAD|AUD|NZD|INR|TRY|UAH|€|\$|£|¥|₹|₺|₴)\b/giu;

    function currencyFromAmount(raw) {
        const value =
            raw.toUpperCase();

        if (
            value.includes('€') ||
            /\bEUR\b/.test(value)
        ) {
            return 'EUR';
        }

        if (
            value.includes('£') ||
            /\bGBP\b/.test(value)
        ) {
            return 'GBP';
        }

        if (
            value.includes('CA$') ||
            /\bCAD\b/.test(value)
        ) {
            return 'CAD';
        }

        if (
            value.includes('A$') ||
            /\bAUD\b/.test(value)
        ) {
            return 'AUD';
        }

        if (
            value.includes('NZ$') ||
            /\bNZD\b/.test(value)
        ) {
            return 'NZD';
        }

        if (
            value.includes('$') ||
            /\bUSD\b/.test(value)
        ) {
            return 'USD';
        }

        if (
            value.includes('KČ') ||
            /\bCZK\b/.test(value)
        ) {
            return 'CZK';
        }

        if (
            value.includes('ZŁ') ||
            /\bPLN\b/.test(value)
        ) {
            return 'PLN';
        }

        if (
            value.includes('FT') ||
            /\bHUF\b/.test(value)
        ) {
            return 'HUF';
        }

        if (
            value.includes('LEI') ||
            /\bRON\b/.test(value)
        ) {
            return 'RON';
        }

        if (
            value.includes('ЛВ') ||
            /\bBGN\b/.test(value)
        ) {
            return 'BGN';
        }

        if (/\bCHF\b/.test(value)) {
            return 'CHF';
        }

        if (/\bDKK\b/.test(value)) {
            return 'DKK';
        }

        if (/\bSEK\b/.test(value)) {
            return 'SEK';
        }

                if (/\bNOK\b/.test(value)) {
            return 'NOK';
        }

        if (
            value.includes('¥') ||
            /\bJPY\b/.test(value)
        ) {
            return 'JPY';
        }

        if (
            value.includes('₹') ||
            /\bINR\b/.test(value)
        ) {
            return 'INR';
        }

        if (
            value.includes('₺') ||
            /\bTRY\b/.test(value)
        ) {
            return 'TRY';
        }

        if (
            value.includes('₴') ||
            /\bUAH\b/.test(value)
        ) {
            return 'UAH';
        }

        return null;
    }

    function numberFromAmount(raw) {
        let value = raw
            .replace(
                /CA\$|A\$|NZ\$/gi,
                ''
            )
            .replace(
                /[€$£¥₹₺₴]/g,
                ''
            )
            .replace(
                /\b(EUR|USD|GBP|CZK|Kč|PLN|zł|HUF|Ft|RON|lei|BGN|лв|CHF|DKK|SEK|NOK|JPY|CAD|AUD|NZD|INR|TRY|UAH)\b/giu,
                ''
            )
            .replace(/\s+/g, '')
            .trim();

        const lastComma =
            value.lastIndexOf(',');

        const lastDot =
            value.lastIndexOf('.');

        if (
            lastComma > -1 &&
            lastDot > -1
        ) {
            if (lastComma > lastDot) {
                value = value
                    .replace(/\./g, '')
                    .replace(',', '.');
            } else {
                value =
                    value.replace(/,/g, '');
            }
        } else if (lastComma > -1) {
            const decimals =
                value.length -
                lastComma -
                1;

            value =
                decimals === 1 ||
                decimals === 2
                    ? value.replace(',', '.')
                    : value.replace(/,/g, '');
        } else if (lastDot > -1) {
            const decimals =
                value.length -
                lastDot -
                1;

            if (
                decimals !== 1 &&
                decimals !== 2
            ) {
                value =
                    value.replace(/\./g, '');
            }
        }

        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : null;
    }

    async function getRate(from, to) {
        if (from === to) {
            return 1;
        }

        const memoryKey =
            `${from}_${to}`;

        if (
            currencyRates.has(memoryKey)
        ) {
            return currencyRates.get(memoryKey);
        }

        const cacheKey =
            `${STORAGE_PREFIX}fx_${memoryKey}`;

        const cached = readCache(
            cacheKey,
            12 * 60 * 60 * 1000
        );

        if (typeof cached === 'number') {
            currencyRates.set(
                memoryKey,
                cached
            );

            return cached;
        }

        const url = new URL(
            config.exchangeApi
        );

        url.searchParams.set(
            'base',
            from
        );

        url.searchParams.set(
            'symbols',
            to
        );

        const response = await fetch(
            url.toString(),
            {
                headers: {
                    Accept: 'application/json'
                },
                cache: 'no-store'
            }
        );

        if (!response.ok) {
            throw new Error(
                `Exchange HTTP ${response.status}`
            );
        }

        const data = await response.json();

        const rate =
            Number(data?.rates?.[to]);

        if (
            !Number.isFinite(rate) ||
            rate <= 0
        ) {
            throw new Error(
                `Kurz ${from}/${to} nebol nájdený`
            );
        }

        currencyRates.set(
            memoryKey,
            rate
        );

        writeCache(
            cacheKey,
            rate
        );

        return rate;
    }

    function formatCurrency(
        amount,
        currency
    ) {
        try {
            return new Intl.NumberFormat(
                locale,
                {
                    style: 'currency',
                    currency,
                    minimumFractionDigits:
                        currency === 'JPY'
                            ? 0
                            : 2,
                    maximumFractionDigits:
                        currency === 'JPY'
                            ? 0
                            : 2
                }
            ).format(amount);
        } catch {
            return (
                amount.toFixed(2) +
                ' ' +
                (
                    currencySymbols[currency] ||
                    currency
                )
            );
        }
    }

    async function convertTextNodeCurrencies(
        node
    ) {
        const parent =
            node.parentElement;

        if (
            !parent ||
            isExcludedElement(parent)
        ) {
            return;
        }

        const text =
            node.nodeValue || '';

        amountRegex.lastIndex = 0;

        if (!amountRegex.test(text)) {
            amountRegex.lastIndex = 0;
            return;
        }

        amountRegex.lastIndex = 0;

        const matches =
            [...text.matchAll(amountRegex)];

        if (!matches.length) {
            return;
        }

        let result = text;

        const replacements = [];

        for (const match of matches) {
            const raw = match[0];

            const sourceCurrency =
                currencyFromAmount(raw);

            const amount =
                numberFromAmount(raw);

            if (
                !sourceCurrency ||
                amount === null ||
                sourceCurrency === targetCurrency
            ) {
                continue;
            }

            try {
                const rate =
                    await getRate(
                        sourceCurrency,
                        targetCurrency
                    );

                replacements.push({
                    raw,
                    converted:
                        formatCurrency(
                            amount * rate,
                            targetCurrency
                        )
                });
            } catch (error) {
                log(
                    'Prepočet meny zlyhal:',
                    error
                );
            }
        }

        replacements.forEach(
            ({ raw, converted }) => {
                result =
                    result.replace(
                        raw,
                        converted
                    );
            }
        );

        if (
            result !== text &&
            node.isConnected
        ) {
            node.nodeValue = result;
        }
    }

    async function convertCurrencies(
        root = document.body
    ) {
        if (
            !config.convertCurrency ||
            !root
        ) {
            return;
        }

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        const parent =
                            node.parentElement;

                        if (
                            !parent ||
                            isExcludedElement(parent)
                        ) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        amountRegex.lastIndex = 0;

                        return amountRegex.test(
                            node.nodeValue || ''
                        )
                            ? NodeFilter.FILTER_ACCEPT
                            : NodeFilter.FILTER_REJECT;
                    }
                }
            );

        const nodes = [];

        while (walker.nextNode()) {
            nodes.push(walker.currentNode);
        }

        for (const node of nodes) {
            await convertTextNodeCurrencies(node);
        }
    }

    let mutationTimer = null;

    function observeDynamicContent() {
        if (!document.body) {
            return;
        }

        const observer =
            new MutationObserver(
                mutations => {
                    const roots = new Set();

                    for (const mutation of mutations) {
                        if (
                            mutation.type ===
                            'characterData'
                        ) {
                            if (
                                mutation.target.parentElement
                            ) {
                                roots.add(
                                    mutation.target.parentElement
                                );
                            }
                        }

                        mutation.addedNodes.forEach(
                            node => {
                                if (
                                    node.nodeType ===
                                    Node.ELEMENT_NODE
                                ) {
                                    roots.add(node);
                                }

                                if (
                                    node.nodeType ===
                                    Node.TEXT_NODE &&
                                    node.parentElement
                                ) {
                                    roots.add(
                                        node.parentElement
                                    );
                                }
                            }
                        );
                    }

                    clearTimeout(mutationTimer);

                    mutationTimer =
                        setTimeout(
                            async () => {
                                for (
                                    const root of roots
                                ) {
                                    if (
                                        !(root instanceof Element) ||
                                        isExcludedElement(root)
                                    ) {
                                        continue;
                                    }

                                    await translateRoot(root);
                                    await convertCurrencies(root);
                                }
                            },
                            350
                        );
                }
            );

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true,
                characterData: true
            }
        );
    }

    async function start() {
        try {
            await translateRoot(
                document.body
            );

            await convertCurrencies(
                document.body
            );

            observeDynamicContent();

            window.dispatchEvent(
                new CustomEvent(
                    'chainvers:plugin-ready',
                    {
                        detail: {
                            language:
                                targetLanguage,
                            currency:
                                targetCurrency
                        }
                    }
                )
            );

            log('Pripravené:', {
                language: targetLanguage,
                currency: targetCurrency
            });
        } catch (error) {
            console.error(
                '[CHAINVERS plugin] Inicializácia zlyhala:',
                error
            );

            observeDynamicContent();
        }
    }

    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            start,
            {
                once: true
            }
        );
    } else {
        start();
    }
})();