/** Client-side Set Dojo trainer — ported from set_dojo_vanilla/app.js */

const SYMBOL_SPRITE_URL = '/projects/set-dojo/assets/symbols/SetSymbols.png';

const MODES = {
  PASSIVE: 'passive',
  PAIR: 'pair',
  SET_NO_SET: 'set-no-set',
  ACTIVE: 'active',
} as const;

type Mode = (typeof MODES)[keyof typeof MODES];

const MODE_META: Record<
  Mode,
  { label: string; description: string; prompt: string; countdownLabel: string }
> = {
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

const STORAGE_KEY = 'set-dojo-settings-v1';

const DEFAULT_TIMINGS = {
  delayBeforeRevealMs: 4500,
  revealDurationMs: 1200,
  delayBetweenRevealsMs: 500,
};

const DEFAULT_REVEAL_WHEN_CORRECT = false;

const COUNTDOWN_TICK_MS = 90;
const ALL_CARD_IDS = Array.from({ length: 81 }, (_, id) => id);

type Card = {
  id: number;
  count: number;
  shape: number;
  fill: number;
  color: number;
};

const CARD_CACHE: Card[] = ALL_CARD_IDS.map(decodeCard);

function decodeCard(id: number): Card {
  return {
    id,
    count: id % 3,
    shape: Math.floor(id / 3) % 3,
    fill: Math.floor(id / 9) % 3,
    color: Math.floor(id / 27) % 3,
  };
}

function applySymbolSprite(symbol: HTMLSpanElement, symbolIndex: number) {
  const row = Math.floor(symbolIndex / 3);
  const col = symbolIndex % 3;
  const posX = col * 50;
  const posY = row * 50;
  const spriteUrl = `url("${SYMBOL_SPRITE_URL}")`;
  symbol.style.maskImage = spriteUrl;
  symbol.style.webkitMaskImage = spriteUrl;
  symbol.style.maskRepeat = 'no-repeat';
  symbol.style.webkitMaskRepeat = 'no-repeat';
  symbol.style.maskSize = '300% 300%';
  symbol.style.webkitMaskSize = '300% 300%';
  symbol.style.maskPosition = `${posX}% ${posY}%`;
  symbol.style.webkitMaskPosition = `${posX}% ${posY}%`;
}

function qs<T extends HTMLElement>(root: ParentNode, id: string): T {
  const found = root.querySelector(`#${id}`);
  if (!found) throw new Error(`Set Dojo: missing #${id}`);
  return found as T;
}

export function mountSetDojo(container: HTMLElement) {
  const elements = {
    board: qs<HTMLElement>(container, 'sd-board'),
    promptText: qs<HTMLElement>(container, 'sd-prompt-text'),
    modeDescription: qs<HTMLElement>(container, 'sd-mode-description'),
    modeKicker: qs<HTMLElement>(container, 'sd-mode-kicker'),
    countdownLabel: qs<HTMLElement>(container, 'sd-countdown-label'),
    countdownValue: qs<HTMLElement>(container, 'sd-countdown-value'),
    progressFill: qs<HTMLElement>(container, 'sd-progress-fill'),
    pairBanner: qs<HTMLElement>(container, 'sd-pair-banner'),
    statusLine: qs<HTMLElement>(container, 'sd-status-line'),
    boardsCount: qs<HTMLElement>(container, 'sd-boards-count'),
    correctCount: qs<HTMLElement>(container, 'sd-correct-count'),
    streakCount: qs<HTMLElement>(container, 'sd-streak-count'),
    bestStreakCount: qs<HTMLElement>(container, 'sd-best-streak-count'),
    newBoardButton: qs<HTMLButtonElement>(container, 'sd-new-board-button'),
    revealNowButton: qs<HTMLButtonElement>(container, 'sd-reveal-now-button'),
    clearSelectionButton: qs<HTMLButtonElement>(container, 'sd-clear-selection-button'),
    setExistsButton: qs<HTMLButtonElement>(container, 'sd-set-exists-button'),
    noSetButton: qs<HTMLButtonElement>(container, 'sd-no-set-button'),
    modeButtons: Array.from(container.querySelectorAll<HTMLButtonElement>('.mode-pill[data-mode]')),
    inputs: {
      delayBeforeReveal: qs<HTMLInputElement>(container, 'sd-delay-before-reveal'),
      revealDuration: qs<HTMLInputElement>(container, 'sd-reveal-duration'),
      delayBetweenReveals: qs<HTMLInputElement>(container, 'sd-delay-between-reveals'),
    },
    outputs: {
      delayBeforeReveal: qs<HTMLOutputElement>(container, 'sd-delay-before-reveal-output'),
      revealDuration: qs<HTMLOutputElement>(container, 'sd-reveal-duration-output'),
      delayBetweenReveals: qs<HTMLOutputElement>(container, 'sd-delay-between-reveals-output'),
    },
    revealWhenCorrectInput: qs<HTMLInputElement>(container, 'sd-reveal-when-correct'),
  };

  const loadedSettings = loadSettings();
  const state = {
    mode: MODES.PASSIVE as Mode,
    timings: loadedSettings.timings,
    revealWhenCorrect: loadedSettings.revealWhenCorrect,
    board: [] as Card[],
    solutions: [] as number[][],
    selectedIds: new Set<number>(),
    pairSourceIds: [] as number[],
    pairTargetIds: [] as number[],
    revealedIds: new Set<number>(),
    missedIds: new Set<number>(),
    stats: {
      boards: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
    },
    phase: 'idle' as 'idle' | 'waiting' | 'answering' | 'revealing' | 'resolved',
    version: 0,
    pendingTimeouts: new Set<number>(),
    progressTimerId: null as number | null,
    countdown: {
      active: false,
      start: 0,
      end: 0,
      label: MODE_META[MODES.PASSIVE].countdownLabel,
      text: 'Ready',
      ratio: 1,
    },
  };

  function hydrateSettings() {
    const mapping: [keyof typeof elements.inputs, keyof typeof state.timings][] = [
      ['delayBeforeReveal', 'delayBeforeRevealMs'],
      ['revealDuration', 'revealDurationMs'],
      ['delayBetweenReveals', 'delayBetweenRevealsMs'],
    ];

    mapping.forEach(([inputKey, stateKey]) => {
      const seconds = state.timings[stateKey] / 1000;
      elements.inputs[inputKey].value = String(seconds);
      elements.outputs[inputKey].textContent = formatSeconds(state.timings[stateKey]);
    });

    elements.revealWhenCorrectInput.checked = state.revealWhenCorrect;
  }

  function bindEvents() {
    elements.revealWhenCorrectInput.addEventListener('change', () => {
      state.revealWhenCorrect = elements.revealWhenCorrectInput.checked;
      persistSettings();
    });

    elements.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.mode as Mode | undefined;
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

  function bindTimingInput(
    input: HTMLInputElement,
    output: HTMLOutputElement,
    key: keyof typeof state.timings,
  ) {
    input.addEventListener('input', () => {
      const valueMs = Math.round(Number(input.value) * 1000);
      state.timings[key] = valueMs;
      output.textContent = formatSeconds(valueMs);
      persistSettings();
      updateCountdownView();
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

  function buildRound(mode: Mode) {
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

    void playRevealSequence({
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

  function revealPairTargets(message: string) {
    stopCountdown();
    state.phase = 'revealing';
    state.revealedIds = new Set(state.pairTargetIds);
    state.missedIds = new Set();
    renderBoard();
    setStatus(message);
    renderActionRow();
    schedule(() => startRound(), Math.max(450, state.timings.revealDurationMs));
  }

  function revealBoardSolutions(prefix: string) {
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

    void playRevealSequence({
      solutions: state.solutions,
      finalMessage: `${prefix} Revealed ${state.solutions.length} set${state.solutions.length === 1 ? '' : 's'}.`,
      afterDone: () => startRound(),
    });
  }

  async function playRevealSequence({
    solutions,
    finalMessage,
    afterDone,
  }: {
    solutions: number[][];
    finalMessage: string;
    afterDone: () => void;
  }) {
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

  function handleCardClick(cardId: number) {
    if (state.phase !== 'answering') return;

    if (state.mode === MODES.PAIR) {
      if (state.pairSourceIds.includes(cardId)) return;
      if (state.pairTargetIds.includes(cardId)) {
        if (state.revealWhenCorrect) {
          showCorrectPairReveal();
        } else {
          markSuccess();
          setStatus('Correct. Loading the next pair board.');
          schedule(() => startRound(), 320);
        }
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
      if (state.revealWhenCorrect) {
        stopCountdown();
        state.phase = 'revealing';
        state.selectedIds.clear();
        applySuccessStats();
        renderActionRow();
        updateCountdownView();
        void playRevealSequence({
          solutions: state.solutions,
          finalMessage: 'Correct set. Loading the next board.',
          afterDone: () => startRound(),
        });
      } else {
        markSuccess();
        setStatus('Correct set. Loading the next board.');
        schedule(() => startRound(), 320);
      }
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
      celebrateCorrectNoSet('Correct. This board has no set.');
      return;
    }

    markFailure();
    revealBoardSolutions('A set exists on this board.');
  }

  function submitSetNoSet(answerSetExists: boolean) {
    const actualSetExists = state.solutions.length > 0;
    if (answerSetExists === actualSetExists) {
      if (!actualSetExists) {
        celebrateCorrectNoSet('Correct. No set on this board.');
        return;
      }
      if (state.revealWhenCorrect) {
        stopCountdown();
        state.phase = 'revealing';
        applySuccessStats();
        renderActionRow();
        updateCountdownView();
        void playRevealSequence({
          solutions: state.solutions,
          finalMessage: 'Correct. Loading the next board.',
          afterDone: () => startRound(),
        });
      } else {
        markSuccess();
        setStatus('Correct. Loading the next board.');
        schedule(() => startRound(), 320);
      }
      return;
    }

    markFailure();
    revealBoardSolutions(answerSetExists ? 'No set exists here.' : 'At least one set exists here.');
  }

  function applySuccessStats() {
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
    renderStats();
  }

  /** Full-board green highlight before the next round when “No set” was correct (if reveal-after-correct is on). */
  function celebrateCorrectNoSet(message: string) {
    if (!state.revealWhenCorrect) {
      markSuccess();
      setStatus(`${message} Loading the next board.`);
      schedule(() => startRound(), 320);
      return;
    }
    stopCountdown();
    state.phase = 'revealing';
    applySuccessStats();
    state.revealedIds = new Set(state.board.map((card) => card.id));
    renderBoard();
    renderActionRow();
    updateCountdownView();
    setStatus(message);
    schedule(() => startRound(), Math.max(450, state.timings.revealDurationMs));
  }

  function showCorrectPairReveal() {
    stopCountdown();
    state.phase = 'revealing';
    applySuccessStats();
    state.revealedIds = new Set(state.pairTargetIds);
    state.missedIds.clear();
    renderBoard();
    renderActionRow();
    updateCountdownView();
    setStatus('Correct. The matching card is highlighted.');
    schedule(() => startRound(), Math.max(450, state.timings.revealDurationMs));
  }

  function markSuccess() {
    stopCountdown();
    state.phase = 'resolved';
    applySuccessStats();
    state.revealedIds.clear();
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

  function startCountdown(durationMs: number, label: string, onTimeout: () => void) {
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
        applySymbolSprite(symbol, symbolId);
        symbols.appendChild(symbol);
      }

      button.appendChild(symbols);
      fragment.appendChild(button);
    });

    elements.board.replaceChildren(fragment);
  }

  function setStatus(message: string) {
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

  function wait(delayMs: number) {
    return new Promise<void>((resolve) => {
      schedule(resolve, delayMs);
    });
  }

  function schedule(callback: () => void, delayMs: number) {
    const timeoutId = window.setTimeout(() => {
      state.pendingTimeouts.delete(timeoutId);
      callback();
    }, Math.max(0, delayMs));
    state.pendingTimeouts.add(timeoutId);
    return timeoutId;
  }

  function sameIdTriplet(left: number[], right: number[]) {
    if (left.length !== 3 || right.length !== 3) return false;
    const a = left.slice().sort((x, y) => x - y);
    const b = right.slice().sort((x, y) => x - y);
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  function sampleCardIds(count: number) {
    const pool = ALL_CARD_IDS.slice();
    for (let index = pool.length - 1; index > pool.length - 1 - count; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(pool.length - count);
  }

  function shuffleInPlace(items: number[]) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }

  function chooseRandomItem<T>(items: T[]) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function findSets(board: Card[]) {
    const indexById = new Map(board.map((card, index) => [card.id, index]));
    const results: number[][] = [];

    for (let leftIndex = 0; leftIndex < board.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < board.length; rightIndex += 1) {
        const thirdId = getThirdCardId(board[leftIndex].id, board[rightIndex].id);
        const thirdIndex = indexById.get(thirdId);
        if (thirdIndex !== undefined && thirdIndex > rightIndex) {
          results.push([board[leftIndex].id, board[rightIndex].id, thirdId].sort((a, b) => a - b));
        }
      }
    }

    return results;
  }

  function getThirdCardId(firstId: number, secondId: number) {
    const first = CARD_CACHE[firstId];
    const second = CARD_CACHE[secondId];

    return encodeCard(
      complementaryValue(first.count, second.count),
      complementaryValue(first.shape, second.shape),
      complementaryValue(first.fill, second.fill),
      complementaryValue(first.color, second.color),
    );
  }

  function complementaryValue(left: number, right: number) {
    return (6 - left - right) % 3;
  }

  function encodeCard(count: number, shape: number, fill: number, color: number) {
    return count + 3 * shape + 9 * fill + 27 * color;
  }

  function describeCard(card: Card) {
    const counts = ['one', 'two', 'three'];
    const shapes = ['squiggle', 'oval', 'diamond'];
    const fills = ['open', 'striped', 'solid'];
    const colors = ['first color', 'second color', 'third color'];
    return `${counts[card.count]} ${colors[card.color]} ${fills[card.fill]} ${shapes[card.shape]}`;
  }

  function formatSeconds(milliseconds: number) {
    return `${(milliseconds / 1000).toFixed(1)} s`;
  }

  function loadSettings(): { timings: typeof DEFAULT_TIMINGS; revealWhenCorrect: boolean } {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { timings: { ...DEFAULT_TIMINGS }, revealWhenCorrect: DEFAULT_REVEAL_WHEN_CORRECT };
      }
      const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_TIMINGS> & { revealWhenCorrect?: boolean };
      return {
        timings: {
          delayBeforeRevealMs: sanitizeTiming(parsed.delayBeforeRevealMs, DEFAULT_TIMINGS.delayBeforeRevealMs),
          revealDurationMs: sanitizeTiming(parsed.revealDurationMs, DEFAULT_TIMINGS.revealDurationMs),
          delayBetweenRevealsMs: sanitizeTiming(
            parsed.delayBetweenRevealsMs,
            DEFAULT_TIMINGS.delayBetweenRevealsMs,
          ),
        },
        revealWhenCorrect:
          typeof parsed.revealWhenCorrect === 'boolean' ? parsed.revealWhenCorrect : DEFAULT_REVEAL_WHEN_CORRECT,
      };
    } catch {
      return { timings: { ...DEFAULT_TIMINGS }, revealWhenCorrect: DEFAULT_REVEAL_WHEN_CORRECT };
    }
  }

  function persistSettings() {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state.timings, revealWhenCorrect: state.revealWhenCorrect }),
    );
  }

  function sanitizeTiming(value: number | undefined, fallback: number) {
    return Number.isFinite(value) && value !== undefined && value >= 0 ? Math.round(value) : fallback;
  }

  hydrateSettings();
  bindEvents();
  updateStaticMeta();
  startRound();
}
