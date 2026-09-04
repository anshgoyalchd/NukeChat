const os = require("os");

/**
 * Discovers and prioritizes local network IP addresses on the host machine.
 * Priority:
 * 1. Android Hotspot (192.168.43.x)
 * 2. iPhone Hotspot (172.20.10.x)
 * 3. Standard Private Wi-Fi LAN (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 * 4. Localhost Fallback (127.0.0.1)
 */
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      // IPv4 only, skip internal loopback unless nothing else found
      if (net.family === "IPv4" && !net.internal) {
        const ip = net.address;

        let priority = 10;
        let type = "LAN / Wi-Fi";

        if (ip.startsWith("192.168.43.")) {
          priority = 1;
          type = "Android Hotspot";
        } else if (ip.startsWith("172.20.10.")) {
          priority = 2;
          type = "iPhone Hotspot";
        } else if (ip.startsWith("192.168.")) {
          priority = 3;
          type = "Home/Office Wi-Fi";
        } else if (ip.startsWith("10.")) {
          priority = 4;
          type = "Private Subnet";
        } else if (ip.startsWith("172.")) {
          priority = 5;
          type = "Local Network";
        }

        candidates.push({
          interfaceName: name,
          ip,
          priority,
          type,
          sslipDomain: `${ip.replace(/\./g, "-")}.sslip.io`,
        });
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);

  // If no external adapter is active, fallback to loopback
  if (candidates.length === 0) {
    candidates.push({
      interfaceName: "lo",
      ip: "127.0.0.1",
      priority: 99,
      type: "Loopback (Offline)",
      sslipDomain: "127-0-0-1.sslip.io",
    });
  }

  return {
    primary: candidates[0],
    all: candidates,
  };
}

module.exports = { getLocalNetworkAddresses };
