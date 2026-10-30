// Shared test helpers. Loads the browser-style scripts in a sandbox so the real question bank is used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadBank() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'questions.js'), 'utf8') + '\n;this.QUESTION_BANK = QUESTION_BANK;', ctx);
  return ctx.QUESTION_BANK;
}

// A tiny fake deck for engine tests: each question has two options.
function fakeDeck(n) {
  const deck = [];
  for (let i = 0; i < n; i++) deck.push({ id: 'Q' + (i + 1), cat: 'Test', q: 'Question ' + (i + 1), o: ['Left', 'Right'], v: [60, 40] });
  return deck;
}

module.exports = { ROOT, loadBank, fakeDeck };
