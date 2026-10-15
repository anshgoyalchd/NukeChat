import QRCode from "qrcode";

/**
 * Extracts essential WebRTC parameters (ufrag, pwd, fingerprint, candidates, m-lines)
 * to allow ultra-compact QR payloads (<140 characters) that result in low-density,
 * large-module QR codes (Version 5-6) that scan instantly on any mobile camera.
 */
export interface SdpExtract {
  ufrag: string;
  pwd: string;
  fpHex: string;
  ip: string;
  port: string;
  mTypes: string; // e.g. "dv" (datachannel + video) or "dva" (datachannel + video + audio)
}

export function extractSdpParams(sdp: string): SdpExtract | null {
  try {
    const ufrag = sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1]?.trim() || "";
    const pwd = sdp.match(/a=ice-pwd:([^\r\n]+)/)?.[1]?.trim() || "";
    const rawFp = sdp.match(/a=fingerprint:sha-256 ([^\r\n]+)/)?.[1]?.trim() || "";
    const fpHex = rawFp.replace(/:/g, "").trim();

    if (!ufrag || !pwd || !fpHex) {
      return null;
    }

    // Extract candidates - prefer local private Wi-Fi / LAN IP (192.168.x, 10.x, 172.16-31.x)
    const candMatches = [...sdp.matchAll(/(?:a=)?candidate:\S+ \d+ \w+ \d+ (\S+) (\d+) typ host/gi)];
    let ip = "";
    let port = "";

    // 1. Look for typical LAN IP
    for (const m of candMatches) {
      const candIp = m[1];
      if (
        candIp.startsWith("192.168.") ||
        candIp.startsWith("10.") ||
        candIp.startsWith("172.16.") ||
        candIp.startsWith("172.20.") ||
        candIp.startsWith("172.30.") ||
        candIp.startsWith("172.31.")
      ) {
        ip = candIp;
        port = m[2];
        break;
      }
    }

    // 2. If no private IP matched, pick first non-loopback host candidate
    if (!ip && candMatches.length > 0) {
      for (const m of candMatches) {
        const candIp = m[1];
        if (candIp !== "127.0.0.1" && !candIp.startsWith("127.") && candIp !== "::1" && candIp !== "0.0.0.0") {
          ip = candIp;
          port = m[2];
          break;
        }
      }
    }

    // 3. Fallback to first candidate if all else fails
    if (!ip && candMatches.length > 0) {
      ip = candMatches[0][1];
      port = candMatches[0][2];
    }

    // 4. Fallback to known custom host IP or LAN hostname if candidates were obscured
    if (!ip && typeof window !== "undefined") {
      try {
        const customIp = localStorage.getItem("nukechat_custom_host_ip");
        if (customIp && (customIp.startsWith("192.168.") || customIp.startsWith("10."))) {
          ip = customIp;
          port = "50000";
        } else if (window.location.hostname && (window.location.hostname.startsWith("192.168.") || window.location.hostname.startsWith("10."))) {
          ip = window.location.hostname;
          port = "50000";
        }
      } catch (e) {}
    }

    let mTypes = "";
    for (const match of sdp.matchAll(/^m=(\w+)/gm)) {
      const kind = match[1];
      if (kind === "application") mTypes += "d";
      else if (kind === "video") mTypes += "v";
      else if (kind === "audio") mTypes += "a";
    }
    if (!mTypes) mTypes = "dv";

    return { ufrag, pwd, fpHex, ip, port, mTypes };
  } catch (err) {
    console.warn("[OfflinePairing] Failed to extract SDP parameters:", err);
    return null;
  }
}

