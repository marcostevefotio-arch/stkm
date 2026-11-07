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

class RecoveryRestoreTest {
    @TempDir Path temp;

    @Test
    void restoresBackupAndEnvelopeThenResetsPassword() throws Exception {
        char[] original = "old-password-123".toCharArray(), replacement = "new-password-123".toCharArray();
        LocalKeyEnvelope.Created created = LocalKeyEnvelope.create(original);
        byte[] key = LocalKeyEnvelope.unlockWithPassword(created.envelope(), original);
        Path db = temp.resolve("db"), backup = temp.resolve("backup.rdb");
        Path envelopeFile = temp.resolve("external.envelope"), restored = temp.resolve("restored");
        try {
            try (Connection connection = EncryptedDatabase.create(db, key);
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE TABLE sample (id INT PRIMARY KEY)");
                statement.executeUpdate("INSERT INTO sample VALUES (42)");
                VerifiedBackup.create(db, key, backup);
            }
            Files.write(envelopeFile, created.envelope());
            RecoveryRestore.restore(backup, envelopeFile, created.recoveryCode(), restored);
            EnvelopeRecovery.resetPassword(restored, created.recoveryCode(), replacement);
            byte[] restoredKey = LocalKeyEnvelope.unlockWithPassword(
                    Files.readAllBytes(restored.resolve("key.envelope")), replacement);
            try (Connection connection = EncryptedDatabase.open(restored, restoredKey);
                 Statement statement = connection.createStatement();
                 ResultSet result = statement.executeQuery("SELECT id FROM sample")) {
                assertTrue(result.next());
                assertEquals(42, result.getInt(1));
            } finally {
                Arrays.fill(restoredKey, (byte) 0);
            }
            assertThrows(java.nio.file.FileAlreadyExistsException.class,
                    () -> RecoveryRestore.restore(backup, envelopeFile, created.recoveryCode(), restored));
            LocalKeyEnvelope.Created wrong = LocalKeyEnvelope.create(original);
            assertThrows(GeneralSecurityException.class, () -> RecoveryRestore.restore(
                    backup, envelopeFile, wrong.recoveryCode(), temp.resolve("wrong")));
            assertFalse(Files.exists(temp.resolve("wrong")));
        } finally {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(original, '\0');
            Arrays.fill(replacement, '\0');
        }
    }
}
