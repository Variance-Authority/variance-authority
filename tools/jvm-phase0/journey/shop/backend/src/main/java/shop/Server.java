package shop;

import com.sun.net.httpserver.HttpContext;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;

public final class Server {
  private static final Path STATIC = Paths.get("frontend");

  public static void main(String[] args) throws IOException {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8123"));
    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    route(server, "/", Server::page);
    route(server, "/api/cart", exchange -> json(exchange, Cart.summary(items(exchange))));
    route(server, "/api/search", exchange -> json(exchange, Search.find(query(exchange, "q"))));
    server.start();
    System.out.println("shop listening on " + port);
  }

  private interface Handler {
    void handle(HttpExchange exchange) throws IOException;
  }

  private static void route(HttpServer server, String path, Handler handler) {
    HttpContext context = server.createContext(path, handler::handle);
    context.getFilters().add(new JourneyFilter());
  }

  private static void page(HttpExchange exchange) throws IOException {
    String path = exchange.getRequestURI().getPath();
    Path file = STATIC.resolve(path.equals("/") ? "index.html" : path.substring(1)).normalize();
    if (!file.startsWith(STATIC) || !Files.isRegularFile(file)) {
      send(exchange, 404, "text/plain", "not found");
      return;
    }
    String type = file.toString().endsWith(".js") ? "text/javascript" : "text/html";
    send(exchange, 200, type, new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
  }

  private static List<String> items(HttpExchange exchange) {
    String items = query(exchange, "items");
    return items.isEmpty() ? List.of() : Arrays.asList(items.split(","));
  }

  private static String query(HttpExchange exchange, String name) {
    String raw = exchange.getRequestURI().getRawQuery();
    if (raw == null) return "";
    for (String pair : raw.split("&")) {
      int eq = pair.indexOf('=');
      if (eq > 0 && pair.substring(0, eq).equals(name)) {
        return URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
      }
    }
    return "";
  }

  private static void json(HttpExchange exchange, String body) throws IOException {
    send(exchange, 200, "application/json", body);
  }

  private static void send(HttpExchange exchange, int status, String type, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", type + "; charset=utf-8");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
    }
  }
}
