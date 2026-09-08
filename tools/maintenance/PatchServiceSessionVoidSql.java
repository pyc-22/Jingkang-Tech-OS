import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class PatchServiceSessionVoidSql {
  private static final String OLD_SQL =
      "select exists(select 1 from sales_order_service_session where service_session_id=:session)";
  private static final String NEW_SQL =
      "select exists(select 1 from sales_order_service_session link join sales_order linked_order on linked_order.id=link.order_id where link.service_session_id=:session and linked_order.status <> 'CANCELLED' and linked_order.refund_status <> 'FULL')";

  private PatchServiceSessionVoidSql() {}

  public static void main(String[] args) throws Exception {
    if (args.length != 2) {
      throw new IllegalArgumentException("Usage: PatchServiceSessionVoidSql <input.class> <output.class>");
    }

    byte[] input = Files.readAllBytes(Path.of(args[0]));
    byte[] oldBytes = OLD_SQL.getBytes(StandardCharsets.UTF_8);
    byte[] newBytes = NEW_SQL.getBytes(StandardCharsets.UTF_8);
    int matchOffset = findOnlyMatch(input, oldBytes);
    if (matchOffset < 3 || input[matchOffset - 3] != 1) {
      throw new IllegalStateException("Expected SQL to be stored in a CONSTANT_Utf8 entry");
    }

    int recordedLength = ((input[matchOffset - 2] & 0xff) << 8) | (input[matchOffset - 1] & 0xff);
    if (recordedLength != oldBytes.length || newBytes.length > 0xffff) {
      throw new IllegalStateException("Unexpected SQL constant length");
    }

    ByteArrayOutputStream patched = new ByteArrayOutputStream(input.length + newBytes.length - oldBytes.length);
    patched.write(input, 0, matchOffset - 2);
    patched.write((newBytes.length >>> 8) & 0xff);
    patched.write(newBytes.length & 0xff);
    patched.write(newBytes);
    patched.write(input, matchOffset + oldBytes.length, input.length - matchOffset - oldBytes.length);

    Path output = Path.of(args[1]);
    Files.createDirectories(output.getParent());
    Files.write(output, patched.toByteArray());
    System.out.println("Patched one ServiceSessionController SQL constant.");
  }

  private static int findOnlyMatch(byte[] input, byte[] target) {
    int found = -1;
    for (int offset = 0; offset <= input.length - target.length; offset++) {
      boolean match = true;
      for (int index = 0; index < target.length; index++) {
        if (input[offset + index] != target[index]) {
          match = false;
          break;
        }
      }
      if (match) {
        if (found >= 0) throw new IllegalStateException("SQL constant appeared more than once");
        found = offset;
      }
    }
    if (found < 0) throw new IllegalStateException("Expected SQL constant was not found");
    return found;
  }
}