export function buildSdpFromParams(params: SdpExtract, isOffer: boolean): string {
  const { ufrag, pwd, fpHex, ip, port, mTypes } = params;
  const fingerprint = fpHex.match(/.{1,2}/g)?.join(":").toUpperCase() || fpHex;
  const setup = isOffer ? "actpass" : "active";

  const lines: string[] = [
    "v=0",
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
  ];

  const mids: string[] = [];
  const types = mTypes.split("");
  types.forEach((_, i) => mids.push(String(i)));
  lines.push(`a=group:BUNDLE ${mids.join(" ")}`);
  lines.push("a=msid-semantic: WMS");

  types.forEach((type, idx) => {
    const mid = String(idx);
    if (type === "d") {
      lines.push(
        "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
        "c=IN IP4 0.0.0.0",
        `a=ice-ufrag:${ufrag}`,
        `a=ice-pwd:${pwd}`,
        `a=fingerprint:sha-256 ${fingerprint}`,
        `a=setup:${setup}`,
        `a=mid:${mid}`,
        "a=sctp-port:5000",
        "a=max-message-size:262144"
      );
      if (ip && port) {
        lines.push(`a=candidate:${idx + 1} 1 udp 2130706431 ${ip} ${port} typ host`);
      }
    } else if (type === "v") {
      lines.push(
        "m=video 9 UDP/TLS/RTP/SAVPF 96",
        "c=IN IP4 0.0.0.0",
        "a=rtcp:9 IN IP4 0.0.0.0",
        "a=rtcp-mux",
        "a=rtcp-rsize",
        `a=ice-ufrag:${ufrag}`,
        `a=ice-pwd:${pwd}`,
        `a=fingerprint:sha-256 ${fingerprint}`,
        `a=setup:${setup}`,
        `a=mid:${mid}`,
        isOffer ? "a=sendonly" : "a=recvonly",
        "a=rtpmap:96 VP8/90000",
        "a=rtcp-fb:96 goog-remb",
        "a=rtcp-fb:96 transport-cc",
        "a=rtcp-fb:96 ccm fir",
        "a=rtcp-fb:96 nack",
        "a=rtcp-fb:96 nack pli"
      );
      if (ip && port) {
        lines.push(`a=candidate:${idx + 1} 1 udp 2130706431 ${ip} ${port} typ host`);
      }
    } else if (type === "a") {
      lines.push(
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        "c=IN IP4 0.0.0.0",
        "a=rtcp:9 IN IP4 0.0.0.0",
        "a=rtcp-mux",
        "a=rtcp-rsize",
        `a=ice-ufrag:${ufrag}`,
        `a=ice-pwd:${pwd}`,
        `a=fingerprint:sha-256 ${fingerprint}`,
        `a=setup:${setup}`,
        `a=mid:${mid}`,
        isOffer ? "a=sendonly" : "a=recvonly",
        "a=rtpmap:111 opus/48000/2",
        "a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000"
      );
      if (ip && port) {
        lines.push(`a=candidate:${idx + 1} 1 udp 2130706431 ${ip} ${port} typ host`);
      }
    }
  });

  return lines.join("\r\n") + "\r\n";
}

/**
 * Compresses an SDP string using native CompressionStream ('deflate').
 * Compresses typical ~2500 byte SDP down to ~250-350 bytes for ultra-fast QR scanning.
 */
export async function compressSdp(sdp: string): Promise<string> {
  // Strip non-essential lines and remote non-host candidates to optimize QR density for local LAN
  const minified = sdp
    .split("\r\n")
    .filter((line) => {
      if (line.startsWith("a=candidate:") && !line.includes("typ host")) {
        return false;
      }
      return true;
    })
    .join("\r\n");

  const stream = new Blob([minified]).stream().pipeThrough(new CompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decompresses an SDP string using native DecompressionStream ('deflate').
 */
export async function decompressSdp(compressed: string): Promise<string> {
  let standard = compressed.replace(/-/g, "+").replace(/_/g, "/");
  while (standard.length % 4) standard += "=";
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).text();
}

export interface QrOfferPayload {
  t: "O"; // Offer
  c: string; // roomCode
  h: string; // hostId
  s: string; // compressed SDP offer
}

export interface QrAnswerPayload {
  t: "A"; // Answer
  c: string; // roomCode
  u: string; // studentId
  s: string; // compressed SDP answer
}

export async function createOfferQrString(roomCode: string, hostId: string, sdp: string): Promise<string> {
  const normCode = roomCode.toUpperCase();
  const params = extractSdpParams(sdp);
  if (params && params.ip) {
    return `NC2:O|${normCode}|${hostId}|${params.mTypes}|${params.ufrag}|${params.pwd}|${params.fpHex}|${params.ip}:${params.port}`;
  }

  // Fallback to compressed SDP if parameter extraction didn't yield a valid candidate
  const compressed = await compressSdp(sdp);
  const payload: QrOfferPayload = {
    t: "O",
    c: normCode,
    h: hostId,
    s: compressed,
  };
  return "NC:" + JSON.stringify(payload);
}

export async function createAnswerQrString(roomCode: string, studentId: string, sdp: string): Promise<string> {
  const normCode = roomCode.toUpperCase();
  const params = extractSdpParams(sdp);
  if (params && params.ip) {
    return `NC2:A|${normCode}|${studentId}|${params.mTypes}|${params.ufrag}|${params.pwd}|${params.fpHex}|${params.ip}:${params.port}`;
  }

  // Fallback
  const compressed = await compressSdp(sdp);
  const payload: QrAnswerPayload = {
    t: "A",
    c: normCode,
    u: studentId,
    s: compressed,
  };
  return "NC:" + JSON.stringify(payload);
}

export async function parsePairingQr(rawString: string): Promise<
  | { type: "offer"; roomCode: string; hostId: string; sdp: string }
  | { type: "answer"; roomCode: string; studentId: string; sdp: string }
  | null
> {
  try {
    let clean = rawString.trim();

    // 1. Ultra-compact NC2 format (<140 chars)
    if (clean.startsWith("NC2:")) {
      const parts = clean.slice(4).split("|");
      const kind = parts[0]; // 'O' or 'A'
      const roomCode = parts[1];
      const peerId = parts[2];
      const mTypes = parts[3] || "dv";
      const ufrag = parts[4];
      const pwd = parts[5];
      const fpHex = parts[6];
      const hostPort = (parts[7] || "").split(":");
      const ip = hostPort[0] || "127.0.0.1";
      const port = hostPort[1] || "50000";

      const sdp = buildSdpFromParams({ ufrag, pwd, fpHex, ip, port, mTypes }, kind === "O");

      if (kind === "O") {
        return {
          type: "offer",
          roomCode,
          hostId: peerId,
          sdp,
        };
      } else {
        return {
          type: "answer",
          roomCode,
          studentId: peerId,
          sdp,
        };
      }
    }

    // 2. Legacy NC JSON format
    if (clean.startsWith("NC:")) {
      clean = clean.slice(3);
    }
    const parsed = JSON.parse(clean);
    if (parsed.t === "O" && parsed.s) {
      const sdp = await decompressSdp(parsed.s);
      return {
        type: "offer",
        roomCode: parsed.c,
        hostId: parsed.h,
        sdp,
      };
    } else if (parsed.t === "A" && parsed.s) {
      const sdp = await decompressSdp(parsed.s);
      return {
        type: "answer",
        roomCode: parsed.c,
        studentId: parsed.u,
        sdp,
      };
    }
  } catch (err) {
    console.warn("[OfflinePairing] Failed to parse QR payload:", err);
  }
  return null;
}

/**
 * Draws a high-contrast, low-density QR code directly to an HTMLCanvasElement.
 * Uses errorCorrectionLevel 'L' and margin 2 to ensure maximum module size and scan speed.
 */
export async function renderQrCode(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    margin: 2,
    width: 260,
    errorCorrectionLevel: "L",
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
  });
}

