const ADJECTIVES = [
  "Quiet", "Sleepy", "Curious", "Blue", "Happy", "Lazy", "Bold", "Clever",
  "Silly", "Witty", "Brave", "Calm", "Gentle", "Kind", "Proud", "Eager",
  "Fancy", "Jolly", "Lively", "Candid", "Cosmic", "Sneaky", "Zen", "Radiant",
  "Friendly", "Cheerful", "Golden", "Rusty", "Chilly", "Warm"
];

const ANIMALS = [
  "Fox", "Panda", "Crow", "Otter", "Tiger", "Koala", "Bear", "Wolf",
  "Owl", "Lion", "Deer", "Frog", "Seal", "Hawk", "Dove", "Swan",
  "Hare", "Mole", "Sloth", "Lynx", "Badger", "Lemur", "Falcon", "Gecko",
  "Turtle", "Rabbit", "Dolphin", "Squirrel", "Beaver", "Raccoon"
];

export function generateIdentity(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const anim = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(100 + Math.random() * 900); // 100 to 999
  return `${adj} ${anim} ${num}`;
}

// Simple hash code for string
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// Generate a soft pastel color from a hash
function getPastelColor(hash: number, offset: number): string {
  const h = (hash + offset) % 360;
  // Pastel: high lightness (70-85%) and moderate saturation (40-60%)
  const s = 50 + ((hash >> 2) % 15);
  const l = 75 + ((hash >> 4) % 10);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function generateAvatar(name: string): string {
  const hash = hashCode(name);
  const bgColor = getPastelColor(hash, 0);
  const patternColor = getPastelColor(hash, 120);
  const shapeType = hash % 4; // 0: circle, 1: rect, 2: polygon, 3: paths
  
  let shapesSvg = "";
  if (shapeType === 0) {
    shapesSvg = `<circle cx="50" cy="50" r="22" fill="${patternColor}" />`;
  } else if (shapeType === 1) {
    shapesSvg = `<rect x="28" y="28" width="44" height="44" rx="8" fill="${patternColor}" transform="rotate(${hash % 90} 50 50)" />`;
  } else if (shapeType === 2) {
    shapesSvg = `<polygon points="50,22 75,65 25,65" fill="${patternColor}" transform="rotate(${hash % 90} 50 50)" />`;
  } else {
    shapesSvg = `
      <circle cx="35" cy="50" r="12" fill="${patternColor}" />
      <circle cx="65" cy="50" r="12" fill="${patternColor}" />
    `;
  }

  // Draw two tiny eyes and a smile for a playful face
  const eyeColor = "#374151"; // dark grey
  const faceSvg = `
    <circle cx="43" cy="45" r="3" fill="${eyeColor}" />
    <circle cx="57" cy="45" r="3" fill="${eyeColor}" />
    <path d="M 45 55 Q 50 60 55 55" stroke="${eyeColor}" stroke-width="2.5" stroke-linecap="round" fill="transparent" />
  `;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
      <rect width="100" height="100" rx="20" fill="${bgColor}" />
      ${shapesSvg}
      ${faceSvg}
    </svg>
  `.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
