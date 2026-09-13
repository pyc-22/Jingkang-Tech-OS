package com.chengxin.massage.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/auth")
@CrossOrigin(origins = "*")
public class AdminAuthController {
  private final AdminSessionService sessions;
  AdminAuthController(AdminSessionService sessions) { this.sessions = sessions; }
  @PostMapping("/login") AdminSessionService.AdminLogin login(@Valid @RequestBody LoginInput input) { return sessions.login(input.loginName(), input.password()); }
  @GetMapping("/session") AdminSessionService.AdminSession session(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { return sessions.session(authorization); }
  @PostMapping("/logout") void logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { sessions.logout(authorization); }
  @PutMapping("/password") void changePassword(@Valid @RequestBody PasswordChangeInput input, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) { sessions.changePassword(authorization, input.currentPassword(), input.newPassword()); }
  record LoginInput(@NotBlank @Size(max=80) String loginName, @NotBlank @Size(min=8,max=128) String password) {}
  record PasswordChangeInput(@NotBlank @Size(min=8,max=128) String currentPassword, @NotBlank @Size(min=8,max=128) String newPassword) {}
}
