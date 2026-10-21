// popup.js — настройки расширения NoKakulaLeveling.
// Никаких захардкоженных тумблеров и списков категорий: тумблеры каналов,
// «Фильтры сообщений» (боты) и «Быстрые команды» (секции commands)
// генерируются из паттернов в памяти расширения (chrome.storage.local,
// window.NKLPatterns). Первый элемент интерфейса — ник пользователя:
// без введённого ника включить тумблер канала нельзя.

document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup загружен');

  // Ключи настроек в chrome.storage.sync
  const MASTER_TOGGLE_KEY = 'hideFilters';   // общий выключатель фильтра сообщений
  const QUICK_MAIN_KEY = 'quickCommands';    // общий выключатель быстрых команд

  // Ключи тумблеров по данным паттернов
  function botToggleKey(botUsername) { return 'filter:' + String(botUsername).toLowerCase(); }
  function sectionToggleKey(sectionName) { return 'quickCommand:' + sectionName; }

  // Поле ввода ника
  const nicknameInput = document.getElementById('nicknameInput');
  const saveNicknameBtn = document.getElementById('saveNickname');

  // Контейнер тумблеров каналов (генерируются из паттернов)
  const channelTogglesEl = document.getElementById('channelToggles');

  // Блок проверки обновлений
  const checkUpdateBtn = document.getElementById('checkUpdateBtn');
  const versionInfo = document.getElementById('versionInfo');
  const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');

  // Блок обновления паттернов с GitHub
  const updatePatternsBtn = document.getElementById('updatePatternsBtn');
  const patternsInfo = document.getElementById('patternsInfo');

  // Тумблер-заглушка "Авто Какула Левелинг"
  const toggle3 = document.getElementById('toggle3');

  // ================= Тёмная тема в стиле Twitch =================
  const themeToggleBtn = document.getElementById('themeToggle');

  // Применяем тему сразу, чтобы не было "белой вспышки" при открытии popup
  function applyTheme(isDark) {
    document.body.classList.toggle('dark-theme', isDark);
    themeToggleBtn.textContent = isDark ? '☀️' : '🌙';
    themeToggleBtn.title = isDark ? 'Светлая тема' : 'Тёмная тема';
  }

  chrome.storage.sync.get(['darkTheme'], function(result) {
    // Если тема не сохранялась — подстраиваемся под системную
    let isDark = result.darkTheme;
    if (typeof isDark !== 'boolean') {
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    applyTheme(isDark);
  });

  themeToggleBtn.addEventListener('click', function() {
    const isDark = !document.body.classList.contains('dark-theme');
    applyTheme(isDark);
    chrome.storage.sync.set({ darkTheme: isDark });
    console.log('Тема изменена, darkTheme:', isDark);
  });
  // =================================================================

  // Загружаем сохраненный ник (ник — первое, что делает тумблеры каналов доступными)
  chrome.storage.sync.get(['twitchNickname'], function(result) {
    nicknameInput.value = result.twitchNickname || '';
    console.log('Загружен ник:', nicknameInput.value);
    refreshChannelTogglesEnabled();
    syncMasterToggleState(); // состояние главного тумблера канала по сохранённым настройкам
  });

  // Тумблер-заглушка "Авто Какула Левелинг" — всегда выключен,
  // при попытке включить показывает, что функция скоро появится
  toggle3.addEventListener('click', function(e) {
    e.preventDefault();
    this.checked = false;
    alert('Эта функция скоро появится! Следите за обновлениями 😉');
  });

  // Есть ли введённый ник — без него каналы переключать нельзя
  function hasNickname() {
    return !!nicknameInput.value.trim();
  }

  // Активируем/деактивируем все тумблеры каналов по наличию ника
  function refreshChannelTogglesEnabled() {
    const ok = hasNickname();
    channelTogglesEl.querySelectorAll('input.channel-master').forEach(function(input) {
      input.disabled = !ok;
    });
  }

  // Синхронизируем состояние главных тумблеров каналов с сохранёнными
  // настройками (hideFilters / quickCommands). Вызывается после загрузки
  // ника — до этого значение из storage ещё неизвестно.
  function syncMasterToggleState() {
    chrome.storage.sync.get([MASTER_TOGGLE_KEY, QUICK_MAIN_KEY], function(result) {
      const on = !!(result[MASTER_TOGGLE_KEY] || result[QUICK_MAIN_KEY]);
      channelTogglesEl.querySelectorAll('input.channel-master').forEach(function(input) {
        input.checked = on;
        const card = input.closest('.toggle-container');
        const advanced = card && card.querySelector('.channel-advanced');
        if (advanced) advanced.style.display = on ? 'block' : 'none';
      });
    });
  }

  // Сохранение ника (по кнопке и по Enter)
  function saveNickname() {
    const nick = nicknameInput.value.trim();

    // Ник на Twitch не может содержать пробелов
    if (nick.includes(' ')) {
      alert('Ник не может содержать пробелы!');
      return;
    }

    chrome.storage.sync.set({ twitchNickname: nick }, function() {
      console.log('Сохранен ник:', nick);
    });

    refreshChannelTogglesEnabled();

    // Если ник убрали — выключаем все каналы
    if (!nick) {
      channelTogglesEl.querySelectorAll('input.channel-master').forEach(function(input) {
        input.checked = false;
        const advanced = input.closest('.toggle-container').querySelector('.channel-advanced');
        if (advanced) advanced.style.display = 'none';
      });
      chrome.storage.sync.set({ hideFilters: false, quickCommands: false });
    }
  }

  saveNicknameBtn.addEventListener('click', saveNickname);
  nicknameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveNickname();
  });
  // Ник меняют без кнопки — реагируем сразу на доступность тумблеров
  nicknameInput.addEventListener('input', refreshChannelTogglesEnabled);

  // ================= Построение тумблеров из паттернов =================
  //
  // Каждый канал (файл patterns/<Канал>.json) — это карточка с тумблером
  // по "channelName". При включении раскрываются два блока:
  //   «Фильтры сообщений:» — тумблеры по "toggleLabel" каждого бота (bots),
  //   «Быстрые команды»    — тумблеры по "toggleLabel" каждой секции (commands).
  // Быстрые команды показаны раскрытым списком сразу (отдельного выключателя нет).

  function pulseMasterFilterFlag() {
    chrome.storage.sync.get([MASTER_TOGGLE_KEY], function(result) {
      const current = !!result[MASTER_TOGGLE_KEY];
      const flipped = {};
      flipped[MASTER_TOGGLE_KEY] = !current;
      chrome.storage.sync.set(flipped, function() {
        const restored = {};
        restored[MASTER_TOGGLE_KEY] = current;
        chrome.storage.sync.set(restored);
      });
    });
  }

  function createSmallToggle(storageKey, label, hint, defaultValue, onChange) {
    const item = document.createElement('div');
    item.className = 'sub-toggle-item';

    const labelEl = document.createElement('label');
    labelEl.className = 'toggle-label';

    const textEl = document.createElement('span');
    textEl.className = 'toggle-text';
    textEl.textContent = label;
    if (hint) {
      const hintEl = document.createElement('span');
      hintEl.className = 'sub-toggle-hint';
      hintEl.textContent = hint;
      textEl.appendChild(hintEl);
    }

    const switchEl = document.createElement('div');
    switchEl.className = 'toggle-switch small';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.storageKey = storageKey;

    const slider = document.createElement('span');
    slider.className = 'slider';

    switchEl.appendChild(input);
    switchEl.appendChild(slider);
    labelEl.appendChild(textEl);
    labelEl.appendChild(switchEl);
    item.appendChild(labelEl);

    const obj = { input: input, element: item };

    chrome.storage.sync.get([storageKey], function(result) {
      input.checked = (result[storageKey] === undefined) ? defaultValue : !!result[storageKey];
    });

    input.addEventListener('change', function() {
      const payload = {};
      payload[storageKey] = this.checked;
      chrome.storage.sync.set(payload);
      if (onChange) onChange(this.checked);
    });

    return obj;
  }

  function buildBlock(titleText) {
    const block = document.createElement('div');
    block.className = 'sub-toggles';
    const title = document.createElement('span');
    title.className = 'sub-toggles-title';
    title.textContent = titleText;
    block.appendChild(title);
    return block;
  }

  function buildChannelCard(channelKey, channel) {
    const container = document.createElement('div');
    container.className = 'toggle-container';

    // Расширенные настройки канала (создаём раньше главного тумблера —
    // на него ссылается обработчик change)
    const advanced = document.createElement('div');
    advanced.className = 'channel-advanced';
    advanced.style.display = 'none';

    // --- Блок «Фильтры сообщений:» — по одному тумблеру на каждого бота ---
    const bots = channel.bots || [];
    if (bots.length > 0) {
      const filterBlock = buildBlock('Фильтры сообщений:');
      bots.forEach(function(bot) {
        const t = createSmallToggle(
          botToggleKey(bot.botUsername),
          bot.toggleLabel || bot.botUsername,
          null,
          false, // по умолчанию фильтры включены
          pulseMasterFilterFlag
          
        );
        filterBlock.appendChild(t.element);
      });
      advanced.appendChild(filterBlock);
    }

    // --- Блок «Быстрые команды» — тумблеры секций commands.
    // Отдельного выключателя для всего блока нет: список показывается раскрытым
    // сразу вместе с блоком фильтров. ---
    const sections = (channel.commands || []).slice().sort(function(a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    if (sections.length > 0) {
      const cmdBlock = buildBlock('Быстрые команды');
      sections.forEach(function(sec) {
        const t = createSmallToggle(
          sectionToggleKey(sec.name),
          sec.toggleLabel || sec.name,
          null,
          false,
          null
        );
        cmdBlock.appendChild(t.element);
      });
      advanced.appendChild(cmdBlock);
    }

    // Главный тумблер канала — название из "channelName"
    const label = document.createElement('label');
    label.className = 'toggle-label';

    const text = document.createElement('span');
    text.className = 'toggle-text';
    text.textContent = channel.channelName || channelKey;

    const switchEl = document.createElement('div');
    switchEl.className = 'toggle-switch';

    const masterInput = document.createElement('input');
    masterInput.type = 'checkbox';
    masterInput.className = 'channel-master';
    masterInput.disabled = !hasNickname(); // без ника канал недоступен

    const slider = document.createElement('span');
    slider.className = 'slider';

    switchEl.appendChild(masterInput);
    switchEl.appendChild(slider);
    label.appendChild(text);
    label.appendChild(switchEl);
    container.appendChild(label);

    // Состояние главного тумблера канала применит syncMasterToggleState()
    // после загрузки ника (иначе не знаем, включены ли фильтры/команды).

    masterInput.addEventListener('change', function() {
      // Без введённого ника переключать канал нельзя
      if (this.checked && !hasNickname()) {
        this.checked = false;
        alert('Сначала укажите ваш Twitch ник в поле выше!');
        return;
      }
      advanced.style.display = this.checked ? 'block' : 'none';
      chrome.storage.sync.set({
        hideFilters: this.checked,
        quickCommands: this.checked
      });
    });

    container.appendChild(advanced);
    return container;
  }

  function renderChannels(patternsData) {
    channelTogglesEl.innerHTML = '';
    if (!window.NKLPatterns || !patternsData) return;
    const channels = window.NKLPatterns.getChannels(patternsData);
    channels.forEach(function(ch) {
      if (!ch) return;
      const key = ch.channelName || '';
      channelTogglesEl.appendChild(buildChannelCard(key, ch));
    });
  }

  // Ждём паттерны из памяти (первая загрузка — из файлов patterns/) и строим UI.
  // После построения повторно синхронизируем состояние тумблеров с настройками.
  window.NKLPatterns.ensureLoaded().then(function(data) {
    renderChannels(data);
    syncMasterToggleState();
  });

  // ================= Проверка обновлений расширения =================

  const REPO_API_URL = 'https://api.github.com/repos/SubaKon/NoKakulaLeveling/releases/latest';
  const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // раз в день

  // Сравнивает версии вида "1.2.3", возвращает 1 если a > b, -1 если a < b, 0 если равны
  function compareVersions(a, b) {
    const pa = String(a).replace(/^v/i, '').split('.').map(Number);
    const pb = String(b).replace(/^v/i, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  // Показывает результат проверки под кнопкой
  function showUpdateResult(newVersion) {
    const currentVersion = chrome.runtime.getManifest().version;
    versionInfo.textContent = `Текущая версия: ${currentVersion} → Последний release: ${newVersion}`;

    if (compareVersions(newVersion, currentVersion) > 0) {
      downloadUpdateBtn.style.display = 'block'; // большая зелёная кнопка скачивания
    } else {
      downloadUpdateBtn.style.display = 'none';
      versionInfo.textContent += '. У вас последняя версия 🙂';
    }
  }

  function checkForUpdates(force) {
    return new Promise(function(resolve) {
      // Принудительная проверка (по кнопке) или проверка раз в день при открытии popup
      chrome.storage.local.get(['lastUpdateCheck'], function(result) {
        const lastCheck = result.lastUpdateCheck || 0;
        if (!force && Date.now() - lastCheck < CHECK_INTERVAL_MS) {
          resolve(null); // уже проверяли сегодня
          return;
        }

        fetch(REPO_API_URL)
          .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function(data) {
            chrome.storage.local.set({ lastUpdateCheck: Date.now() });
            const newVersion = (data.tag_name || '').trim();
            if (newVersion) {
              showUpdateResult(newVersion);
            }
            resolve(newVersion);
          })
          .catch(function(err) {
            console.log('Ошибка проверки обновления:', err);
            if (force) {
              versionInfo.textContent = 'Не удалось проверить обновление 😔';
            }
            resolve(null);
          });
      });
    });
  }

  // Кнопка принудительной проверки
  checkUpdateBtn.addEventListener('click', function() {
    checkUpdateBtn.disabled = true;
    checkUpdateBtn.textContent = 'Проверяем...';
    downloadUpdateBtn.style.display = 'none';
    versionInfo.textContent = '';

    checkForUpdates(true).finally(function() {
      checkUpdateBtn.disabled = false;
      checkUpdateBtn.textContent = 'Проверить обновление';
    });
  });

  // При открытии popup — автоматическая проверка, но не чаще раза в день
  checkForUpdates(false);

  // ================= Обновление паттернов с GitHub =================
  //
  // Логика сама по себе в patterns.js (window.NKLPatterns.updateFromGitHub):
  // 1. Проверяем наличие файлов в папке patterns/ на GitHub;
  // 2. Читаем их;
  // 3. compatibilityVersion > 2 → окошко "Паттерны несовместимы с этой
  //    версией расширения";
  // 4. patternVersion больше той, что в памяти → перезаписываем storage.local.

  function showPatternsVersionInfo() {
    chrome.storage.local.get(['patterns'], function(result) {
      const data = (result && result.patterns) || {};
      const keys = Object.keys(data);
      if (keys.length === 0) {
        patternsInfo.textContent = '';
        return;
      }
      const parts = keys.map(function(k) {
        return k + ': v' + (data[k].patternVersion || 0);
      });
      patternsInfo.textContent = 'Паттерны в памяти — ' + parts.join(', ');
    });
  }

  updatePatternsBtn.addEventListener('click', function() {
    updatePatternsBtn.disabled = true;
    updatePatternsBtn.textContent = 'Обновляем...';
    patternsInfo.textContent = '';

    window.NKLPatterns.updateFromGitHub().then(function(res) {
      // Окошко о несовместимости формата
      if (res.incompatible) {
        alert('Паттерны несовместимы с этой версией расширения');
      }

      if (res.updated.length > 0) {
        patternsInfo.textContent =
          '✅ Паттерны обновлены: ' + res.updated.join(', ') +
          '. Перезагрузите страницы Twitch, чтобы применить.';
        // Перестраиваем тумблеры по обновлённым данным
        window.NKLPatterns.ensureLoaded().then(renderChannels);
      } else if (res.skipped.length > 0 && !res.incompatible && res.errors.length === 0) {
        patternsInfo.textContent = 'У вас уже последние версии паттернов 🙂';
      } else if (res.errors.length > 0) {
        patternsInfo.textContent = 'Не удалось обновить паттерны: ' + res.errors.join('; ');
      } else if (res.incompatible) {
        patternsInfo.textContent = 'Обновление не применено: формат паттернов не поддерживается.';
      }

      showPatternsVersionInfo();
    }).catch(function(err) {
      patternsInfo.textContent = 'Ошибка обновления паттернов: ' + err.message;
    }).finally(function() {
      updatePatternsBtn.disabled = false;
      updatePatternsBtn.textContent = 'Обновить паттерны с GitHub';
    });
  });

  // При открытии popup показываем версии паттернов, лежащие в памяти
  window.NKLPatterns.ensureLoaded().then(showPatternsVersionInfo);
});
