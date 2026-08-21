export interface BlogSection {
  type: 'paragraph' | 'heading' | 'code' | 'list' | 'quote';
  text?: string;
  items?: string[];
  code?: string;
  language?: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  readTime: string;
  description: string;
  category: string;
  sections: BlogSection[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'p2p-webrtc-file-sharing',
    title: 'How P2P WebRTC Mesh Networks Enable Serverless Secure File Sharing',
    date: 'August 21, 2026',
    readTime: '5 min read',
    category: 'Technology',
    description: 'Discover how browser-native WebRTC DataChannels allow you to share files and chat directly with peers without uploading any data to cloud servers.',
    sections: [
      {
        type: 'heading',
        text: 'The Problem with Centralized File Sharing'
      },
      {
        type: 'paragraph',
        text: 'When you upload a file to most modern chat applications, it travels to a central cloud server, gets stored in a disk database, and is then downloaded by the recipient. While convenient, this model poses major security and privacy risks. Your files are retained on third-party servers indefinitely, making them vulnerable to corporate data mining, subpoenas, or server-side database breaches.'
      },
      {
        type: 'heading',
        text: 'Enter WebRTC DataChannels'
      },
      {
        type: 'paragraph',
        text: 'WebRTC (Web Real-Time Communication) is an open-source standard that enables direct, peer-to-peer (P2P) communication inside browser windows without any third-party plugins. While commonly associated with low-latency audio and video streaming, WebRTC also includes DataChannels, which allow the transfer of arbitrary binary data (like files, images, and text) directly between browsers.'
      },
      {
        type: 'quote',
        text: 'By bypassing intermediate servers entirely, WebRTC guarantees that your data is never uploaded, cached, or logged in transit. Payloads move directly from your device\'s network interface to your friend\'s.'
      },
      {
        type: 'heading',
        text: 'How Nuke Chat Implements WebRTC Mesh'
      },
      {
        type: 'paragraph',
        text: 'In Nuke Chat\'s P2P rooms, we construct a full mesh network. When you join a room, a brief signaling phase occurs via WebSockets to introduce participants. Once the direct peer-to-peer connection is negotiated, the WebSocket connection goes silent, and all chat payloads and file transfers move exclusively through WebRTC DataChannels.'
      },
      {
        type: 'heading',
        text: 'A Look at the WebRTC Code'
      },
      {
        type: 'paragraph',
        text: 'Setting up a peer connection and creating a data channel in JavaScript uses the native RTCPeerConnection API. Here is a simple implementation of data channel initiation:'
      },
      {
        type: 'code',
        language: 'javascript',
        code: `// Initialize peer connection
const peerConnection = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

// Create Data Channel
const dataChannel = peerConnection.createDataChannel("sendChannel", {
  ordered: true // Guarantees packet delivery order
});

dataChannel.onopen = () => {
  console.log("P2P Data Channel is open and ready!");
  dataChannel.send("Hello directly from my browser!");
};

dataChannel.onmessage = (event) => {
  console.log("Received P2P message:", event.data);
};`
      },
      {
        type: 'heading',
        text: 'Conclusion'
      },
      {
        type: 'paragraph',
        text: 'WebRTC Mesh represents a massive paradigm shift in privacy. With Nuke Chat\'s P2P mode, files and conversations exist strictly in the memory of the participating devices. The moment you close the tab, the room vanishes from the face of the internet, leaving absolutely zero trace.'
      }
    ]
  },
  {
    slug: 'client-side-aes-gcm-encryption',
    title: 'Under the Hood: How Client-Side AES-256-GCM Encryption Works in the Browser',
    date: 'August 20, 2026',
    readTime: '4 min read',
    category: 'Security',
    description: 'Learn how to secure web applications using browser-native Web Crypto APIs to encrypt messages client-side before sending them to a server.',
    sections: [
      {
        type: 'heading',
        text: 'Why Client-Side Encryption is Essential'
      },
      {
        type: 'paragraph',
        text: 'Most messaging platforms encrypt data "in transit" (using HTTPS) but decrypt it once it reaches their servers. This means the server owner has full visibility into your chats. True privacy requires client-side encryption (E2EE), where messages are encrypted on your device before being sent, and decrypted only on the recipient\'s device. The server only sees unreadable ciphertext.'
      },
      {
        type: 'heading',
        text: 'What is AES-256-GCM?'
      },
      {
        type: 'paragraph',
        text: 'AES (Advanced Encryption Standard) with a 256-bit key is the industry standard for symmetric encryption. GCM (Galois/Counter Mode) is an authenticated encryption mode that provides both confidentiality and integrity, guaranteeing that messages cannot be tampered with in transit. If an attacker modifies even a single bit of the encrypted payload, decryption will fail.'
      },
      {
        type: 'heading',
        text: 'Deriving Keys from Room Codes'
      },
      {
        type: 'paragraph',
        text: 'In Nuke Chat, the server does not store encryption keys. The key is derived directly inside your browser using the Web Crypto API, combining the unique Room Code (which acts as a shared secret) and a random salt generated during room creation. Since the room code is in the URL hash (which is never sent to the server), the server has no way of reading your messages.'
      },
      {
        type: 'heading',
        text: 'Implementing browser-native Web Crypto API'
      },
      {
        type: 'paragraph',
        text: 'Here is how you encrypt text client-side using native browser APIs without importing any heavy external libraries:'
      },
      {
        type: 'code',
        language: 'javascript',
        code: `// Encrypt text using Web Crypto API
async function encryptMessage(text, keyMaterial, salt) {
  const enc = new TextEncoder();
  
  // 1. Derive cryptographic key from room code material
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(keyMaterial), "PBKDF2", false, ["deriveKey"]
  );
  
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  // 2. Generate a unique Initialization Vector (IV)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // 3. Encrypt the data
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    enc.encode(text)
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv))
  };
}`
      },
      {
        type: 'heading',
        text: 'Conclusion'
      },
      {
        type: 'paragraph',
        text: 'By harnessing the browser\'s native Web Crypto API, Nuke Chat delivers military-grade encryption with zero performance overhead or external package bloat, securing your temporary conversations reliably.'
      }
    ]
  },
  {
    slug: 'serverless-privacy-ephemeral-apps',
    title: 'Why Serverless Architecture is the Future of Privacy-First Ephemeral Apps',
    date: 'August 19, 2026',
    readTime: '4 min read',
    category: 'Architecture',
    description: 'Explore the benefits of building temporary chat tools on Cloudflare serverless edge nodes and memory-transient Durable Objects with SQLite databases.',
    sections: [
      {
        type: 'heading',
        text: 'The Architectural Mismatch of Traditional Databases'
      },
      {
        type: 'paragraph',
        text: 'Traditional web applications store data in persistent databases (like PostgreSQL, MongoDB, or MySQL) hosted on virtual machines. For permanent applications, this is perfect. But for an ephemeral communication app where chat rooms expire in an hour, storing data on a permanent physical disk creates a liability. Deleted data is often not fully purged immediately, and leaving databases running costs money even when idle.'
      },
      {
        type: 'heading',
        text: 'Serverless Edge Compute & Cloudflare Workers'
      },
      {
        type: 'paragraph',
        text: 'Nuke Chat resolves this by operating entirely on Cloudflare\'s edge infrastructure. Workers are serverless functions running on V8 isolates that start up in milliseconds close to the user. Instead of maintaining a central database, Nuke Chat utilizes Cloudflare Durable Objects.'
      },
      {
        type: 'quote',
        text: 'Durable Objects guarantee that all users in a specific chat room connect to the exact same physical in-memory instance, which runs a private SQLite database stored inside that object\'s transient state storage.'
      },
      {
        type: 'heading',
        text: 'Wiping Data by Hibernating Objects'
      },
      {
        type: 'paragraph',
        text: 'When a Nuke Chat room expires, the Durable Object deletes its local SQLite records and shuts down. Because there is no central database or physical disk backing the Durable Object, the data is permanently, irreversibly erased from Cloudflare\'s server memory. It literally ceases to exist.'
      },
      {
        type: 'heading',
        text: 'Benefits of the Ephemeral Stack'
      },
      {
        type: 'list',
        items: [
          'Zero Maintenance: No servers to patch, databases to scale, or backups to manage.',
          'Instant Deletion: No residual data left on disks. Deletion is immediate and absolute.',
          'Zero Cost Idle: Durable Objects hibernate when inactive. Under Cloudflare\'s free tier, you pay absolutely nothing when rooms are empty.'
        ]
      },
      {
        type: 'heading',
        text: 'Conclusion'
      },
      {
        type: 'paragraph',
        text: 'Privacy-first tools require privacy-first architecture. By combining client-side cryptography with serverless edge databases, Nuke Chat proves that robust privacy can be built without heavy, expensive, or permanent server infrastructure.'
      }
    ]
  }
];
