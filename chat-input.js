// chat-input.js — слушатель поля ввода чата Twitch + всплывающие подсказки команд.
// Работает при включённом тумблере канала («Быстрые команды» в popup).
// Показывает до 5 лучших совпадений по секциям команд из памяти расширения;
// названия и состав секций НЕ захардкожены — берутся из "commands" файлов
// паттернов (window.NKLPatterns), мини-тумблеры в popup генерируются оттуда же.
// Паттерны берутся из памяти расширения (chrome.storage.local) через window.NKLPatterns,
// первая загрузка — из файлов папки patterns/ (новый формат: секция commands).
// Если команда заканчивается на "*" — показывается пометка "требуется аргумент".

(function () {
  'use strict';

  const INPUT_SELECTOR = '[data-a-target="chat-input"][data-slate-editor="true"]';
  const MAX_SUGGESTIONS = 5;

  // Ключи storage для секций команд строятся по имени секции из файла паттернов:
  // 'quickCommand:<имя секции>' (например quickCommand:kakulaLeveling).
  function sectionKey(sectionName) {
    return 'quickCommand:' + sectionName;
  }

  // ==================== Состояние ====================
  let enabled = false;          // главный тумблер "Быстрые команды"
  let categoryFlags = {};       // { 'quickCommand:<секция>': true/false, ... }
  let patternsData = null;      // паттерны из памяти расширения (storage.local)
  let currentInput = null;      // поле ввода, за которым следим
  let lastText = '';            // последний виденный текст (дедуп событий)
  let domObserver = null;       // MutationObserver над поддеревом поля ввода
  let waiter = null;            // наблюдатель "поле ещё не появилось"
  let pendingVerify = null;     // одна отложенная перепроверка на событие ввода
  let panel = null;             // DOM панели подсказок
  let suggestions = [];         // текущий список подсказок
  let activeIndex = -1;         // индекс подсвеченной подсказки

  // ==================== Данные: storage.local + тумблеры ====================

  // Паттерны берутся из памяти расширения (window.NKLPatterns).
  // Если данные ещё не готовы — дожидаемся события готовности из patterns.js.
  function loadPatterns() {
    if (!window.NKLPatterns) {
      patternsData = null;
      return Promise.resolve();
    }
    return window.NKLPatterns.ensureLoaded().then(function (data) {
      patternsData = data || null;
      if (enabled) refreshFromInput();
    }).catch(function () {
      patternsData = null;
    });
  }

  function loadToggles() {
    // Список секций берём из памяти — захардкоженных категорий нет
    const sections = patternsData ? window.NKLPatterns.getCommandSections(patternsData) : [];
    const keys = ['quickCommands'].concat(sections.map((s) => sectionKey(s.name)));
    chrome.storage.sync.get(keys, function (result) {
      enabled = !!result.quickCommands;
      sections.forEach(function (sec) {
        categoryFlags[sectionKey(sec.name)] = !!result[sectionKey(sec.name)];
      });
      if (!enabled) hidePanel();
      else refreshFromInput(); // могли включить тумблер прямо во время ввода
    });
  }

  // Меняем настройки на лету (popup открыт параллельно с чатом)
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync') return;
    if ('quickCommands' in changes) {
      enabled = !!changes.quickCommands.newValue;
      if (!enabled) hidePanel();
      else refreshFromInput();
    }
    Object.keys(changes).forEach(function (key) {
      if (key.indexOf('quickCommand:') === 0) {
        categoryFlags[key] = !!changes[key].newValue;
        if (enabled && currentInput) refreshFromInput();
      }
    });
  });

  // ==================== Панель подсказок ====================
  function ensurePanel(inputEl) {
    if (panel && panel.isConnected) return panel;

    panel = document.createElement('div');
    panel.id = 'nkl-suggestions';
    panel.setAttribute('dir', 'auto');

    const style = document.createElement('style');
    style.textContent = `
      #nkl-suggestions {
        display: none;
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        margin-bottom: 6px;
        background: #18181b;
        border: 1px solid #3a3a3d;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,.45);
        padding: 4px 0;
        z-index: 9999;
        max-height: 260px;
        overflow-y: auto;
        font-family: inherit;
        font-size: 13px;
        color: #efeff1;
      }
      #nkl-suggestions .nkl-cat {
        padding: 4px 12px 2px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .6px;
        color: #adadb8;
      }
      #nkl-suggestions .nkl-item {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 5px 12px;
        cursor: pointer;
      }
      #nkl-suggestions .nkl-item:hover,
      #nkl-suggestions .nkl-item.nkl-active {
        background: #2a2a2e;
      }
      #nkl-suggestions .nkl-cmd {
        font-weight: 600;
        color: #a970ff;
        white-space: nowrap;
      }
      #nkl-suggestions .nkl-desc {
        color: #adadb8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #nkl-suggestions .nkl-arg {
        color: #ffa600;
        font-size: 11px;
        white-space: nowrap;
        margin-left: auto;
      }
    `;
    document.head.appendChild(style);

    // Вставляем панель рядом с полем ввода: ищем ближайшего позиционируемого
    // предка, иначе просто перед формой чата.
    const anchor = inputEl.closest('.chat-wysiwyg-input-box') ||
                   inputEl.parentElement ||
                   inputEl;
    const host = anchor.parentElement || anchor;
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    host.appendChild(panel);

    // Клик по подсказке (mousedown раньше blur поля)
    panel.addEventListener('mousedown', function (e) {
      const item = e.target.closest('.nkl-item');
      if (!item) return;
      e.preventDefault(); // не даём полю потерять фокус
      const idx = parseInt(item.dataset.index, 10);
      if (!isNaN(idx)) chooseSuggestion(idx);
    });

    return panel;
  }

  function hidePanel() {
    if (panel && panel.isConnected) panel.style.display = 'none';
    activeIndex = -1;
    suggestions = [];
  }

  // Формирует строку подсказки: команда + описание + пометка про аргумент
  function buildItem(cmd, desc) {
    let needsArg = false;
    let cleanCmd = String(cmd).trim();

    // "*" в конце команды = требуется аргумент
    if (/\*\s*$/.test(cleanCmd)) {
      needsArg = true;
      cleanCmd = cleanCmd.replace(/\*\s*$/, '').trim();
    }

    const row = document.createElement('div');
    row.className = 'nkl-item';

    const cmdEl = document.createElement('span');
    cmdEl.className = 'nkl-cmd';
    cmdEl.textContent = cleanCmd;
    row.appendChild(cmdEl);

    if (desc) {
      const descEl = document.createElement('span');
      descEl.className = 'nkl-desc';
      descEl.textContent = desc;
      row.appendChild(descEl);
    }

    if (needsArg) {
      const argEl = document.createElement('span');
      argEl.className = 'nkl-arg';
      argEl.textContent = 'требуется аргумент';
      row.appendChild(argEl);
    }

    return { row: row, command: cleanCmd };
  }

  // ==================== Логика фильтрации ====================
  // Очки соответствия: чем больше — тем лучше.
  //  точное совпадение > начало команды > подстрока описания/команды
  function scoreMatch(query, command, desc) {
    const q = query.toLowerCase();
    const c = command.toLowerCase();

    if (!q) return 1; // пустой запрос после "!" — показываем всё подряд
    if (c === q) return 100;
    if (c.startsWith(q)) return 50;
    if (c.includes(q)) return 30;
    if (desc && desc.toLowerCase().includes(q)) return 10;
    return 0;
  }

  function collectSuggestions(query) {
    if (!patternsData) return [];

    const results = [];

    // Идём по секциям в порядке order (getCommandSections уже отсортирован);
    // каждая секция показывается только если её мини-тумблер включён.
    window.NKLPatterns.getCommandSections(patternsData).forEach(function (section) {
      if (!section || !section.name) return;
      const key = sectionKey(section.name);
      if (!categoryFlags[key]) return; // мини-тумблер выключен
      const list = section.patterns;
      if (!Array.isArray(list) || list.length === 0) return;

      const title = section.toggleLabel || section.name;

      list.forEach(function (entry) {
        // Поддерживаем и строки "!команда", и объекты {cmd, desc}
        const cmd = typeof entry === 'string' ? entry : (entry && (entry.cmd || entry.command)) || '';
        const desc = typeof entry === 'object' && entry ? (entry.desc || entry.hint || '') : '';
        if (!cmd) return;

        const score = scoreMatch(query, cmd, desc);
        if (score > 0) {
          results.push({ score: score, cmd: cmd, desc: desc, cat: title });
        }
      });
    });

    // Топ-5 лучших совпадений (стабильно: при равных очках — по алфавиту)
    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.cmd.localeCompare(b.cmd);
    });
    return results.slice(0, MAX_SUGGESTIONS);
  }

  function renderPanel(items) {
    if (!currentInput) return;
    ensurePanel(currentInput);

    panel.innerHTML = '';

    if (items.length === 0) {
      hidePanel();
      return;
    }

    let lastCat = null;
    items.forEach(function (it, i) {
      if (it.cat !== lastCat) {
        const catEl = document.createElement('div');
        catEl.className = 'nkl-cat';
        catEl.textContent = it.cat;
        panel.appendChild(catEl);
        lastCat = it.cat;
      }

      const built = buildItem(it.cmd, it.desc);
      built.row.dataset.index = String(i);
      built.row.dataset.command = built.command;
      panel.appendChild(built.row);
    });

    suggestions = items;
    activeIndex = -1;
    panel.style.display = 'block';
  }

  // ==================== Мост с MAIN world (порт подхода SevenTV) ====================
  // SevenTV Extension вставляет текст НЕ через DOM/Selection API, а напрямую
  // через движок Slate: slate.apply({type:'insert_text'/'remove_text'/'set_selection'}).
  // Объект slateEditor живёт внутри React-дерева и виден только в MAIN world
  // страницы, поэтому саму вставку выполняет page-world.js, а сюда приходят
  // ответы через window.postMessage.
  let pageWorldReady = false;
  let insertSeq = 0;
  const insertCallbacks = {}; // id -> функция ответа

  window.addEventListener('message', function (ev) {
    const d = ev.data;
    if (!d || d.source !== 'nkl-page') return;

    if (d.type === 'nkl-ready') {
      pageWorldReady = true;
      return;
    }
    if (d.type === 'nkl-insert-result') {
      const cb = insertCallbacks[d.id];
      if (cb) { delete insertCallbacks[d.id]; cb(d); }
    }
  });

  function askPageWorldInsert(command, caretAbs) {
    return new Promise(function (resolve) {
      const id = 'nkl-' + (++insertSeq);
      insertCallbacks[id] = resolve;
      try {
        window.postMessage(
          { source: 'nkl-content', type: 'nkl-insert-command', id: id, command: command, caret: caretAbs },
          '*'
        );
      } catch (e) {
        delete insertCallbacks[id];
        resolve({ ok: false, error: String(e) });
        return;
      }
      setTimeout(function () {
        if (insertCallbacks[id]) {
          delete insertCallbacks[id];
          resolve({ ok: false, error: 'timeout' });
        }
      }, 500);
    });
  }

  // Абсолютная позиция курсора во всём тексте поля (как cursorLocation.offset
  // у SevenTV, только в плоских координатах DOM-текста). page-world сопоставит
  // её с leaf'ом Slate по path/offset.
  function getCaretOffset(inputEl) {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!inputEl.contains(range.startContainer)) return null;
      const pre = range.cloneRange();
      pre.selectNodeContents(inputEl);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    } catch (e) {
      return null;
    }
  }

  // ==================== Вставка команды в поле ввода ====================
  // Основной путь — метод SevenTV: замена набранного "!токена" на полную
  // команду выполняется операциями Slate (remove_text + insert_text +
  // set_selection) внутри MAIN world. execCommand('insertText') остался
  // только как аварийный fallback, если MAIN world недоступен.
  async function insertTail(command) {
    if (!currentInput || !command) return;

    const fullText = getLiveText(currentInput);
    const caret = getCaretOffset(currentInput);

    // Путь 1: Slate-операции через page-world (подход SevenTV).
    if (pageWorldReady) {
      const res = await askPageWorldInsert(command, caret);
      if (res && res.ok) {
        hidePanel();
        lastText = getLiveText(currentInput);
        return;
      }
      // Не удалось найти slateEditor — падаем на fallback,
      // но если пользователь уже набрал команду целиком — ничего не вставляем.
    }

    // Путь 2 (fallback): вычисляем "хвост" и вставляем нативным
    // execCommand — он генерирует правильный beforeinput/input событие,
    // которое Slate сам обрабатывает через свой DOM->Slate маппинг.
    const tail = computeTail(fullText, command);
    if (!tail) {
      hidePanel();
      lastText = getLiveText(currentInput);
      return;
    }
    document.execCommand('insertText', false, tail);

    hidePanel();
    lastText = getLiveText(currentInput);
  }

  // Вычисляет, какой текст осталось дописать к текущему вводу (для fallback).
  // fullText — что сейчас в поле (например "!ка"), command — цель ("!какуляторы").
  function computeTail(fullText, command) {
    const target = command + ' '; // после команды всегда пробел
    if (target.startsWith(fullText)) {
      return target.slice(fullText.length);
    }
    // Ввод НЕ является префиксом цели — safest вариант: дописать всю команду.
    return target;
  }

  function chooseSuggestion(index) {
    const item = suggestions[index];
    if (!item) return;
    insertTail(String(item.cmd).replace(/\*\s*$/, '').trim());
  }

  // ==================== Реакция на ввод ====================
  function refreshFromInput() {
    if (!enabled || !currentInput || !currentInput.isConnected) {
      hidePanel();
      return;
    }

    const text = getLiveText(currentInput);
    if (text === lastText) return; // дубли-события без изменения текста — игнор
    lastText = text;

    //console.log('NKL chat-input: изменился ввод →', JSON.stringify(text));

    // Подсказки активны только когда ввод НАЧИНАЕТСЯ с "!"
    if (text[0] !== '!') {
      hidePanel();
      return;
    }

    const query = text.slice(1).split(/\s+/)[0]; // слово после "!" до первого пробела
    const items = collectSuggestions(query);
    renderPanel(items);
  }

  // Читаем живой DOM через Range API: Slate обновляет DOM батчами,
  // а Range.toString() всегда отдаёт актуальный текст.
  function getLiveText(inputEl) {
    try {
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      return range.toString();
    } catch (e) {
      return inputEl.textContent || '';
    }
  }

  function onNativeEvent(e) {
    if (!enabled) return; // главный тумблер выключен — не тратим ничего
    if (e && e.type === 'beforeinput') return; // текст ещё старый

    refreshFromInput(); // синхронная попытка: обычно текст уже актуален

    // Подстраховка на случай React-батча: РОВНО ОДНА отложенная перепроверка
    // на событие (не цикл и не опрос).
    if (pendingVerify) cancelAnimationFrame(pendingVerify);
    pendingVerify = requestAnimationFrame(function () {
      pendingVerify = null;
      refreshFromInput();
    });
  }

  // Навигация стрелками / Enter / Esc.
  // Enter НЕ перехватываем: пусть Twitch отправляет сообщение как обычно —
  // любые stopPropagation/preventDefault на Enter конфликтуют с обработкой
  // отправки Slate и приводила к рассинхрону. Выбор мышью и Tab достаточно.
  function onKeyDown(e) {
    if (!enabled || !panel || panel.style.display === 'none') return;

    if (e.key === 'Escape') {
      hidePanel();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + suggestions.length) % suggestions.length;
      const rows = panel.querySelectorAll('.nkl-item');
      rows.forEach(function (r, i) {
        r.classList.toggle('nkl-active', i === activeIndex);
      });
      if (rows[activeIndex]) rows[activeIndex].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Tab' && activeIndex >= 0) {
      e.preventDefault(); // Tab без активной подсказки — обычное поведение браузера
      Promise.resolve(chooseSuggestion(activeIndex)).catch(function () {});
    }
  }

  // ==================== Подключение к полю ввода ====================
  function observeEditorTree(el) {
    if (domObserver) domObserver.disconnect();
    if (!enabled) return;
    domObserver = new MutationObserver(function () {
      if (enabled) refreshFromInput();
    });
    domObserver.observe(el, { childList: true, subtree: true, characterData: true });
  }

  function attachToInput(inputEl) {
    if (currentInput === inputEl && inputEl.isConnected) return;
    detachFromInput();
    currentInput = inputEl;
    lastText = getLiveText(inputEl);

    currentInput.addEventListener('input', onNativeEvent);
    currentInput.addEventListener('beforeinput', onNativeEvent);
    currentInput.addEventListener('compositionend', onNativeEvent);
    currentInput.addEventListener('keydown', onKeyDown);
    currentInput.addEventListener('blur', function () {
      // Не скрываем сразу: mousedown по подсказке опережает blur
      setTimeout(hidePanel, 150);
    });

    observeEditorTree(inputEl);

    // Пингуем MAIN world: page-world.js мог загрузиться раньше, чем мы
    // навесили слушатель сообщений — он ответит 'nkl-ready' и мы узнаем,
    // что Slate-вставка доступна (как у SevenTV).
    try { window.postMessage({ source: 'nkl-content', type: 'nkl-ping' }, '*'); } catch (e) {}

    console.log('✅ NKL chat-input: слушатель навешен на поле ввода чата');
  }

  function detachFromInput() {
    if (currentInput) {
      currentInput.removeEventListener('input', onNativeEvent);
      currentInput.removeEventListener('beforeinput', onNativeEvent);
      currentInput.removeEventListener('compositionend', onNativeEvent);
      currentInput.removeEventListener('keydown', onKeyDown);
    }
    if (domObserver) { domObserver.disconnect(); domObserver = null; }
    if (pendingVerify) { cancelAnimationFrame(pendingVerify); pendingVerify = null; }
    currentInput = null;
    lastText = '';
    hidePanel();
    startBodyWatcher();
  }

  function findAndAttach() {
    const inputEl = document.querySelector(INPUT_SELECTOR);
    if (inputEl) {
      attachToInput(inputEl);
      stopWaiter();
      return true;
    }
    return false;
  }

  function stopWaiter() {
    if (waiter) { waiter.disconnect(); waiter = null; }
  }

  // Поисковый наблюдатель нужен ТОЛЬКО пока поля нет или его заменили.
  function startBodyWatcher() {
    if (waiter) return;
    waiter = new MutationObserver(function () {
      if (currentInput && !currentInput.isConnected) detachFromInput();
      if (!currentInput && findAndAttach()) stopWaiter();
    });
    waiter.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    // Сначала дожидаемся паттернов из памяти — список секций для тумблеров
    // строится по данным, захардкоженных категорий больше нет.
    loadPatterns().then(loadToggles);
    if (!findAndAttach()) startBodyWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
