// patterns.js — единый источник паттернов для расширения NoKakulaLeveling.
//
// Новый формат патернов (папка patterns/, на данный момент один файл AlexstraWho.json):
// {
//   compatibilityVersion, patternVersion, channelName,
//   bots:     [{ botUsername, toggleLabel, patterns }],
//   commands: [{ name, toggleLabel, order, patterns }]
// }
//
// Логика загрузки:
// 1. Проверяем chrome.storage.local — если паттерны там есть, берём из памяти.
// 2. Если их нет (первая загрузка) — fetch файла patterns/AlexstraWho.json
//    через chrome.runtime.getURL и записываем в storage.local.
// 3. Обновление с GitHub (updatePatternsFromGitHub): читаем папку
//    https://raw.githubusercontent.com/SubaKon/NoKakulaLeveling/refs/heads/updates/patterns/
//    (перед релизом ветка updates будет заменена на main).
//    - compatibilityVersion > 2 → окно "Паттерны несовместимы с этой версией расширения";
//    - patternVersion больше того, что в памяти → перезаписываем память.
//
// Подключается ПЕРЕД filter.js / chat-input.js в content_scripts manifest'а
// (и перед popup.js в popup.html). Наружу отдаётся window.NKLPatterns.

(function () {
  'use strict';

  // Жёстко фиксируем к коду список файлов патернов (заделка на будущее —
  // несколько каналов/ботов появятся позже, сейчас только AlexstraWho).
  const PATTERN_FILES = ['patterns/AlexstraWho.json'];

  // Максимальная версия формата паттернов, которую понимает это расширение.
  // Если в файле с GitHub compatibilityVersion больше — паттерны несовместимы.
  const MAX_COMPATIBILITY_VERSION = 2;

  // Папка patterns/ в репозитории на GitHub (raw). Сейчас ветка updates —
  // тестовая; перед релизом будет заменена на main.
  const GITHUB_PATTERNS_BASE_URL =
    'https://raw.githubusercontent.com/SubaKon/NoKakulaLeveling/refs/heads/main/patterns/';

  // Список файлов для проверки с GitHub берём из того же жёстко
  // зафиксированного списка локальных файлов (patterns/X.json → X.json).
  function getGitHubPatternFiles() {
    return PATTERN_FILES.map(function (f) {
      return f.replace(/^patterns\//, '');
    });
  }

  // Возвращает паттерны, хранящиеся в памяти расширения (storage.local).
  function getStoredPatterns() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(['patterns'], function (result) {
        resolve((result && result.patterns) || {});
      });
    });
  }

  // Записывает паттерны в память расширения.
  function savePatternsToStorage(data) {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ patterns: data }, function () {
        resolve(true);
      });
    });
  }

  // ==================== Обновление паттернов с GitHub ====================
  //
  // 1. Проверяем наличие файлов в папке patterns/ на GitHub (Contents API).
  // 2. Читаем найденные файлы (raw.githubusercontent.com).
  // 3. Если compatibilityVersion файла > MAX_COMPATIBILITY_VERSION —
  //    возвращаем ошибку несовместимости (popup покажет окошко), ничего
  //    не перезаписываем.
  // 4. Если patternVersion больше той, что лежит в storage.local —
  //    перезаписываем память этим файлом.
  //
  // Возвращает промис с объектом:
  // { ok, incompatible, updated, skipped, errors[], files[] }
  async function updatePatternsFromGitHub() {
    const result = {
      ok: false,
      incompatible: false,
      updated: [],   // каналы, чьи паттерны перезаписаны
      skipped: [],   // каналы, где версия в памяти не ниже github-версии
      errors: [],    // тексты ошибок (сеть/парсинг)
      files: []      // имена файлов, найденных в папке patterns/ на GitHub
    };

    try {
      // --- Шаг 1. Проверяем наличие файлов в папке patterns/ на GitHub ---
      const contentsUrl =
        'https://api.github.com/repos/SubaKon/NoKakulaLeveling/contents/patterns' +
        '?ref=main';
      const contentsResp = await fetch(contentsUrl, {
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!contentsResp.ok) {
        throw new Error('Не удалось получить список файлов папки patterns/ (HTTP ' +
          contentsResp.status + ')');
      }
      const contents = await contentsResp.json();
      if (!Array.isArray(contents)) {
        throw new Error('Папка patterns/ на GitHub пуста или недоступна');
      }

      const expectedFiles = getGitHubPatternFiles();
      const remoteJsonFiles = contents.filter(function (entry) {
        return entry.type === 'file' && /\.json$/i.test(entry.name);
      }).map(function (entry) { return entry.name; });

      result.files = remoteJsonFiles;

      // Берём только те файлы, которые ожидаем (жёсткая привязка к коду).
      const filesToLoad = expectedFiles.filter(function (name) {
        return remoteJsonFiles.indexOf(name) !== -1;
      });

      if (filesToLoad.length === 0) {
        throw new Error('В папке patterns/ на GitHub не найдено ни одного ожидаемого файла');
      }

      // --- Шаг 2. Начинаем читать файлы ---
      const stored = await getStoredPatterns();
      let anyIncompatible = false;

      for (const name of filesToLoad) {
        try {
          const rawResp = await fetch(GITHUB_PATTERNS_BASE_URL + name);
          if (!rawResp.ok) {
            result.errors.push(name + ': HTTP ' + rawResp.status);
            continue;
          }
          const json = await rawResp.json();

          const key = (json.channelName || '').toLowerCase() ||
                      name.replace(/\.json$/i, '');

          // --- Шаг 3. Проверка совместимости формата ---
          const compat = Number(json.compatibilityVersion) || 0;
          if (compat > MAX_COMPATIBILITY_VERSION) {
            anyIncompatible = true;
            console.warn('⚠️ Паттерны ' + name + ' несовместимы: compatibilityVersion=' +
              compat + ' > ' + MAX_COMPATIBILITY_VERSION);
            continue; // такой файл в память НЕ пишем
          }

          // --- Шаг 4. Сравнение patternVersion с тем, что в памяти ---
          const remoteVersion = Number(json.patternVersion) || 0;
          const storedChannel = stored[key];
          const localVersion = storedChannel ? (Number(storedChannel.patternVersion) || 0) : 0;

          if (remoteVersion > localVersion) {
            stored[key] = json;
            result.updated.push(key);
          } else {
            result.skipped.push(key);
          }
        } catch (fileErr) {
          result.errors.push(name + ': ' + fileErr.message);
        }
      }

      if (anyIncompatible) {
        result.incompatible = true;
      }

      // Перезаписываем память, только если хотя бы один канал обновился
      if (result.updated.length > 0) {
        await savePatternsToStorage(stored);
      }

      result.ok = result.errors.length === 0 && !result.incompatible;
      return result;
    } catch (err) {
      result.errors.push(err.message);
      result.ok = false;
      return result;
    }
  }

  const PATTERNS_READY_EVENT = 'nkl:patterns-ready';

  function fireReady() {
    try {
      window.dispatchEvent(new CustomEvent(PATTERNS_READY_EVENT));
    } catch (e) { /* ignore */ }
  }

  // Загружаем паттерны из файлов и возвращаем объект вида
  // { 'AlexstraWho': <файл целиком>, ... }
  async function fetchPatternFiles() {
    const data = {};
    for (const file of PATTERN_FILES) {
      const response = await fetch(chrome.runtime.getURL(file));
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' for ' + file);
      }
      const json = await response.json();
      const key = (json.channelName || '').toLowerCase() ||
                  file.replace(/^patterns\//, '').replace(/\.json$/i, '');
      data[key] = json;
    }
    return data;
  }

  // Основная точка входа: проверка storage.local → при отсутствии
  // загрузка из файлов и запись в storage.local.
  // Возвращает промис с объектом паттернов из памяти расширения.
  function ensurePatternsLoaded() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(['patterns'], async function (result) {
        // 1. Паттерны уже в памяти — используем их
        if (result && result.patterns && Object.keys(result.patterns).length > 0) {
          console.log('✅ Паттерны взяты из storage.local');
          resolve(result.patterns);
          return;
        }

        // 2. Первой запуск — грузим из файлов папки patterns/ и записываем в память
        try {
          const data = await fetchPatternFiles();
          chrome.storage.local.set({ patterns: data }, function () {
            console.log('✅ Паттерны загружены из файлов и записаны в storage.local');
            resolve(data);
          });
        } catch (error) {
          console.error('❌ Ошибка загрузки паттернов из файлов:', error);
          resolve(null);
        }
      });
    });
  }

  // ==================== Хелперы по новому формату ====================
  //
  // ВАЖНО: никаких захардкоженных каналов/ботов/секций — все хелперы
  // работают со ВСЕМИ каналами из памяти ({ channelKey: <файл> }), поэтому
  // добавление нового канала = новый файл patterns/<Канал>.json + его имя
  // в списке PATTERN_FILES, без правки filter.js / chat-input.js / popup.js.

  // Все каналы списком (каждый — содержимое файла паттернов целиком).
  function getChannels(patternsData) {
    if (!patternsData) return [];
    return Object.keys(patternsData).map(function (k) { return patternsData[k]; });
  }

  // Первый канал-объект (оставлен для совместимости; сейчас каналов может быть несколько)
  function getChannel(patternsData) {
    const list = getChannels(patternsData);
    return list.length ? list[0] : null;
  }

  // Плоский список всех паттернов командных секций всех каналов (для фильтра сообщений).
  // Паттерны ботов (секция bots) в общий список НЕ попадают — они применяются
  // исключительно к сообщениям самого бота, иначе шаблон "*" у Nightbot
  // скрывал бы вообще весь чат.
  function getAllPatterns(patternsData) {
    const out = [];
    getChannels(patternsData).forEach(function (ch) {
      (ch.commands || []).forEach(function (c) {
        (c.patterns || []).forEach(function (p) { out.push(p); });
      });
    });
    return out;
  }

  // Паттерны конкретного бота по нику (регистронезависимо), во всех каналах.
  function getBotPatterns(patternsData, botUsername) {
    if (!botUsername) return [];
    const target = String(botUsername).toLowerCase();
    const out = [];
    getChannels(patternsData).forEach(function (ch) {
      (ch.bots || []).forEach(function (b) {
        if (String(b.botUsername).toLowerCase() === target) {
          (b.patterns || []).forEach(function (p) { out.push(p); });
        }
      });
    });
    return out;
  }

  function getBotCommandPatterns(patternsData, botUsername) {
    if (!botUsername) return [];
    const target = String(botUsername).toLowerCase();
    const out = [];
    const seen = {};
    getChannels(patternsData).forEach(function (ch) {
      // Имена командных секций, привязанных к этому боту.
      const sectionNames = {};
      (ch.bots || []).forEach(function (b) {
        if (String(b.botUsername || '').toLowerCase() === target && b.botComands) {
          sectionNames[String(b.botComands).toLowerCase()] = true;
        }
      });
      if (Object.keys(sectionNames).length === 0) return;
      // Паттерны командных секций с такими именами.
      (ch.commands || []).forEach(function (c) {
        if (sectionNames[String(c.name || '').toLowerCase()]) {
          (c.patterns || []).forEach(function (p) {
            if (!seen[p]) {
              seen[p] = true;
              out.push(p);
            }
          });
        }
      });
    });
    return out;
  }

  // Командные секции всех каналов, отсортированные по order (для быстрых команд).
  function getCommandSections(patternsData) {
    const out = [];
    getChannels(patternsData).forEach(function (ch) {
      (ch.commands || []).forEach(function (c) { out.push(c); });
    });
    return out.slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
  }

  // Секции ботов всех каналов (для тумблеров «Фильтры сообщений» и фильтра).
  function getBotSections(patternsData) {
    const out = [];
    getChannels(patternsData).forEach(function (ch) {
      (ch.bots || []).forEach(function (b) { out.push(b); });
    });
    return out;
  }

  // Специальный префиксный паттерн "$smile$*" — «скрыть сообщение, если оно
  // начинается со смайлика (картинка-эмодзи Twitch или юникод-небуква)».
  // Наличие этого паттерна у бота включает соответствующую проверку в filter.js;
  // паттерны "@..." обрабатываются дефолтной логикой (@ — обычный символ).
  const SMILE_PATTERN = '$smile$*';
  function hasSmilePattern(patternList) {
    return Array.isArray(patternList) && patternList.indexOf(SMILE_PATTERN) !== -1;
  }

  // Обычные текстовые паттерны бота — без спецпаттерна $smile$*.
  function withoutSmilePattern(patternList) {
    if (!Array.isArray(patternList)) return [];
    return patternList.filter(function (p) { return p !== SMILE_PATTERN; });
  }

  // Экспорт наружу
  window.NKLPatterns = {
    ensureLoaded: ensurePatternsLoaded,
    getChannels: getChannels,
    getChannel: getChannel,
    getAllPatterns: getAllPatterns,
    getBotPatterns: getBotPatterns,
    getBotSections: getBotSections,
    getBotCommandPatterns: getBotCommandPatterns,
    getCommandSections: getCommandSections,
    hasSmilePattern: hasSmilePattern,
    withoutSmilePattern: withoutSmilePattern,
    updateFromGitHub: updatePatternsFromGitHub,
    MAX_COMPATIBILITY_VERSION: MAX_COMPATIBILITY_VERSION,
    READY_EVENT: PATTERNS_READY_EVENT
  };

  // Стартуем загрузку сразу при подключении скрипта, чтобы к моменту
  // инициализации filter.js / chat-input.js данные уже были готовы.
  window.NKLPatterns._promise = ensurePatternsLoaded().then(function (data) {
    fireReady();
    return data;
  });
})();
