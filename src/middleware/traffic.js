const db = require('../config/database');

const FLUSH_MS = 30000;
const buffer = new Map();
let timer = null;

// Cumule en mémoire les requêtes de chaque établissement puis les écrit par lots.
function record(organizationId, status, bytes, now = new Date()) {
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const key = `${organizationId}|${day}`;
    const entry = buffer.get(key) || { organizationId, day, requests: 0, clientErrors: 0, serverErrors: 0, bytes: 0 };
    entry.requests += 1;
    if (status >= 500) entry.serverErrors += 1;
    else if (status >= 400) entry.clientErrors += 1;
    entry.bytes += bytes;
    buffer.set(key, entry);
}

async function flush() {
    if (!buffer.size) return;
    const entries = [...buffer.values()];
    buffer.clear();
    for (const entry of entries) {
        try {
            await db.execute(
                `INSERT INTO tenant_traffic_daily(organization_id,day,requests,client_errors,server_errors,response_bytes,last_request_at)
                 VALUES(?,?,?,?,?,?,NOW())
                 ON DUPLICATE KEY UPDATE requests=requests+VALUES(requests),client_errors=client_errors+VALUES(client_errors),
                 server_errors=server_errors+VALUES(server_errors),response_bytes=response_bytes+VALUES(response_bytes),last_request_at=NOW()`,
                [entry.organizationId, entry.day, entry.requests, entry.clientErrors, entry.serverErrors, entry.bytes]
            );
        } catch (error) {
            console.error('Mesure du trafic impossible :', error.message);
        }
    }
}

function trafficMeter(req, res, next) {
    res.on('finish', () => {
        const url = req.originalUrl || '';
        if (!req.tenantId || !url.startsWith('/api/') || url.startsWith('/api/portal')) return;
        record(req.tenantId, res.statusCode, Number(res.getHeader('content-length')) || 0);
    });
    if (!timer && process.env.NODE_ENV !== 'test') {
        timer = setInterval(flush, FLUSH_MS);
        timer.unref();
    }
    next();
}

module.exports = { trafficMeter, flush, record };
