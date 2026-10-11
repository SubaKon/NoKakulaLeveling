// filter.js — весь фильтр сообщений для NoKakulaLeveling
// Подключается к content.js через <script>-тег (manifest: ["filter.js", "content.js"])
// Наружу отдаётся одна функция: window.NKLFilter.shouldHide(node)

(function () {
  // Глобальные переменные фильтра
  let patterns = [];
  let isHideOthersEnabled = false;
  let userNickname = '';

  const BOT_NICKNAME = 'AlexstraWho'; // Ник Алекстры

  // 1. Загружаем паттерны из файла
  async function loadPatterns() {
    try {
      const response = await fetch(chrome.runtime.getURL('patterns.json'));
      const data = await response.json();
      patterns = data.kakulaLeveling || [];
      console.log('✅ Загружено паттернов:', patterns.length);
    } catch (error) {
      console.error('❌ Ошибка загрузки паттернов:', error);
    }
  }

  // 2. Загружаем состояние тумблеров и ника из storage
  function loadToggleState() {
    chrome.storage.sync.get(['hideOthersKakula', 'twitchNickname'], function (result) {
      isHideOthersEnabled = result.hideOthersKakula || false;
      userNickname = (result.twitchNickname || '').trim();
    });
  }

  // 3. Проверяем, является ли первый символ смайликом или @
  function isEmojiOrAt(text, node) {
    if (!text) return false;

    // 1. Проверяем на @
    if (text.charAt(0) === '@') {
      return true;
    }

    // 2. Проверяем на кастомный эмодзи Twitch (картинка в самом начале)
    const textContainer = node.querySelector('[data-a-target="chat-message-text"]');
    if (textContainer) {
      const firstChild = textContainer.firstElementChild;
      if (firstChild && firstChild.tagName === 'IMG' && (firstChild.classList.contains('chat-emoticon') || firstChild.classList.contains('emoticon'))) {
        return true;
      }
    }

    // 3. ЖЕЛЕЗОБЕТОННАЯ ПРОВЕРКА:
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

  // 5. Проверяем текст сообщения по всем паттернам
  function containsPattern(messageText) {
    for (const pattern of patterns) {
      if (matchesPattern(messageText, pattern)) {
        return true;
      }
    }
    return false;
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

    // Тумблер "скрыть чужой" выключен — ничего не скрываем
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

    // 2. Если это Алекстра — особый фильтр
    if (username === BOT_NICKNAME) {
      if (isEmojiOrAt(fullText, node)) {
        shouldHideFlag = true;
      }
    }

    // 3. Проверка по паттернам — только если флаг ещё false
    if (!shouldHideFlag) {
      shouldHideFlag = containsPattern(fullText);
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

    if (changes.hideOthersKakula) {
      const newValue = changes.hideOthersKakula.newValue || false;
      if (newValue !== isHideOthersEnabled) {
        isHideOthersEnabled = newValue;
        toggleChanged = true;
      }
    }
    if (changes.twitchNickname) {
      userNickname = (changes.twitchNickname.newValue || '').trim();
      toggleChanged = true;
    }

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
