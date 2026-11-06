package fr.redams.desktop.stock;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Objects;
import java.util.UUID;

/**
 * Experimental stock ledger. Quantities are stored as thousandths, and every
 * stock change and its pending synchronization record share one transaction.
 */
public final class StockLedger {
    private static final long MAX_QUANTITY = 99_999_999_999_999L;
    private final Connection connection;

    public StockLedger(Connection connection) {
        this.connection = Objects.requireNonNull(connection);
    }

    /**
     * Initializes a new, empty database only. Failure leaves it unavailable
     * until explicitly inspected; this method must not be used as a migration.
     */
    public void initialize() throws SQLException {
        requireAutoCommit();
        if (!"PUBLIC".equals(connection.getSchema())) throw new SQLException("The PUBLIC schema is required.");
        try (Statement statement = connection.createStatement()) {
            try (ResultSet tables = statement.executeQuery("""
                    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                    WHERE TABLE_SCHEMA='PUBLIC' AND TABLE_TYPE='BASE TABLE'
                    """)) {
                if (!tables.next() || tables.getLong(1) != 0) {
                    throw new SQLException("Stock ledger initialization requires an empty database.");
                }
            }
            statement.execute("CREATE TABLE local_stock_lock (id INT PRIMARY KEY CHECK(id=1))");
            statement.execute("INSERT INTO local_stock_lock VALUES (1)");
            statement.execute("""
                    CREATE TABLE local_stock_products (
                        id UUID PRIMARY KEY, sku VARCHAR(100) NOT NULL UNIQUE,
                        name VARCHAR(180) NOT NULL, quantity_milli BIGINT NOT NULL
                            CHECK(quantity_milli >= 0 AND quantity_milli <= 99999999999999)
                    )
                    """);
            statement.execute("""
                    CREATE TABLE local_stock_operations (
                        id UUID PRIMARY KEY, product_id UUID NOT NULL,
                        actor_id VARCHAR(100) NOT NULL, kind VARCHAR(10) NOT NULL,
                        sku VARCHAR(100), name VARCHAR(180),
                        quantity_milli BIGINT NOT NULL, resulting_milli BIGINT NOT NULL,
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        sync_status VARCHAR(10) NOT NULL DEFAULT 'pending'
                            CHECK(sync_status IN ('pending', 'confirmed', 'conflict')),
                        FOREIGN KEY (product_id) REFERENCES local_stock_products(id)
                    )
                    """);
        }
    }

    public Result createProduct(UUID operationId, UUID productId, String actorId,
                                String sku, String name, BigDecimal initialQuantity) throws SQLException {
        Request request = new Request(required(operationId), required(productId), text(actorId, 100),
                "CREATE", text(sku, 100), text(name, 180), quantity(initialQuantity, true));
        return execute(request);
    }

    public Result move(UUID operationId, UUID productId, String actorId, Direction direction,
                       BigDecimal amount) throws SQLException {
        Request request = new Request(required(operationId), required(productId), text(actorId, 100),
                Objects.requireNonNull(direction).name(), null, null, quantity(amount, false));
        return execute(request);
    }

    public enum Direction { IN, OUT }

    public record Result(UUID operationId, UUID productId, BigDecimal quantity, boolean replayed) {}

    private record Request(UUID operationId, UUID productId, String actor, String kind,
                           String sku, String name, long amount) {}

