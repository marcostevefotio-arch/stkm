package fr.redams.desktop.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import fr.redams.desktop.security.LocalKeyEnvelope;
import fr.redams.desktop.server.LocalStockServer;
import fr.redams.desktop.stock.StockLedger;
import fr.redams.desktop.storage.EncryptedDatabase;
import fr.redams.desktop.storage.EnvelopeRecovery;
import fr.redams.desktop.storage.RecoveryRestore;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.time.Duration;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import javax.swing.table.DefaultTableModel;

/** Single-machine prototype; it is not connected to the business portal. */
public final class PrototypeDesktop {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final LocalStockServer server;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final JFrame window = new JFrame("REDAMS - Prototype local (données de test uniquement)");
    private final DefaultTableModel table = new DefaultTableModel(new String[]{"ID", "SKU", "Produit", "Quantité"}, 0) {
        @Override public boolean isCellEditable(int row, int column) { return false; }
    };
    private final JTable products = new JTable(table);
    private final JButton create = new JButton("Créer un produit");
    private final JButton in = new JButton("Entrée");
    private final JButton out = new JButton("Sortie");
    private final JButton refresh = new JButton("Actualiser");
    private final JButton backup = new JButton("Sauvegarder");
    private boolean uncertainWrite;

    private PrototypeDesktop(LocalStockServer server) {
        this.server = server;
        window.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        window.addWindowListener(new WindowAdapter() {
            @Override public void windowClosed(WindowEvent event) { server.close(); }
        });
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT));
        buttons.add(refresh); buttons.add(create); buttons.add(in); buttons.add(out); buttons.add(backup);
        window.add(new JLabel("Prototype isolé : aucune synchronisation, vente, authentification utilisateur ou accès réseau."), BorderLayout.NORTH);
        window.add(new JScrollPane(products), BorderLayout.CENTER);
        window.add(buttons, BorderLayout.SOUTH);
        refresh.addActionListener(event -> refresh());
        create.addActionListener(event -> createProduct());
        in.addActionListener(event -> move("IN"));
        out.addActionListener(event -> move("OUT"));
        backup.addActionListener(event -> backup());
        window.setSize(950, 500);
        window.setLocationRelativeTo(null);
        window.setVisible(true);
        refresh();
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(PrototypeDesktop::launch);
    }

    private static void launch() {
        int mode = JOptionPane.showOptionDialog(null,
                "Prototype de test uniquement. Ne saisissez aucune donnée réelle.",
                "REDAMS - Prototype", JOptionPane.DEFAULT_OPTION, JOptionPane.WARNING_MESSAGE,
                null, new String[]{"Créer une base", "Ouvrir une base", "Récupérer l'accès",
                        "Restaurer une sauvegarde", "Annuler"}, "Annuler");
        if (mode < 0 || mode > 3) return;
        Path backupFile = null, externalEnvelope = null;
        if (mode == 3) {
            JFileChooser fileChooser = new JFileChooser();
            fileChooser.setDialogTitle("Choisir la sauvegarde chiffrée");
            if (fileChooser.showOpenDialog(null) != JFileChooser.APPROVE_OPTION) return;
            backupFile = fileChooser.getSelectedFile().toPath();
            fileChooser.setDialogTitle("Choisir la copie de key.envelope");
            if (fileChooser.showOpenDialog(null) != JFileChooser.APPROVE_OPTION) return;
            externalEnvelope = fileChooser.getSelectedFile().toPath();
        }
        JFileChooser chooser = new JFileChooser();
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        chooser.setDialogTitle(mode == 0 || mode == 3 ? "Choisir le dossier parent" : "Choisir le dossier de la base");
        if (chooser.showOpenDialog(null) != JFileChooser.APPROVE_OPTION) return;
        Path selected = chooser.getSelectedFile().toPath();
        if (mode == 0 || mode == 3) {
            String name = JOptionPane.showInputDialog(null, "Nom du nouveau dossier (lettres, chiffres, tirets) :");
            if (name == null) return;
            if (!name.matches("[A-Za-z0-9_-]{1,60}")) {
                JOptionPane.showMessageDialog(null, "Nom de dossier invalide.", "Erreur", JOptionPane.ERROR_MESSAGE);
                return;
            }
            selected = selected.resolve(name);
        }
        JPasswordField passwordField = new JPasswordField();
        JPasswordField recoveryField = new JPasswordField();
        Object prompt = mode == 2 || mode == 3 ? new Object[]{"Clé de récupération", recoveryField,
                "Nouveau mot de passe (12 à 128 caractères)", passwordField} : passwordField;
        if (JOptionPane.showConfirmDialog(null, prompt, "Mot de passe local",
                JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) {
            passwordField.setText("");
            recoveryField.setText("");
            return;
        }
        char[] password = passwordField.getPassword();
        passwordField.setText("");
        char[] recoveryInput = recoveryField.getPassword();
        recoveryField.setText("");
        Path directory = selected;
        Path restoreBackup = backupFile, restoreEnvelope = externalEnvelope;
        CompletableFuture.supplyAsync(() -> {
            byte[] key = null;
            String recovery = null;
            try {
                if (mode == 0) {
                    LocalKeyEnvelope.Created envelope = LocalKeyEnvelope.create(password);
                    recovery = envelope.recoveryCode();
                    key = LocalKeyEnvelope.unlockWithPassword(envelope.envelope(), password);
                    try (Connection connection = EncryptedDatabase.create(directory, key)) {
                        new StockLedger(connection).initialize();
                    }
                    Files.write(directory.resolve("key.envelope"), envelope.envelope(), StandardOpenOption.CREATE_NEW);
                } else {
                    if (mode == 3) RecoveryRestore.restore(restoreBackup, restoreEnvelope,
                            new String(recoveryInput), directory);
                    if (mode == 2 || mode == 3) EnvelopeRecovery.resetPassword(directory, new String(recoveryInput), password);
                    Path envelopeFile = directory.resolve("key.envelope");
                    if (Files.size(envelopeFile) > 1024) throw new IllegalArgumentException("Enveloppe trop volumineuse.");
                    key = LocalKeyEnvelope.unlockWithPassword(Files.readAllBytes(envelopeFile), password);
                }
                return new Started(new LocalStockServer(directory, key), recovery);
            } catch (Exception error) {
                throw new java.util.concurrent.CompletionException(new StartupException(error, recovery));
            } finally {
                Arrays.fill(password, '\0');
                Arrays.fill(recoveryInput, '\0');
                if (key != null) Arrays.fill(key, (byte) 0);
            }
        }).whenComplete((started, error) -> SwingUtilities.invokeLater(() -> {
            if (error != null) {
                if (error.getCause() instanceof StartupException startup && startup.recovery != null) {
                    JOptionPane.showMessageDialog(null, "La création a échoué. Si une enveloppe a été créée, "
                            + "conservez cette clé avant toute récupération :\n" + startup.recovery,
                            "Clé de récupération", JOptionPane.WARNING_MESSAGE);
                }
                Throwable cause = error.getCause() == null ? error : error.getCause().getCause();
                System.err.println("Ouverture de la base locale impossible : "
                        + (cause == null ? "erreur inconnue" : cause.getClass().getSimpleName()));
                JOptionPane.showMessageDialog(null, "Ouverture impossible. Vérifiez le dossier et le mot de passe.\n"
                        + "Si la création a échoué, le dossier partiel est conservé : " + directory,
                        "Erreur", JOptionPane.ERROR_MESSAGE);
                return;
            }
            if (started.recovery() != null) {
                JOptionPane.showMessageDialog(null, "Conservez cette clé de récupération hors du poste et "
                        + "une copie de key.envelope :\n" + started.recovery(),
                        "Clé de récupération", JOptionPane.WARNING_MESSAGE);
            }
            new PrototypeDesktop(started.server());
        }));
    }

    private void refresh() {
        perform("/products", null, response -> {
            table.setRowCount(0);
            for (JsonNode product : response) table.addRow(new Object[]{product.path("id").asText(),
                    product.path("sku").asText(), product.path("name").asText(), product.path("quantity").asText()});
        });
    }

    private void createProduct() {
        JTextField sku = new JTextField(), name = new JTextField(), quantity = new JTextField("0");
        if (JOptionPane.showConfirmDialog(window, new Object[]{"SKU", sku, "Produit", name, "Stock initial", quantity},
                "Nouveau produit", JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) return;
        try {
            var request = new LocalStockServer.Create(UUID.randomUUID(), UUID.randomUUID(),
                    sku.getText(), name.getText(), new BigDecimal(quantity.getText()));
            perform("/products", JSON.writeValueAsString(request), ignored -> refresh());
        } catch (Exception error) {
            JOptionPane.showMessageDialog(window, "Saisie invalide.", "Erreur", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void move(String direction) {
        int row = products.getSelectedRow();
        if (row < 0) {
            JOptionPane.showMessageDialog(window, "Sélectionnez un produit.");
            return;
        }
        String quantity = JOptionPane.showInputDialog(window, "Quantité :");
        if (quantity == null) return;
        try {
            var request = new LocalStockServer.Move(UUID.randomUUID(), UUID.fromString(table.getValueAt(row, 0).toString()),
                    StockLedger.Direction.valueOf(direction), new BigDecimal(quantity));
            perform("/movements", JSON.writeValueAsString(request), ignored -> refresh());
        } catch (Exception error) {
            JOptionPane.showMessageDialog(window, "Saisie invalide.", "Erreur", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void backup() {
        JFileChooser chooser = new JFileChooser();
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        chooser.setDialogTitle("Choisir un dossier sur l'équipement de sauvegarde");
        if (chooser.showOpenDialog(window) != JFileChooser.APPROVE_OPTION) return;
        Path destination = chooser.getSelectedFile().toPath().resolve("redams-" + UUID.randomUUID() + ".rdb");
        setBusy(true);
        CompletableFuture.runAsync(() -> {
            try {
                server.backup(destination);
            } catch (Exception error) {
                throw new java.util.concurrent.CompletionException(error);
            }
        }).whenComplete((ignored, error) -> SwingUtilities.invokeLater(() -> {
            setBusy(false);
            if (error != null) {
                System.err.println("Échec de sauvegarde : " + error.getCause().getClass().getSimpleName());
                JOptionPane.showMessageDialog(window, "Sauvegarde échouée. Vérifiez le dossier et les droits.",
                        "Erreur", JOptionPane.ERROR_MESSAGE);
            } else {
                JOptionPane.showMessageDialog(window, "Sauvegarde créée : " + destination
                        + "\nConservez aussi une copie de key.envelope et la clé de récupération, séparément.");
            }
        }));
    }

    private void perform(String path, String body, java.util.function.Consumer<JsonNode> onSuccess) {
        setBusy(true);
        CompletableFuture.supplyAsync(() -> {
            try {
                HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.port() + path))
                        .timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + server.token());
                if (body != null) request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body));
                HttpResponse<String> response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) throw new ServerResponseException(response.statusCode());
                return JSON.readTree(response.body());
            } catch (Exception error) {
                throw new java.util.concurrent.CompletionException(error);
            }
        }).whenComplete((result, error) -> SwingUtilities.invokeLater(() -> {
            setBusy(false);
            if (error != null) {
                Throwable cause = error.getCause();
                if (body != null && !(cause instanceof ServerResponseException response && response.status < 500)) {
                    uncertainWrite = true;
                    setBusy(false);
                }
                JOptionPane.showMessageDialog(window, uncertainWrite
                        ? "Résultat inconnu. Les écritures sont bloquées ; inspectez les données avant toute reprise."
                        : "Opération refusée ou erreur du serveur local.",
                        "Erreur", JOptionPane.ERROR_MESSAGE);
            } else onSuccess.accept(result);
        }));
    }

    private void setBusy(boolean busy) {
        refresh.setEnabled(!busy);
        create.setEnabled(!busy && !uncertainWrite);
        in.setEnabled(!busy && !uncertainWrite);
        out.setEnabled(!busy && !uncertainWrite);
        backup.setEnabled(!busy);
    }

    private record Started(LocalStockServer server, String recovery) {}
    private static final class StartupException extends Exception {
        private final String recovery;
        private StartupException(Exception cause, String recovery) {
            super(cause);
            this.recovery = recovery;
        }
    }
    private static final class ServerResponseException extends Exception {
        private final int status;
        private ServerResponseException(int status) { this.status = status; }
    }
}
