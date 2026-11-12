const test = require('node:test');
const assert = require('node:assert/strict');
const { getStatus, runMigration } = require('../src/services/database-upgrade.service');

function fakeConnection({ history = [], events = [] } = {}) {
    return {
        events,
        async execute(sql) {
            events.push(sql);
            if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
            if (sql.includes("TABLE_NAME IN ('accounting_books','users','accounting_review_snapshots')")) return [[{ TABLE_NAME: 'users', ENGINE: 'InnoDB' }, { TABLE_NAME: 'accounting_books', ENGINE: 'InnoDB' }], []];
            if (sql.includes("TABLE_NAME IN ('organization_settings','sales_invoices')")) return [[{ TABLE_NAME: 'organization_settings', ENGINE: 'InnoDB' }, { TABLE_NAME: 'sales_invoices', ENGINE: 'InnoDB' }], []];
            if (sql.includes("TABLE_NAME='organization_settings'") && sql.includes('SELECT TABLE_NAME')) return [[{ TABLE_NAME: 'organization_settings', ENGINE: 'InnoDB' }], []];
            if (sql.includes("COLUMN_NAME='separate_sale_payment'")) return [[], []];
            if (sql.includes('SELECT TABLE_NAME')) return [[{ TABLE_NAME: 'plans' }, { TABLE_NAME: 'platform_promotions' }, { TABLE_NAME: 'products' }, { TABLE_NAME: 'sales_invoice_items' }], []];
            if (sql.includes("TABLE_NAME='users' AND COLUMN_NAME='role'")) return [[{ COLUMN_TYPE: "enum('OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','SUPER_ADMIN')", IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'VIEWER' }], []];
            if (sql.includes('SELECT COLUMN_NAME,COLUMN_TYPE')) return [[], []];
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
    assert.equal(status.items.length, 9);
    assert.equal(status.items[0].status, 'pending');
    assert.deepEqual(status.items[0].steps.map(step => step.action), ['add_column', 'add_foreign_key']);
    assert.equal(connection.events.some(sql => sql.startsWith('ALTER TABLE')), false);
});

test('database logo migration adds nullable MIME and binary columns after backup', async () => {
    const connection = fakeConnection();
    const migration = (await getStatus(connection)).items.find(item => item.id === '2026111201_database_logo_storage');
    assert.equal(migration.status, 'pending');
    assert.deepEqual(migration.steps.map(step => step.column), ['logo_mime_type', 'logo_data']);
    await runMigration({ migrationId: migration.id, staffId: 1, reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
    });
    const ddl = connection.events.filter(sql => typeof sql === 'string' && sql.startsWith('ALTER TABLE `organization_settings` ADD COLUMN'));
    assert.match(ddl[0], /logo_mime_type` VARCHAR\(30\) NULL/);
    assert.match(ddl[1], /logo_data` LONGBLOB NULL/);
    assert.ok(ddl.every(sql => connection.events.indexOf(sql) > connection.events.indexOf('BACKUP_VERIFIED')));
});

test('separated sales migration adds default-off fields only after backup', async () => {
    const connection = fakeConnection();
    const migration = (await getStatus(connection)).items.find(item => item.id === '2026110701_separate_sale_payment');
    assert.equal(migration.status, 'pending');
    assert.equal(migration.steps.length, 2);
    await runMigration({ migrationId: migration.id, staffId: 1, reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
    });

    const ddl = connection.events.filter(sql => typeof sql === 'string' && sql.startsWith('ALTER TABLE `'));
    assert.equal(ddl.length, 2);
    assert.ok(ddl.every(sql => /TINYINT\(1\) NOT NULL DEFAULT 0/.test(sql) && connection.events.indexOf(sql) > connection.events.indexOf('BACKUP_VERIFIED')));
});

test('role merger migration is additive, default-off and requires backup', async () => {
    const connection = fakeConnection();
    const migration = (await getStatus(connection)).items.find(item => item.id === '2026110702_merge_pharmacist_storekeeper');
    assert.equal(migration.status, 'pending');
    assert.equal(migration.steps.length, 1);
    await runMigration({ migrationId: migration.id, staffId: 1, reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
    });
    const ddl = connection.events.find(sql => sql.startsWith('ALTER TABLE `organization_settings` ADD COLUMN `merge_pharmacist_storekeeper`'));
    assert.ok(ddl);
    assert.ok(connection.events.indexOf(ddl) > connection.events.indexOf('BACKUP_VERIFIED'));
    assert.equal(connection.events.some(sql => /UPDATE users|ALTER TABLE users/.test(sql)), false);
});

test('review migration requires backup before creating its table', async () => {
    const connection = fakeConnection();
    const migration = (await getStatus(connection)).items.find(item => item.id === '2026110605_accounting_review');
    assert.equal(migration.status, 'pending');
    assert.deepEqual(migration.steps.map(step => step.action), ['create_table']);
    await runMigration({
        migrationId: migration.id, staffId: 1, reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
    });
    const ddl = connection.events.findIndex(sql => typeof sql === 'string' && sql.startsWith('CREATE TABLE IF NOT EXISTS accounting_review_snapshots'));
    assert.ok(ddl > connection.events.indexOf('BACKUP_VERIFIED'));
});

test('accountant role migration previews the enum change and requires backup', async () => {
    const connection = fakeConnection();
    const status = await getStatus(connection);
    const migration = status.items.find(item => item.id === '2026110604_accountant_role');
    assert.equal(migration.status, 'pending');
    assert.deepEqual(migration.steps.map(step => step.action), ['extend_role']);
    await runMigration({
        migrationId: migration.id, staffId: 1, reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
    });
    const ddl = connection.events.findIndex(sql => typeof sql === 'string' && sql.startsWith('ALTER TABLE users MODIFY role'));
    assert.ok(ddl > connection.events.indexOf('BACKUP_VERIFIED'));
    assert.match(connection.events[ddl], /'SUPER_ADMIN','ACCOUNTANT'/);
});

test('accountant role migration refuses unexpected role definitions', async () => {
    const connection = fakeConnection(), execute = connection.execute;
    connection.execute = async sql => sql.includes("TABLE_NAME='users' AND COLUMN_NAME='role'")
        ? [[{ COLUMN_TYPE: "enum('OWNER','VIEWER')", IS_NULLABLE: 'NO', COLUMN_DEFAULT: 'VIEWER' }], []]
        : execute.call(connection, sql);
    const item = (await getStatus(connection)).items.find(item => item.id === '2026110604_accountant_role');
    assert.equal(item.status, 'blocked');
    assert.match(item.reason, /incompatible/);
});

test('historical sale cost migration requires backup and leaves past costs unknown', async () => {
    const connection = fakeConnection();
    const status = await getStatus(connection);
    const migration = status.items.find(item => item.id === '2026110603_sale_unit_purchase_cost');
    assert.equal(migration.status, 'pending');
    assert.deepEqual(migration.steps.map(step => step.action), ['add_column']);
    await runMigration({
        migrationId: migration.id, staffId: 1, reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
    });
    const ddl = connection.events.findIndex(sql => typeof sql === 'string' && sql.startsWith('ALTER TABLE sales_invoice_items ADD COLUMN'));
    assert.ok(ddl > connection.events.indexOf('BACKUP_VERIFIED'));
    assert.match(connection.events[ddl], /unit_purchase_cost DECIMAL\(18,4\) NULL/);
    assert.ok(!connection.events.some(sql => typeof sql === 'string' && sql.startsWith('UPDATE sales_invoice_items')));
});

test('historical sale cost migration blocks incompatible existing columns', async () => {
    const connection = fakeConnection();
    const execute = connection.execute;
    connection.execute = async sql => sql.includes("COLUMN_NAME='unit_purchase_cost'")
        ? [[{ COLUMN_TYPE: 'decimal(14,2)', IS_NULLABLE: 'NO' }], []]
        : execute.call(connection, sql);
    const status = await getStatus(connection);
    const migration = status.items.find(item => item.id === '2026110603_sale_unit_purchase_cost');
    assert.equal(migration.status, 'blocked');
    assert.match(migration.reason, /incompatible/);
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

    test('purchase cost migration requires a backup and adds a nullable decimal column', async () => {
        const connection = fakeConnection();
        await runMigration({
            migrationId: '2026110601_product_purchase_cost',
            staffId: 1,
            reviewed: true,
            connectionPool: { getConnection: async () => connection },
            backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
        });
        const index = connection.events.findIndex(sql => typeof sql === 'string' && sql.startsWith('ALTER TABLE products ADD COLUMN purchase_cost'));
        assert.ok(index > connection.events.indexOf('BACKUP_VERIFIED'));
        assert.match(connection.events[index], /DECIMAL\(18,4\) NULL/);
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

test('accounting migration creates both tables only after the backup', async () => {
    const connection = fakeConnection();
    await runMigration({
        migrationId: '2026110602_accounting_book', staffId: 1, reviewed: true,
        connectionPool: { getConnection: async () => connection },
        backup: async () => { connection.events.push('BACKUP_VERIFIED'); return { filename: 'backup.sql', size: 12 }; }
    });
    const ddl = connection.events.filter(sql => typeof sql === 'string' && sql.startsWith('CREATE TABLE IF NOT EXISTS accounting_'));
    assert.equal(ddl.length, 2);
    assert.ok(connection.events.indexOf(ddl[0]) > connection.events.indexOf('BACKUP_VERIFIED'));
    assert.match(ddl[0], /accounting_books/);
    assert.match(ddl[1], /accounting_entries/);
    assert.match(ddl[1], /`lines` JSON NOT NULL/);
});
