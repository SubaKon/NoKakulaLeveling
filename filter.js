// filter.js — весь фильтр сообщений для NoKakulaLeveling
// Подключается к content.js через <script>-тег
// (manifest: ["browser-polyfill.js", "patterns.js", "filter.js", "content.js", "chat-input.js"])
// Паттерны берутся из памяти расширения (chrome.storage.local) через window.NKLPatterns.
// Никаких захардкоженных имён ботов/каналов/тумблеров: всё генерируется из данных памяти.
// Наружу отдаётся одна функция: window.NKLFilter.shouldHide(node)

(function () {
  // Глобальные переменные фильтра
  let patterns = [];            // плоский список общих командных паттернов (все каналы)
  let botPatterns = {};         // { 'никбота': [...] } — текстовые паттерны конкретного бота
  let botSmileEnabled = {};     // { 'никбота': true } — у бота в паттернах есть "$smile$*"
  let botTogglesEnabled = {};   // { 'filter:<бот>': bool } — тумблеры «Фильтры сообщений» из popup
  let isHideOthersEnabled = false; // общий выключатель фильтра (главный тумблер в popup)
  let userNickname = '';

  // Ключ тумблера конкретного бота в chrome.storage.sync
  function botToggleKey(botNick) {
    return 'filter:' + botNick;
  }

  // 1. Загружаем паттерны из storage.local (первая загрузка — из файлов patterns/)
  async function loadPatterns() {
    try {
      const data = await window.NKLPatterns.ensureLoaded();
      patterns = window.NKLPatterns.getAllPatterns(data);

      // Собираем паттерны по никам ботов — новый формат несёт их в секции bots.
      // Спецпаттерн "$smile$*" не является текстовым: он включает проверку
      // «начинается со смайлика» только для этого бота.
      botPatterns = {};
      botSmileEnabled = {};
      window.NKLPatterns.getBotSections(data).forEach(function (bot) {
        const nick = String(bot.botUsername || '').toLowerCase();
        if (!nick) return;
        const list = bot.patterns || [];
        if (window.NKLPatterns.hasSmilePattern(list)) {
          botSmileEnabled[nick] = true;
        }
        botPatterns[nick] = window.NKLPatterns.withoutSmilePattern(list);
      });

      // Подтягиваем состояние тумблеров ботов из настроек
      loadBotToggleState();

      console.log('✅ Загружено паттернов:', patterns.length,
                  '| ботов:', Object.keys(botPatterns).length);
    } catch (error) {
      console.error('❌ Ошибка загрузки паттернов:', error);
    }
  }

  // 2. Загружаем состояние главного тумблера и ника из storage
  function loadToggleState() {
    chrome.storage.sync.get(['hideFilters', 'twitchNickname'], function (result) {
      isHideOthersEnabled = result.hideFilters || false;
      userNickname = (result.twitchNickname || '').trim();
    });
  }

  // 2b. Загружаем состояние тумблеров отдельных ботов («Фильтры сообщений»).
  // Значения по умолчанию — включены (поведение как до появления тумблеров).
  function loadBotToggleState() {
    const nicks = Object.keys(botPatterns);
    if (nicks.length === 0) return;
    const keys = nicks.map(botToggleKey);
    chrome.storage.sync.get(keys, function (result) {
      nicks.forEach(function (nick) {
        const v = result[botToggleKey(nick)];
        botTogglesEnabled[nick] = (v === undefined) ? true : !!v;
      });
    });
  }

  // 3. Проверка «сообщение начинается со смайлика»: картинка-эмодзи Twitch
  // в самом начале сообщения либо юникод-небуква (💸, ‼️, 𖡎 ...).
  // Вызывается только для ботов, у которых в паттернах есть "$smile$*".
  function startsWithSmile(text, node) {
    if (!text) return false;

    // 1. Кастомный эмодзи Twitch (картинка в самом начале)
    const textContainer = node.querySelector('[data-a-target="chat-message-text"]');
    if (textContainer) {
      const firstChild = textContainer.firstElementChild;
      if (firstChild && firstChild.tagName === 'IMG' && (firstChild.classList.contains('chat-emoticon') || firstChild.classList.contains('emoticon'))) {
        return true;
      }
    }

    // 2. ЖЕЛЕЗОБЕТОННАЯ ПРОВЕРКА:
    // Проверяем, является ли первый символ ОБЫЧНОЙ буквой или цифрой
    const firstCodePoint = text.codePointAt(0);
    if (firstCodePoint !== undefined) {
      const firstCharFull = String.fromCodePoint(firstCodePoint);

      // \p{L} = любая буква (включая кириллицу), \p{N} = любая цифра
      const isNormalChar = /^\p{L}|\p{N}/u.test(firstCharFull);

      // Если это НЕ обычная буква и НЕ цифра, значит это смайлик, символ (𖡎, ‼️, 💸) или спецзнак
      if (!isNormalChar) {
        return true;
      }
    }

    return false;
  }

  // 4. Логика проверки паттерна
  function matchesPattern(messageText, pattern) {
    const startsWithStar = pattern.startsWith('*');
    const endsWithStar = pattern.endsWith('*');

    if (startsWithStar && endsWithStar) {
      const substring = pattern.slice(1, -1);
      return messageText.includes(substring);
    }
    else if (endsWithStar) {
      const prefix = pattern.slice(0, -1);
      return messageText.startsWith(prefix);
    }
    else if (startsWithStar) {
      const suffix = pattern.slice(1);
      return messageText.endsWith(suffix);
    }
    else {
      // Паттерн без звёздочек: точное совпадение ИЛИ совпадение с пробелом после паттерна
      // (чтобы "!акции " тоже засчитывалось как "!акции")
      if (messageText === pattern) return true;
      if (messageText.startsWith(pattern) && /\s/.test(messageText.charAt(pattern.length))) {
        return true;
      }
      return false;
    }
  }

  // 5. Проверяем текст сообщения по паттернам.
  // list — список паттернов (для бота — его собственные, иначе — общие командные)
  function matchesAny(messageText, list) {
    for (const pattern of list) {
      if (matchesPattern(messageText, pattern)) {
        return true;
      }
    }
    return false;
  }

  // Паттерны конкретного бота из памяти (storage.local); если бота нет в данных — [].
  // Общие командные паттерны сюда не подмешиваются: паттерны бота применяются
  // ТОЛЬКО к сообщениям этого бота, общие проверяются отдельно (shouldHide, шаг 3).
  function getPatternsForBot(botUsername) {
    const nick = String(botUsername || '').toLowerCase();
    return botPatterns[nick] || [];
  }

  // 6. Проверяем, есть ли в сообщении упоминание @ник пользователя (без учёта регистра)
  function hasUserMention(fullText) {
    if (!userNickname) return false;
    const nickLower = userNickname.toLowerCase();
    const mentionRegex = new RegExp('@' + nickLower + '(?![\\w])', 'i');
    return mentionRegex.test(fullText);
  }

  // Извлекаем имя автора и полный текст сообщения из узла
  function extractMessageData(node) {
    const usernameEl = node.querySelector('[data-a-target="chat-message-username"]');
    const username = usernameEl ? usernameEl.textContent.trim() : '';

    const textParts = node.querySelectorAll('[data-a-target="chat-message-text"], [data-a-target="chat-message-mention"]');
    let fullText = '';
    textParts.forEach(part => {
      fullText += part.textContent;
    });
    fullText = fullText.trim();

    return { username, fullText };
  }

  // ГЛАВНАЯ ФУНКЦИЯ ПРОВЕРКИ НА СКРЫТИЕ
  // Возвращает true, если сообщение нужно скрыть
  function shouldHide(node) {
    // Фильтр: реагируем только на LI (VOD) и DIV (Live)
    if (node.tagName !== 'LI' && node.tagName !== 'DIV') {
      return false;
    }

    // Общий тумблер фильтров выключен — ничего не скрываем
    if (!isHideOthersEnabled) {
      return false;
    }

    const { username, fullText } = extractMessageData(node);

    // Если это не полноценное сообщение, пропускаем
    if (!username || !fullText) {
      return false;
    }

    // 1. Если ник сообщения совпадает с ником пользователя — никогда не скрываем
    if (userNickname && username.toLowerCase() === userNickname.toLowerCase()) {
      return false;
    }

    let shouldHideFlag = false;

    // 2. Сообщения ботов из памяти (botUsername из паттернов):
    // паттерны бота применяются ТОЛЬКО к сообщениям этого бота.
    // Спецпаттерн "$smile$*" включает проверку «начинается со смайлика»,
    // "@..." обрабатывается дефолтной логикой (@ — обычный символ).
    const nickLower = username.toLowerCase();
    const isKnownBot = Object.prototype.hasOwnProperty.call(botPatterns, nickLower);

    if (isKnownBot && botTogglesEnabled[nickLower] !== false) {
      if (botSmileEnabled[nickLower] && startsWithSmile(fullText, node)) {
        shouldHideFlag = true;
      }
      if (!shouldHideFlag) {
        shouldHideFlag = matchesAny(fullText, getPatternsForBot(username));
      }
    }

    // 3. Проверка по общим командным паттернам — только если флаг ещё false
    if (!shouldHideFlag) {
      shouldHideFlag = matchesAny(fullText, patterns);
    }

    // 4. Если в сообщении есть упоминание @ник пользователя — не скрываем
    if (shouldHideFlag && hasUserMention(fullText)) {
      shouldHideFlag = false;
    }

    return shouldHideFlag;
  }

  // 9. Слушаем изменения в настройках
  chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace !== 'sync') return;

    let toggleChanged = false;

    if (changes.hideFilters) {
      const newValue = changes.hideFilters.newValue || false;
      if (newValue !== isHideOthersEnabled) {
        isHideOthersEnabled = newValue;
        toggleChanged = true;
      }
    }
    if (changes.twitchNickname) {
      userNickname = (changes.twitchNickname.newValue || '').trim();
      toggleChanged = true;
    }

    // Тумблеры «Фильтры сообщений» отдельных ботов (filter:<бот>)
    Object.keys(changes).forEach(function (key) {
      if (key.indexOf('filter:') === 0) {
        const nick = key.slice('filter:'.length);
        botTogglesEnabled[nick] = !!changes[key].newValue;
        toggleChanged = true;
      }
    });

    // Если тумблер поменял состояние — уведомляем content.js
    // (тот запустит разовый проход по уже открытым сообщениям)
    if (toggleChanged) {
      window.dispatchEvent(new CustomEvent('nkl:filter-state-changed', {
        detail: { enabled: isHideOthersEnabled }
      }));
    }
  });

  // Экспортируем API наружу
  window.NKLFilter = {
    init: loadPatterns,
    loadToggleState: loadToggleState,
    shouldHide: shouldHide
  };
})();
