// browser-polyfill.js — мост совместимости Chrome <-> Firefox.
// Загружается ПЕРВЫМ во всех контекстах (popup, content scripts).
// В Chrome переменная `chrome` уже существует и полифилл её не трогает.
// В Firefox он создаёт `window.chrome`, проксируя вызовы на `browser.*`,
// чтобы весь остальной код мог работать через привычный chrome.* API.
(function () {
  'use strict';

  // Firefox экспортирует Promise-ориентированный API как глобальную `browser`.
  var api = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id)
    ? browser
    : null;

  if (!api) return; // это Chrome (или другой Chromium-браузер) — ничего делать не нужно

  // Глубокий прокси: обёртывает callback-стиль вызовов chrome.* над Promise-API Firefox.
  function wrapNamespace(ns) {
    if (!ns || typeof ns !== 'object') return ns;
    return new Proxy(ns, {
      get: function (target, prop) {
        if (prop === 'isSupported') {
          return function () { return Promise.resolve(true); };
        }
        var value;
        try { value = target[prop]; } catch (e) { return undefined; }
        if (typeof value === 'function') {
          return function () {
            var args = Array.prototype.slice.call(arguments);
            var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
            var result;
            try {
              result = value.apply(target, args);
            } catch (e) {
              if (cb) cb(undefined);
              throw e;
            }
            // Синхронные свойства/методы (runtime.id, extension.getURL и т.п.)
            if (!(result && typeof result.then === 'function')) {
              if (cb) cb(result);
              return result;
            }
            if (cb) {
              result.then(
                function (r) { cb(r); },
                function (err) { console.error('[NKL polyfill]', err); }
              );
              return undefined; // как в Chrome: callback-вызовы возвращают undefined
            }
            return result;
          };
        }
        // Вложенные пространства имён (storage.sync, runtime.*, ...)
        if (value && typeof value === 'object') return wrapNamespace(value);
        return value;
      }
    });
  }

  var wrapped = wrapNamespace(api);

  // popup.html подключает скрипт напрямую: window.browser уже есть в Firefox.
  window.browser = wrapped;

  // Content scripts в Firefox изолированы: globalThis.browser доступен там,
  // а window.chrome — нет. Создаём window.chrome для кода, использующего chrome.*.
  if (typeof window !== 'undefined' && !window.chrome) {
    window.chrome = wrapped;
  }
})();
