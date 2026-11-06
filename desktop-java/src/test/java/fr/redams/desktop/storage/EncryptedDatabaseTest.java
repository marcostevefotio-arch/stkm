package fr.redams.desktop.storage;

import fr.redams.desktop.security.LocalKeyEnvelope;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

class EncryptedDatabaseTest {
    @TempDir Path temp;

    @Test
    void persistsEncryptedDataAndUnlocksUsingRecovery() throws Exception {
        char[] password = "test-password-123".toCharArray();
        LocalKeyEnvelope.Created envelope = LocalKeyEnvelope.create(password);
        byte[] key = LocalKeyEnvelope.unlockWithPassword(envelope.envelope(), password);
        Path directory = temp.resolve("database");
        String marker = "REDAMS_PRIVATE_TEST_MARKER_702348701928374";
        try {
            try (Connection connection = EncryptedDatabase.create(directory, key);
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE sample (id INT PRIMARY KEY, payload VARCHAR(200) NOT NULL)");
                statement.executeUpdate("INSERT INTO sample VALUES (1, '" + marker + "')");
            }
            byte[] databaseFile = Files.readAllBytes(directory.resolve("redams.mv.db"));
            assertFalse(contains(databaseFile, marker.getBytes(StandardCharsets.UTF_8)));
            byte[] recovery = LocalKeyEnvelope.unlockWithRecovery(envelope.envelope(), envelope.recoveryCode());
            try (Connection connection = EncryptedDatabase.open(directory, recovery);
                 Statement statement = connection.createStatement();
                 ResultSet result = statement.executeQuery("SELECT payload FROM sample WHERE id=1")) {
                assertTrue(result.next());
                assertEquals(marker, result.getString(1));
            } finally {
                Arrays.fill(recovery, (byte) 0);
            }
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(password, '\0');
        }
    }

    @Test
    void wrongKeyAndMissingDatabaseFailWithoutCreatingReplacement() throws Exception {
        byte[] key = randomKey();
        byte[] wrong = randomKey();
        Path directory = temp.resolve("database");
        try {
            try (Connection ignored = EncryptedDatabase.create(directory, key)) {
                assertFalse(ignored.isClosed());
            }
            assertThrows(SQLException.class, () -> EncryptedDatabase.open(directory, wrong));
            Path missing = temp.resolve("missing");
            assertThrows(SQLException.class, () -> EncryptedDatabase.open(missing, key));
            assertFalse(Files.exists(missing));
            assertThrows(IOException.class, () -> EncryptedDatabase.create(directory, key));
            try (Connection ignored = EncryptedDatabase.open(directory, key)) {
                assertFalse(ignored.isClosed());
            }
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(wrong, (byte) 0);
        }
    }

    @Test
    void committedAndRolledBackTransactionsRemainDistinctAfterReopen() throws Exception {
        byte[] key = randomKey();
        Path directory = temp.resolve("database");
        try {
            try (Connection connection = EncryptedDatabase.create(directory, key);
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE sample (id INT PRIMARY KEY)");
                connection.setAutoCommit(false);
                statement.executeUpdate("INSERT INTO sample VALUES (1)");
                connection.commit();
                statement.executeUpdate("INSERT INTO sample VALUES (2)");
                connection.rollback();
            }
            try (Connection connection = EncryptedDatabase.open(directory, key);
                 Statement statement = connection.createStatement();
                 ResultSet result = statement.executeQuery("SELECT id FROM sample")) {
                assertTrue(result.next());
                assertEquals(1, result.getInt(1));
                assertFalse(result.next());
            }
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    @Test
    void rejectsInvalidArgumentsAndDatabaseUrlInjection() {
        assertThrows(IllegalArgumentException.class, () -> EncryptedDatabase.open(temp.resolve("db"), new byte[31]));
        assertThrows(IllegalArgumentException.class, () -> EncryptedDatabase.open(temp.resolve("db;CIPHER=NONE"), new byte[32]));
        assertThrows(IllegalArgumentException.class, () -> EncryptedDatabase.open(null, new byte[32]));
    }

    @Test
    void concurrentConditionalUpdatesCannotSellTheSameUnitTwice() throws Exception {
        byte[] key = randomKey();
        Path directory = temp.resolve("database");
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            try (Connection connection = EncryptedDatabase.create(directory, key);
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE sample_stock (id INT PRIMARY KEY, quantity INT NOT NULL CHECK(quantity >= 0))");
                statement.executeUpdate("INSERT INTO sample_stock VALUES (1, 1)");
                CountDownLatch start = new CountDownLatch(1);
                Future<Integer> first = executor.submit(() -> decrement(directory, key, start));
                Future<Integer> second = executor.submit(() -> decrement(directory, key, start));
                start.countDown();
                assertEquals(1, first.get() + second.get());
                try (ResultSet result = statement.executeQuery("SELECT quantity FROM sample_stock WHERE id=1")) {
                    assertTrue(result.next());
                    assertEquals(0, result.getInt(1));
                }
            }
        } finally {
            executor.shutdownNow();
            Arrays.fill(key, (byte) 0);
        }
    }

    private static int decrement(Path directory, byte[] key, CountDownLatch start) throws Exception {
        try (Connection connection = EncryptedDatabase.open(directory, key);
             Statement statement = connection.createStatement()) {
            start.await();
            return statement.executeUpdate("UPDATE sample_stock SET quantity=quantity-1 WHERE id=1 AND quantity >= 1");
        }
    }

    private static byte[] randomKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return key;
    }

    private static boolean contains(byte[] haystack, byte[] needle) {
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            if (Arrays.equals(Arrays.copyOfRange(haystack, i, i + needle.length), needle)) return true;
        }
        return false;
    }
}
