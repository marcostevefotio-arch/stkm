package fr.redams.desktop.stock;

import fr.redams.desktop.storage.EncryptedDatabase;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

class StockLedgerTest {
    @TempDir Path temp;

    @Test
    void initializationRefusesAnExistingDatabase() throws Exception {
        byte[] key = key();
        try (Connection connection = EncryptedDatabase.create(temp.resolve("db"), key);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE existing_data (id INT PRIMARY KEY)");
            statement.execute("INSERT INTO existing_data VALUES (42)");
            assertThrows(SQLException.class, () -> new StockLedger(connection).initialize());
            try (ResultSet result = statement.executeQuery("SELECT id FROM existing_data")) {
                assertTrue(result.next());
                assertEquals(42, result.getInt(1));
            }
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    @Test
    void operationsAreAtomicAndReplaysCannotApplyTwice() throws Exception {
        byte[] key = key();
        UUID product = UUID.randomUUID(), create = UUID.randomUUID(), out = UUID.randomUUID();
        try (Connection connection = EncryptedDatabase.create(temp.resolve("db"), key)) {
            StockLedger ledger = new StockLedger(connection);
            ledger.initialize();
            assertEquals(new BigDecimal("5.125"),
                    ledger.createProduct(create, product, "agent", "SKU-1", "Produit", new BigDecimal("5.125")).quantity());
            assertFalse(ledger.move(out, product, "agent", StockLedger.Direction.OUT, new BigDecimal("1.125")).replayed());
            ledger.move(UUID.randomUUID(), product, "agent", StockLedger.Direction.IN, new BigDecimal("2"));
            StockLedger.Result replay = ledger.move(out, product, "agent", StockLedger.Direction.OUT, new BigDecimal("1.125"));
            assertTrue(replay.replayed());
            assertEquals(new BigDecimal("4.000"), replay.quantity());
            assertThrows(IllegalArgumentException.class,
                    () -> ledger.move(out, product, "agent", StockLedger.Direction.OUT, new BigDecimal("1")));
            assertThrows(IllegalArgumentException.class,
                    () -> ledger.move(UUID.randomUUID(), product, "agent", StockLedger.Direction.OUT, new BigDecimal("6.001")));
            assertThrows(IllegalArgumentException.class,
                    () -> ledger.move(UUID.randomUUID(), product, "agent", StockLedger.Direction.IN, new BigDecimal("0.0001")));
            assertThrows(IllegalArgumentException.class,
                    () -> ledger.move(UUID.randomUUID(), UUID.randomUUID(), "agent", StockLedger.Direction.IN, BigDecimal.ONE));
            try (Statement query = connection.createStatement();
                 ResultSet rows = query.executeQuery("""
                         SELECT p.quantity_milli, COUNT(o.id),
                                SUM(CASE WHEN o.sync_status='pending' THEN 1 ELSE 0 END)
                         FROM local_stock_products p JOIN local_stock_operations o ON o.product_id=p.id
                         GROUP BY p.quantity_milli
                         """)) {
                assertTrue(rows.next());
                assertEquals(6000, rows.getLong(1));
                assertEquals(3, rows.getInt(2));
                assertEquals(3, rows.getInt(3));
                assertFalse(rows.next());
            }
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    @Test
    void concurrentSalesCannotBothConsumeTheLastUnit() throws Exception {
        byte[] key = key();
        Path db = temp.resolve("db");
        UUID product = UUID.randomUUID();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try (Connection keeper = EncryptedDatabase.create(db, key)) {
            StockLedger ledger = new StockLedger(keeper);
            ledger.initialize();
            ledger.createProduct(UUID.randomUUID(), product, "admin", "SKU-1", "Produit", BigDecimal.ONE);
            CountDownLatch start = new CountDownLatch(1);
            Future<Boolean> first = executor.submit(() -> sell(db, key, product, start));
            Future<Boolean> second = executor.submit(() -> sell(db, key, product, start));
            start.countDown();
            assertNotEquals(first.get(), second.get());
            try (Statement statement = keeper.createStatement();
                 ResultSet result = statement.executeQuery("""
                         SELECT quantity_milli,(SELECT COUNT(*) FROM local_stock_operations)
                         FROM local_stock_products
                         """)) {
                assertTrue(result.next());
                assertEquals(0, result.getLong(1));
                assertEquals(2, result.getLong(2));
            }
        } finally {
            executor.shutdownNow();
            Arrays.fill(key, (byte) 0);
        }
    }

    @Test
    void concurrentRetriesWithTheSameIdApplyOnlyOnce() throws Exception {
        byte[] key = key();
        Path db = temp.resolve("db");
        UUID product = UUID.randomUUID(), operation = UUID.randomUUID();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try (Connection keeper = EncryptedDatabase.create(db, key)) {
            StockLedger ledger = new StockLedger(keeper);
            ledger.initialize();
            ledger.createProduct(UUID.randomUUID(), product, "admin", "SKU-1", "Produit", BigDecimal.ONE);
            CountDownLatch start = new CountDownLatch(1);
            Future<Boolean> first = executor.submit(() -> replay(db, key, product, operation, start));
            Future<Boolean> second = executor.submit(() -> replay(db, key, product, operation, start));
            start.countDown();
            assertNotEquals(first.get(), second.get());
            try (Statement statement = keeper.createStatement();
                 ResultSet result = statement.executeQuery("""
                         SELECT quantity_milli,(SELECT COUNT(*) FROM local_stock_operations)
                         FROM local_stock_products
                         """)) {
                assertTrue(result.next());
                assertEquals(0, result.getLong(1));
                assertEquals(2, result.getLong(2));
            }
        } finally {
            executor.shutdownNow();
            Arrays.fill(key, (byte) 0);
        }
    }

    @Test
    void rejectedChangesLeaveConnectionAndJournalUnchanged() throws Exception {
        byte[] key = key();
        try (Connection connection = EncryptedDatabase.create(temp.resolve("db"), key)) {
            StockLedger ledger = new StockLedger(connection);
            ledger.initialize();
            UUID product = UUID.randomUUID();
            ledger.createProduct(UUID.randomUUID(), product, "admin", "SKU", "Produit", BigDecimal.ZERO);
            assertThrows(IllegalArgumentException.class, () -> ledger.move(
                    UUID.randomUUID(), product, "admin", StockLedger.Direction.OUT, BigDecimal.ONE));
            assertTrue(connection.getAutoCommit());
            connection.setAutoCommit(false);
            assertThrows(IllegalStateException.class, () -> ledger.move(
                    UUID.randomUUID(), product, "admin", StockLedger.Direction.IN, BigDecimal.ONE));
            connection.rollback();
            connection.setAutoCommit(true);
            try (Statement statement = connection.createStatement();
                 ResultSet result = statement.executeQuery("SELECT COUNT(*) FROM local_stock_operations")) {
                assertTrue(result.next());
                assertEquals(1, result.getInt(1));
            }

        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    @Test
    void journalWriteFailureRollsBackStockAndAllowsSafeRetry() throws Exception {
        byte[] key = key();
        try (Connection connection = EncryptedDatabase.create(temp.resolve("db"), key);
             Statement statement = connection.createStatement()) {
            StockLedger ledger = new StockLedger(connection);
            ledger.initialize();
            UUID product = UUID.randomUUID(), operation = UUID.randomUUID();
            ledger.createProduct(UUID.randomUUID(), product, "admin", "SKU", "Produit", BigDecimal.ZERO);
            statement.execute("ALTER TABLE local_stock_operations ADD CONSTRAINT reject_in CHECK(kind <> 'IN')");
            assertThrows(SQLException.class, () -> ledger.move(operation, product, "admin",
                    StockLedger.Direction.IN, BigDecimal.ONE));
            try (ResultSet result = statement.executeQuery("""
                    SELECT quantity_milli,(SELECT COUNT(*) FROM local_stock_operations)
                    FROM local_stock_products
                    """)) {
                assertTrue(result.next());
                assertEquals(0, result.getLong(1));
                assertEquals(1, result.getInt(2));
            }
            statement.execute("ALTER TABLE local_stock_operations DROP CONSTRAINT reject_in");
            assertFalse(ledger.move(operation, product, "admin", StockLedger.Direction.IN, BigDecimal.ONE).replayed());
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    private static boolean sell(Path path, byte[] key, UUID product, CountDownLatch start) throws Exception {
        try (Connection connection = EncryptedDatabase.open(path, key)) {
            start.await();
            try {
                new StockLedger(connection).move(UUID.randomUUID(), product, "vendeur",
                        StockLedger.Direction.OUT, BigDecimal.ONE);
                return true;
            } catch (IllegalArgumentException error) {
                assertEquals("Insufficient stock.", error.getMessage());
                return false;
            }
        }
    }

    private static boolean replay(Path path, byte[] key, UUID product, UUID operation,
                                  CountDownLatch start) throws Exception {
        try (Connection connection = EncryptedDatabase.open(path, key)) {
            start.await();
            return new StockLedger(connection).move(operation, product, "vendeur",
                    StockLedger.Direction.OUT, BigDecimal.ONE).replayed();
        }
    }

    private static byte[] key() {
        byte[] result = new byte[32];
        new SecureRandom().nextBytes(result);
        return result;
    }
}
