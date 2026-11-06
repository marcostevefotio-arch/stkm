package fr.redams.desktop.storage;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Experimental encrypted embedded database. The caller manages transactions,
 * the lifetime of the returned connection and the data key.
 */
public final class EncryptedDatabase {
    private static final String DATABASE_NAME = "redams";
    private static final byte[] USER_KEY_CONTEXT =
            "redams:local-database:user-password:v1".getBytes(StandardCharsets.US_ASCII);

    private EncryptedDatabase() {}

    /**
     * Creates a new directory and database. An existing directory is never reused.
     * If initialization fails, the directory is retained for explicit inspection.
     */
    public static Connection create(Path directory, byte[] dataKey)
            throws IOException, SQLException, GeneralSecurityException {
        validate(directory, dataKey);
        Path absolute = directory.toAbsolutePath().normalize();
        Files.createDirectory(absolute);
        return connect(absolute, dataKey, false);
    }

    /**
     * Opens an existing database; it never creates a replacement when missing.
     */
    public static Connection open(Path directory, byte[] dataKey)
            throws SQLException, GeneralSecurityException {
        validate(directory, dataKey);
        return connect(directory.toAbsolutePath().normalize(), dataKey, true);
    }

    private static void validate(Path directory, byte[] dataKey) {
        if (directory == null || dataKey == null || dataKey.length != 32) {
            throw new IllegalArgumentException("A directory and a 256-bit data key are required.");
        }
        String path = directory.toAbsolutePath().normalize().toString();
        if (path.indexOf(';') >= 0 || path.indexOf('\n') >= 0 || path.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("The database path contains unsupported characters.");
        }
    }

    private static Connection connect(Path directory, byte[] dataKey, boolean existing)
            throws SQLException, GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(dataKey, "HmacSHA256"));
        byte[] userKey = mac.doFinal(USER_KEY_CONTEXT);
        try {
            String password = HexFormat.of().formatHex(dataKey) + " " + HexFormat.of().formatHex(userKey);
            String file = directory.resolve(DATABASE_NAME).toString().replace('\\', '/');
            String url = "jdbc:h2:file:" + file + ";CIPHER=AES;IFEXISTS=" + existing;
            return DriverManager.getConnection(url, "REDAMS", password);
        } finally {
            java.util.Arrays.fill(userKey, (byte) 0);
        }
    }
}
