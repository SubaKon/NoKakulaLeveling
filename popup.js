// Ждем, пока DOM загрузится
document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup загружен');

  // Получаем тумблеры
  const toggle2 = document.getElementById('toggle2');

  // Тумблер "Быстрые команды" и маленькие тумблеры
  const toggleQuickCommands = document.getElementById('toggleQuickCommands');
  const subToggles = document.getElementById('subToggles');
  const toggleBaseCommand = document.getElementById('toggleBaseCommand');
  const toggleKakulaCommand = document.getElementById('toggleKakulaCommand');
  const toggleKakulaDefense = document.getElementById('toggleKakulaDefense');

  // Тумблер-заглушка "Авто Какула Левелинг"
  const toggle3 = document.getElementById('toggle3');

  // Поле ввода ника
  const nicknameInput = document.getElementById('nicknameInput');
  const saveNicknameBtn = document.getElementById('saveNickname');

  // Блок проверки обновлений
  const checkUpdateBtn = document.getElementById('checkUpdateBtn');
  const versionInfo = document.getElementById('versionInfo');
  const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');

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

  // Загружаем сохраненное состояние второго тумблера
  chrome.storage.sync.get(['hideOthersKakula'], function(result) {
    toggle2.checked = result.hideOthersKakula || false;
    console.log('Загружено состояние toggle2:', toggle2.checked);
  });

  // Загружаем сохраненный ник
  chrome.storage.sync.get(['twitchNickname'], function(result) {
    nicknameInput.value = result.twitchNickname || '';
    console.log('Загружен ник:', nicknameInput.value);
  });

  // Загружаем состояние "Быстрых команд" и маленьких тумблеров
  chrome.storage.sync.get(['quickCommands', 'quickCommandBase', 'quickCommandKakula', 'quickCommandKakulaDefense'], function(result) {
    toggleQuickCommands.checked = result.quickCommands || false;
    toggleBaseCommand.checked = result.quickCommandBase || false;
    toggleKakulaCommand.checked = result.quickCommandKakula || false;
    toggleKakulaDefense.checked = result.quickCommandKakulaDefense || false;
    subToggles.style.display = toggleQuickCommands.checked ? 'block' : 'none';
    console.log('Загружено состояние быстрых команд:', toggleQuickCommands.checked);
  });

  // Тумблер-заглушка "Авто Какула Левелинг" — всегда выключен,
  // при попытке включить показывает, что функция скоро появится
  toggle3.addEventListener('click', function(e) {
    e.preventDefault();
    this.checked = false;
    alert('Эта функция скоро появится! Следите за обновлениями 😉');
  });

  // Обработчик для второго тумблера
  toggle2.addEventListener('change', function() {
    console.log('Toggle 2:', this.checked);

    // Требует заполненный ник
    if (this.checked && !nicknameInput.value.trim()) {
      this.checked = false; // Сбрасываем обратно
      alert('Сначала укажите ваш Twitch ник в поле ниже!');
      return;
    }

    chrome.storage.sync.set({ hideOthersKakula: this.checked });
  });

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

    // Если включен второй тумблер, а ник убрали — выключаем его
    if (!nick && toggle2.checked) {
      toggle2.checked = false;
      chrome.storage.sync.set({ hideOthersKakula: false });
    }
  }

  saveNicknameBtn.addEventListener('click', saveNickname);
  nicknameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveNickname();
  });

  // Обработчик для тумблера "Быстрые команды"
  toggleQuickCommands.addEventListener('change', function() {
    console.log('Быстрые команды:', this.checked);

    chrome.storage.sync.set({ quickCommands: this.checked });

    // Показываем/скрываем маленькие тумблеры
    subToggles.style.display = this.checked ? 'block' : 'none';

  });

  // Обработчик для маленького тумблера "Это база, это знать надо"
  toggleBaseCommand.addEventListener('change', function() {
    console.log('База команда:', this.checked);
    chrome.storage.sync.set({ quickCommandBase: this.checked });
  });

  // Обработчик для маленького тумблера "Какула Левелинг"
  toggleKakulaCommand.addEventListener('change', function() {
    console.log('Какула Левелинг команда:', this.checked);
    chrome.storage.sync.set({ quickCommandKakula: this.checked });
  });

  // Обработчик для маленького тумблера "Какула Дефенс"
  toggleKakulaDefense.addEventListener('change', function() {
    console.log('Какула Дефенс команда:', this.checked);
    chrome.storage.sync.set({ quickCommandKakulaDefense: this.checked });
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
});
