# WebRTC Mesh & File Transfer Protocol

In **P2P Chat**, text and files bypass the server and are sent directly browser-to-browser via WebRTC DataChannels.

---

## 1. WebRTC Mesh Architecture

In a mesh topology, each peer coordinates direct RTCPeerConnections with every other peer in the room.

```text
       [ Peer A ] ◄═════════► [ Peer B ]
           ▲                      ▲
           ║                      ║
           ╚═══════► [ Peer C ] ◄═╝
```

- **Maximum Capacity**: 12 active participants.
- **Coordination**: When Peer C joins, the server sends `PEER_JOINED`. Peer C then initiates an RTCPeerConnection to Peer A and Peer B.
- **Role Assignment**: The newer peer is always the **offerer**, and older peers are the **answerers**.

---

## 2. Signaling Protocol (Over WebSockets)

The Durable Object acts as a signal carrier. The payload of signaling messages is ignored by the server.

### Signaling Payload Schema
```json
{
  "type": "SIGNAL",
  "senderId": "peer-c",
  "timestamp": 1723984500000,
  "payload": {
    "targetId": "peer-a",
    "signal": {
      "type": "sdp-offer" | "sdp-answer" | "ice-candidate",
      "data": {} // Raw RTCSessionDescriptionInit or RTCIceCandidateInit
    }
  }
}
```

---

## 3. DataChannel Settings

- **Channel Label**: `nukechat-channel`
- **Ordered**: `true` (guarantees text and file chunks arrive in sequence).
- **MaxRetransmits**: Custom configured for speed vs reliability.

---

## 4. Chunked File Transfer Protocol

Sending large files (e.g. up to 50MB) requires chunking to prevent memory bloat and browser crashes.

```text
[ File ] ──► Split into 32KB Chunks ──► Send as ArrayBuffer ──► Write to IndexedDB ──► Reassemble
```

### 1. File Metadata Offer
Before sending chunks, the sender broadcasts the file metadata:
```json
{
  "type": "FILE_OFFER",
  "payload": {
    "fileId": "file-12345",
    "name": "project.zip",
    "size": 10485760,
    "mimeType": "application/zip",
    "totalChunks": 320,
    "hash": "SHA-256-hash-value"
  }
}
```

### 2. Chunk Format
File chunks are sent as binary packets or structured objects over the DataChannel.
- **Binary Header**: The first 8 bytes of the packet represent the `chunkIndex` (4 bytes) and `fileIdHash` (4 bytes), followed by the raw bytes.
- **Reassembly**: The receiver writes incoming chunks directly into **IndexedDB** keyed by `(fileId, chunkIndex)`.

### 3. Verification & Cleanup
- Once all chunks are received, the client queries IndexedDB, reassembles the blob, runs a SHA-256 checksum check, and offers a download link.
- **Sender Departure Cleanup**: If Peer A leaves, Peer B's client immediately scans local IndexedDB storage and deletes all chunks and references corresponding to `senderId: "peer-a"`.
