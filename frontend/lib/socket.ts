import { io, type Socket } from "socket.io-client";
import { apiBase } from "./api";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (typeof window === "undefined") {
    throw new Error("getSocket is client-only");
  }
  if (!socket) {
    const url = apiBase();
    socket = io(url, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
    });
  }
  return socket;
}

export function resetSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.close();
    socket = null;
  }
}
