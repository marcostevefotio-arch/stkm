const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const db = require('../config/database');

const backupDirectory = path.join(__dirname, '../../storage/database-backups');
const lockName = 'redams_schema_migrations';
const migrations = [{
    id: '2026110501_promotion_plan_scope',
    description: 'Cibler une promotion sur un forfait précis ou sur tous les forfaits.',
    definition: 'Add nullable platform_promotions.plan_id BIGINT UNSIGNED and its FK to plans.id.',
    async inspect(connection) {
        const [tables] = await connection.execute(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('plans','platform_promotions')`
        );
        const existingTables = new Set(tables.map(row => row.TABLE_NAME));
        if (!existingTables.has('plans') || !existingTables.has('platform_promotions')) {
            return { ready: false, reason: 'Les tables plans et platform_promotions doivent exister. Exécutez d’abord npm run db:init.', steps: [] };
        }
        const [columns] = await connection.execute(
            `SELECT COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_promotions' AND COLUMN_NAME='plan_id'`
        );
        if (columns.length && (String(columns[0].COLUMN_TYPE).toLowerCase() !== 'bigint unsigned' || columns[0].IS_NULLABLE !== 'YES')) {
            return { ready: false, reason: 'La colonne platform_promotions.plan_id existe avec une définition inattendue.', steps: [] };
        }
        const [foreignKeys] = await connection.execute(
            `SELECT REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
             FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_promotions'
               AND COLUMN_NAME='plan_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
        );
        if (foreignKeys.some(row => row.REFERENCED_TABLE_NAME !== 'plans' || row.REFERENCED_COLUMN_NAME !== 'id')) {
            return { ready: false, reason: 'Une clé étrangère incompatible existe déjà pour platform_promotions.plan_id.', steps: [] };
        }
        const steps = [];
        if (!columns.length) steps.push({ action: 'add_column', description: 'Ajouter plan_id nullable à platform_promotions.' });
        if (!foreignKeys.length) steps.push({ action: 'add_foreign_key', description: 'Relier plan_id à plans.id.' });
        return { ready: true, reason: null, steps };
    },
    async apply(connection, steps) {
        for (const step of steps) {
            if (step.action === 'add_column') {
                await connection.execute('ALTER TABLE platform_promotions ADD COLUMN plan_id BIGINT UNSIGNED NULL');
            } else if (step.action === 'add_foreign_key') {
                await connection.execute('ALTER TABLE platform_promotions ADD CONSTRAINT fk_promotion_plan FOREIGN KEY (plan_id) REFERENCES plans(id)');
            }
        }
    }
}].map(migration => ({
    ...migration,
    checksum: crypto.createHash('sha256')
        .update(`${migration.id}\n${migration.description}\n${migration.definition}\n${migration.inspect.toString()}\n${migration.apply.toString()}`)
        .digest('hex')
}));

function backupError(message, statusCode = 503) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function ensureTrackingTables(connection) {
    await connection.execute(`CREATE TABLE IF NOT EXISTS database_migration_history (
        migration_id VARCHAR(120) NOT NULL PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        description VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        applied_by_staff_id BIGINT UNSIGNED NULL,
        backup_filename VARCHAR(255) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await connection.execute(`CREATE TABLE IF NOT EXISTS database_migration_runs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        migration_id VARCHAR(120) NOT NULL,
        checksum CHAR(64) NOT NULL,
        status ENUM('running','succeeded','failed') NOT NULL,
        started_by_staff_id BIGINT UNSIGNED NOT NULL,
        backup_filename VARCHAR(255) NULL,
        error_message VARCHAR(1000) NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        KEY idx_database_migration_runs_migration(migration_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function recordBuiltInMigration(connection, migrationId) {
    const migration = migrations.find(item => item.id === migrationId);
    if (!migration) throw new Error(`Unknown built-in migration: ${migrationId}`);
    await ensureTrackingTables(connection);
    await connection.execute(
        `INSERT IGNORE INTO database_migration_history(migration_id,checksum,description)
         VALUES(?,?,?)`,
        [migration.id, migration.checksum, migration.description]
    );
}

async function getStatus(connection = db) {
    await ensureTrackingTables(connection);
    const [history] = await connection.execute('SELECT migration_id,checksum,applied_at,backup_filename FROM database_migration_history');
    const [runs] = await connection.execute(
        `SELECT r.migration_id,r.status,r.backup_filename,r.error_message,r.started_at,r.completed_at,s.full_name
         FROM database_migration_runs r LEFT JOIN platform_staff s ON s.id=r.started_by_staff_id
         ORDER BY r.id DESC LIMIT 20`
    );
    const historyById = new Map(history.map(row => [row.migration_id, row]));
    const lastRunById = new Map();
    for (const run of runs) if (!lastRunById.has(run.migration_id)) lastRunById.set(run.migration_id, run);
    const items = [];
    for (const migration of migrations) {
        const record = historyById.get(migration.id);
        const inspection = await migration.inspect(connection);
        const checksumMismatch = Boolean(record && record.checksum !== migration.checksum);
        const schemaDrift = Boolean(record && (!inspection.ready || inspection.steps.length));
        items.push({
            id: migration.id,
            description: migration.description,
            checksum: migration.checksum,
            status: checksumMismatch ? 'checksum_mismatch' : schemaDrift ? 'schema_drift' : record ? 'applied' : inspection.ready ? 'pending' : 'blocked',
            applied_at: record?.applied_at || null,
            backup_filename: record?.backup_filename || null,
            steps: inspection.steps,
            reason: checksumMismatch
                ? 'Le code de cette migration a changé après son application. Elle est bloquée pour préserver l’intégrité.'
                : schemaDrift ? inspection.reason || 'Le schéma ne correspond plus au résultat enregistré. Restaurez une sauvegarde et vérifiez la base avant toute nouvelle action.' : inspection.reason,
            last_run: lastRunById.get(migration.id) || null
        });
    }
    return { items, runs };
}

function backupFileName() {
    const databaseName = process.env.DB_NAME;
    if (!databaseName) throw new Error('La configuration DB_NAME est requise pour créer une sauvegarde.');
    const safeName = databaseName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return `redams-${safeName}-${timestamp}-${crypto.randomBytes(6).toString('hex')}.sql`;
}

async function createDatabaseBackup() {
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
        throw backupError('Configuration DB_HOST, DB_USER ou DB_NAME manquante; la sauvegarde est bloquée.');
    }
    try { await fs.promises.mkdir(backupDirectory, { recursive: true }); }
    catch (error) { throw backupError(`Impossible de préparer le dossier de sauvegarde; migration bloquée. ${error.message}`); }
    const filename = backupFileName();
    const filePath = path.join(backupDirectory, filename);
    const args = [
        `--host=${process.env.DB_HOST}`,
        `--port=${process.env.DB_PORT || '3306'}`,
        `--user=${process.env.DB_USER}`,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--hex-blob',
        '--set-gtid-purged=OFF',
        '--no-tablespaces',
        '--quick',
        process.env.DB_NAME
    ];
    const child = spawn(process.env.MYSQLDUMP_PATH || 'mysqldump', args, {
        env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    const output = fs.createWriteStream(filePath, { flags: 'wx' });
    let fileCreated = false;
    output.once('open', () => { fileCreated = true; });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk.slice(0, 4000 - stderr.length); });
    try {
        const exit = new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `mysqldump exited with code ${code}`)));
        });
        await Promise.all([pipeline(child.stdout, output), exit]);
        const details = await fs.promises.stat(filePath);
        if (!details.size) throw new Error('mysqldump returned an empty backup.');
        return { filename, size: details.size, created_at: details.mtime.toISOString() };
    } catch (error) {
        if (fileCreated) {
            try { await fs.promises.rm(filePath); }
            catch (cleanupError) { throw backupError(`${error.message || error} La sauvegarde partielle n’a pas pu être supprimée: ${cleanupError.message}`, 500); }
        }
        if (error.code === 'ENOENT') {
            throw backupError('mysqldump est introuvable. Installez les outils client MySQL ou configurez MYSQLDUMP_PATH; aucune migration n’a été appliquée.');
        }
        throw backupError(`Sauvegarde échouée; aucune migration n’a été appliquée. ${String(error.message || error).slice(0, 800)}`);
    }
}

async function listBackups() {
    let entries;
    try { entries = await fs.promises.readdir(backupDirectory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile() || !/^redams-[A-Za-z0-9_-]+-\d{8}T\d{6}Z-[a-f0-9]{12}\.sql$/.test(entry.name)) continue;
        const stats = await fs.promises.stat(path.join(backupDirectory, entry.name));
        files.push({ filename: entry.name, size: stats.size, created_at: stats.mtime.toISOString() });
    }
    return files.sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 20);
}

function backupPath(filename) {
    if (typeof filename !== 'string' || !/^redams-[A-Za-z0-9_-]+-\d{8}T\d{6}Z-[a-f0-9]{12}\.sql$/.test(filename)) return null;
    return path.join(backupDirectory, filename);
}

async function runMigration({ migrationId, staffId, reviewed, connectionPool = db, backup = createDatabaseBackup }) {
    if (reviewed !== true) {
        const error = new Error('Confirmez explicitement la migration après avoir vérifié son aperçu.');
        error.statusCode = 400;
        throw error;
    }
    const migration = migrations.find(item => item.id === migrationId);
    if (!migration) {
        const error = new Error('Migration inconnue ou non fournie par cette version de l’application.');
        error.statusCode = 404;
        throw error;
    }
    const connection = await connectionPool.getConnection();
    let locked = false, runId = null, backupInfo = null, operationError = null;
    try {
        const [lockRows] = await connection.execute('SELECT GET_LOCK(?,0) AS acquired', [lockName]);
        if (Number(lockRows[0]?.acquired) !== 1) {
            const error = new Error('Une autre opération de mise à jour de la base est en cours.');
            error.statusCode = 409;
            throw error;
        }
        locked = true;
        await ensureTrackingTables(connection);
        const [history] = await connection.execute('SELECT checksum FROM database_migration_history WHERE migration_id=?', [migration.id]);
        if (history.length) {
            const error = new Error(history[0].checksum === migration.checksum ? 'Cette migration est déjà appliquée.' : 'La signature de cette migration diffère de celle enregistrée; application bloquée.');
            error.statusCode = 409;
            throw error;
        }
        const inspection = await migration.inspect(connection);
        if (!inspection.ready) {
            const error = new Error(inspection.reason || 'Les vérifications préalables ont échoué.');
            error.statusCode = 409;
            throw error;
        }
        const [result] = await connection.execute(
            `INSERT INTO database_migration_runs(migration_id,checksum,status,started_by_staff_id)
             VALUES(?,?,'running',?)`,
            [migration.id, migration.checksum, staffId]
        );
        runId = result.insertId;
        backupInfo = await backup();
        await connection.execute('UPDATE database_migration_runs SET backup_filename=? WHERE id=?', [backupInfo.filename, runId]);
        await migration.apply(connection, inspection.steps);
        await connection.execute(
            `INSERT INTO database_migration_history(migration_id,checksum,description,applied_by_staff_id,backup_filename)
             VALUES(?,?,?,?,?)`,
            [migration.id, migration.checksum, migration.description, staffId, backupInfo.filename]
        );
        await connection.execute(
            `UPDATE database_migration_runs SET status='succeeded',completed_at=CURRENT_TIMESTAMP WHERE id=?`,
            [runId]
        );
        return { migration_id: migration.id, backup: backupInfo, message: 'Migration appliquée et journalisée.' };
    } catch (error) {
        operationError = error;
        if (runId) {
            try {
                await connection.execute(
                    `UPDATE database_migration_runs SET status='failed',backup_filename=?,error_message=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`,
                    [backupInfo?.filename || null, String(error.message || error).slice(0, 1000), runId]
                );
            } catch (loggingError) {
                error.message = `${error.message || error} La journalisation de l’échec a aussi échoué: ${loggingError.message}`;
            }
        }
        throw error;
    } finally {
        if (locked) {
            try { await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]); }
            catch (lockError) {
                if (operationError) operationError.message = `${operationError.message || operationError} Impossible de libérer le verrou MySQL: ${lockError.message}`;
                else {
                    connection.release();
                    throw lockError;
                }
            }
        }
        connection.release();
    }
}

module.exports = { getStatus, recordBuiltInMigration, runMigration, createDatabaseBackup, listBackups, backupPath };
