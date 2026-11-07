package fr.redams.desktop.server;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import fr.redams.desktop.stock.StockLedger;
import fr.redams.desktop.storage.EncryptedDatabase;
import fr.redams.desktop.storage.VerifiedBackup;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Loopback-only prototype, not an authenticated multi-user server. */
public final class LocalStockServer implements AutoCloseable {
    private static final int MAX_BODY = 8192;
    private static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private final Path directory;
    private final byte[] key;
    private final String token;
    private final HttpServer server;
    private final ExecutorService executor;

    public LocalStockServer(Path directory, byte[] key) throws IOException, SQLException, GeneralSecurityException {
        if (directory == null || key == null || key.length != 32) throw new IllegalArgumentException("Invalid database or key.");
        try (Connection connection = EncryptedDatabase.open(directory, key);
             Statement statement = connection.createStatement();
             ResultSet ignored = statement.executeQuery("SELECT id FROM local_stock_lock WHERE id=1")) {
            if (!ignored.next()) throw new SQLException("Stock ledger is not initialized.");
        }
        this.directory = directory.toAbsolutePath().normalize();
        this.key = key.clone();
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        Arrays.fill(random, (byte) 0);
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 16);
        executor = Executors.newFixedThreadPool(4);
        server.setExecutor(executor);
        server.createContext("/", this::handle);
        server.start();
    }

    public int port() { return server.getAddress().getPort(); }
    public String token() { return token; }

    public synchronized void backup(Path destination) throws IOException, SQLException, GeneralSecurityException {
        VerifiedBackup.create(directory, key, destination);
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            byte[] expected = ("Bearer " + token).getBytes(StandardCharsets.US_ASCII);
            byte[] supplied = authorization == null ? new byte[0] : authorization.getBytes(StandardCharsets.US_ASCII);
            if (!MessageDigest.isEqual(expected, supplied)) {
                respond(exchange, 401, new ErrorMessage("Authentification requise."));
                return;
            }
            if (exchange.getRequestURI().getRawQuery() != null) {
                respond(exchange, 400, new ErrorMessage("Paramètres non acceptés."));
                return;
            }
            String path = exchange.getRequestURI().getPath(), method = exchange.getRequestMethod();
            if (path.equals("/products") && method.equals("GET")) {
                respond(exchange, 200, products());
            } else if (path.equals("/products") && method.equals("POST")) {
                Create request = read(exchange, Create.class);
                if (request.operationId() == null || request.productId() == null) throw new IllegalArgumentException("Missing ID.");
                try (Connection connection = EncryptedDatabase.open(directory, key)) {
                    respond(exchange, 200, new StockLedger(connection).createProduct(request.operationId(),
                            request.productId(), "prototype", request.sku(), request.name(), request.quantity()));
                }
            } else if (path.equals("/movements") && method.equals("POST")) {
                Move request = read(exchange, Move.class);
                if (request.operationId() == null || request.productId() == null || request.direction() == null) {
                    throw new IllegalArgumentException("Missing ID or direction.");
                }
                try (Connection connection = EncryptedDatabase.open(directory, key)) {
                    respond(exchange, 200, new StockLedger(connection).move(request.operationId(),
                            request.productId(), "prototype", request.direction(), request.quantity()));
                }
            } else {
                respond(exchange, 404, new ErrorMessage("Ressource introuvable."));
            }
        } catch (IllegalArgumentException error) {
            respond(exchange, 400, new ErrorMessage("Requête invalide ou opération refusée."));
        } catch (SQLException | GeneralSecurityException error) {
            System.err.println("Erreur du serveur local : " + error.getClass().getSimpleName());
            respond(exchange, 500, new ErrorMessage("Erreur de base locale. Consultez le journal serveur."));
        } finally {
            exchange.close();
        }
    }

    private List<Product> products() throws SQLException, GeneralSecurityException {
        List<Product> products = new ArrayList<>();
        try (Connection connection = EncryptedDatabase.open(directory, key);
             Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("SELECT id,sku,name,quantity_milli FROM local_stock_products ORDER BY name,id")) {
            while (rows.next()) products.add(new Product(rows.getObject(1, UUID.class), rows.getString(2),
                    rows.getString(3), BigDecimal.valueOf(rows.getLong(4), 3)));
        }
        return products;
    }

    private static <T> T read(HttpExchange exchange, Class<T> type) throws IOException {
        String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
        if (contentType == null || !contentType.equalsIgnoreCase("application/json")) {
            throw new IllegalArgumentException("Expected application/json.");
        }
        byte[] data = exchange.getRequestBody().readNBytes(MAX_BODY + 1);
        if (data.length > MAX_BODY) throw new IllegalArgumentException("Request too large.");
        try {
            T value = JSON.readValue(data, type);
            if (value == null) throw new IllegalArgumentException("Request is empty.");
            return value;
        } catch (com.fasterxml.jackson.core.JacksonException error) {
            throw new IllegalArgumentException("Invalid JSON.", error);
        }
    }

    private static void respond(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = JSON.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    @Override public synchronized void close() {
        server.stop(2);
        executor.shutdownNow();
        Arrays.fill(key, (byte) 0);
    }

    private record ErrorMessage(String error) {}
    public record Product(UUID id, String sku, String name, BigDecimal quantity) {}
    public record Create(UUID operationId, UUID productId, String sku, String name, BigDecimal quantity) {}
    public record Move(UUID operationId, UUID productId, StockLedger.Direction direction, BigDecimal quantity) {}
}
