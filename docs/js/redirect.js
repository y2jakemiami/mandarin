/**
 * 🔄 Умный редирект: мобильная / десктоп версия
 * Определяет устройство и перенаправляет на нужную страницу
 * Показывает красивый лоадер во время решения
 */
(function() {
    'use strict';

    // === НАСТРОЙКИ ===
    const CONFIG = {
        mobileBreakpoint: 768,        // Порог: < 768px = мобильная версия
        mobilePage: 'index.html',     // Страница для мобильных
        desktopPage: 'index_desktop.html', // Страница для ПК/планшетов
        storageKey: 'viewModePreference',  // Ключ в localStorage
        redirectDelay: 300            // Задержка перед редиректом (мс)
    };

    // === ЭКРАН ЗАГРУЗКИ (как в chat.html) ===
    function showLoadingScreen() {
        // Если лоадер уже есть — не создаём дубль
        if (document.getElementById('redirect-loader')) return;

        const loader = document.createElement('div');
        loader.id = 'redirect-loader';
        loader.className = 'loading-screen';
        loader.innerHTML = `
            <div class="loader">
                <span></span><span></span><span></span>
                <span></span><span></span><span></span>
            </div>
            <div class="loader-text">Определяем устройство...</div>
            <div class="loader-progress"></div>
        `;
        document.body.appendChild(loader);

        // Добавляем стили динамически (если ещё не подключены)
        if (!document.getElementById('redirect-loader-styles')) {
            const style = document.createElement('style');
            style.id = 'redirect-loader-styles';
            style.textContent = `
                .loading-screen {
                    position: fixed;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: var(--loading-gradient, linear-gradient(135deg, #FFB74D 0%, #FF9800 30%, #FFB74D 60%, #FF9800 100%));
                    background-size: 400% 400%;
                    animation: gradientShift 3s ease infinite;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    transition: opacity 0.3s ease;
                }
                @keyframes gradientShift {
                    0%, 100% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                }
                .loader {
                    --size: 70px;
                    width: var(--size);
                    height: var(--size);
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 5px;
                    margin-bottom: 20px;
                }
                .loader span {
                    width: 100%;
                    height: 100%;
                    background-color: #FFFFFF;
                    border-radius: 4px;
                    animation: blink 0.6s alternate infinite linear;
                }
                .loader span:nth-child(1) { animation-delay: 0ms; }
                .loader span:nth-child(2) { animation-delay: 200ms; }
                .loader span:nth-child(3) { animation-delay: 300ms; }
                .loader span:nth-child(4) { animation-delay: 400ms; }
                .loader span:nth-child(5) { animation-delay: 500ms; }
                .loader span:nth-child(6) { animation-delay: 600ms; }
                @keyframes blink {
                    0% { opacity: 0.3; transform: scale(0.5) rotate(5deg); }
                    50% { opacity: 1; transform: scale(1); }
                }
                .loader-text {
                    color: white;
                    font-size: 16px;
                    font-weight: 500;
                    text-align: center;
                    margin-bottom: 8px;
                    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
                }
                .loader-progress {
                    color: rgba(255, 255, 255, 0.9);
                    font-size: 13px;
                    font-weight: 400;
                }
                /* Тёмная тема */
                @media (prefers-color-scheme: dark) {
                    .loader span { background-color: #F5F5F7; }
                    .loader-text { color: #F5F5F7; }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // === ОПРЕДЕЛЕНИЕ ТИПА УСТРОЙВА ===
    function detectDeviceType() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const ua = navigator.userAgent.toLowerCase();
        
        // 1. Приоритет: явное предпочтение пользователя
        const saved = localStorage.getItem(CONFIG.storageKey);
        if (saved === 'mobile' || saved === 'desktop') {
            return saved;
        }

        // 2. Проверка на мобильные устройства по User-Agent
        const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
        if (isMobileUA && width < CONFIG.mobileBreakpoint) {
            return 'mobile';
        }

        // 3. Проверка на планшет (iPad и крупные тач-устройства)
        const isTablet = (isTouch && width >= 768 && width < 1024) || 
                         /ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua);
        if (isTablet) {
            // Планшеты: если портрет — мобильная, если ландшафт — десктоп
            return (height > width) ? 'mobile' : 'desktop';
        }

        // 4. Основное правило: по ширине экрана
        return width < CONFIG.mobileBreakpoint ? 'mobile' : 'desktop';
    }

    // === ВЫПОЛНЕНИЕ РЕДИРЕКТА ===
    function performRedirect() {
        const deviceType = detectDeviceType();
        const currentPage = window.location.pathname.split('/').pop();
        const targetPage = deviceType === 'mobile' ? CONFIG.mobilePage : CONFIG.desktopPage;

        // Если уже на нужной странице — не редиректим
        if (currentPage === targetPage) {
            hideLoadingScreen();
            return;
        }

        // Сохраняем выбор в sessionStorage, чтобы не редиректить при ресайзе в рамках сессии
        sessionStorage.setItem('lastRedirect', deviceType);

        // Показываем лоадер и ждём немного для плавности
        showLoadingScreen();
        
        setTimeout(() => {
            // Формируем новый URL (сохраняем query-параметры если есть)
            const newUrl = targetPage + window.location.search;
            window.location.replace(newUrl); // replace вместо assign — нельзя вернуться назад
        }, CONFIG.redirectDelay);
    }

    // === СКРЫТИЕ ЛОАДЕРА ===
    function hideLoadingScreen() {
        const loader = document.getElementById('redirect-loader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 300);
        }
    }

    // === ОБРАБОТЧИК ИЗМЕНЕНИЯ РАЗМЕРА ОКНА ===
    let resizeTimeout;
    function handleResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            // Не редиректим, если пользователь уже вручную выбрал версию
            if (localStorage.getItem(CONFIG.storageKey)) return;
            
            // Не редиректим, если только что был редирект в этой сессии
            if (sessionStorage.getItem('lastRedirect')) return;
            
            // Показываем лоадер и перепроверяем
            showLoadingScreen();
            setTimeout(performRedirect, 200);
        }, 500); // Дебаунс 500мс
    }

    // === ИНИЦИАЛИЗАЦИЯ ===
    function init() {
        // Если страница уже загружена полностью — возможно, редирект не нужен
        if (document.readyState === 'complete') {
            performRedirect();
        } else {
            // Ждём загрузки DOM
            document.addEventListener('DOMContentLoaded', performRedirect);
        }

        // Слушаем изменение размера (для поворота экрана на планшетах)
        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);
    }

    // Запускаем, если не в iframe и не в режиме предпросмотра
    if (window.self === window.top && !window.location.href.includes('githubpreview')) {
        init();
    }
})();