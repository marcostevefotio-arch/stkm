package fr.redams.desktop.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Wraps a randomly generated local data key for password and recovery access.
 * The returned envelope contains no plaintext data key.
 */
public final class LocalKeyEnvelope {
    private static final byte[] MAGIC = {'R', 'D', 'K', 'E', 1};
    private static final int SALT_SIZE = 16;
    private static final int ID_SIZE = 16;
    private static final int NONCE_SIZE = 12;
    private static final int KEY_SIZE = 32;
    private static final int WRAPPED_SIZE = KEY_SIZE + 16;
    private static final int HEADER_SIZE = MAGIC.length + SALT_SIZE + ID_SIZE;
    private static final int BODY_SIZE = HEADER_SIZE + 2 * (NONCE_SIZE + WRAPPED_SIZE);
    private static final int MAC_SIZE = 32;
    private static final int ENVELOPE_SIZE = BODY_SIZE + MAC_SIZE;
    private static final int ITERATIONS = 600_000;
    private static final byte[] PASSWORD_CONTEXT = "redams:local-key:password:v1".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] RECOVERY_CONTEXT = "redams:local-key:recovery:v1".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] MAC_CONTEXT = "redams:local-key:envelope:v1".getBytes(StandardCharsets.US_ASCII);
    private static final SecureRandom RANDOM = new SecureRandom();

    private LocalKeyEnvelope() {}

    public static final class Created {
        private final byte[] envelope;
        private final String recoveryCode;

        private Created(byte[] envelope, String recoveryCode) {
            this.envelope = envelope.clone();
            this.recoveryCode = recoveryCode;
        }

        public byte[] envelope() {
            return envelope.clone();
        }

        public String recoveryCode() {
            return recoveryCode;
        }
    }

    public static Created create(char[] password) throws GeneralSecurityException {
        validatePassword(password);
        byte[] salt = randomBytes(SALT_SIZE);
        byte[] id = randomBytes(ID_SIZE);
        byte[] header = ByteBuffer.allocate(HEADER_SIZE).put(MAGIC).put(salt).put(id).array();
        byte[] dataKey = randomBytes(KEY_SIZE);
        byte[] recoveryKey = randomBytes(KEY_SIZE);
        byte[] passwordKey = null;
        try {
            passwordKey = derivePasswordKey(password, salt);
            byte[] passwordNonce = randomBytes(NONCE_SIZE);
            byte[] recoveryNonce = randomBytes(NONCE_SIZE);
            byte[] passwordWrapped = wrap(dataKey, passwordKey, passwordNonce, header, PASSWORD_CONTEXT);
            byte[] recoveryWrapped = wrap(dataKey, recoveryKey, recoveryNonce, header, RECOVERY_CONTEXT);
            byte[] body = ByteBuffer.allocate(BODY_SIZE)
                    .put(header).put(passwordNonce).put(passwordWrapped)
                    .put(recoveryNonce).put(recoveryWrapped).array();
            byte[] envelope = ByteBuffer.allocate(ENVELOPE_SIZE).put(body).put(authenticate(body, dataKey)).array();
            return new Created(envelope, Base64.getUrlEncoder().withoutPadding().encodeToString(recoveryKey));
        } finally {
            Arrays.fill(dataKey, (byte) 0);
            Arrays.fill(recoveryKey, (byte) 0);
            if (passwordKey != null) Arrays.fill(passwordKey, (byte) 0);
        }
    }

    /**
     * The caller must clear the returned data key as soon as it is no longer needed.
     */
    public static byte[] unlockWithPassword(byte[] envelope, char[] password) throws GeneralSecurityException {
        validatePassword(password);
        Parsed parsed = parse(envelope);
        byte[] key = derivePasswordKey(password, parsed.salt);
        try {
            return verifyEnvelope(parsed, unwrap(parsed.passwordWrapped, key, parsed.passwordNonce, parsed.header, PASSWORD_CONTEXT));
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    /**
     * The caller must clear the returned data key as soon as it is no longer needed.
     */
    public static byte[] unlockWithRecovery(byte[] envelope, String recoveryCode) throws GeneralSecurityException {
        Parsed parsed = parse(envelope);
        if (recoveryCode == null || !recoveryCode.matches("[A-Za-z0-9_-]{43}")) {
            throw new IllegalArgumentException("Invalid recovery code format.");
        }
        byte[] key;
        try {
            key = Base64.getUrlDecoder().decode(recoveryCode);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Invalid recovery code format.", error);
        }
        try {
            if (key.length != KEY_SIZE ||
                    !Base64.getUrlEncoder().withoutPadding().encodeToString(key).equals(recoveryCode)) {
                throw new IllegalArgumentException("Invalid recovery code format.");
            }
            return verifyEnvelope(parsed, unwrap(parsed.recoveryWrapped, key, parsed.recoveryNonce, parsed.header, RECOVERY_CONTEXT));
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    private static void validatePassword(char[] password) {
        if (password == null || password.length < 12 || password.length > 128) {
            throw new IllegalArgumentException("Password must contain 12 to 128 characters.");
        }
    }

    private static byte[] derivePasswordKey(char[] password, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(password, salt, ITERATIONS, KEY_SIZE * 8);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    private static byte[] wrap(byte[] data, byte[] key, byte[] nonce, byte[] header, byte[] context)
            throws GeneralSecurityException {
        return cipher(Cipher.ENCRYPT_MODE, data, key, nonce, header, context);
    }

    private static byte[] unwrap(byte[] data, byte[] key, byte[] nonce, byte[] header, byte[] context)
            throws GeneralSecurityException {
        try {
            return cipher(Cipher.DECRYPT_MODE, data, key, nonce, header, context);
        } catch (AEADBadTagException error) {
            throw new GeneralSecurityException("Invalid credential or corrupted key envelope.", error);
        }
    }

    private static byte[] cipher(int mode, byte[] data, byte[] key, byte[] nonce, byte[] header, byte[] context)
            throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(header);
        cipher.updateAAD(context);
        return cipher.doFinal(data);
    }

    private static byte[] randomBytes(int size) {
        byte[] bytes = new byte[size];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static byte[] authenticate(byte[] body, byte[] dataKey) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(dataKey, "HmacSHA256"));
        mac.update(MAC_CONTEXT);
        return mac.doFinal(body);
    }

    private static byte[] verifyEnvelope(Parsed parsed, byte[] dataKey) throws GeneralSecurityException {
        try {
            if (!MessageDigest.isEqual(parsed.mac, authenticate(parsed.body, dataKey))) {
                throw new GeneralSecurityException("Invalid credential or corrupted key envelope.");
            }
            return dataKey;
        } catch (GeneralSecurityException error) {
            Arrays.fill(dataKey, (byte) 0);
            throw error;
        }
    }

    private static Parsed parse(byte[] envelope) {
        if (envelope == null || envelope.length != ENVELOPE_SIZE) {
            throw new IllegalArgumentException("Invalid key envelope length.");
        }
        ByteBuffer buffer = ByteBuffer.wrap(envelope);
        byte[] header = new byte[HEADER_SIZE];
        buffer.get(header);
        if (!Arrays.equals(MAGIC, Arrays.copyOf(header, MAGIC.length))) {
            throw new IllegalArgumentException("Unsupported key envelope format.");
        }
        byte[] salt = Arrays.copyOfRange(header, MAGIC.length, MAGIC.length + SALT_SIZE);
        byte[] passwordNonce = new byte[NONCE_SIZE];
        byte[] passwordWrapped = new byte[WRAPPED_SIZE];
        byte[] recoveryNonce = new byte[NONCE_SIZE];
        byte[] recoveryWrapped = new byte[WRAPPED_SIZE];
        buffer.get(passwordNonce).get(passwordWrapped).get(recoveryNonce).get(recoveryWrapped);
        byte[] body = Arrays.copyOf(envelope, BODY_SIZE);
        byte[] mac = Arrays.copyOfRange(envelope, BODY_SIZE, ENVELOPE_SIZE);
        return new Parsed(header, salt, passwordNonce, passwordWrapped, recoveryNonce, recoveryWrapped, body, mac);
    }

    private record Parsed(byte[] header, byte[] salt, byte[] passwordNonce, byte[] passwordWrapped,
                          byte[] recoveryNonce, byte[] recoveryWrapped, byte[] body, byte[] mac) {}
}
