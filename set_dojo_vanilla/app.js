(() => {
  'use strict';

  const MODES = {
    PASSIVE: 'passive',
    PAIR: 'pair',
    SET_NO_SET: 'set-no-set',
    ACTIVE: 'active',
  };

  const MODE_META = {
    [MODES.PASSIVE]: {
      label: 'Passive',
      description: 'Observe first. The trainer reveals all sets one after another.',
      prompt: 'Watch the board. All sets will be highlighted automatically.',
      countdownLabel: 'Reveal in',
    },
    [MODES.PAIR]: {
      label: 'Pair',
      description: 'Two cards are pre-highlighted. Find the missing third card.',
      prompt: 'Tap the third card that completes the highlighted pair.',
      countdownLabel: 'Reveal in',
    },
    [MODES.SET_NO_SET]: {
      label: 'Set / No Set',
      description: 'Decide whether at least one set exists on the current board.',
      prompt: 'Answer whether this board contains a set before time runs out.',
      countdownLabel: 'Time left',
    },
    [MODES.ACTIVE]: {
      label: 'Active',
      description: 'Select three cards that form a set, or choose “No set”.',
      prompt: 'Build a set fast. Three taps auto-submit your answer.',
      countdownLabel: 'Time left',
    },
  };

  const SYMBOL_PATHS = [
    'assets/symbols/00-open-squiggle.png',
    'assets/symbols/01-open-oval.png',
    'assets/symbols/02-open-diamond.png',
    'assets/symbols/03-striped-squiggle.png',
    'assets/symbols/04-striped-oval.png',
    'assets/symbols/05-striped-diamond.png',
    'assets/symbols/06-solid-squiggle.png',
    'assets/symbols/07-solid-oval.png',
    'assets/symbols/08-solid-diamond.png',
  ];

  const STORAGE_KEY = 'set-dojo-settings-v1';

  const DEFAULT_TIMINGS = {
    delayBeforeRevealMs: 4500,
    revealDurationMs: 1200,
    delayBetweenRevealsMs: 500,
  };

  const COUNTDOWN_TICK_MS = 90;
  const ALL_CARD_IDS = Array.from({ length: 81 }, (_, id) => id);
  const CARD_CACHE = ALL_CARD_IDS.map(decodeCard);

  const elements = {
    board: document.getElementById('board'),
    promptText: document.getElementById('prompt-text'),
    modeDescription: document.getElementById('mode-description'),
    modeKicker: document.getElementById('mode-kicker'),
    countdownLabel: document.getElementById('countdown-label'),
    countdownValue: document.getElementById('countdown-value'),
    progressFill: document.getElementById('progress-fill'),
    pairBanner: document.getElementById('pair-banner'),
    statusLine: document.getElementById('status-line'),
    boardsCount: document.getElementById('boards-count'),
    correctCount: document.getElementById('correct-count'),
    streakCount: document.getElementById('streak-count'),
    bestStreakCount: document.getElementById('best-streak-count'),
    newBoardButton: document.getElementById('new-board-button'),
    revealNowButton: document.getElementById('reveal-now-button'),
    clearSelectionButton: document.getElementById('clear-selection-button'),
    setExistsButton: document.getElementById('set-exists-button'),
    noSetButton: document.getElementById('no-set-button'),
    modeButtons: Array.from(document.querySelectorAll('[data-mode]')),
    inputs: {
      delayBeforeReveal: document.getElementById('delay-before-reveal'),
      revealDuration: document.getElementById('reveal-duration'),
      delayBetweenReveals: document.getElementById('delay-between-reveals'),
    },
    outputs: {
      delayBeforeReveal: document.getElementById('delay-before-reveal-output'),
      revealDuration: document.getElementById('reveal-duration-output'),
      delayBetweenReveals: document.getElementById('delay-between-reveals-output'),
    },
  };

  const state = {
    mode: MODES.PASSIVE,
    timings: loadTimings(),
    board: [],
    solutions: [],
    selectedIds: new Set(),
    pairSourceIds: [],
    pairTargetIds: [],
    revealedIds: new Set(),
    missedIds: new Set(),
    stats: {
      boards: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
    },
    phase: 'idle',
    version: 0,
    pendingTimeouts: new Set(),
    progressTimerId: null,
    countdown: {
      active: false,
      start: 0,
      end: 0,
      label: MODE_META[MODES.PASSIVE].countdownLabel,
      text: 'Ready',
      ratio: 1,
    },
  };

  init();

  function init() {
    hydrateTimingControls();
    bindEvents();
    updateStaticMeta();
    startRound();
  }

  function bindEvents() {
    elements.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.mode;
        if (!nextMode || nextMode === state.mode) return;
        state.mode = nextMode;
        updateStaticMeta();
        startRound();
      });
    });

    elements.newBoardButton.addEventListener('click', () => {
      startRound();
    });

    elements.revealNowButton.addEventListener('click', () => {
      if (state.mode === MODES.PASSIVE) {
        beginPassiveReveal();
        return;
      }
      if (state.mode === MODES.PAIR) {
        revealPairTargets('Revealed matching card.');
      }
    });

    elements.clearSelectionButton.addEventListener('click', () => {
      if (state.phase !== 'answering') return;
      state.selectedIds.clear();
      state.missedIds.clear();
      renderBoard();
      setStatus('Selection cleared.');
    });

    elements.setExistsButton.addEventListener('click', () => {
      if (state.mode !== MODES.SET_NO_SET || state.phase !== 'answering') return;
      submitSetNoSet(true);
    });

    elements.noSetButton.addEventListener('click', () => {
      if (state.phase !== 'answering') return;
      if (state.mode === MODES.SET_NO_SET) {
        submitSetNoSet(false);
        return;
      }
      if (state.mode === MODES.ACTIVE) {
        submitNoSet();
      }
    });

    bindTimingInput(elements.inputs.delayBeforeReveal, elements.outputs.delayBeforeReveal, 'delayBeforeRevealMs');
    bindTimingInput(elements.inputs.revealDuration, elements.outputs.revealDuration, 'revealDurationMs');
    bindTimingInput(
      elements.inputs.delayBetweenReveals,
      elements.outputs.delayBetweenReveals,
      'delayBetweenRevealsMs',
    );
  }

  function bindTimingInput(input, output, key) {
    input.addEventListener('input', () => {
      const valueMs = Math.round(Number(input.value) * 1000);
      state.timings[key] = valueMs;
      output.textContent = formatSeconds(valueMs);
      persistTimings();
      updateCountdownView();
    });
  }

  function hydrateTimingControls() {
    const mapping = [
      ['delayBeforeReveal', 'delayBeforeRevealMs'],
      ['revealDuration', 'revealDurationMs'],
      ['delayBetweenReveals', 'delayBetweenRevealsMs'],
    ];

    mapping.forEach(([inputKey, stateKey]) => {
      const seconds = state.timings[stateKey] / 1000;
      elements.inputs[inputKey].value = String(seconds);
      elements.outputs[inputKey].textContent = formatSeconds(state.timings[stateKey]);
    });
  }

  function startRound() {
    resetRoundState();
    state.stats.boards += 1;

    const round = buildRound(state.mode);
    state.board = round.board;
    state.solutions = round.solutions;
    state.pairSourceIds = round.pairSourceIds;
    state.pairTargetIds = round.pairTargetIds;

    if (state.mode === MODES.PASSIVE) {
      state.phase = 'waiting';
      render();
      setStatus('Watching board. Solutions will reveal automatically.');
      startCountdown(state.timings.delayBeforeRevealMs, MODE_META[state.mode].countdownLabel, beginPassiveReveal);
      renderActionRow();
      return;
    }

    state.phase = 'answering';
    render();
    setStatus(initialStatusForMode());
    startCountdown(state.timings.delayBeforeRevealMs, MODE_META[state.mode].countdownLabel, handleTimeout);
    renderActionRow();
  }

  function buildRound(mode) {
    if (mode === MODES.PASSIVE || mode === MODES.PAIR) {
      const { board, solutions } = drawBoard({ requireSet: true });
      if (mode === MODES.PAIR) {
        const chosenSet = chooseRandomItem(solutions);
        const targetId = chosenSet[Math.floor(Math.random() * 3)];
        const pairSourceIds = chosenSet.filter((id) => id !== targetId);
        return {
          board,
          solutions,
          pairSourceIds,
          pairTargetIds: [targetId],
        };
      }
      return { board, solutions, pairSourceIds: [], pairTargetIds: [] };
    }

    if (mode === MODES.SET_NO_SET) {
      const wantNoSet = Math.random() < 0.45;
      const { board, solutions } = drawBoard(wantNoSet ? { requireNoSet: true } : { requireSet: true });
      return { board, solutions, pairSourceIds: [], pairTargetIds: [] };
    }

    const wantNoSet = Math.random() < 0.18;
    const { board, solutions } = drawBoard(wantNoSet ? { requireNoSet: true } : { requireSet: true });
    return { board, solutions, pairSourceIds: [], pairTargetIds: [] };
  }

  function drawBoard({ requireSet = false, requireNoSet = false } = {}) {
    for (let attempt = 0; attempt < 4000; attempt += 1) {
      const boardIds = sampleCardIds(12);
      shuffleInPlace(boardIds);
      const board = boardIds.map((id) => CARD_CACHE[id]);
      const solutions = findSets(board);
      if (requireSet && solutions.length === 0) continue;
      if (requireNoSet && solutions.length > 0) continue;
      return { board, solutions };
    }

    const fallbackBoardIds = sampleCardIds(12);
    const fallbackBoard = fallbackBoardIds.map((id) => CARD_CACHE[id]);
    return { board: fallbackBoard, solutions: findSets(fallbackBoard) };
  }

  function beginPassiveReveal() {
    if (state.mode !== MODES.PASSIVE) return;
    stopCountdown();
    if (state.phase === 'revealing') return;
    state.phase = 'revealing';
    renderActionRow();

    if (state.solutions.length === 0) {
      state.revealedIds.clear();
      setStatus('No set on this board. Loading the next board.');
      schedule(() => startRound(), Math.max(450, state.timings.revealDurationMs));
      return;
    }

    playRevealSequence({
      solutions: state.solutions,
      finalMessage: `Revealed ${state.solutions.length} set${state.solutions.length === 1 ? '' : 's'}.`,
      afterDone: () => startRound(),
    });
  }

  function handleTimeout() {
    if (state.phase !== 'answering') return;

    if (state.mode === MODES.PAIR) {
      revealPairTargets('Time up. Highlighted the matching card.');
      markFailure();
      return;
    }

    revealBoardSolutions('Time up.');
    markFailure();
  }

  function revealPairTargets(message) {
    stopCountdown();
    state.phase = 'revealing';
    state.revealedIds = new Set(state.pairTargetIds);
    state.missedIds = new Set();
    renderBoard();
    setStatus(message);
    renderActionRow();
    schedule(() => startRound(), Math.max(450, state.timings.revealDurationMs));
  }

  function revealBoardSolutions(prefix) {
    stopCountdown();
    state.phase = 'revealing';
    renderActionRow();

    if (state.solutions.length === 0) {
      state.revealedIds.clear();
      state.missedIds.clear();
      renderBoard();
      setStatus(`${prefix} This board has no set.`);
      schedule(() => startRound(), Math.max(450, state.timings.revealDurationMs));
      return;
    }

    playRevealSequence({
      solutions: state.solutions,
      finalMessage: `${prefix} Revealed ${state.solutions.length} set${state.solutions.length === 1 ? '' : 's'}.`,
      afterDone: () => startRound(),
    });
  }

  async function playRevealSequence({ solutions, finalMessage, afterDone }) {
    const version = state.version;

    for (const solution of solutions) {
      if (version !== state.version) return;
      state.revealedIds = new Set(solution);
      renderBoard();
      await wait(state.timings.revealDurationMs);
      if (version !== state.version) return;
      state.revealedIds.clear();
      renderBoard();
      await wait(state.timings.delayBetweenRevealsMs);
      if (version !== state.version) return;
    }

    if (version !== state.version) return;
    setStatus(finalMessage);
    schedule(afterDone, Math.max(250, state.timings.delayBetweenRevealsMs));
  }

  function handleCardClick(cardId) {
    if (state.phase !== 'answering') return;

    if (state.mode === MODES.PAIR) {
      if (state.pairSourceIds.includes(cardId)) return;
      if (state.pairTargetIds.includes(cardId)) {
        markSuccess();
        setStatus('Correct. Loading the next pair board.');
        schedule(() => startRound(), 320);
      } else {
        state.missedIds = new Set([cardId]);
        renderBoard();
        setStatus('Not that one. Showing the correct answer.');
        markFailure();
        revealPairTargets('The missing third card is highlighted.');
      }
      return;
    }

    if (state.mode !== MODES.ACTIVE) return;

    if (state.selectedIds.has(cardId)) {
      state.selectedIds.delete(cardId);
      state.missedIds.clear();
      renderBoard();
      return;
    }

    if (state.selectedIds.size === 3) {
      state.selectedIds.clear();
    }

    state.selectedIds.add(cardId);
    state.missedIds.clear();
    renderBoard();

    if (state.selectedIds.size === 3) {
      submitActiveSelection();
    }
  }

  function submitActiveSelection() {
    const pickedIds = Array.from(state.selectedIds);
    const sortedIds = pickedIds.slice().sort((left, right) => left - right);
    const isCorrect = state.solutions.some((solution) => sameIdTriplet(solution, sortedIds));

    if (isCorrect) {
      markSuccess();
      setStatus('Correct set. Loading the next board.');
      schedule(() => startRound(), 320);
      return;
    }

    state.missedIds = new Set(pickedIds);
    renderBoard();
    markFailure();
    revealBoardSolutions('That selection is not a set.');
  }

  function submitNoSet() {
    const isCorrect = state.solutions.length === 0;
    if (isCorrect) {
      markSuccess();
      setStatus('Correct. This board has no set. Loading the next board.');
      schedule(() => startRound(), 320);
      return;
    }

    markFailure();
    revealBoardSolutions('A set exists on this board.');
  }

  function submitSetNoSet(answerSetExists) {
    const actualSetExists = state.solutions.length > 0;
    if (answerSetExists === actualSetExists) {
      markSuccess();
      setStatus('Correct. Loading the next board.');
      schedule(() => startRound(), 320);
      return;
    }

    markFailure();
    revealBoardSolutions(answerSetExists ? 'No set exists here.' : 'At least one set exists here.');
  }

  function markSuccess() {
    stopCountdown();
    state.phase = 'resolved';
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
    state.revealedIds.clear();
    renderStats();
    renderActionRow();
  }

  function markFailure() {
    stopCountdown();
    state.phase = 'revealing';
    state.stats.streak = 0;
    renderStats();
    renderActionRow();
  }

  function resetRoundState() {
    state.version += 1;
    state.pendingTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    state.pendingTimeouts.clear();
    if (state.progressTimerId !== null) {
      clearInterval(state.progressTimerId);
      state.progressTimerId = null;
    }

    state.selectedIds.clear();
    state.revealedIds.clear();
    state.missedIds.clear();
    state.pairSourceIds = [];
    state.pairTargetIds = [];
    state.phase = 'idle';
    state.countdown = {
      active: false,
      start: 0,
      end: 0,
      label: MODE_META[state.mode].countdownLabel,
      text: 'Ready',
      ratio: 1,
    };
    updateCountdownView();
  }

  function startCountdown(durationMs, label, onTimeout) {
    stopCountdown();
    const now = performance.now();
    state.countdown.active = true;
    state.countdown.start = now;
    state.countdown.end = now + durationMs;
    state.countdown.label = label;
    const update = () => {
      const remainingMs = Math.max(0, state.countdown.end - performance.now());
      state.countdown.text = formatSeconds(remainingMs);
      state.countdown.ratio = durationMs <= 0 ? 0 : remainingMs / durationMs;
      updateCountdownView();
      if (remainingMs <= 0) {
        stopCountdown();
        onTimeout();
      }
    };

    update();
    state.progressTimerId = window.setInterval(update, COUNTDOWN_TICK_MS);
  }

  function stopCountdown() {
    if (state.progressTimerId !== null) {
      clearInterval(state.progressTimerId);
      state.progressTimerId = null;
    }
    state.countdown.active = false;
    updateCountdownView();
  }

  function updateStaticMeta() {
    const meta = MODE_META[state.mode];
    elements.modeKicker.textContent = meta.label;
    elements.modeDescription.textContent = meta.description;
    elements.promptText.textContent = meta.prompt;
    elements.countdownLabel.textContent = meta.countdownLabel;
    elements.modeButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === state.mode);
    });
    renderActionRow();
  }

  function updateCountdownView() {
    elements.countdownLabel.textContent = state.countdown.label;

    if (!state.countdown.active) {
      const fallback = state.phase === 'revealing' ? 'Revealing' : 'Ready';
      elements.countdownValue.textContent = fallback;
      elements.progressFill.style.transform = 'scaleX(0)';
      return;
    }

    elements.countdownValue.textContent = state.countdown.text;
    elements.progressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, state.countdown.ratio))})`;
  }

  function render() {
    renderStats();
    renderBoard();
    renderActionRow();
    updateCountdownView();
  }

  function renderStats() {
    elements.boardsCount.textContent = String(state.stats.boards);
    elements.correctCount.textContent = String(state.stats.correct);
    elements.streakCount.textContent = String(state.stats.streak);
    elements.bestStreakCount.textContent = String(state.stats.bestStreak);
  }

  function renderActionRow() {
    const isPassive = state.mode === MODES.PASSIVE;
    const isPair = state.mode === MODES.PAIR;
    const isSetNoSet = state.mode === MODES.SET_NO_SET;
    const isActive = state.mode === MODES.ACTIVE;

    elements.revealNowButton.hidden = !(isPassive || isPair);
    elements.clearSelectionButton.hidden = !isActive;
    elements.setExistsButton.hidden = !isSetNoSet;
    elements.noSetButton.hidden = !(isSetNoSet || isActive);

    elements.revealNowButton.disabled = state.phase !== 'waiting' && state.phase !== 'answering';
    elements.clearSelectionButton.disabled = state.phase !== 'answering' || state.selectedIds.size === 0;
    elements.setExistsButton.disabled = state.phase !== 'answering';
    elements.noSetButton.disabled = state.phase !== 'answering';

    elements.pairBanner.hidden = !isPair;
  }

  function renderBoard() {
    const fragment = document.createDocumentFragment();

    state.board.forEach((card) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'set-card';
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', describeCard(card));

      if (state.phase !== 'answering' || (state.mode !== MODES.ACTIVE && state.mode !== MODES.PAIR)) {
        button.disabled = true;
      }

      if (state.selectedIds.has(card.id)) {
        button.classList.add('set-card--selected');
      }

      if (state.pairSourceIds.includes(card.id)) {
        button.classList.add('set-card--pair-source');
      }

      if (state.revealedIds.has(card.id)) {
        button.classList.add('set-card--revealed');
      }

      if (state.missedIds.has(card.id)) {
        button.classList.add('set-card--missed');
      }

      button.addEventListener('click', () => handleCardClick(card.id));

      const symbols = document.createElement('div');
      symbols.className = 'set-card__symbols';
      symbols.dataset.count = String(card.count + 1);

      const symbolId = card.fill * 3 + card.shape;
      for (let index = 0; index < card.count + 1; index += 1) {
        const symbol = document.createElement('span');
        symbol.className = 'set-symbol';
        symbol.style.setProperty('--symbol-color', `var(--set-color-${card.color})`);
        symbol.style.maskImage = `url("${SYMBOL_PATHS[symbolId]}")`;
        symbol.style.webkitMaskImage = `url("${SYMBOL_PATHS[symbolId]}")`;
        symbols.appendChild(symbol);
      }

      button.appendChild(symbols);
      fragment.appendChild(button);
    });

    elements.board.replaceChildren(fragment);
  }

  function setStatus(message) {
    elements.statusLine.textContent = message;
  }

  function initialStatusForMode() {
    switch (state.mode) {
      case MODES.PAIR:
        return 'Find the third card before the reveal timer expires.';
      case MODES.SET_NO_SET:
        return 'Decide whether this board contains at least one set.';
      case MODES.ACTIVE:
        return 'Select three cards or choose “No set”.';
      default:
        return 'Waiting for the first reveal.';
    }
  }

  function wait(delayMs) {
    return new Promise((resolve) => {
      schedule(resolve, delayMs);
    });
  }

  function schedule(callback, delayMs) {
    const timeoutId = window.setTimeout(() => {
      state.pendingTimeouts.delete(timeoutId);
      callback();
    }, Math.max(0, delayMs));
    state.pendingTimeouts.add(timeoutId);
    return timeoutId;
  }

  function sameIdTriplet(left, right) {
    if (left.length !== 3 || right.length !== 3) return false;
    const a = left.slice().sort((x, y) => x - y);
    const b = right.slice().sort((x, y) => x - y);
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  function sampleCardIds(count) {
    const pool = ALL_CARD_IDS.slice();
    for (let index = pool.length - 1; index > pool.length - 1 - count; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(pool.length - count);
  }

  function shuffleInPlace(items) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }

  function chooseRandomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function findSets(board) {
    const indexById = new Map(board.map((card, index) => [card.id, index]));
    const results = [];

    for (let leftIndex = 0; leftIndex < board.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < board.length; rightIndex += 1) {
        const thirdId = getThirdCardId(board[leftIndex].id, board[rightIndex].id);
        const thirdIndex = indexById.get(thirdId);
        if (thirdIndex !== undefined && thirdIndex > rightIndex) {
          results.push(
            [board[leftIndex].id, board[rightIndex].id, thirdId].sort((a, b) => a - b),
          );
        }
      }
    }

    return results;
  }

  function getThirdCardId(firstId, secondId) {
    const first = CARD_CACHE[firstId];
    const second = CARD_CACHE[secondId];

    return encodeCard(
      complementaryValue(first.count, second.count),
      complementaryValue(first.shape, second.shape),
      complementaryValue(first.fill, second.fill),
      complementaryValue(first.color, second.color),
    );
  }

  function complementaryValue(left, right) {
    return (6 - left - right) % 3;
  }

  function encodeCard(count, shape, fill, color) {
    return count + 3 * shape + 9 * fill + 27 * color;
  }

  function decodeCard(id) {
    return {
      id,
      count: id % 3,
      shape: Math.floor(id / 3) % 3,
      fill: Math.floor(id / 9) % 3,
      color: Math.floor(id / 27) % 3,
    };
  }

  function describeCard(card) {
    const counts = ['one', 'two', 'three'];
    const shapes = ['squiggle', 'oval', 'diamond'];
    const fills = ['open', 'striped', 'solid'];
    const colors = ['first color', 'second color', 'third color'];
    return `${counts[card.count]} ${colors[card.color]} ${fills[card.fill]} ${shapes[card.shape]}`;
  }

  function formatSeconds(milliseconds) {
    return `${(milliseconds / 1000).toFixed(1)} s`;
  }

  function loadTimings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_TIMINGS };
      const parsed = JSON.parse(raw);
      return {
        delayBeforeRevealMs: sanitizeTiming(parsed.delayBeforeRevealMs, DEFAULT_TIMINGS.delayBeforeRevealMs),
        revealDurationMs: sanitizeTiming(parsed.revealDurationMs, DEFAULT_TIMINGS.revealDurationMs),
        delayBetweenRevealsMs: sanitizeTiming(
          parsed.delayBetweenRevealsMs,
          DEFAULT_TIMINGS.delayBetweenRevealsMs,
        ),
      };
    } catch (error) {
      return { ...DEFAULT_TIMINGS };
    }
  }

  function persistTimings() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.timings));
  }

  function sanitizeTiming(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
  }
})();
