package shop;

import com.sun.net.httpserver.Filter;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import va.presence.rt.Journey;

/** The one line a service adds: each request runs inside the journey it carried. */
final class JourneyFilter extends Filter {
  @Override
  public void doFilter(HttpExchange exchange, Chain chain) throws IOException {
    try (Journey journey = Journey.enter(
        exchange.getRequestHeaders().getFirst("Cookie"), exchange.getRequestHeaders().getFirst("baggage"))) {
      chain.doFilter(exchange);
    }
  }

  @Override
  public String description() {
    return "variance-authority journey";
  }
}
