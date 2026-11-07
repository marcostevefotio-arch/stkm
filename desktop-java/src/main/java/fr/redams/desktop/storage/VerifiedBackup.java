package fr.redams.desktop.storage;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Experimental authenticated backups of the encrypted embedded database.
 * The archive must be stored on an independently managed backup device.
 */
public final class VerifiedBackup {
    private static final byte[] MAGIC = "RDBAK001".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] CONTEXT = "redams:backup:mac:v1".getBytes(StandardCharsets.US_ASCII);
    private static final int MAC_BYTES = 32;

    private VerifiedBackup() {}

    /**
     * Creates a new backup file without overwriting an existing file.
     * The database must already exist and be readable with the given data key.
     */
    public static void create(Path databaseDirectory, byte[] key, Path destination)
            throws IOException, SQLException, GeneralSecurityException {
        requireKey(key);
        Path target = destination.toAbsolutePath().normalize();
        Path parent = target.getParent();
        if (parent == null || !Files.isDirectory(parent)) throw new IOException("Backup directory does not exist.");
        boolean created = false;
        try (TemporaryFile temporary = new TemporaryFile(parent, ".redams-backup-")) {
            Path archive = temporary.path;
            try (Connection connection = EncryptedDatabase.open(databaseDirectory, key);
                 PreparedStatement statement = connection.prepareStatement("BACKUP TO ?")) {
                statement.setString(1, archive.toString());
                statement.execute();
            }
            Mac mac = newMac(key);
            try (OutputStream output = Files.newOutputStream(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                created = true;
                output.write(MAGIC);
                mac.update(MAGIC);
                try (InputStream input = Files.newInputStream(archive)) {
                    byte[] buffer = new byte[65536];
                    for (int count; (count = input.read(buffer)) != -1;) {
                        mac.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                    }
                }
                output.write(mac.doFinal());
            }
        } catch (IOException | SQLException | GeneralSecurityException | RuntimeException | Error error) {
            if (created) {
                try {
                    Files.deleteIfExists(target);
                } catch (IOException cleanup) {
                    error.addSuppressed(cleanup);
                }
            }
            throw error;
        }
    }

    /**
     * Verifies the complete backup before restoring into a new directory.
     * If restoration fails, the new directory is left for inspection.
     */
    public static void restore(Path backup, byte[] key, Path destination)
            throws IOException, SQLException, GeneralSecurityException {
        requireKey(key);
        Path directory = destination.toAbsolutePath().normalize();
        Files.createDirectory(directory);
        try (TemporaryFile temporary = new TemporaryFile(directory, ".redams-restore-")) {
            Path archive = temporary.path;
            copyVerifiedArchive(backup, archive, key);
            try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(archive))) {
                ZipEntry entry = zip.getNextEntry();
                if (entry == null || entry.isDirectory() || !"redams.mv.db".equals(entry.getName())) {
                    throw new IOException("Unexpected database backup contents.");
                }
                try (OutputStream output = Files.newOutputStream(directory.resolve("redams.mv.db"),
                        StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                    zip.transferTo(output);
                }
                zip.closeEntry();
                if (zip.getNextEntry() != null) throw new IOException("Unexpected extra backup entry.");
            }
            try (Connection connection = EncryptedDatabase.open(directory, key);
                 PreparedStatement statement = connection.prepareStatement("SELECT 1")) {
                statement.execute();
            }
        }
    }

    private static void copyVerifiedArchive(Path backup, Path archive, byte[] key)
            throws IOException, GeneralSecurityException {
        long length = Files.size(backup);
        if (length <= MAGIC.length + MAC_BYTES) throw new IOException("Invalid backup length.");
        long remaining = length - MAGIC.length - MAC_BYTES;
        Mac mac = newMac(key);
        try (InputStream input = Files.newInputStream(backup);
             OutputStream output = Files.newOutputStream(archive, StandardOpenOption.TRUNCATE_EXISTING)) {
            byte[] header = input.readNBytes(MAGIC.length);
            if (!Arrays.equals(header, MAGIC)) throw new IOException("Unsupported backup format.");
            mac.update(header);
            byte[] buffer = new byte[65536];
            while (remaining > 0) {
                int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (count < 0) throw new EOFException("Incomplete backup.");
                mac.update(buffer, 0, count);
                output.write(buffer, 0, count);
                remaining -= count;
            }
            byte[] expected = input.readNBytes(MAC_BYTES);
            if (expected.length != MAC_BYTES || input.read() != -1 || !MessageDigest.isEqual(mac.doFinal(), expected)) {
                throw new GeneralSecurityException("Backup integrity verification failed.");
            }
        }
    }

    private static Mac newMac(byte[] key) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        byte[] derived = mac.doFinal(CONTEXT);
        try {
            mac.init(new SecretKeySpec(derived, "HmacSHA256"));
            return mac;
        } finally {
            Arrays.fill(derived, (byte) 0);
        }
    }

    private static void requireKey(byte[] key) {
        if (key == null || key.length != 32) throw new IllegalArgumentException("A 256-bit data key is required.");
    }

    private static final class TemporaryFile implements AutoCloseable {
        private final Path path;

        private TemporaryFile(Path directory, String prefix) throws IOException {
            path = Files.createTempFile(directory, prefix, ".zip");
        }

        @Override
        public void close() throws IOException {
            Files.deleteIfExists(path);
        }
    }
}
