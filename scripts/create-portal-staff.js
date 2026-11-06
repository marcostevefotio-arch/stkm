require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/config/database');
const { STAFF_ROLES } = require('../src/config/portal-access');

async function createPortalStaff() {
    const fullName = String(process.env.PORTAL_STAFF_NAME || '').trim();
    const email = String(process.env.PORTAL_STAFF_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.PORTAL_STAFF_PASSWORD || '');
    const role = String(process.env.PORTAL_STAFF_ROLE || 'PLATFORM_ADMIN');
    if (fullName.length < 2 || fullName.length > 180) throw new Error('PORTAL_STAFF_NAME doit contenir 2 à 180 caractères.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) throw new Error('PORTAL_STAFF_EMAIL doit être une adresse valide.');
    if (password.length < 12 || password.length > 128) throw new Error('PORTAL_STAFF_PASSWORD doit contenir 12 à 128 caractères.');
    if (!STAFF_ROLES.includes(role)) throw new Error(`PORTAL_STAFF_ROLE doit valoir : ${STAFF_ROLES.join(', ')}.`);
    const [existing] = await db.execute('SELECT id FROM platform_staff WHERE email=?', [email]);
    if (existing.length) throw new Error('Un employé avec cette adresse existe déjà.');
    await db.execute('INSERT INTO platform_staff(full_name,email,password_hash,role) VALUES(?,?,?,?)', [fullName, email, await bcrypt.hash(password, 12), role]);
    console.log(`Employé ${role} créé : ${email}`);
}

createPortalStaff().then(() => db.end()).catch(async error => { console.error(error.message); try { await db.end(); } finally { process.exit(1); } });
