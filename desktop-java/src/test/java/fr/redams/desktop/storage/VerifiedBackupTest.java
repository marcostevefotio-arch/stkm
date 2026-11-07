package fr.redams.desktop.storage;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Arrays;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class VerifiedBackupTest {
    @TempDir Path temp;

    @Test
    void createsAuthenticatedEncryptedBackupAndRestoresCommittedData() throws Exception {
        byte[] key = key();
        Path db = temp.resolve("db"), backup = temp.resolve("backup.rdb"), restored = temp.resolve("restored");
        String marker = "REDAMS_BACKUP_PRIVATE_MARKER_89716851873";
        try {
            try (Connection connection = EncryptedDatabase.create(db, key);
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE sample (id INT PRIMARY KEY, payload VARCHAR(200))");
                statement.executeUpdate("INSERT INTO sample VALUES (1, '" + marker + "')");
                VerifiedBackup.create(db, key, backup);
            }
            byte[] data = Files.readAllBytes(backup);
            try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(data, 8, data.length - 40))) {
                assertEquals("redams.mv.db", zip.getNextEntry().getName());
                assertFalse(contains(zip.readAllBytes(), marker.getBytes(StandardCharsets.UTF_8)));
            }
            VerifiedBackup.restore(backup, key, restored);
            try (Connection connection = EncryptedDatabase.open(restored, key);
                 Statement statement = connection.createStatement();
                 ResultSet result = statement.executeQuery("SELECT payload FROM sample")) {
                assertTrue(result.next());
                assertEquals(marker, result.getString(1));
            }
            assertThrows(IOException.class, () -> VerifiedBackup.create(db, key, backup));
            assertThrows(IOException.class, () -> VerifiedBackup.restore(backup, key, restored));
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    @Test
    void rejectsTamperingWrongKeyAndTruncatedBackupBeforeRestoringDatabase() throws Exception {
        byte[] key = key(), wrong = key();
        Path db = temp.resolve("db"), backup = temp.resolve("backup.rdb");
        try {
            try (Connection connection = EncryptedDatabase.create(db, key)) {
                assertFalse(connection.isClosed());
                VerifiedBackup.create(db, key, backup);
            }
            assertThrows(GeneralSecurityException.class, () -> VerifiedBackup.restore(backup, wrong, temp.resolve("wrong")));
            assertFalse(Files.exists(temp.resolve("wrong").resolve("redams.mv.db")));
            byte[] bytes = Files.readAllBytes(backup);
            bytes[bytes.length / 2] ^= 1;
            Path tampered = temp.resolve("tampered.rdb");
            Files.write(tampered, bytes);
            assertThrows(GeneralSecurityException.class, () -> VerifiedBackup.restore(tampered, key, temp.resolve("tampered")));
            assertFalse(Files.exists(temp.resolve("tampered").resolve("redams.mv.db")));
            Files.write(tampered, Arrays.copyOf(bytes, 10));
            assertThrows(IOException.class, () -> VerifiedBackup.restore(tampered, key, temp.resolve("truncated")));
            assertFalse(Files.exists(temp.resolve("truncated").resolve("redams.mv.db")));
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(wrong, (byte) 0);
        }
    }

    @Test
    void onlineBackupDoesNotRestoreUncommittedChanges() throws Exception {
        byte[] key = key();
        Path db = temp.resolve("db"), backup = temp.resolve("backup.rdb"), restored = temp.resolve("restored");
        try {
            try (Connection connection = EncryptedDatabase.create(db, key);
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE sample (id INT PRIMARY KEY)");
                statement.executeUpdate("INSERT INTO sample VALUES (1)");
                connection.setAutoCommit(false);
                statement.executeUpdate("INSERT INTO sample VALUES (2)");
                VerifiedBackup.create(db, key, backup);
                connection.rollback();
            }
            VerifiedBackup.restore(backup, key, restored);
            try (Connection connection = EncryptedDatabase.open(restored, key);
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

    private static byte[] key() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return key;
    }

    private static boolean contains(byte[] bytes, byte[] marker) {
        for (int i = 0; i <= bytes.length - marker.length; i++) {
            if (Arrays.equals(Arrays.copyOfRange(bytes, i, i + marker.length), marker)) return true;
        }
        return false;
    }
}
