/**
 * Study Time Tracker - Automated Unit Tests
 * Uses Node.js native test runner (node:test, node:assert)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const FocusEngine = require('../focus-engine.js');
const { migrateData, defaultData } = require('../main.js');

describe('1. Manual & Pomodoro Timer Timestamp Calculations', () => {
  test('currentElapsedManual correctly computes total seconds from base and live duration', () => {
    const startedAt = 1000000;
    const timer = {
      running: true,
      startedAt,
      elapsedBeforeStart: 120
    };
    // 30 seconds after startedAt
    const nowMs = startedAt + 30000;
    const elapsed = FocusEngine.currentElapsedManual(timer, nowMs);
    assert.equal(elapsed, 150); // 120 base + 30 live
  });

  test('currentElapsedManual does not add live time when paused', () => {
    const timer = {
      running: false,
      startedAt: null,
      elapsedBeforeStart: 300
    };
    const elapsed = FocusEngine.currentElapsedManual(timer, Date.now());
    assert.equal(elapsed, 300);
  });

  test('currentElapsedPomodoro computes live elapsed time', () => {
    const startedAt = 2000000;
    const pomodoro = {
      running: true,
      startedAt,
      elapsedBeforeStart: 60,
      targetDuration: 1500
    };
    const nowMs = startedAt + 45000; // 45 seconds live
    const elapsed = FocusEngine.currentElapsedPomodoro(pomodoro, nowMs);
    assert.equal(elapsed, 105);
  });

  test('currentRemainingPomodoro counts down and clamps to 0', () => {
    const startedAt = 3000000;
    const pomodoro = {
      running: true,
      startedAt,
      elapsedBeforeStart: 0,
      targetDuration: 300 // 5 minutes (300s)
    };
    // 100 seconds elapsed
    let remaining = FocusEngine.currentRemainingPomodoro(pomodoro, startedAt + 100000);
    assert.equal(remaining, 200);

    // 400 seconds elapsed (past target)
    remaining = FocusEngine.currentRemainingPomodoro(pomodoro, startedAt + 400000);
    assert.equal(remaining, 0); // clamps at zero
  });
});

describe('2. Break Time Exclusion From Study Metrics', () => {
  test('Live Pomodoro focus time is included in today, week, and month totals', () => {
    const fixedNow = new Date('2026-10-26T12:00:00Z');
    const pomodoro = {
      running: true,
      mode: 'focus',
      startedAt: fixedNow.getTime() - 600000, // 10 minutes ago
      elapsedBeforeStart: 0,
      targetDuration: 1500
    };

    const totals = FocusEngine.calculateTotals([], null, pomodoro, fixedNow);
    assert.equal(totals.todaySeconds, 600);
    assert.equal(totals.weekSeconds, 600);
    assert.equal(totals.monthSeconds, 600);
  });

  test('Live Pomodoro breaks (shortBreak & longBreak) are strictly excluded from study totals', () => {
    const fixedNow = new Date('2026-10-26T12:00:00Z');
    const shortBreak = {
      running: true,
      mode: 'shortBreak',
      startedAt: fixedNow.getTime() - 300000, // 5 min break running
      elapsedBeforeStart: 0,
      targetDuration: 300
    };

    const shortTotals = FocusEngine.calculateTotals([], null, shortBreak, fixedNow);
    assert.equal(shortTotals.todaySeconds, 0, 'Short break must not add to study time');
    assert.equal(shortTotals.weekSeconds, 0, 'Short break must not add to week study time');

    const longBreak = {
      running: true,
      mode: 'longBreak',
      startedAt: fixedNow.getTime() - 900000, // 15 min break running
      elapsedBeforeStart: 0,
      targetDuration: 900
    };

    const longTotals = FocusEngine.calculateTotals([], null, longBreak, fixedNow);
    assert.equal(longTotals.todaySeconds, 0, 'Long break must not add to study time');
    assert.equal(longTotals.weekSeconds, 0, 'Long break must not add to week study time');
  });
});

describe('3. Analytics Aggregation (Daily, Weekly, Monthly & Productive Day)', () => {
  // Let's set a Wednesday: 2026-10-21 (Monday was 2026-10-19)
  const now = new Date('2026-10-21T18:00:00Z');

  const sessions = [
    // Today session (2026-10-21)
    { id: '1', date: '2026-10-21', seconds: 3600, subject: 'Coding', startedAt: new Date('2026-10-21T10:00:00Z').getTime() },
    // Earlier this week (Monday 2026-10-19)
    { id: '2', date: '2026-10-19', seconds: 1800, subject: 'Maths', startedAt: new Date('2026-10-19T10:00:00Z').getTime() },
    // Earlier this month, prior week (2026-10-05)
    { id: '3', date: '2026-10-05', seconds: 7200, subject: 'Science', startedAt: new Date('2026-10-05T10:00:00Z').getTime() },
    // Previous month (2026-09-28)
    { id: '4', date: '2026-09-28', seconds: 5000, subject: 'English', startedAt: new Date('2026-09-28T10:00:00Z').getTime() }
  ];

  test('calculates correct daily, weekly, and monthly totals', () => {
    const { todaySeconds, weekSeconds, monthSeconds, monthCount } = FocusEngine.calculateTotals(sessions, null, null, now);
    assert.equal(todaySeconds, 3600, 'Today should be 3600s');
    assert.equal(weekSeconds, 5400, 'Week should be 3600 + 1800 = 5400s');
    assert.equal(monthSeconds, 12600, 'Month should be 3600 + 1800 + 7200 = 12600s');
    assert.equal(monthCount, 3, 'Month count should only include October sessions');
  });

  test('identifies most productive day of week correctly', () => {
    const best = FocusEngine.calculateMostProductiveDay(sessions);
    // 2026-09-28 (5000s) + 2026-10-05 (7200s) + 2026-10-19 (1800s) = Monday total 14000s
    assert.equal(best.dayName, 'Monday');
    assert.equal(best.totalSeconds, 14000);
  });
});

describe('4. Streak Calculation (Consecutive Days, Reset & Threshold)', () => {
  const fixedNow = new Date('2026-10-26T15:00:00'); // Let this be Monday Oct 26

  test('calculates active streak when qualifying sessions exist for consecutive days', () => {
    const sessions = [
      { date: '2026-10-24', seconds: 1800 }, // Saturday: 30m (qualifies >= 15m)
      { date: '2026-10-25', seconds: 1200 }, // Sunday: 20m (qualifies >= 15m)
      { date: '2026-10-26', seconds: 900 }   // Today Monday: 15m (qualifies)
    ];

    const result = FocusEngine.calculateStreaks(sessions, 15, fixedNow);
    assert.equal(result.currentStreak, 3);
    assert.equal(result.longestStreak, 3);
    assert.equal(result.todayQualified, true);
  });

  test('preserves active streak from yesterday when today is still in progress', () => {
    const sessions = [
      { date: '2026-10-24', seconds: 1800 },
      { date: '2026-10-25', seconds: 1800 },
      { date: '2026-10-26', seconds: 300 } // Today only 5m so far (< 15m threshold)
    ];

    const result = FocusEngine.calculateStreaks(sessions, 15, fixedNow);
    assert.equal(result.currentStreak, 2, 'Streak should continue unbroken from yesterday');
    assert.equal(result.todayQualified, false);
  });

  test('resets streak to 0 if yesterday was completely missed', () => {
    const sessions = [
      { date: '2026-10-23', seconds: 3600 },
      { date: '2026-10-24', seconds: 3600 }
      // Missed 2026-10-25!
      // Today 2026-10-26 has no qualifying session yet
    ];

    const result = FocusEngine.calculateStreaks(sessions, 15, fixedNow);
    assert.equal(result.currentStreak, 0, 'Current streak should break when a day was missed');
    assert.equal(result.longestStreak, 2, 'Longest streak remains preserved');
  });

  test('sessions below the streak threshold minutes do not count toward streaks', () => {
    const sessions = [
      { date: '2026-10-24', seconds: 600 }, // 10 min < 15 min threshold
      { date: '2026-10-25', seconds: 600 }  // 10 min < 15 min threshold
    ];

    const result = FocusEngine.calculateStreaks(sessions, 15, fixedNow);
    assert.equal(result.currentStreak, 0);
    assert.equal(result.longestStreak, 0);
  });
});

describe('5. Achievement Unlock Conditions & Duplicate Prevention', () => {
  test('awards First Step on 1st session, Goal Crusher on qualifying day, and Pomodoro Pro at 5 sessions', () => {
    const data = {
      sessions: [
        { date: '2026-10-26', seconds: 1800 }
      ],
      pomodoro: { completedSessions: 5 },
      achievements: [],
      settings: { streakThresholdMinutes: 15 }
    };

    const { newlyUnlocked, achievements } = FocusEngine.evaluateAchievements(data, new Date('2026-10-26T12:00:00Z'));
    const unlockedIds = newlyUnlocked.map((a) => a.id);

    assert.ok(unlockedIds.includes('first_session'), 'Should unlock first_session');
    assert.ok(unlockedIds.includes('goal_met'), 'Should unlock goal_met');
    assert.ok(unlockedIds.includes('pomo_5'), 'Should unlock pomo_5');
    assert.equal(achievements.length, 3);
  });

  test('duplicate prevention ensures unlocked achievements are not re-awarded', () => {
    const data = {
      sessions: [{ date: '2026-10-26', seconds: 1800 }],
      pomodoro: { completedSessions: 5 },
      achievements: [
        { id: 'first_session', title: 'First Step', unlockedAt: 12345 }
      ],
      settings: { streakThresholdMinutes: 15 }
    };

    const { newlyUnlocked, achievements } = FocusEngine.evaluateAchievements(data, new Date('2026-10-26T12:00:00Z'));
    const newlyIds = newlyUnlocked.map((a) => a.id);

    assert.ok(!newlyIds.includes('first_session'), 'Already unlocked achievement must not be in newlyUnlocked');
    // Total achievements should now contain first_session, goal_met, pomo_5 (length 3, not 4)
    assert.equal(achievements.filter((a) => a.id === 'first_session').length, 1);
  });
});

describe('6. Notes Search and Subject Filtering', () => {
  const notes = [
    { id: '1', title: 'Calculus derivatives summary', content: 'Chain rule and product rule', subject: 'Maths', updatedAt: 100 },
    { id: '2', title: 'Photosynthesis notes', content: 'Light dependent reactions in thylakoids', subject: 'Science', updatedAt: 300 },
    { id: '3', title: 'Electron IPC protocols', content: 'contextBridge and preload mechanics', subject: 'Coding', updatedAt: 200 }
  ];

  test('filters notes by title search term case-insensitively', () => {
    const results = FocusEngine.filterNotes(notes, 'CALCULUS');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, '1');
  });

  test('filters notes by content snippet', () => {
    const results = FocusEngine.filterNotes(notes, 'thylakoids');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, '2');
  });

  test('filters notes by subject', () => {
    const results = FocusEngine.filterNotes(notes, '', 'Coding');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, '3');
  });

  test('sorts notes by updatedAt descending', () => {
    const results = FocusEngine.filterNotes(notes, '');
    assert.equal(results[0].id, '2', 'Updated at 300 should be first');
    assert.equal(results[1].id, '3', 'Updated at 200 should be second');
    assert.equal(results[2].id, '1', 'Updated at 100 should be third');
  });
});

describe('7. Task Priority Sorting & Completion Filtering', () => {
  const tasks = [
    { id: 't1', title: 'Low priority task', priority: 'low', completed: false, createdAt: 10 },
    { id: 't2', title: 'High priority task', priority: 'high', completed: false, createdAt: 20 },
    { id: 't3', title: 'Completed high priority task', priority: 'high', completed: true, createdAt: 30 },
    { id: 't4', title: 'Medium priority task', priority: 'medium', completed: false, createdAt: 15 }
  ];

  test('sorts uncompleted high priority tasks before medium and low', () => {
    const sorted = FocusEngine.sortAndFilterTasks(tasks, 'all', 'all');
    // High pending -> Medium pending -> Low pending -> Completed high
    assert.equal(sorted[0].id, 't2', 'High pending must come first');
    assert.equal(sorted[1].id, 't4', 'Medium pending must come second');
    assert.equal(sorted[2].id, 't1', 'Low pending must come third');
    assert.equal(sorted[3].id, 't3', 'Completed task must be at the bottom');
  });

  test('filters tasks by pending and completed status', () => {
    const pending = FocusEngine.sortAndFilterTasks(tasks, 'pending', 'all');
    assert.equal(pending.length, 3);
    assert.ok(pending.every((t) => !t.completed));

    const completed = FocusEngine.sortAndFilterTasks(tasks, 'completed', 'all');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].id, 't3');
  });
});

describe('8. Data Schema Migration & Backward Compatibility', () => {
  test('migrates legacy v1 data schema to v2 without losing sessions or goal', () => {
    const legacyRaw = {
      goalMinutes: 180,
      sessions: [
        { id: 's1', date: '2026-10-20', seconds: 1200, subject: 'Maths' }
      ],
      timer: {
        running: false,
        subject: 'Maths',
        elapsedBeforeStart: 60
      }
    };

    const migrated = migrateData(legacyRaw);
    assert.equal(migrated.version, 2);
    assert.equal(migrated.goalMinutes, 180);
    assert.equal(migrated.sessions.length, 1);
    assert.equal(migrated.sessions[0].id, 's1');

    // Check newly added structures initialized with valid defaults
    assert.ok(migrated.pomodoro, 'Pomodoro object initialized');
    assert.equal(migrated.pomodoro.mode, 'focus');
    assert.equal(migrated.pomodoro.targetDuration, 1500);
    assert.ok(Array.isArray(migrated.exams), 'Exams array initialized');
    assert.ok(Array.isArray(migrated.tasks), 'Tasks array initialized');
    assert.ok(Array.isArray(migrated.notes), 'Notes array initialized');
    assert.ok(Array.isArray(migrated.achievements), 'Achievements array initialized');
    assert.equal(migrated.settings.streakThresholdMinutes, 15);
  });

  test('gracefully handles empty or corrupt raw data by returning default schema', () => {
    const fromNull = migrateData(null);
    assert.equal(fromNull.version, 2);
    assert.equal(fromNull.goalMinutes, 240);
    assert.deepEqual(fromNull.sessions, []);

    const fromGarbage = migrateData('invalid json string');
    assert.equal(fromGarbage.version, 2);
    assert.equal(fromGarbage.goalMinutes, 240);
  });
});
