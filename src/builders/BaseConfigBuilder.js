import { ProxyParser } from '../parsers/index.js';
import { deepCopy, tryDecodeSubscriptionLines, decodeBase64 } from '../utils.js';
import { createTranslator } from '../i18n/index.js';
import { generateRules, getOutbounds, PREDEFINED_RULE_SETS } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('BaseConfigBuilder');

export class BaseConfigBuilder {
    constructor(inputString, baseConfig, lang, userAgent, groupByCountry = false, includeAutoSelect = true) {
        log.info('🏗️ BaseConfigBuilder constructor called', {
            inputLength: inputString?.length,
            lang: lang,
            userAgent: userAgent?.substring(0, 50),
            groupByCountry: groupByCountry,
            includeAutoSelect: includeAutoSelect
        });

        this.inputString = inputString;
        this.config = deepCopy(baseConfig);
        this.customRules = [];
        this.selectedRules = [];
        this.t = createTranslator(lang);
        this.userAgent = userAgent;
        this.appliedOverrideKeys = new Set();
        this.groupByCountry = groupByCountry;
        this.includeAutoSelect = includeAutoSelect;
        this.providerUrls = [];
    }

    async build() {
        log.logBuildStep('build() started');
        
        log.logBuildStep('Calling parseCustomItems()');
        const customItems = await this.parseCustomItems();
        log.logBuildStep('parseCustomItems() completed', {
            itemCount: customItems?.length || 0
        });
        
        log.logBuildStep('Calling addCustomItems()');
        this.addCustomItems(customItems);
        
        log.logBuildStep('Calling addSelectors()');
        this.addSelectors();
        
        log.logBuildStep('build() completed');
        return this.formatConfig();
    }

