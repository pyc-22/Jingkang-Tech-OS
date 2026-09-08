package com.chengxin.massage.mobile;

import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/mobile/auth")
@CrossOrigin(origins = "*")
public class MobileAuthController {
  private final MobileSessionService sessions;

  MobileAuthController(MobileSessionService sessions) { this.sessions = sessions; }

  @PostMapping("/login")
  LoginResponse login(@Valid @RequestBody LoginInput input) {
    MobileSessionService.LoginSession session = sessions.login(input.loginName(), input.password());
    return new LoginResponse(session.accessToken(), session.expiresAt(), session.displayName());
  }

  @PostMapping("/logout")
  void logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { sessions.logout(authorization); }

  record LoginInput(@NotBlank String loginName, @NotBlank String password) {}
  record LoginResponse(String accessToken, OffsetDateTime expiresAt, String displayName) {}
}
