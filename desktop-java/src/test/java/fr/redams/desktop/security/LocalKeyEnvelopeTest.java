package fr.redams.desktop.security;

import java.security.GeneralSecurityException;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

public final class LocalKeyEnvelopeTest {
    private static final char[] PASSWORD = "test-password-123".toCharArray();

    @Test
    void verifiesEnvelope() throws Exception {
        main(new String[0]);
    }

    public static void main(String[] args) throws Exception {
        LocalKeyEnvelope.Created created = LocalKeyEnvelope.create(PASSWORD);
        byte[] envelope = created.envelope();
        byte[] passwordKey = LocalKeyEnvelope.unlockWithPassword(envelope, PASSWORD);
        byte[] recoveryKey = LocalKeyEnvelope.unlockWithRecovery(envelope, created.recoveryCode());
        check(passwordKey.length == 32, "data key length");
        check(Arrays.equals(passwordKey, recoveryKey), "password and recovery must unlock the same key");
        check(!contains(envelope, passwordKey), "data key must not appear in the envelope");
        check(created.recoveryCode().matches("[A-Za-z0-9_-]{43}"), "recovery code format");

        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithPassword(envelope, "wrong-password-123".toCharArray()));
        LocalKeyEnvelope.Created other = LocalKeyEnvelope.create(PASSWORD);
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithRecovery(envelope, other.recoveryCode()));
        expect(IllegalArgumentException.class, () -> LocalKeyEnvelope.unlockWithRecovery(envelope, "invalid"));
        expect(IllegalArgumentException.class, () -> LocalKeyEnvelope.create("short".toCharArray()));
        expect(IllegalArgumentException.class, () -> LocalKeyEnvelope.unlockWithPassword(Arrays.copyOf(envelope, envelope.length - 1), PASSWORD));
        expect(IllegalArgumentException.class, () -> LocalKeyEnvelope.unlockWithPassword(Arrays.copyOf(envelope, envelope.length + 1), PASSWORD));

        byte[] alteredHeader = envelope.clone();
        alteredHeader[10] ^= 1;
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithPassword(alteredHeader, PASSWORD));
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithRecovery(alteredHeader, created.recoveryCode()));
        byte[] alteredPassword = envelope.clone();
        alteredPassword[50] ^= 1;
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithPassword(alteredPassword, PASSWORD));
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithRecovery(alteredPassword, created.recoveryCode()));
        byte[] alteredRecovery = envelope.clone();
        alteredRecovery[alteredRecovery.length - 33] ^= 1;
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithRecovery(alteredRecovery, created.recoveryCode()));
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithPassword(alteredRecovery, PASSWORD));
        byte[] alteredMac = envelope.clone();
        alteredMac[alteredMac.length - 1] ^= 1;
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithPassword(alteredMac, PASSWORD));
        expect(GeneralSecurityException.class, () -> LocalKeyEnvelope.unlockWithRecovery(alteredMac, created.recoveryCode()));
        byte[] unknownVersion = envelope.clone();
        unknownVersion[4] = 2;
        expect(IllegalArgumentException.class, () -> LocalKeyEnvelope.unlockWithPassword(unknownVersion, PASSWORD));
        byte[] copy = created.envelope();
        copy[0] = 0;
        check(created.envelope()[0] != 0, "envelope getter must return a copy");
        check(!Arrays.equals(envelope, other.envelope()), "envelopes must be randomized");
        Arrays.fill(passwordKey, (byte) 0);
        Arrays.fill(recoveryKey, (byte) 0);
        System.out.println("LocalKeyEnvelopeTest: OK");
    }

    private static boolean contains(byte[] haystack, byte[] needle) {
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            if (Arrays.equals(Arrays.copyOfRange(haystack, i, i + needle.length), needle)) return true;
        }
        return false;
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void expect(Class<? extends Throwable> expected, CheckedAction action) throws Exception {
        try {
            action.run();
        } catch (Exception error) {
            if (expected.isInstance(error)) return;
            throw error;
        }
        throw new AssertionError("Expected " + expected.getSimpleName());
    }

    @FunctionalInterface
    private interface CheckedAction {
        void run() throws Exception;
    }
}
