package com.chengxin.massage;

import java.util.Map;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class ApiExceptionHandler {
  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<Map<String, Object>> status(ResponseStatusException exception) {
    return error(exception.getStatusCode().value(), exception.getReason() == null ? "Request rejected" : exception.getReason());
  }

  @ExceptionHandler(EmptyResultDataAccessException.class)
  ResponseEntity<Map<String, Object>> missing() { return error(404, "Resource not found"); }

  @ExceptionHandler({DataIntegrityViolationException.class, ConcurrencyFailureException.class})
  ResponseEntity<Map<String, Object>> conflict() { return error(409, "Data changed or conflicts with existing records; refresh and retry"); }

  @ExceptionHandler(IllegalArgumentException.class)
  ResponseEntity<Map<String, Object>> invalid() { return error(422, "Invalid business input"); }

  private ResponseEntity<Map<String, Object>> error(int status, String message) {
    return ResponseEntity.status(status).body(Map.of("status", status, "message", message));
  }
}
