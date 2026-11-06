const test = require('node:test');
const assert = require('node:assert/strict');
const { getStatus, runMigration } = require('../src/services/database-upgrade.service');

function fakeConnection({ history = [], events = [] } = {}) {
    return {
        events,
        async execute(sql) {
            events.push(sql);
            if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
            if (sql.includes('SELECT TABLE_NAME')) return [[{ TABLE_NAME: 'plans' }, { TABLE_NAME: 'platform_promotions' }], []];
            if (sql.includes('SELECT COLUMN_TYPE')) return [[], []];
            if (sql.includes('SELECT REFERENCED_TABLE_NAME')) return [[], []];
            if (sql.includes('SELECT checksum FROM database_migration_history')) return [history, []];
            if (sql.includes('SELECT migration_id,checksum,applied_at')) return [history, []];
            if (sql.includes('SELECT r.migration_id')) return [[], []];
            if (sql.includes('INSERT INTO database_migration_runs')) return [{ insertId: 7 }, []];
            return [{}, []];
        },
        release() { events.push('RELEASE'); }
    };
}

test('database migration status previews additive changes without applying them', async () => {
    const connection = fakeConnection();
    const status = await getStatus(connection);
    assert.equal(status.items.length, 1);
    assert.equal(status.items[0].status, 'pending');
    assert.deepEqual(status.items[0].steps.map(step => step.action), ['add_column', 'add_foreign_key']);
    assert.equal(connection.events.some(sql => sql.startsWith('ALTER TABLE')), false);
});

test('migration requires explicit confirmation before obtaining a connection', async () => {
    let connections = 0;
    await assert.rejects(
        runMigration({ migrationId: '2026110501_promotion_plan_scope', staffId: 1, reviewed: false, connectionPool: { getConnection: async () => { connections += 1; } } }),
        { statusCode: 400 }
    );
    assert.equal(connections, 0);
});

test('migration creates and verifies a backup before applying DDL', async () => {
    const connection = fakeConnection();
    const backup = { filename: 'redams-test-20261105T120000Z.sql', size: 12, created_at: '2026-11-05T12:00:00.000Z' };
    const result = await runMigration({
        migrationId: '2026110501_promotion_plan_scope',
        staffId: 1,
        reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return backup; }
    });
    assert.equal(result.backup.filename, backup.filename);
    assert.ok(connection.events.indexOf('BACKUP_VERIFIED') < connection.events.findIndex(sql => typeof sql === 'string' && sql.startsWith('ALTER TABLE')));
    assert.ok(connection.events.some(sql => typeof sql === 'string' && sql.includes("status='succeeded'")));
});

test('failed backup is logged and blocks all schema changes', async () => {
    const connection = fakeConnection();
    await assert.rejects(runMigration({
        migrationId: '2026110501_promotion_plan_scope',
        staffId: 1,
        reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { throw new Error('mysqldump unavailable'); }
    }), /mysqldump unavailable/);
    assert.equal(connection.events.some(sql => typeof sql === 'string' && sql.startsWith('ALTER TABLE')), false);
    assert.ok(connection.events.some(sql => typeof sql === 'string' && sql.includes("status='failed'")));
});
