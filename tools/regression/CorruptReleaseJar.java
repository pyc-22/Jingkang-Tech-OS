import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

// Creates deliberately broken test artifacts; never changes the input JAR.
class CorruptReleaseJar {
  public static void main(String[] args) throws Exception {
    try (var input = new ZipInputStream(Files.newInputStream(Path.of(args[0])));
         var output = new ZipOutputStream(Files.newOutputStream(Path.of(args[1])))) {
      ZipEntry entry;
      while ((entry = input.getNextEntry()) != null) {
        byte[] data = input.readAllBytes();
        if (entry.getName().startsWith("BOOT-INF/lib/logback-classic-")) {
          if (args[2].equals("missing-library")) continue;
          if (args[2].equals("missing-class")) {
            var buffer = new ByteArrayOutputStream();
            try (var nested = new ZipInputStream(new ByteArrayInputStream(data));
                 var rewritten = new ZipOutputStream(buffer)) {
              ZipEntry item;
              while ((item = nested.getNextEntry()) != null) {
                byte[] bytes = nested.readAllBytes();
                if (item.getName().equals("ch/qos/logback/classic/spi/ThrowableProxy.class")) continue;
                rewritten.putNextEntry(new ZipEntry(item.getName()));
                rewritten.write(bytes);
                rewritten.closeEntry();
              }
            }
            data = buffer.toByteArray();
          }
        }
        var replacement = new ZipEntry(entry.getName());
        if (entry.getMethod() == ZipEntry.STORED && !args[2].equals("compressed-libraries")) {
          replacement.setMethod(ZipEntry.STORED);
          replacement.setSize(data.length);
          var crc = new CRC32(); crc.update(data);
          replacement.setCrc(crc.getValue());
        }
        output.putNextEntry(replacement);
        output.write(data);
        output.closeEntry();
      }
    }
  }
}
