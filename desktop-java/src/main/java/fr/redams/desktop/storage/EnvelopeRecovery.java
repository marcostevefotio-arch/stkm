package fr.redams.desktop.storage;

import fr.redams.desktop.security.LocalKeyEnvelope;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Arrays;

/** Recovery for an existing local database; never creates a replacement database. */
public final class EnvelopeRecovery {
    private static final int MAX_ENVELOPE_BYTES = 1024;
    private EnvelopeRecovery() {}

    public static void resetPassword(Path directory, String recoveryCode, char[] newPassword)
            throws IOException, GeneralSecurityException, SQLException {
        Path base = directory.toAbsolutePath().normalize();
        Path file = base.resolve("key.envelope");
        if (Files.size(file) > MAX_ENVELOPE_BYTES) throw new IOException("Invalid key envelope size.");
        byte[] envelope = Files.readAllBytes(file);
        byte[] key = LocalKeyEnvelope.unlockWithRecovery(envelope, recoveryCode);
        try {
            try (Connection connection = EncryptedDatabase.open(base, key)) {
                if (connection.isClosed()) throw new SQLException("Database could not be opened.");
            }
            byte[] replacement = LocalKeyEnvelope.resetPassword(envelope, recoveryCode, newPassword);
            Path temporary = Files.createTempFile(base, ".key-envelope-", ".tmp");
            try {
                try (FileChannel output = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                    ByteBuffer buffer = ByteBuffer.wrap(replacement);
                    while (buffer.hasRemaining()) output.write(buffer);
                    output.force(true);
                }
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } finally {
                Files.deleteIfExists(temporary);
                Arrays.fill(replacement, (byte) 0);
            }
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }
}
