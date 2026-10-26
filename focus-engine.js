/**
 * Study Time Tracker - Core Focus Engine
 * Pure computational domain logic for timer math, statistics, streaks,
 * achievements, and notebook/task filtering.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FocusEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  function dateKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatClock(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatMMSS(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${pad(m)}:${pad(s)}`;
  }

  function formatDuration(seconds, alwaysShowHours = false) {
    const mins = Math.floor(Math.max(0, seconds) / 60);
    const hours = Math.floor(mins / 60);
    if (alwaysShowHours || hours > 0) {
      return `${hours}h ${pad(mins % 60)}m`;
    }
    return `${mins}m`;
  }

  function sessionSeconds(session) {
    return Math.max(0, Number(session && session.seconds) || 0);
  }

  // --------------------------------------------------------------------------
  // TIMER TIMESTAMP MATH
  // --------------------------------------------------------------------------
  function currentElapsedManual(timer, nowMs = Date.now()) {
    if (!timer) return 0;
    const base = Number(timer.elapsedBeforeStart) || 0;
    const live = timer.running && timer.startedAt ? Math.max(0, (nowMs - timer.startedAt) / 1000) : 0;
    return base + live;
  }

  function currentElapsedPomodoro(pomodoro, nowMs = Date.now()) {
    if (!pomodoro) return 0;
    const base = Number(pomodoro.elapsedBeforeStart) || 0;
    const live = pomodoro.running && pomodoro.startedAt ? Math.max(0, (nowMs - pomodoro.startedAt) / 1000) : 0;
    return base + live;
  }

  function currentRemainingPomodoro(pomodoro, nowMs = Date.now()) {
    if (!pomodoro) return 0;
    const target = Number(pomodoro.targetDuration) || 1500;
    const elapsed = currentElapsedPomodoro(pomodoro, nowMs);
    return Math.max(0, target - elapsed);
  }

  // --------------------------------------------------------------------------
  // TOTALS & ANALYTICS AGGREGATION
  // --------------------------------------------------------------------------
  function calculateTotals(sessions = [], timer = null, pomodoro = null, now = new Date()) {
    const today = dateKey(now);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = (monday.getDay() + 6) % 7; // Monday = 0, Sunday = 6
    monday.setDate(monday.getDate() - day);
    const weekStart = dateKey(monday);

    const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

    let todaySeconds = 0;
    let weekSeconds = 0;
    let monthSeconds = 0;
    let monthCount = 0;

    for (const s of sessions) {
      const secs = sessionSeconds(s);
      if (s.date === today) todaySeconds += secs;
      if (s.date >= weekStart && s.date <= today) weekSeconds += secs;
      if (s.date >= monthStart && s.date <= today) {
        monthSeconds += secs;
        monthCount++;
      }
    }

    const nowMs = now.getTime();

    // Include live manual timer if active today
    if (timer && timer.running && timer.startedAt) {
      const live = currentElapsedManual(timer, nowMs);
      const timerDate = dateKey(new Date(timer.startedAt));
      if (timerDate === today) todaySeconds += live;
      if (timerDate >= weekStart) weekSeconds += live;
      if (timerDate >= monthStart) monthSeconds += live;
    }

    // Include live Pomodoro ONLY if in 'focus' mode (breaks are strictly excluded from study time)
    if (pomodoro && pomodoro.running && pomodoro.startedAt && pomodoro.mode === 'focus') {
      const livePomo = currentElapsedPomodoro(pomodoro, nowMs);
      const pomoDate = dateKey(new Date(pomodoro.startedAt));
      if (pomoDate === today) todaySeconds += livePomo;
      if (pomoDate >= weekStart) weekSeconds += livePomo;
      if (pomoDate >= monthStart) monthSeconds += livePomo;
    }

    return { todaySeconds, weekSeconds, monthSeconds, monthCount };
  }

  function calculateDailyActiveStats(sessions = []) {
    const dateMap = {};
    for (const s of sessions) {
      dateMap[s.date] = (dateMap[s.date] || 0) + sessionSeconds(s);
    }
    const activeDays = Object.keys(dateMap).length;
    const totalSeconds = sessions.reduce((acc, s) => acc + sessionSeconds(s), 0);
    const averageSeconds = activeDays > 0 ? Math.round(totalSeconds / activeDays) : 0;
    return { dateMap, activeDays, totalSeconds, averageSeconds };
  }

  function calculateMostProductiveDay(sessions = []) {
    const dayTotals = [0, 0, 0, 0, 0, 0, 0]; // Sun to Sat
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const s of sessions) {
      if (s.startedAt) {
        const d = new Date(s.startedAt).getDay();
        dayTotals[d] += sessionSeconds(s);
      }
    }
    let maxIdx = -1;
    let maxSecs = 0;
    dayTotals.forEach((secs, i) => {
      if (secs > maxSecs) {
        maxSecs = secs;
        maxIdx = i;
      }
    });
    return {
      dayName: maxIdx !== -1 && maxSecs > 0 ? dayNames[maxIdx] : 'None yet',
      totalSeconds: maxSecs,
      dayIndex: maxIdx
    };
  }

  // --------------------------------------------------------------------------
  // STREAKS CALCULATION
  // --------------------------------------------------------------------------
  function calculateStreaks(sessions = [], thresholdMinutes = 15, now = new Date()) {
    const thresholdSecs = Math.max(1, thresholdMinutes) * 60;
    const dateMap = {};
    for (const s of sessions) {
      dateMap[s.date] = (dateMap[s.date] || 0) + sessionSeconds(s);
    }

    const sortedDates = Object.keys(dateMap).sort();
    const qualifyingSet = new Set();
    sortedDates.forEach((d) => {
      if (dateMap[d] >= thresholdSecs) qualifyingSet.add(d);
    });

    const todayStr = dateKey(now);
    const todayQualified = qualifyingSet.has(todayStr);

    let currentStreak = 0;
    const checkDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!todayQualified) {
      // If today hasn't met the threshold yet, streak continues unbroken from yesterday
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (qualifyingSet.has(dateKey(checkDate))) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // Calculate historical longest streak
    let longestStreak = 0;
    let runningCount = 0;
    if (sortedDates.length > 0) {
      let prev = null;
      sortedDates.forEach((dStr) => {
        if (qualifyingSet.has(dStr)) {
          const cur = new Date(dStr);
          if (prev) {
            const diffDays = Math.round((cur - prev) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
              runningCount++;
            } else if (diffDays === 0) {
              runningCount = Math.max(1, runningCount);
            } else {
              runningCount = 1;
            }
          } else {
            runningCount = 1;
          }
          prev = cur;
          if (runningCount > longestStreak) longestStreak = runningCount;
        }
      });
    }

    return {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      todayQualified
    };
  }

  // --------------------------------------------------------------------------
  // ACHIEVEMENTS
  // --------------------------------------------------------------------------
  const ACHIEVEMENTS_DEF = [
    { id: 'first_session', title: 'First Step', desc: 'Complete your first study session', icon: '🚀' },
    { id: 'goal_met', title: 'Goal Crusher', desc: 'Reach your daily study goal for the first time', icon: '🎯' },
    { id: 'streak_3', title: 'Focus Momentum', desc: 'Maintain a 3-day consecutive study streak', icon: '🔥' },
    { id: 'streak_7', title: 'Week Warrior', desc: 'Hit a 7-day consecutive study streak', icon: '⚡' },
    { id: 'streak_30', title: 'Iron Focus', desc: '30-day streak of consistent study', icon: '🏆' },
    { id: 'pomo_5', title: 'Pomodoro Pro', desc: 'Complete 5 Pomodoro focus sessions', icon: '🍅' },
    { id: 'hours_10', title: 'Double Digit', desc: 'Accumulate 10 total hours of deep study', icon: '⏳' },
    { id: 'hours_50', title: 'Master of Focus', desc: 'Achieve 50 total hours of mastery', icon: '👑' }
  ];

  function evaluateAchievements(data, now = new Date()) {
    if (!data) return { newlyUnlocked: [], achievements: [] };
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const threshold = (data.settings && data.settings.streakThresholdMinutes) || 15;
    const { currentStreak, todayQualified } = calculateStreaks(sessions, threshold, now);
    const totalSecs = sessions.reduce((acc, s) => acc + sessionSeconds(s), 0);
    const pomoCount = (data.pomodoro && data.pomodoro.completedSessions) || 0;

    const existingList = Array.isArray(data.achievements) ? [...data.achievements] : [];
    const unlockedIds = new Set(existingList.map((a) => a.id));
    const newlyUnlocked = [];

    function award(id) {
      if (!unlockedIds.has(id)) {
        const def = ACHIEVEMENTS_DEF.find((a) => a.id === id);
        if (def) {
          const entry = { id, title: def.title, unlockedAt: now.getTime() };
          existingList.push(entry);
          unlockedIds.add(id);
          newlyUnlocked.push(def);
        }
      }
    }

    if (sessions.length >= 1) award('first_session');
    if (todayQualified) award('goal_met');
    if (currentStreak >= 3) award('streak_3');
    if (currentStreak >= 7) award('streak_7');
    if (currentStreak >= 30) award('streak_30');
    if (pomoCount >= 5) award('pomo_5');
    if (totalSecs >= 36000) award('hours_10'); // 10 hours
    if (totalSecs >= 180000) award('hours_50'); // 50 hours

    return { newlyUnlocked, achievements: existingList };
  }

  // --------------------------------------------------------------------------
  // NOTES & PLANNER FILTERING
  // --------------------------------------------------------------------------
  function filterNotes(notes = [], query = '', subject = '') {
    const q = (query || '').trim().toLowerCase();
    const sub = (subject || '').trim().toLowerCase();

    return notes.filter((n) => {
      const matchQ = !q || (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q);
      const matchSub = !sub || (n.subject || '').toLowerCase() === sub;
      return matchQ && matchSub;
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function sortAndFilterTasks(tasks = [], statusFilter = 'all', priorityFilter = 'all') {
    const weights = { high: 3, medium: 2, low: 1 };

    return tasks.filter((t) => {
      if (statusFilter === 'pending' && t.completed) return false;
      if (statusFilter === 'completed' && !t.completed) return false;
      if (priorityFilter !== 'all' && (t.priority || 'medium').toLowerCase() !== priorityFilter.toLowerCase()) return false;
      return true;
    }).sort((a, b) => {
      if (Boolean(a.completed) !== Boolean(b.completed)) {
        return a.completed ? 1 : -1;
      }
      const wA = weights[(a.priority || 'medium').toLowerCase()] || 2;
      const wB = weights[(b.priority || 'medium').toLowerCase()] || 2;
      if (wB !== wA) return wB - wA;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function filterExams(exams = [], type = 'upcoming', now = new Date()) {
    const today = dateKey(now);
    return exams.filter((e) => {
      if (!e.date) return false;
      if (type === 'upcoming') return e.date >= today;
      return e.date < today;
    }).sort((a, b) => {
      if (type === 'upcoming') return a.date.localeCompare(b.date);
      return b.date.localeCompare(a.date);
    });
  }

  return {
    pad,
    dateKey,
    formatClock,
    formatMMSS,
    formatDuration,
    sessionSeconds,
    currentElapsedManual,
    currentElapsedPomodoro,
    currentRemainingPomodoro,
    calculateTotals,
    calculateDailyActiveStats,
    calculateMostProductiveDay,
    calculateStreaks,
    ACHIEVEMENTS_DEF,
    evaluateAchievements,
    filterNotes,
    sortAndFilterTasks,
    filterExams
  };
});
