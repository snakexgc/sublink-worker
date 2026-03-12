import { parseShadowsocks } from './protocols/shadowsocksParser.js';
import { parseVmess } from './protocols/vmessParser.js';
import { parseVless } from './protocols/vlessParser.js';
import { parseHysteria2 } from './protocols/hysteria2Parser.js';
import { parseTrojan } from './protocols/trojanParser.js';
import { parseTuic } from './protocols/tuicParser.js';
import { fetchSubscription } from './subscription/httpSubscriptionFetcher.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ProxyParser');

const protocolParsers = {
    ss: parseShadowsocks,
    vmess: parseVmess,
    vless: parseVless,
    hysteria: parseHysteria2,
    hysteria2: parseHysteria2,
    hy2: parseHysteria2,
    http: fetchSubscription,
    https: fetchSubscription,
    trojan: parseTrojan,
    tuic: parseTuic
};

export class ProxyParser {
    static async parse(url, userAgent) {
        log.info('🔍 ProxyParser.parse called', {
            urlLength: url?.length,
            urlPreview: url ? url.substring(0, 80) + '...' : '(null)',
            userAgent: userAgent || '(not provided)'
        });

        if (!url || typeof url !== 'string') {
            log.warn('⚠️ ProxyParser: URL is empty or not a string', {
                urlType: typeof url,
                urlValue: url
            });
            return undefined;
        }

        const trimmed = url.trim();
        if (!trimmed) {
            log.warn('⚠️ ProxyParser: URL is empty after trimming');
            return undefined;
        }

        const protocolMatch = trimmed.match(/^([a-zA-Z0-9+-]+):\/\//);
        if (!protocolMatch) {
            log.warn('⚠️ ProxyParser: No protocol scheme found in URL', {
                urlPreview: trimmed.substring(0, 50)
            });
            return undefined;
        }

        const type = protocolMatch[1].toLowerCase();
        log.info('📋 ProxyParser: Protocol detected', {
            protocol: type,
            hasParser: !!protocolParsers[type],
            availableParsers: Object.keys(protocolParsers)
        });

        const parser = protocolParsers[type];
        if (!parser) {
            log.warn('⚠️ ProxyParser: No parser available for protocol', {
                protocol: type,
                supportedProtocols: Object.keys(protocolParsers)
            });
            return undefined;
        }

        log.info(`🔄 ProxyParser: Starting ${type} parsing`, {
            urlLength: trimmed.length
        });

        try {
            const result = await parser(trimmed, userAgent);
            
            if (result) {
                if (Array.isArray(result)) {
                    log.info(`✅ ProxyParser: ${type} parsing returned array`, {
                        itemCount: result.length
                    });
                } else if (typeof result === 'object') {
                    const resultType = result.type || 'proxy';
                    if (result.proxies && Array.isArray(result.proxies)) {
                        log.info(`✅ ProxyParser: ${type} parsing returned config object`, {
                            type: resultType,
                            proxyCount: result.proxies.length,
                            hasConfig: !!result.config
                        });
                    } else {
                        log.info(`✅ ProxyParser: ${type} parsing returned proxy object`, {
                            type: result.type || type,
                            tag: result.tag || result.name || '(unnamed)',
                            server: result.server || result.server_address,
                            port: result.server_port || result.port
                        });
                    }
                }
            } else {
                log.warn(`⚠️ ProxyParser: ${type} parsing returned null/undefined`);
            }

            return result;
        } catch (error) {
            log.error(`❌ ProxyParser: Error parsing ${type} URL`, {
                error: error.message,
                stack: error.stack,
                urlPreview: trimmed.substring(0, 100)
            });
            throw error;
        }
    }
}
