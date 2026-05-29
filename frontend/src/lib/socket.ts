import { io } from "socket.io-client";
import { getToken } from "./tokenStorage";

const socket = io("http://localhost:8000", {
  auth: (cb) => {
    cb({ token: getToken() ?? "" });
  },
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 10_000,
  // Start with polling (always works), then upgrade to websocket.
  // Reversing the order causes the first attempt to fail and adds a 1s reconnect delay.
  transports: ["polling", "websocket"],
});


export default socket;
