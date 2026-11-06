const crypto = require('crypto');

const STAFF_ROLES = ['PLATFORM_ADMIN', 'SUPPORT', 'BILLING', 'VIEWER'];
const WRITE_ROLES = {
    clients: ['PLATFORM_ADMIN', 'BILLING'],
    invoices: ['PLATFORM_ADMIN', 'BILLING'],
    claims: ['PLATFORM_ADMIN', 'SUPPORT', 'BILLING'],
    support: ['PLATFORM_ADMIN', 'SUPPORT'],
    tokens: ['PLATFORM_ADMIN', 'SUPPORT'],
    staff: ['PLATFORM_ADMIN']
};

const canWrite = (role, area) => (WRITE_ROLES[area] || []).includes(role);
const portalSecret = () => process.env.PORTAL_JWT_SECRET || `${process.env.JWT_SECRET}:portal`;

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
function generateApiToken() {
    const secret = crypto.randomBytes(24).toString('hex');
    const token = `rsk_${secret}`;
    return { token, prefix: token.slice(0, 12), hash: hashToken(token) };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const normalizeTime = value => (String(value).length === 5 ? `${value}:00` : String(value));

function validateShifts(shifts) {
    if (!Array.isArray(shifts) || shifts.length > 28) return 'Les horaires sont invalides (28 plages maximum).';
    for (const shift of shifts) {
        if (!Number.isInteger(shift?.weekday) || shift.weekday < 1 || shift.weekday > 7) return 'Le jour de la semaine est invalide.';
        if (!TIME_PATTERN.test(String(shift.start_time)) || !TIME_PATTERN.test(String(shift.end_time))) return 'Les heures doivent être au format HH:MM.';
        if (normalizeTime(shift.start_time) >= normalizeTime(shift.end_time)) return 'L’heure de fin doit être postérieure à l’heure de début.';
    }
    const byDay = new Map();
    for (const shift of shifts) {
        const list = byDay.get(shift.weekday) || [];
        list.push([normalizeTime(shift.start_time), normalizeTime(shift.end_time)]);
        byDay.set(shift.weekday, list);
    }
    for (const list of byDay.values()) {
        list.sort();
        for (let index = 1; index < list.length; index += 1) if (list[index][0] < list[index - 1][1]) return 'Deux plages horaires se chevauchent.';
    }
    return null;
}

function isOnDuty(shifts, now = new Date()) {
    const weekday = now.getDay() || 7;
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    return shifts.some(shift => Number(shift.weekday) === weekday && normalizeTime(shift.start_time) <= time && time < normalizeTime(shift.end_time));
}

module.exports = { STAFF_ROLES, canWrite, portalSecret, hashToken, generateApiToken, validateShifts, isOnDuty, normalizeTime };
