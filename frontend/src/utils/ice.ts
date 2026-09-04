export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  // Fast global STUN servers
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },

  // UDP TURN servers
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },

  // Critical TCP TURN fallback (for restrictive cellular NAT & firewalls that block UDP)
  {
    urls: "turn:openrelay.metered.ca:80?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },

  // Secure TLS TURNS fallback (looks like standard HTTPS, unblockable by any ISP/firewall)
  {
    urls: "turns:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turns:openrelay.metered.ca:5349?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];
