// content.js — только наблюдение за чатом и само действие (скрытие).
// Вся логика фильтрации вынесена в filter.js (window.NKLFilter.shouldHide).

console.log('NoKakulaLeveling: Скрипт запущен');

// Запоминаем контейнер чата, чтобы иметь возможность пройти по всем открытым сообщениям
let chatContainer = null;

// 1. Ждем появления контейнера #live-page-chat
function waitForChatContainer() {
  const existingContainer = document.querySelector('#live-page-chat');
  if (existingContainer) {
    console.log('✅ #live-page-chat уже найден!');
    chatContainer = existingContainer;
    startChatObserver(existingContainer);
    return;
  }

  console.log('👁️ Ждем появления #live-page-chat...');
  const tempObserver = new MutationObserver((mutations, obs) => {
    const container = document.querySelector('#live-page-chat');
    if (container) {
      console.log('✅ #live-page-chat появился!');
      obs.disconnect();
      chatContainer = container;
      startChatObserver(container);
    }
  });

  tempObserver.observe(document.body, { childList: true, subtree: true });
}

// 2. Наблюдатель за сообщениями
function startChatObserver(container) {
  console.log('🚀 Запускаем наблюдение и фильтрацию...');

  const chatObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        // Простая проверка: если функция проверки на скрытие вернула true — скрываем
        if (window.NKLFilter.shouldHide(node)) {
          hideNode(node);
        }
      });
    });
  });

  chatObserver.observe(container, {
    childList: true,
    subtree: true
  });
}

// 3. Скрытие/возврат отдельного сообщения
// При скрытии помечаем узел data-атрибутом, чтобы при выключении тумблера
// возвращать на места только те сообщения, которые скрыло расширение.
function hideNode(node) {
  node.dataset.nklHidden = 'true';
  node.style.display = 'none';
}

function showNode(node) {
  if (node.dataset.nklHidden === 'true') {
    node.style.removeProperty('display');
    delete node.dataset.nklHidden;
  }
}

// 4. Разовый проход по ВСЕМ уже открытым сообщениям чата
// enabled === true  — скрыть всё, что попадает под фильтр
// enabled === false — вернуть на места всё, что было скрыто нами
function sweepExistingMessages(enabled) {
  if (!chatContainer || !window.NKLFilter) return;

  const nodes = chatContainer.querySelectorAll('li, div');
  let hiddenCount = 0;
  let restoredCount = 0;

  nodes.forEach((node) => {
    if (enabled) {
      if (window.NKLFilter.shouldHide(node)) {
        hideNode(node);
        hiddenCount++;
      }
    } else {
      if (node.dataset.nklHidden === 'true') {
        showNode(node);
        restoredCount++;
      }
    }
  });

  console.log(
    `🧹 Проход по открытым сообщениям завершён: ${enabled ? 'скрыто ' + hiddenCount : 'возвращено ' + restoredCount}`
  );
}

// 5. Слушаем смену состояния тумблера (событие из filter.js)
// Небольшая задержка нужна, чтобы filter.js гарантированно обновил свои переменные
// (isHideOthersEnabled / userNickname) до того, как начнётся проход по сообщениям.
window.addEventListener('nkl:filter-state-changed', (e) => {
  const enabled = e.detail && e.detail.enabled;
  console.log(`🔔 Тумблер ${enabled ? 'включён' : 'выключен'} — запускаем разовый поиск по открытым сообщениям`);
  setTimeout(() => sweepExistingMessages(!!enabled), 0);
  // Наблюдатель продолжает работать в штатном режиме — новых сообщений это касается автоматически,
  // т.к. shouldHide учитывает текущее состояние тумблера.
});

// 6. Инициализация
async function init() {
  await window.NKLFilter.init();       // загрузка паттернов (filter.js)
  window.NKLFilter.loadToggleState();  // загрузка тумблеров и ника (filter.js)
  waitForChatContainer();
}

// Запуск
init();
