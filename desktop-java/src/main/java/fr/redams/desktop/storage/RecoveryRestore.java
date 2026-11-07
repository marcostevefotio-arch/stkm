package fr.redams.desktop.storage;

import fr.redams.desktop.security.LocalKeyEnvelope;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.GeneralSecurityException;
import java.sql.SQLException;
import java.util.Arrays;

/** Restores to a new directory using a separately stored key envelope. */
public final class RecoveryRestore {
    private RecoveryRestore() {}

    public static void restore(Path backup, Path envelopeFile, String recoveryCode, Path destination)
            throws IOException, GeneralSecurityException, SQLException {
        if (Files.size(envelopeFile) > 1024) throw new IOException("Invalid key envelope size.");
        byte[] envelope = Files.readAllBytes(envelopeFile);
        byte[] key = LocalKeyEnvelope.unlockWithRecovery(envelope, recoveryCode);
        try {
            VerifiedBackup.restore(backup, key, destination);
            try (FileChannel output = FileChannel.open(destination.resolve("key.envelope"),
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(envelope);
                while (buffer.hasRemaining()) output.write(buffer);
                output.force(true);
            }
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }
}
