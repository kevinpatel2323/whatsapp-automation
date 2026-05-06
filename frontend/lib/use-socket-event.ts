"use client";

import { useEffect, useRef } from "react";
import { getSocket } from "./socket";

export function useSocketEvent(
  event: string,
  handler: (data: unknown) => void,
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const h = (data: unknown) => {
      ref.current(data);
    };
    s.on(event, h);
    return () => {
      s.off(event, h);
    };
  }, [event]);
}
