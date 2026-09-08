package com.chengxin.massage.catalog;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.chengxin.massage.admin.StoreContextService;

@RestController
@RequestMapping("/api/v1/technician-queue")
@CrossOrigin(origins = "*")
public class TechnicianQueueController {
  private final TechnicianQueueService queue;
  private final StoreContextService storeContext;

  TechnicianQueueController(TechnicianQueueService queue, StoreContextService storeContext) {
    this.queue = queue;
    this.storeContext = storeContext;
  }

  @GetMapping
  TechnicianQueueService.QueueSnapshot current(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    return queue.currentQueue(storeContext.currentStore(authorization, requestedStoreId));
  }

  @GetMapping("/events")
  List<TechnicianQueueService.QueueEvent> events(@RequestParam(defaultValue = "40") int limit,
                                                  @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
                                                  @RequestHeader(value = "X-Store-Id", required = false) String requestedStoreId) {
    UUID storeId = storeContext.currentStore(authorization, requestedStoreId);
    return queue.events(storeId, limit);
  }
}
