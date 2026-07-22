// utils/roomCode.js
// A short, human-typeable invite code, e.g. "HIVE-7F3K2Q".
// We avoid confusing characters (0/O, 1/I) so it's easy to read aloud/type.
const { customAlphabet } = require("nanoid");

const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const nanoid = customAlphabet(alphabet, 6);

function generateRoomCode() {
  return `HIVE-${nanoid()}`;
}

module.exports = { generateRoomCode };
