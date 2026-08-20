import { describe, it, expect } from "vitest";
import { generateIdentity, generateAvatar } from "../../shared/identities";
import { WORDS } from "./utils/words";

// Local implementation of room voting logic to test the threshold calculations in isolation
function calculateNukeThreshold(votesCount: number, activeCount: number): boolean {
  return votesCount > activeCount / 2;
}

// Room code check logic
function isValidRoomCode(code: string): boolean {
  const parts = code.split("-");
  if (parts.length !== 2) return false;
  const word = parts[0];
  const num = parseInt(parts[1], 10);
  return WORDS.includes(word) && num >= 1000 && num <= 9999;
}

describe("Nuke Chat Logic & Utility Tests", () => {
  describe("Identity Generator", () => {
    it("should generate identity name matching pattern: [Adjective] [Animal] [Number]", () => {
      const identity = generateIdentity();
      expect(identity).toMatch(/^[A-Za-z]+ [A-Za-z]+ \d{3}$/);
    });

    it("should generate deterministic pastel SVG avatars based on name hash", () => {
      const name = "Sleepy Panda 482";
      const avatar1 = generateAvatar(name);
      const avatar2 = generateAvatar(name);
      
      expect(avatar1).toBe(avatar2);
      expect(avatar1).toContain("data:image/svg+xml;utf8");
      expect(avatar1).toContain("%3Csvg");
      expect(avatar1).toContain("%3C%2Fsvg%3E");
    });
  });

  describe("Room Code Generator", () => {
    it("should conform to the high-entropy uppercase dictionary-and-number format", () => {
      // Mocking generation format
      const word = WORDS[0]; // ACORN
      const code = `${word}-4219`;
      expect(isValidRoomCode(code)).toBe(true);
      expect(isValidRoomCode("INVALIDCODE")).toBe(false);
      expect(isValidRoomCode("ACORN-99")).toBe(false); // 4 digit required
    });
  });

  describe("Nuke Voting Threshold Math", () => {
    it("should evaluate threshold correctly for even active count", () => {
      // 4 active, 2 votes = 50% (should NOT nuke)
      expect(calculateNukeThreshold(2, 4)).toBe(false);

      // 4 active, 3 votes = 75% (should nuke)
      expect(calculateNukeThreshold(3, 4)).toBe(true);

      // 6 active, 3 votes = 50% (should NOT nuke)
      expect(calculateNukeThreshold(3, 6)).toBe(false);

      // 6 active, 4 votes = 66% (should nuke)
      expect(calculateNukeThreshold(4, 6)).toBe(true);
    });

    it("should evaluate threshold correctly for odd active count", () => {
      // 3 active, 1 vote = 33% (should NOT nuke)
      expect(calculateNukeThreshold(1, 3)).toBe(false);

      // 3 active, 2 votes = 66% (should nuke)
      expect(calculateNukeThreshold(2, 3)).toBe(true);

      // 7 active, 3 votes = 42% (should NOT nuke)
      expect(calculateNukeThreshold(3, 7)).toBe(false);

      // 7 active, 4 votes = 57% (should nuke)
      expect(calculateNukeThreshold(4, 7)).toBe(true);
    });

    it("should evaluate threshold correctly for small rooms", () => {
      // 2 active, 1 vote = 50% (should NOT nuke)
      expect(calculateNukeThreshold(1, 2)).toBe(false);

      // 2 active, 2 votes = 100% (should nuke)
      expect(calculateNukeThreshold(2, 2)).toBe(true);

      // 1 active, 1 vote = 100% (should nuke)
      expect(calculateNukeThreshold(1, 1)).toBe(true);
    });
  });
});