/**
 * Enumerates video devices and returns the optimal 1x main camera device ID,
 * avoiding the 0.5x ultra-wide, macro, and depth cameras that phones often pick by default.
 */
export async function getOptimalCameraDeviceId(
  facingMode: "environment" | "user" = "environment",
  preferredDeviceId?: string
): Promise<string | undefined> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return preferredDeviceId;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
    if (videoDevices.length <= 1) return videoDevices[0]?.deviceId;

    if (preferredDeviceId) {
      const found = videoDevices.find((d) => d.deviceId === preferredDeviceId);
      if (found) return found.deviceId;
    }

    if (facingMode === "user") {
      const front = videoDevices.find((d) => {
        const l = d.label.toLowerCase();
        return (
          l.includes("front") ||
          l.includes("user") ||
          l.includes("selfie") ||
          l.includes("face") ||
          l.includes("anterior") ||
          l.includes("avant") ||
          l.includes("camera2 1")
        );
      });
      // Never fall back to videoDevices[0] which is typically the back camera!
      // Return undefined so browser uses native facingMode: "user" constraint.
      return front ? front.deviceId : undefined;
    }

    // For environment (back) camera:
    // Filter out ultra-wide, 0.5, macro, depth, and secondary sensors
    const backCameras = videoDevices.filter((d) => {
      const l = d.label.toLowerCase();
      return !l.includes("front") && !l.includes("user");
    });

    if (backCameras.length === 0) return videoDevices[0]?.deviceId;

    // 1. First preference: device labeled with 'main', 'standard', 'wide' (not ultra), 'camera 0', 'back camera 1'
    const preferred = backCameras.find((d) => {
      const l = d.label.toLowerCase();
      const isUltra =
        l.includes("ultra") ||
        l.includes("0.5") ||
        l.includes("wide-angle") ||
        l.includes("macro") ||
        l.includes("depth");
      return (
        !isUltra &&
        (l.includes("main") ||
          l.includes("wide") ||
          l.includes("back camera 1") ||
          l.includes("camera 0") ||
          l.includes("camera2 0"))
      );
    });
    if (preferred) return preferred.deviceId;

    // 2. Second preference: any back camera that is not ultra-wide or macro
    const nonUltra = backCameras.find((d) => {
      const l = d.label.toLowerCase();
      return (
        !l.includes("ultra") &&
        !l.includes("0.5") &&
        !l.includes("macro") &&
        !l.includes("depth")
      );
    });
    return nonUltra?.deviceId || backCameras[0]?.deviceId;
  } catch (e) {
    return preferredDeviceId;
  }
}

/**
 * Returns a list of all back camera device IDs and labels for cycling lenses
 */
export async function getAvailableBackCameras(): Promise<Array<{ deviceId: string; label: string }>> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const backCameras = devices
      .filter((d) => d.kind === "videoinput")
      .filter((d) => {
        const l = d.label.toLowerCase();
        return !l.includes("front") && !l.includes("user");
      });
    return backCameras.map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${index + 1}`,
    }));
  } catch (e) {
    return [];
  }
}
