const db = require('../config/database');
const { hashToken } = require('../config/portal-access');

async function authenticateApiToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-api-key'] || '').trim();
    if (!/^rsk_[a-f0-9]{48}$/.test(token)) return res.status(401).json({ error: 'Clé API requise ou invalide.' });
    try {
        const [rows] = await db.execute(
            `SELECT t.id,t.organization_id,o.name organization_name,o.status organization_status
             FROM client_api_tokens t JOIN organizations o ON o.id=t.organization_id
             WHERE t.token_hash=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>NOW()) LIMIT 1`,
            [hashToken(token)]
        );
        if (!rows.length) return res.status(401).json({ error: 'Clé API invalide, expirée ou révoquée.' });
        if (rows[0].organization_status !== 'active') return res.status(403).json({ error: 'L’établissement est suspendu ou fermé.' });
        await db.execute('UPDATE client_api_tokens SET last_used_at=NOW() WHERE id=?', [rows[0].id]);
        req.apiToken = rows[0];
        req.tenantId = Number(rows[0].organization_id);
        next();
    } catch (error) { next(error); }
}

module.exports = { authenticateApiToken };
