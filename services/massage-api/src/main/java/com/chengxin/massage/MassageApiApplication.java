package com.chengxin.massage;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class MassageApiApplication {
  public static void main(String[] args) { SpringApplication.run(MassageApiApplication.class, args); }
}