    async parseCustomItems() {
        log.info('📝 parseCustomItems: Starting to parse input');
        const input = this.inputString || '';
        const parsedItems = [];

        log.info('📝 parseCustomItems: Input analysis', {
            inputLength: input.length,
            inputPreview: input.substring(0, 100) + '...'
        });

        const { parseSubscriptionContent } = await import('../parsers/subscription/subscriptionContentParser.js');

        log.logBuildStep('Trying direct content parsing');
        const directResult = parseSubscriptionContent(input);
        if (directResult && typeof directResult === 'object' && directResult.type) {
            log.info('📝 parseCustomItems: Direct parsing succeeded', {
                type: directResult.type,
                proxyCount: directResult.proxies?.length || 0,
                hasConfig: !!directResult.config
            });
            
            if (directResult.config) {
                this.applyConfigOverrides(directResult.config);
            }
            if (Array.isArray(directResult.proxies)) {
                for (const proxy of directResult.proxies) {
                    if (proxy && proxy.tag) {
                        parsedItems.push(proxy);
                    }
                }
                if (parsedItems.length > 0) {
                    log.info('📝 parseCustomItems: Returning from direct parsing', {
                        itemCount: parsedItems.length
                    });
                    return parsedItems;
                }
            }
        }

        const isBase64Like = /^[A-Za-z0-9+/=\r\n]+$/.test(input) && input.replace(/[\r\n]/g, '').length % 4 === 0;
        if (isBase64Like) {
            log.logBuildStep('Trying Base64 decode');
            try {
                const sanitized = input.replace(/\s+/g, '');
                const decodedWhole = decodeBase64(sanitized);
                log.info('📝 parseCustomItems: Base64 decoded', {
                    decodedLength: decodedWhole?.length,
                    decodedPreview: decodedWhole?.substring(0, 100) + '...'
                });
                
                if (typeof decodedWhole === 'string') {
                    const decodedResult = parseSubscriptionContent(decodedWhole);
                    if (decodedResult && typeof decodedResult === 'object' && decodedResult.type) {
                        log.info('📝 parseCustomItems: Decoded content parsed', {
                            type: decodedResult.type,
                            proxyCount: decodedResult.proxies?.length || 0
                        });
                        
                        if (decodedResult.config) {
                            this.applyConfigOverrides(decodedResult.config);
                        }
                        if (Array.isArray(decodedResult.proxies)) {
                            for (const proxy of decodedResult.proxies) {
                                if (proxy && proxy.tag) {
                                    parsedItems.push(proxy);
                                }
                            }
                            if (parsedItems.length > 0) {
                                log.info('📝 parseCustomItems: Returning from Base64 decoded content', {
                                    itemCount: parsedItems.length
                                });
                                return parsedItems;
                            }
                        }
                    }
                }
            } catch (e) {
                log.warn('📝 parseCustomItems: Base64 decode failed', {
                    error: e.message
                });
            }
        }

        log.logBuildStep('Processing line-by-line');
        const urls = input.split('\n').filter(url => url.trim() !== '');
        log.info('📝 parseCustomItems: Line-by-line processing', {
            lineCount: urls.length
        });

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            log.info(`📝 parseCustomItems: Processing line ${i + 1}/${urls.length}`, {
                linePreview: url.substring(0, 80) + '...'
            });

            let processedUrls = tryDecodeSubscriptionLines(url);
            if (!Array.isArray(processedUrls)) {
                processedUrls = [processedUrls];
            }

            log.info(`📝 parseCustomItems: Line ${i + 1} decoded to ${processedUrls.length} items`);

            for (let j = 0; j < processedUrls.length; j++) {
                const processedUrl = processedUrls[j];
                const trimmedUrl = typeof processedUrl === 'string' ? processedUrl.trim() : '';

                if (!trimmedUrl) {
                    log.warn(`📝 parseCustomItems: Empty URL at line ${i + 1}, item ${j + 1}`);
                    continue;
                }

                if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
                    log.info(`📝 parseCustomItems: HTTP(S) URL detected`, {
                        url: trimmedUrl.substring(0, 80) + '...'
                    });

                    const { fetchSubscriptionWithFormat } = await import('../parsers/subscription/httpSubscriptionFetcher.js');

                    try {
                        const fetchResult = await fetchSubscriptionWithFormat(trimmedUrl, this.userAgent);
                        if (fetchResult) {
                            const { content, format, url: originalUrl } = fetchResult;

                            log.info(`📝 parseCustomItems: Subscription fetched`, {
                                format: format,
                                contentLength: content?.length,
                                originalUrl: originalUrl?.substring(0, 60) + '...'
                            });

                            if (this.isCompatibleProviderFormat(format)) {
                                log.info(`📝 parseCustomItems: Using as provider URL`);
                                this.providerUrls.push(originalUrl);
                                continue;
                            }

                            const result = parseSubscriptionContent(content);
                            if (result && typeof result === 'object' && (result.type === 'yamlConfig' || result.type === 'singboxConfig' || result.type === 'surgeConfig')) {
                                if (result.config) {
                                    this.applyConfigOverrides(result.config);
                                }
                                if (Array.isArray(result.proxies)) {
                                    const beforeCount = parsedItems.length;
                                    result.proxies.forEach(proxy => {
                                        if (proxy && typeof proxy === 'object' && proxy.tag) {
                                            parsedItems.push(proxy);
                                        }
                                    });
                                    log.info(`📝 parseCustomItems: Added ${parsedItems.length - beforeCount} proxies from subscription`);
                                }
                                continue;
                            }
                            if (Array.isArray(result)) {
                                for (const item of result) {
                                    if (item && typeof item === 'object' && item.tag) {
                                        parsedItems.push(item);
                                    } else if (typeof item === 'string') {
                                        const subResult = await ProxyParser.parse(item, this.userAgent);
                                        if (subResult) {
                                            parsedItems.push(subResult);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        log.error('📝 parseCustomItems: Error processing HTTP subscription', {
                            error: error.message,
                            url: trimmedUrl.substring(0, 60) + '...'
                        });
                    }
                    continue;
                }

                log.info(`📝 parseCustomItems: Parsing protocol URL`, {
                    protocol: trimmedUrl.split('://')[0],
                    urlPreview: trimmedUrl.substring(0, 80) + '...'
                });

                const result = await ProxyParser.parse(processedUrl, this.userAgent);
                
                if (result && typeof result === 'object' && (result.type === 'yamlConfig' || result.type === 'singboxConfig' || result.type === 'surgeConfig')) {
                    if (result.config) {
                        this.applyConfigOverrides(result.config);
                    }
                    if (Array.isArray(result.proxies)) {
                        result.proxies.forEach(proxy => {
                            if (proxy && typeof proxy === 'object' && proxy.tag) {
                                parsedItems.push(proxy);
                            }
                        });
                    }
                    continue;
                }
                if (Array.isArray(result)) {
                    for (const item of result) {
                        if (item && typeof item === 'object' && item.tag) {
                            parsedItems.push(item);
                        } else if (typeof item === 'string') {
                            const subResult = await ProxyParser.parse(item, this.userAgent);
                            if (subResult) {
                                parsedItems.push(subResult);
                            }
                        }
                    }
                } else if (result) {
                    log.info(`📝 parseCustomItems: Adding parsed proxy`, {
                        type: result.type,
                        tag: result.tag
                    });
                    parsedItems.push(result);
                }
            }
        }

        log.info('📝 parseCustomItems: Completed', {
            totalItems: parsedItems.length,
            itemTypes: parsedItems.map(p => p?.type).filter(Boolean)
        });

        return parsedItems;
    }

    isCompatibleProviderFormat(format) {
        return false;
    }

    applyConfigOverrides(overrides) {
        if (!overrides || typeof overrides !== 'object') {
            return;
        }

        log.info('🔧 applyConfigOverrides: Applying config overrides', {
            keys: Object.keys(overrides)
        });

        const blacklistedKeys = new Set(['proxies', 'rules', 'rule-providers', 'proxy-groups']);

        Object.entries(overrides).forEach(([key, value]) => {
            if (blacklistedKeys.has(key)) {
                log.info(`🔧 applyConfigOverrides: Skipping blacklisted key: ${key}`);
                return;
            }
            if (value === undefined) {
                delete this.config[key];
                this.appliedOverrideKeys.add(key);
            } else if (key === 'dns' && typeof value === 'object' && !Array.isArray(value)) {
                this.config[key] = this.mergeDnsConfig(this.config[key], value);
                this.appliedOverrideKeys.add(key);
            } else {
                this.config[key] = deepCopy(value);
                this.appliedOverrideKeys.add(key);
            }
        });

        if (Array.isArray(overrides['proxy-groups'])) {
            this.pendingUserProxyGroups = this.pendingUserProxyGroups || [];
            this.pendingUserProxyGroups.push(...overrides['proxy-groups']);
        }
    }

    mergeDnsConfig(existing, incoming) {
        if (!existing || typeof existing !== 'object') {
            return deepCopy(incoming);
        }

        const result = deepCopy(existing);
        const mergeableArrayKeys = new Set(['nameserver', 'fallback', 'fake-ip-filter']);

        Object.entries(incoming).forEach(([key, value]) => {
            if (mergeableArrayKeys.has(key) && Array.isArray(value)) {
                if (Array.isArray(result[key])) {
                    result[key] = [...new Set([...result[key], ...value])];
                } else {
                    result[key] = deepCopy(value);
                }
            } else if (key === 'nameserver-policy' && typeof value === 'object' && !Array.isArray(value)) {
                result[key] = { ...(result[key] || {}), ...deepCopy(value) };
            } else {
                result[key] = deepCopy(value);
            }
        });

        return result;
    }

    hasConfigOverride(key) {
        return this.appliedOverrideKeys?.has(key);
    }

    getOutboundsList() {
        let outbounds;
        if (typeof this.selectedRules === 'string' && PREDEFINED_RULE_SETS[this.selectedRules]) {
            outbounds = getOutbounds(PREDEFINED_RULE_SETS[this.selectedRules]);
        } else if (this.selectedRules && Object.keys(this.selectedRules).length > 0) {
            outbounds = getOutbounds(this.selectedRules);
        } else {
            outbounds = getOutbounds(PREDEFINED_RULE_SETS.minimal);
        }
        return outbounds;
    }

    getProxyList() {
        return this.getProxies().map(proxy => this.getProxyName(proxy));
    }

    getProxies() {
        throw new Error('getProxies must be implemented in child class');
    }

    getProxyName(proxy) {
        throw new Error('getProxyName must be implemented in child class');
    }

    convertProxy(proxy) {
        throw new Error('convertProxy must be implemented in child class');
    }

    addProxyToConfig(proxy) {
        throw new Error('addProxyToConfig must be implemented in child class');
    }

    addAutoSelectGroup(proxyList) {
        throw new Error('addAutoSelectGroup must be implemented in child class');
    }

    addNodeSelectGroup(proxyList) {
        throw new Error('addNodeSelectGroup must be implemented in child class');
    }

    addOutboundGroups(outbounds, proxyList) {
        throw new Error('addOutboundGroups must be implemented in child class');
    }

    addCustomRuleGroups(proxyList) {
        throw new Error('addCustomRuleGroups must be implemented in child class');
    }

    addFallBackGroup(proxyList) {
        throw new Error('addFallBackGroup must be implemented in child class');
    }

    addCountryGroups() {
        throw new Error('addCountryGroups must be implemented in child class');
    }

    addCustomItems(customItems) {
        log.logBuildStep('addCustomItems: Adding custom items', {
            itemCount: customItems?.length || 0
        });

        const validItems = customItems.filter(item => item != null);
        validItems.forEach((item, index) => {
            if (item?.tag) {
                const convertedProxy = this.convertProxy(item);
                if (convertedProxy) {
                    this.addProxyToConfig(convertedProxy);
                    log.info(`🔧 addCustomItems: Added proxy ${index + 1}`, {
                        tag: item.tag,
                        type: item.type
                    });
                }
            }
        });
    }

    addSelectors() {
        log.logBuildStep('addSelectors: Adding selector groups');
        
        const outbounds = this.getOutboundsList();
        const proxyList = this.getProxyList();

        log.info('🔧 addSelectors: Proxy list prepared', {
            proxyCount: proxyList.length,
            outboundCount: outbounds.length
        });

        this.addAutoSelectGroup(proxyList);
        this.addNodeSelectGroup(proxyList);
        if (this.groupByCountry) {
            this.addCountryGroups();
        }
        this.addOutboundGroups(outbounds, proxyList);
        this.addCustomRuleGroups(proxyList);
        this.addFallBackGroup(proxyList);

        if (this.pendingUserProxyGroups && this.pendingUserProxyGroups.length > 0) {
            this.mergeUserProxyGroups(this.pendingUserProxyGroups);
        }
    }

    mergeUserProxyGroups(userGroups) {
    }

    generateRules() {
        return generateRules(this.selectedRules, this.customRules);
    }

    formatConfig() {
        throw new Error('formatConfig must be implemented in child class');
    }
}
