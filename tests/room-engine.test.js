// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../room-engine.js');
const { fakeDeck } = require('./helpers.js');

const T0 = 1_000_000;

// Builds a room with host Ann and players Bob and Cy, all ready, in the lobby.
function setup(rounds) {
  const deck = fakeDeck(rounds || 3);
  const room = E.createRoom({ code: 'ABCDE', id: 'ann', token: 't-ann', name: 'Ann', now: T0, deck });
  E.joinRoom(room, { id: 'bob', token: 't-bob', name: 'Bob', now: T0 + 1 });
  E.joinRoom(room, { id: 'cy', token: 't-cy', name: 'Cy', now: T0 + 2 });
  ['ann', 'bob', 'cy'].forEach(id => E.setReady(room, id, true));
  return room;
}

test('Name validation accepts letters and rejects markup and empty names', () => {
  assert.equal(E.normaliseName('  Zoë  '), 'Zoë');
  assert.equal(E.normaliseName('<script>'), null);
  assert.equal(E.normaliseName(''), null);
  assert.equal(E.normaliseName('x'.repeat(21)), null);
  assert.equal(E.normaliseName(42), null);
});

test('Only the host can start, and everyone must be ready first', () => {
  const room = setup();
  assert.equal(E.startGame(room, 'bob', T0).error, 'not_host');
  E.setReady(room, 'cy', false);
  assert.equal(E.startGame(room, 'ann', T0).error, 'not_all_ready');
  E.setReady(room, 'cy', true);
  assert.equal(E.startGame(room, 'ann', T0).ok, true);
  assert.equal(room.status, 'round');
  assert.equal(room.round.stage, 'predict');
});

test('A single player cannot start', () => {
  const room = E.createRoom({ code: 'ABCDE', id: 'ann', token: 't', name: 'Ann', now: T0, deck: fakeDeck(3) });
  E.setReady(room, 'ann', true);
  assert.equal(E.startGame(room, 'ann', T0).error, 'not_enough_players');
});

test('Predictions stay secret until every connected player has predicted, then choices open', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  E.submit(room, 'ann', 'predict', 0, T0);
  E.submit(room, 'bob', 'predict', 1, T0);
  assert.equal(room.round.stage, 'predict', 'Cy has not predicted yet');
  const dup = E.submit(room, 'ann', 'predict', 1, T0);
  assert.equal(dup.error, 'already_submitted', 'duplicate prediction is rejected');
  assert.equal(room.round.predictions.ann, 0, 'the first prediction is kept');
  E.submit(room, 'cy', 'predict', 0, T0);
  assert.equal(room.round.stage, 'choose');
  assert.equal(E.submit(room, 'ann', 'predict', 0, T0).error, 'wrong_stage');
});

test('Invalid options and unknown submission types are rejected', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  assert.equal(E.submit(room, 'ann', 'predict', 5, T0).error, 'invalid_option');
  assert.equal(E.submit(room, 'ann', 'predict', -1, T0).error, 'invalid_option');
  assert.equal(E.submit(room, 'ann', 'predict', 'x', T0).error, 'invalid_option');
  assert.equal(E.submit(room, 'ann', 'cheat', 0, T0).error, 'invalid_type');
});

test('Majority scoring: correct predictions earn points and extend streaks, wrong ones reset them', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  E.submit(room, 'ann', 'predict', 0, T0);
  E.submit(room, 'bob', 'predict', 1, T0);
  E.submit(room, 'cy', 'predict', 0, T0);
  E.submit(room, 'ann', 'choose', 0, T0);
  E.submit(room, 'bob', 'choose', 0, T0);
  E.submit(room, 'cy', 'choose', 1, T0);
  // Votes are [2, 1], so the majority is option 0.
  assert.equal(room.status, 'reveal');
  assert.deepEqual(room.round.result.votes, [2, 1]);
  assert.equal(room.round.result.majority, 0);
  const ann = E.findPlayer(room, 'ann');
  const bob = E.findPlayer(room, 'bob');
  assert.equal(ann.score, 100);
  assert.equal(ann.streak, 1);
  assert.equal(bob.score, 0);
  assert.equal(bob.streak, 0);
  assert.equal(room.round.result.correct.bob, false);
});

