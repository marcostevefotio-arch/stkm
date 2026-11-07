package fr.redams.desktop.server;

import fr.redams.desktop.stock.StockLedger;
import fr.redams.desktop.storage.EncryptedDatabase;
import fr.redams.desktop.storage.VerifiedBackup;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.util.Arrays;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class LocalStockServerTest {
    @TempDir Path temp;

    @Test
    void servesAuthenticatedStockOnlyOnLoopbackAndRejectsBadRequests() throws Exception {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        Path db = temp.resolve("db");
        try {
            try (Connection connection = EncryptedDatabase.create(db, key)) {
                new StockLedger(connection).initialize();
            }
            try (LocalStockServer server = new LocalStockServer(db, key)) {
                HttpClient client = HttpClient.newHttpClient();
                String url = "http://127.0.0.1:" + server.port();
                assertEquals(401, send(client, url + "/products", null, null).statusCode());
                UUID product = UUID.randomUUID(), op = UUID.randomUUID();
                String create = "{\"operationId\":\"" + op + "\",\"productId\":\"" + product
                        + "\",\"sku\":\"SKU\",\"name\":\"Produit\",\"quantity\":2}";
                assertEquals(200, send(client, url + "/products", server.token(), create).statusCode());
                assertTrue(send(client, url + "/products", server.token(), create).body().contains("\"replayed\":true"));
                assertTrue(send(client, url + "/products", server.token(), null).body().contains("\"quantity\":2.000"));
                String move = "{\"operationId\":\"" + UUID.randomUUID() + "\",\"productId\":\"" + product
                        + "\",\"direction\":\"OUT\",\"quantity\":3}";
                assertEquals(400, send(client, url + "/movements", server.token(), move).statusCode());
                assertEquals(400, send(client, url + "/products", server.token(), "{\"sku\":\"a\",\"sku\":\"b\"}").statusCode());
                assertEquals(400, send(client, url + "/products", server.token(), "x".repeat(8193)).statusCode());
                assertEquals(404, send(client, url + "/unknown", server.token(), null).statusCode());
                assertEquals(400, send(client, url + "/products?token=wrong", server.token(), null).statusCode());
                Path backup = temp.resolve("server.rdb"), restored = temp.resolve("restored");
                server.backup(backup);
                VerifiedBackup.restore(backup, key, restored);
                try (Connection connection = EncryptedDatabase.open(restored, key);
                     var statement = connection.createStatement();
                     var rows = statement.executeQuery("SELECT sku,quantity_milli FROM local_stock_products")) {
                    assertTrue(rows.next());
                    assertEquals("SKU", rows.getString(1));
                    assertEquals(2000, rows.getLong(2));
                }
            }
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    private static HttpResponse<String> send(HttpClient client, String url, String token, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url));
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (body != null) request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
