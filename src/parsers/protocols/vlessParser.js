import { parseServerInfo, parseUrlParams, createTlsConfig, createTransportConfig, parseBool } from '../../utils.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('VlessParser');

export function parseVless(url) {
    log.info('🚀 Starting VLESS parsing', { 
        urlLength: url?.length,
        urlPreview: url?.substring(0, 80) + '...'
    });

    if (!url || typeof url !== 'string') {
        log.error('❌ Invalid input: url is empty or not a string');
        return null;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith('vless://')) {
        log.error('❌ Invalid protocol: URL does not start with vless://', {
            actualPrefix: trimmedUrl.substring(0, 10)
        });
        return null;
    }

    log.logVlessDetail('Step 1: Parsing URL params', { 
        urlLength: trimmedUrl.length 
    });

    let addressPart, params, name;
    try {
        const parsed = parseUrlParams(trimmedUrl);
        addressPart = parsed.addressPart;
        params = parsed.params;
        name = parsed.name;
        
        log.logVlessDetail('Step 2: URL params parsed successfully', {
            addressPart: addressPart?.substring(0, 50) + '...',
            paramKeys: Object.keys(params || {}),
            proxyName: name || '(unnamed)'
        });
    } catch (error) {
        log.error('❌ Failed to parse URL params', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }

    log.logVlessDetail('Step 3: Splitting address part (uuid@server:port)', {
        addressPart: addressPart
    });

    const atIndex = addressPart.indexOf('@');
    if (atIndex === -1) {
        log.error('❌ Invalid VLESS URL format: missing @ separator', {
            addressPart: addressPart
        });
        throw new Error('Invalid VLESS URL format: missing @ separator');
    }

    const uuid = addressPart.slice(0, atIndex);
    const serverInfo = addressPart.slice(atIndex + 1);

    log.logVlessDetail('Step 4: UUID and server info extracted', {
        uuidLength: uuid?.length,
        uuidPreview: uuid?.substring(0, 8) + '...',
        serverInfo: serverInfo
    });

    let host, port;
    try {
        const serverResult = parseServerInfo(serverInfo);
        host = serverResult.host;
        port = serverResult.port;
        
        log.logVlessDetail('Step 5: Server info parsed', {
            host: host,
            port: port,
            portType: typeof port
        });
    } catch (error) {
        log.error('❌ Failed to parse server info', {
            serverInfo: serverInfo,
            error: error.message
        });
        throw error;
    }

    if (!host) {
        log.error('❌ Missing host in VLESS URL', { serverInfo: serverInfo });
        throw new Error('Missing host in VLESS URL');
    }

    if (!port || isNaN(port)) {
        log.error('❌ Invalid or missing port in VLESS URL', { 
            serverInfo: serverInfo,
            port: port 
        });
        throw new Error('Invalid or missing port in VLESS URL');
    }

    log.logVlessDetail('Step 6: Creating TLS config', {
        security: params.security,
        sni: params.sni,
        host: params.host,
        allowInsecure: params.allowInsecure,
        pbk: params.pbk ? '(present)' : '(absent)',
        sid: params.sid ? '(present)' : '(absent)'
    });

    let tls;
    try {
        tls = createTlsConfig(params);
        
        log.logVlessDetail('Step 7: TLS config created', {
            tlsEnabled: tls?.enabled,
            tlsServerName: tls?.server_name,
            tlsInsecure: tls?.insecure,
            hasReality: !!tls?.reality
        });

        if (tls.reality) {
            log.logVlessDetail('Step 7b: Reality detected, adding utls config', {
                realityEnabled: tls.reality.enabled,
                publicKey: tls.reality.public_key ? '(present)' : '(missing)',
                shortId: tls.reality.short_id ? '(present)' : '(missing)'
            });
            tls.utls = {
                enabled: true,
                fingerprint: 'chrome'
            };
        }
    } catch (error) {
        log.error('❌ Failed to create TLS config', {
            error: error.message,
            params: params
        });
        throw error;
    }

    const transportType = params.type || 'tcp';
    log.logVlessDetail('Step 8: Checking transport type', {
        transportType: transportType
    });

    let transport;
    if (transportType !== 'tcp') {
        try {
            transport = createTransportConfig(params);
            log.logVlessDetail('Step 9: Transport config created', {
                transportType: transport?.type,
                transportPath: transport?.path,
                transportHost: transport?.headers?.host,
                serviceName: transport?.service_name
            });
        } catch (error) {
            log.error('❌ Failed to create transport config', {
                error: error.message,
                params: params
            });
            throw error;
        }
    } else {
        log.logVlessDetail('Step 9: Using TCP transport (no extra config needed)');
    }

    const udp = params.udp !== undefined ? parseBool(params.udp) : undefined;
    const flow = params.flow ?? undefined;

    log.logVlessDetail('Step 10: Additional params processed', {
        udp: udp,
        flow: flow
    });

    const result = {
        type: 'vless',
        tag: name || `vless-${host}:${port}`,
        server: host,
        server_port: port,
        uuid: decodeURIComponent(uuid),
        tcp_fast_open: false,
        tls,
        transport,
        network: 'tcp',
        flow: flow,
        ...(udp !== undefined ? { udp } : {})
    };

    log.info('✅ VLESS parsing completed successfully', {
        tag: result.tag,
        server: result.server,
        port: result.server_port,
        tlsEnabled: result.tls?.enabled,
        transportType: result.transport?.type || 'tcp',
        flow: result.flow || '(none)'
    });

    return result;
}
