"use client";

import { useEffect, useState } from "react";
import {
  BLOCKED_SIGN_IN_REQUEST_MESSAGE,
  subscribeBlockedSignInRequest,
} from "@/lib/blocked-request-guard";

export function BlockedRequestNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    return subscribeBlockedSignInRequest(() => {
      setMessage(BLOCKED_SIGN_IN_REQUEST_MESSAGE);
    });
  }, []);

  if (!message) return null;

  return (
    <div className="blocked-request-banner" role="alert">
      {message}
    </div>
  );
}