test('A tie in room votes means no majority, so nobody scores and streaks are unchanged', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  E.findPlayer(room, 'ann').streak = 3;
  E.submit(room, 'ann', 'predict', 0, T0);
  E.submit(room, 'bob', 'predict', 0, T0);
  E.submit(room, 'cy', 'predict', 0, T0);
  E.submit(room, 'ann', 'choose', 0, T0);
  E.submit(room, 'bob', 'choose', 1, T0);
  E.submit(room, 'cy', 'choose', 0, T0);
  E.submit(room, 'bob', 'choose', 1, T0); // duplicate, ignored
  assert.equal(room.round.result.tie, false, 'votes are 2 to 1, not a tie');
  // Build a real tie with an even split instead.
  const r2 = setup();
  E.startGame(r2, 'ann', T0);
  E.findPlayer(r2, 'ann').streak = 3;
  ['ann', 'bob'].forEach(id => E.submit(r2, id, 'predict', 0, T0));
  E.submit(r2, 'cy', 'predict', 0, T0);
  E.submit(r2, 'ann', 'choose', 0, T0);
  E.submit(r2, 'bob', 'choose', 1, T0);
  E.submit(r2, 'cy', 'choose', 1, T0);
  assert.equal(r2.round.result.votes[0], 1);
  assert.equal(r2.round.result.votes[1], 2);
  // A true tie: two players, one vote each.
  const two = E.createRoom({ code: 'ABCDE', id: 'a', token: 'ta', name: 'A', now: T0, deck: fakeDeck(2) });
  E.joinRoom(two, { id: 'b', token: 'tb', name: 'B', now: T0 });
  E.setReady(two, 'a', true); E.setReady(two, 'b', true);
  E.startGame(two, 'a', T0);
  E.findPlayer(two, 'a').streak = 3;
  E.submit(two, 'a', 'predict', 0, T0); E.submit(two, 'b', 'predict', 0, T0);
  E.submit(two, 'a', 'choose', 0, T0); E.submit(two, 'b', 'choose', 1, T0);
  assert.equal(two.round.result.tie, true);
  assert.equal(E.findPlayer(two, 'a').streak, 3);
  assert.equal(E.findPlayer(two, 'a').score, 0);
});

test('A player who disconnects does not block the stage from advancing', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  // Bob stops polling; only Ann and Cy stay connected.
  const later = T0 + 60_000;
  E.touch(room, 'ann', later);
  E.touch(room, 'cy', later);
  E.submit(room, 'ann', 'predict', 0, later);
  E.submit(room, 'cy', 'predict', 0, later);
  assert.equal(room.round.stage, 'choose');
  E.submit(room, 'ann', 'choose', 0, later);
  E.submit(room, 'cy', 'choose', 0, later);
  assert.equal(room.status, 'reveal');
  assert.equal(E.findPlayer(room, 'bob').connected, undefined);
  assert.equal(E.isConnected(E.findPlayer(room, 'bob'), later), false);
});

test('A player who joins mid-round waits and is excluded from the current round', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  E.joinRoom(room, { id: 'dee', token: 't-dee', name: 'Dee', now: T0 });
  assert.equal(E.findPlayer(room, 'dee').waiting, true);
  assert.equal(E.submit(room, 'dee', 'predict', 0, T0).error, 'not_participant');
  ['ann', 'bob', 'cy'].forEach(id => E.submit(room, id, 'predict', 0, T0));
  ['ann', 'bob', 'cy'].forEach(id => E.submit(room, id, 'choose', 0, T0));
  E.nextRound(room, 'ann', T0);
  assert.equal(E.findPlayer(room, 'dee').waiting, false, 'Dee joins from the next round');
  assert.ok(room.round.participants.includes('dee'));
});

test('A player who leaves mid-round is removed from the round and the host passes on', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  E.submit(room, 'ann', 'predict', 0, T0);
  E.leaveRoom(room, 'ann', T0);
  assert.equal(room.hostId, 'bob', 'earliest remaining player becomes host');
  assert.equal(room.round.predictions.ann, undefined, 'their prediction is dropped');
  E.submit(room, 'bob', 'predict', 0, T0);
  E.submit(room, 'cy', 'predict', 0, T0);
  assert.equal(room.round.stage, 'choose');
});

