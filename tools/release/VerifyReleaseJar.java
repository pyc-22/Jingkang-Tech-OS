import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.OutputStream;
import java.net.URLClassLoader;
import java.util.jar.JarFile;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.springframework.boot.loader.launch.Archive;
import org.springframework.boot.loader.launch.JarLauncher;
import org.springframework.boot.loader.net.protocol.Handlers;

// Run with Java 21 source-file mode and only the release JAR on the classpath.
public class VerifyReleaseJar extends JarLauncher {
  private VerifyReleaseJar(Archive archive) throws Exception {
    super(archive);
  }

  public static void main(String[] args) throws Exception {
    File file = new File(args[0]);
    int libraries = 0;
    try (JarFile jar = new JarFile(file)) {
      if (!"org.springframework.boot.loader.launch.JarLauncher".equals(
          jar.getManifest().getMainAttributes().getValue("Main-Class"))) {
        throw new IllegalStateException("Expected a Spring Boot executable JAR");
      }
      var entries = jar.entries();
      while (entries.hasMoreElements()) {
        var entry = entries.nextElement();
        if (entry.isDirectory()) continue;
        byte[] data;
        try (var input = jar.getInputStream(entry)) { data = input.readAllBytes(); }
        CRC32 crc = new CRC32();
        crc.update(data);
        if (crc.getValue() != entry.getCrc()) throw new IllegalStateException("CRC mismatch: " + entry.getName());
        if (!entry.getName().startsWith("BOOT-INF/lib/") || !entry.getName().endsWith(".jar")) continue;
        if (entry.getMethod() != ZipEntry.STORED) {
          throw new IllegalStateException("Nested library must be STORED: " + entry.getName());
        }
        try (var nested = new ZipInputStream(new ByteArrayInputStream(data))) {
          int files = 0;
          while (nested.getNextEntry() != null) {
            nested.transferTo(OutputStream.nullOutputStream());
            files++;
          }
          if (files == 0) throw new IllegalStateException("Empty nested library: " + entry.getName());
        }
        libraries++;
      }
      if (libraries == 0) throw new IllegalStateException("No packaged runtime libraries");
      if (jar.getEntry("BOOT-INF/classes/db/migration/V101__member_store_codes.sql") == null) {
        throw new IllegalStateException("Missing V101 migration");
      }
    }

    Handlers.register();
    try (Archive archive = Archive.create(file)) {
      var probe = new VerifyReleaseJar(archive);
      try (var loader = (URLClassLoader) probe.createClassLoader(probe.getClassPathUrls())) {
        Thread.currentThread().setContextClassLoader(loader);
        Class.forName(probe.getMainClass(), false, loader);
        var home = Class.forName("com.chengxin.massage.HomeController", false, loader);
        var release = home.getDeclaredField("RELEASE");
        release.setAccessible(true);
        if (args.length > 1 && !args[1].equals(release.get(null))) {
          throw new IllegalStateException("Packaged release differs from source: " + release.get(null));
        }
        var proxy = Class.forName("ch.qos.logback.classic.spi.ThrowableProxy", true, loader);
        var exception = new IllegalStateException("EXPECTED_RELEASE_LOGGING_PROBE", new RuntimeException("nested cause"));
        Object throwable = proxy.getConstructor(Throwable.class).newInstance(exception);
        if (proxy.getMethod("getCause").invoke(throwable) == null) throw new IllegalStateException("Missing exception cause");
        var factory = Class.forName("org.slf4j.LoggerFactory", true, loader);
        Object logger = factory.getMethod("getLogger", String.class).invoke(null, "release-verification");
        Class.forName("org.slf4j.Logger", true, loader).getMethod("error", String.class, Throwable.class)
          .invoke(logger, "Expected exception: verifying packaged Logback", exception);
        System.out.println("RELEASE_JAR_OK release=" + release.get(null) + " libraries=" + libraries);
      }
    }
  }
}
