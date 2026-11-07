package fr.redams.desktop.storage;

import fr.redams.desktop.security.LocalKeyEnvelope;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class EnvelopeRecoveryTest {
    @TempDir Path temp;

    @Test
    void recoveryChangesPasswordWithoutChangingDataOrRecoveryKey() throws Exception {
        char[] original = "old-password-123".toCharArray(), replacement = "new-password-123".toCharArray();
        LocalKeyEnvelope.Created created = LocalKeyEnvelope.create(original);
        byte[] key = LocalKeyEnvelope.unlockWithPassword(created.envelope(), original);
        Path db = temp.resolve("db");
        try {
            try (Connection connection = EncryptedDatabase.create(db, key);
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE sample (id INT PRIMARY KEY)");
                statement.executeUpdate("INSERT INTO sample VALUES (42)");
            }
            Files.write(db.resolve("key.envelope"), created.envelope());
            EnvelopeRecovery.resetPassword(db, created.recoveryCode(), replacement);
            byte[] updated = Files.readAllBytes(db.resolve("key.envelope"));
            assertThrows(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithPassword(updated, original));
            byte[] recovered = LocalKeyEnvelope.unlockWithRecovery(updated, created.recoveryCode());
            byte[] newKey = LocalKeyEnvelope.unlockWithPassword(updated, replacement);
            try {
                assertArrayEquals(key, recovered);
                assertArrayEquals(key, newKey);
                try (Connection connection = EncryptedDatabase.open(db, newKey);
                     Statement statement = connection.createStatement();
                     ResultSet result = statement.executeQuery("SELECT id FROM sample")) {
                    assertTrue(result.next());
                    assertEquals(42, result.getInt(1));
                }
            } finally {
                Arrays.fill(recovered, (byte) 0);
                Arrays.fill(newKey, (byte) 0);
            }
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(original, '\0');
            Arrays.fill(replacement, '\0');
        }
    }

    @Test
    void wrongRecoveryAndMissingDatabaseLeaveEnvelopeUnchanged() throws Exception {
        char[] password = "old-password-123".toCharArray(), replacement = "new-password-123".toCharArray();
        LocalKeyEnvelope.Created created = LocalKeyEnvelope.create(password);
        LocalKeyEnvelope.Created wrong = LocalKeyEnvelope.create(password);
        Path db = temp.resolve("db");
        Files.createDirectory(db);
        Files.write(db.resolve("key.envelope"), created.envelope());
        assertThrows(GeneralSecurityException.class,
                () -> EnvelopeRecovery.resetPassword(db, wrong.recoveryCode(), replacement));
        assertArrayEquals(created.envelope(), Files.readAllBytes(db.resolve("key.envelope")));
        assertThrows(java.sql.SQLException.class,
                () -> EnvelopeRecovery.resetPassword(db, created.recoveryCode(), replacement));
        assertArrayEquals(created.envelope(), Files.readAllBytes(db.resolve("key.envelope")));
        Arrays.fill(password, '\0');
        Arrays.fill(replacement, '\0');
    }
}
