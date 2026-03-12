const LOG_PREFIX = '[SublinkWorker]';

let globalLogger = console;

export function setGlobalLogger(logger) {
    if (logger && typeof logger === 'object') {
        globalLogger = logger;
    }
}

export function getGlobalLogger() {
    return globalLogger;
}

function formatTimestamp() {
    return new Date().toISOString();
}

function truncate(str, maxLength = 200) {
    if (typeof str !== 'string') return str;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
}

function safeStringify(obj, maxLength = 500) {
    try {
        const str = JSON.stringify(obj, null, 2);
        return truncate(str, maxLength);
    } catch (e) {
        return '[Unable to stringify]';
    }
}

export function createLogger(category = 'App') {
    const log = (level, message, data = null) => {
        const timestamp = formatTimestamp();
        const prefix = `${LOG_PREFIX}[${timestamp}][${category}]`;
        
        const logMessage = data !== null 
            ? `${prefix} ${message}` 
            : `${prefix} ${message}`;

        switch (level) {
            case 'debug':
                if (data !== null) {
                    globalLogger.debug?.(logMessage, typeof data === 'object' ? safeStringify(data) : data);
                } else {
                    globalLogger.debug?.(logMessage);
                }
                break;
            case 'info':
                if (data !== null) {
                    globalLogger.info(logMessage, typeof data === 'object' ? safeStringify(data) : data);
                } else {
                    globalLogger.info(logMessage);
                }
                break;
            case 'warn':
                if (data !== null) {
                    globalLogger.warn(logMessage, typeof data === 'object' ? safeStringify(data) : data);
                } else {
                    globalLogger.warn(logMessage);
                }
                break;
            case 'error':
                if (data !== null) {
                    globalLogger.error(logMessage, typeof data === 'object' ? safeStringify(data) : data);
                } else {
                    globalLogger.error(logMessage);
                }
                break;
        }
    };

    return {
        debug: (message, data = null) => log('debug', message, data),
        info: (message, data = null) => log('info', message, data),
        warn: (message, data = null) => log('warn', message, data),
        error: (message, data = null) => log('error', message, data),
        
        logProxyParse: (protocol, url, result) => {
            const truncatedUrl = truncate(url, 100);
            if (result) {
                globalLogger.info(
                    `${LOG_PREFIX}[${formatTimestamp()}][${category}] ✅ Parsed ${protocol} proxy successfully`,
                    `URL: ${truncatedUrl}`,
                    `Result: ${safeStringify(result, 300)}`
                );
            } else {
                globalLogger.warn(
                    `${LOG_PREFIX}[${formatTimestamp()}][${category}] ⚠️ Failed to parse ${protocol} proxy`,
                    `URL: ${truncatedUrl}`
                );
            }
        },

        logProxyParseError: (protocol, url, error) => {
            const truncatedUrl = truncate(url, 100);
            globalLogger.error(
                `${LOG_PREFIX}[${formatTimestamp()}][${category}] ❌ Error parsing ${protocol} proxy`,
                `URL: ${truncatedUrl}`,
                `Error: ${error?.message || error}`
            );
        },

        logVlessDetail: (step, data) => {
            globalLogger.info(
                `${LOG_PREFIX}[${formatTimestamp()}][${category}][VLESS] ${step}`,
                safeStringify(data, 400)
            );
        },

        logRequest: (endpoint, params) => {
            globalLogger.info(
                `${LOG_PREFIX}[${formatTimestamp()}][${category}] 📥 Request to ${endpoint}`,
                safeStringify(params, 500)
            );
        },

        logBuildStep: (step, details = null) => {
            if (details) {
                globalLogger.info(
                    `${LOG_PREFIX}[${formatTimestamp()}][${category}] 🔧 Build step: ${step}`,
                    typeof details === 'string' ? details : safeStringify(details, 300)
                );
            } else {
                globalLogger.info(
                    `${LOG_PREFIX}[${formatTimestamp()}][${category}] 🔧 Build step: ${step}`
                );
            }
        }
    };
}

export const logger = createLogger('App');
