package com.chengxin.massage.catalog;

/** State rules shared by mobile acceptance, timeout processing, and front-desk reassignment. */
public final class ServiceDispatchLifecycle {
  public static final int DEFAULT_ACCEPTANCE_TIMEOUT_SECONDS = 300;

  private ServiceDispatchLifecycle() {}

  static boolean canBeReassigned(String sessionStatus) {
    return "REASSIGNMENT_REQUIRED".equals(sessionStatus) || "DISPATCH_CANCELLED".equals(sessionStatus);
  }

  static boolean canCancelDispatch(String sessionStatus) {
    return "REASSIGNMENT_REQUIRED".equals(sessionStatus);
  }

  static boolean canStart(String sessionStatus) {
    return "ACCEPTED".equals(sessionStatus);
  }

  static String awaitingReplacementStatus() {
    return "REASSIGNMENT_REQUIRED";
  }
}