test('Host can reveal early once someone has chosen, and only the host can', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  ['ann', 'bob', 'cy'].forEach(id => E.submit(room, id, 'predict', 0, T0));
  assert.equal(E.hostReveal(room, 'ann', T0).error, 'no_choices');
  E.submit(room, 'bob', 'choose', 0, T0);
  assert.equal(E.hostReveal(room, 'bob', T0).error, 'not_host');
  assert.equal(E.hostReveal(room, 'ann', T0).ok, true);
  assert.equal(room.status, 'reveal');
  assert.deepEqual(room.round.result.votes, [1, 0]);
});

test('A full game ends after the last round and rematch resets scores', () => {
  const room = setup(2);
  const playRound = () => {
    ['ann', 'bob', 'cy'].forEach(id => E.submit(room, id, 'predict', 0, T0));
    ['ann', 'bob', 'cy'].forEach(id => E.submit(room, id, 'choose', 0, T0));
    assert.equal(room.status, 'reveal');
  };
  E.startGame(room, 'ann', T0);
  playRound();
  assert.equal(E.nextRound(room, 'ann', T0).finished, false, 'round 2 of 2 starts');
  assert.equal(room.round.index, 1);
  playRound();
  assert.equal(E.nextRound(room, 'ann', T0).finished, true, 'no rounds left');
  assert.equal(room.status, 'finished');
  assert.equal(E.findPlayer(room, 'ann').score, 200);
  assert.equal(E.findPlayer(room, 'ann').bestStreak, 2);
  assert.equal(E.rematch(room, 'bob', fakeDeck(2), T0).error, 'not_host');
  assert.equal(E.rematch(room, 'ann', fakeDeck(2), T0).ok, true);
  assert.equal(room.status, 'lobby');
  assert.equal(E.findPlayer(room, 'ann').score, 0);
  assert.equal(E.findPlayer(room, 'ann').ready, false);
});

test('Projection hides other players predictions and choices until the reveal', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  E.submit(room, 'ann', 'predict', 1, T0);
  const bobView = E.project(room, 'bob', T0);
  const text = JSON.stringify(bobView);
  assert.equal(bobView.round.predictedBy.includes('ann'), true, 'only the fact of submission is shared');
  assert.equal(bobView.round.mine.predicted, null);
  assert.equal(bobView.round.result, null);
  assert.equal(text.includes('"predictions"'), false);
  assert.equal(bobView.history, undefined);
});

test('Projection includes the full result after the reveal', () => {
  const room = setup();
  E.startGame(room, 'ann', T0);
  ['ann', 'bob', 'cy'].forEach(id => E.submit(room, id, 'predict', 0, T0));
  ['ann', 'bob', 'cy'].forEach(id => E.submit(room, id, 'choose', 1, T0));
  const view = E.project(room, 'bob', T0);
  assert.ok(view.round.result);
  assert.equal(view.round.result.votes[1], 3);
  assert.equal(view.round.result.majority, 1);
});

test('Rooms expire after the idle limit and presence uses the presence window', () => {
  const room = setup();
  const last = room.lastActive;
  assert.equal(E.isExpired(room, last + E.ROOM_LIMITS.idleMs), false, 'exactly at the limit is still open');
  assert.equal(E.isExpired(room, last + E.ROOM_LIMITS.idleMs + 1), true);
  assert.equal(E.isConnected({ lastSeen: T0 }, T0 + E.ROOM_LIMITS.presenceMs), true);
  assert.equal(E.isConnected({ lastSeen: T0 }, T0 + E.ROOM_LIMITS.presenceMs + 1), false);
});

test('Rooms refuse a ninth player', () => {
  const room = E.createRoom({ code: 'ABCDE', id: 'p0', token: 't0', name: 'P0', now: T0, deck: fakeDeck(2) });
  for (let i = 1; i < E.ROOM_LIMITS.maxPlayers; i++) E.joinRoom(room, { id: 'p' + i, token: 't' + i, name: 'P' + i, now: T0 });
  assert.equal(E.joinRoom(room, { id: 'extra', token: 'tx', name: 'Extra', now: T0 }).error, 'room_full');
});