    private Result execute(Request request) throws SQLException {
        requireAutoCommit();
        connection.setAutoCommit(false);
        Throwable failure = null;
        boolean rollbackFailed = false;
        try {
            try (Statement lock = connection.createStatement();
                 ResultSet row = lock.executeQuery("SELECT id FROM local_stock_lock WHERE id=1 FOR UPDATE")) {
                if (!row.next()) throw new SQLException("Stock ledger lock is missing.");
            }
            Result existing = existing(request);
            if (existing != null) {
                connection.commit();
                return existing;
            }

            long next;
            if ("CREATE".equals(request.kind())) {
                next = request.amount();
                try (PreparedStatement insert = connection.prepareStatement(
                        "INSERT INTO local_stock_products(id,sku,name,quantity_milli) VALUES(?,?,?,?)")) {
                    insert.setObject(1, request.productId());
                    insert.setString(2, request.sku());
                    insert.setString(3, request.name());
                    insert.setLong(4, next);
                    insert.executeUpdate();
                }
            } else {
                long current;
                try (PreparedStatement query = connection.prepareStatement(
                        "SELECT quantity_milli FROM local_stock_products WHERE id=? FOR UPDATE")) {
                    query.setObject(1, request.productId());
                    try (ResultSet row = query.executeQuery()) {
                        if (!row.next()) throw new IllegalArgumentException("Product not found.");
                        current = row.getLong(1);
                    }
                }
                if ("OUT".equals(request.kind()) && request.amount() > current) {
                    throw new IllegalArgumentException("Insufficient stock.");
                }
                next = "IN".equals(request.kind()) ? current + request.amount() : current - request.amount();
                if (next > MAX_QUANTITY) throw new IllegalArgumentException("Maximum stock exceeded.");
                try (PreparedStatement update = connection.prepareStatement(
                        "UPDATE local_stock_products SET quantity_milli=? WHERE id=?")) {
                    update.setLong(1, next);
                    update.setObject(2, request.productId());
                    if (update.executeUpdate() != 1) throw new SQLException("Product update failed.");
                }
            }
            try (PreparedStatement insert = connection.prepareStatement("""
                    INSERT INTO local_stock_operations
                        (id,product_id,actor_id,kind,sku,name,quantity_milli,resulting_milli)
                    VALUES(?,?,?,?,?,?,?,?)
                    """)) {
                insert.setObject(1, request.operationId());
                insert.setObject(2, request.productId());
                insert.setString(3, request.actor());
                insert.setString(4, request.kind());
                insert.setString(5, request.sku());
                insert.setString(6, request.name());
                insert.setLong(7, request.amount());
                insert.setLong(8, next);
                insert.executeUpdate();
            }
            connection.commit();
            return result(request, next, false);
        } catch (SQLException | RuntimeException | Error error) {
            failure = error;
            try {
                connection.rollback();
            } catch (SQLException rollbackError) {
                rollbackFailed = true;
                error.addSuppressed(rollbackError);
            }
            throw error;
        } finally {
            if (rollbackFailed) {
                try {
                    connection.close();
                } catch (SQLException closeError) {
                    failure.addSuppressed(closeError);
                }
            } else {
                try {
                    connection.setAutoCommit(true);
                } catch (SQLException resetError) {
                    try {
                        connection.close();
                    } catch (SQLException closeError) {
                        resetError.addSuppressed(closeError);
                    }
                    if (failure != null) failure.addSuppressed(resetError);
                    else throw resetError;
                }
            }
        }
    }

    private Result existing(Request request) throws SQLException {
        try (PreparedStatement query = connection.prepareStatement("""
                SELECT product_id,actor_id,kind,sku,name,quantity_milli,resulting_milli
                FROM local_stock_operations WHERE id=?
                """)) {
            query.setObject(1, request.operationId());
            try (ResultSet row = query.executeQuery()) {
                if (!row.next()) return null;
                if (!request.productId().equals(row.getObject(1, UUID.class))
                        || !request.actor().equals(row.getString(2))
                        || !request.kind().equals(row.getString(3))
                        || !Objects.equals(request.sku(), row.getString(4))
                        || !Objects.equals(request.name(), row.getString(5))
                        || request.amount() != row.getLong(6)) {
                    throw new IllegalArgumentException("Operation ID already used for a different request.");
                }
                return result(request, row.getLong(7), true);
            }
        }
    }

    private static Result result(Request request, long quantity, boolean replayed) {
        return new Result(request.operationId(), request.productId(), BigDecimal.valueOf(quantity, 3), replayed);
    }

    private void requireAutoCommit() throws SQLException {
        if (!connection.getAutoCommit()) throw new IllegalStateException("A dedicated connection without an active transaction is required.");
    }

    private static UUID required(UUID id) {
        return Objects.requireNonNull(id, "An operation and product ID are required.");
    }

    private static String text(String value, int maxLength) {
        if (value == null || value.isBlank() || !value.equals(value.trim()) || value.length() > maxLength) {
            throw new IllegalArgumentException("Invalid stock operation text.");
        }
        return value;
    }

    private static long quantity(BigDecimal value, boolean allowZero) {
        if (value == null) throw new IllegalArgumentException("Quantity is required.");
        try {
            long amount = value.setScale(3, RoundingMode.UNNECESSARY).movePointRight(3).longValueExact();
            if (amount < (allowZero ? 0 : 1) || amount > MAX_QUANTITY) {
                throw new IllegalArgumentException("Quantity is out of range.");
            }
            return amount;
        } catch (ArithmeticException error) {
            throw new IllegalArgumentException("Quantity must have at most three decimal places and be in range.", error);
        }
    }
}
