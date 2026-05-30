// js/main.js
import { state } from './state.js';
import { DEFAULT_SETTINGS, TTS_CONFIG, HOST } from './config.js';
import { parseAIResponse } from './utils.js';
import videoManager from './video-manager.js';
import { callAI, callTranslationAI, getInitialGreeting, buildSystemPrompt } from './ai-service.js';
import ttsService from './tts-service.js';
import { startImageMode, handleImageModeResponse, isImageMode, switchBackToDialog } from './mode-image.js';
import { 
    updateChatBackground, 
    addMessage, 
    showTyping, 
    hideTyping, 
    setInputLocked, 
    toggleSendVoiceButtons, 
    updateChatHeader, 
    applyTheme, 
    setupUIListeners,
    updateXpProgress, // Добавляем импорт функции обновления прогресса XP
    fetchTranslation
} from './ui-controller.js';

// === DOM ELEMENTS (кэшируем для скорости) ===
const elements = {
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    voiceBtn: document.getElementById('voiceBtn'),
    videoCallBtn: document.getElementById('videoCallBtn'),
    endCallBtn: document.getElementById('endCallBtn'),
    videoCallPanel: document.getElementById('videoCallPanel'),
    callStatusText: document.getElementById('callStatusText'),
    taskBar: document.getElementById('taskBar'),
    messagesContainer: document.getElementById('messagesContainer')
};

const chatHeader = document.querySelector('.chat-header');

function isMeaningfulInput(text) {
    if (!text || !text.trim()) return false;
    
    const cleaned = text.trim().toLowerCase();
    
    // Слишком коротко (1-2 символа) — скорее всего, случайный ввод
    if (cleaned.length < 3) return false;
    
    // Только знаки препинания / эмодзи / пробелы
    if (/^[\s\p{P}\p{S}\p{Emoji}]+$/u.test(cleaned)) return false;
    
    // Только междометия / звуки (а, э, ммм, ага, ой и т.п.)
    const interjections = /^(а+|э+|о+|у+|м+|н+|ага|ого|ой|эй|ну|да|нет|ок|окей|ладно)$/i;
    if (interjections.test(cleaned)) return false;
    
    return true;
}

function loadTopicIcon() {
    const container = document.querySelector('.avatar-container');
    if (!container) return;

    // Дефолтная иконка (пользователь)
    const defaultIcon = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>`;
    
    try {
        const saved = JSON.parse(localStorage.getItem('currentTopicData') || '{}');
        const iconPath = saved.icon;
        
        // Подставляем SVG с иконкой темы или оставляем дефолтную
        container.innerHTML = iconPath 
            ? `<svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg>`
            : defaultIcon;
            
        // Плавное появление
        container.style.opacity = '0';
        requestAnimationFrame(() => {
            container.style.transition = 'opacity 0.25s ease, background 0.3s var(--anim-curve)';
            container.style.opacity = '1';
        });
    } catch (e) {
        container.innerHTML = defaultIcon;
    }
}

/**
 * Обработчик кнопки «волшебная палочка»
 * - Если ввод осмысленный → перевод на китайский → вставка в input
 * - Если ввод пустой/бессмысленный → генерация подсказки → вставка в input
 * - НЕ добавляет сообщение в чат, только заполняет поле ввода
 */
async function handleMagicButton() {
    const input = document.getElementById('messageInput');
    const userText = input?.value?.trim() || '';
    
    // Визуальный фидбек на кнопке
    const magicBtn = document.querySelector('.task-btn-magic');

    magicBtn.classList.add('active');
    
    // Блокируем ввод на время запроса
    setInputLocked(true);
    
    try {
        let prompt = '';
        let actionType = ''; // 'translate' или 'hint'
        
        if (isMeaningfulInput(userText)) {
            // === СЛУЧАЙ 1: Перевод ввода пользователя на китайский ===
            console.log("Translation NOW");
            actionType = 'translate';
            prompt = `
Ты — переводчик на китайский язык.
Задача: переведи следующий текст на китайский (упрощённые иероглифы).
Не добавляй пояснений, только перевод.

Текст для перевода: "${userText}"

Верни ответ СТРОГО в формате JSON:
{
    "text": "перевод на китайском",
    "correct_status": "good",
    "xp_reward": 0,
    "emotion": "calm",
    "feedback": "Перевод на русский: [дословный перевод]"
}
`;
        } else {
            // === СЛУЧАЙ 2: Генерация подсказки на основе контекста ===
            actionType = 'hint';
            console.log("Magic NOW");
            const lastAIMessage = state.conversationHistory
                .slice()
                .reverse()
                .find(msg => msg.role === 'assistant')?.content || '';
            
            const contextHint = lastAIMessage 
                ? `Последнее сообщение в диалоге: "${lastAIMessage}".` 
                : `Тема урока: "${state.topic}".`;
            
            prompt = `
Ты — репетитор китайского языка. Студент нажал кнопку "подсказка", но не ввёл текст.
${contextHint}

Задача: напиши короткую, полезную фразу на китайском, которая:
- соответствует теме/контексту
- уровня HSK ${state.level || 1}
- может продолжить диалог или дать пример использования

Верни ответ СТРОГО в формате JSON:
{
    "text": "подсказка на китайском",
    "correct_status": "good",
    "xp_reward": 0,
    "emotion": "happy",
    "feedback": "Подсказка: [перевод фразы на русский]"
}
`;
        }
        
        const response = actionType === 'translate' 
        ? await callTranslationAI('translate', userText)
        : await callTranslationAI('hint', '', { 
            topic: state.topic, 
            level: state.level,
            lastAIMessage: state.conversationHistory.slice().reverse().find(m => m.role === 'assistant')?.content 
        });
    
        if (response.error) throw new Error(response.error);
        
        // Парсим ответ (теперь там только { "text": "..." })
        let aiText = '';
        try {
            const parsed = JSON.parse(response.text);
            aiText = parsed.text || response.text;
        } catch {
            aiText = response.text;
        }
        
        if (!aiText || aiText.trim() === '') throw new Error('Пустой ответ');
        
        // === ВСТАВЛЯЕМ В INPUT ===
        input.value = aiText;
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
        toggleSendVoiceButtons(true);
        
        // Переключаем кнопки: показываем "отправить"
        toggleSendVoiceButtons(true);
        
    } catch (error) {
        magicBtn.classList.remove('active');
        console.error('Magic button error:', error);
    } finally {
        magicBtn.classList.remove('active');
        setInputLocked(false);
    }
}

// === ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ===
function loadUserSettings() {
    try {
        const stored = localStorage.getItem('ai_chinese_settings');
        if (stored) {
            const s = JSON.parse(stored);
            const avatarCfg = s.avatar === 'boy' 
                ? { videoPrefix: 'm_', voiceRu: 'maleru', voiceZh: 'yunyang' } 
                : { videoPrefix: 'g_', voiceRu: 'femaleru', voiceZh: 'xiaoxiao' };
            
            if (s.aiLanguage === 'zh') TTS_CONFIG.voice = avatarCfg.voiceZh;
            else TTS_CONFIG.voice = avatarCfg.voiceRu;
            
            return { ...DEFAULT_SETTINGS, ...s, ...avatarCfg };
        }
    } catch (e) {
        console.error('Ошибка загрузки настроек:', e);
    }
    return DEFAULT_SETTINGS;
}

function initApp() {



    // Внутри initApp или setupUIListeners
    const taskBtns = document.querySelectorAll('.task-btn');
    const magicBtn = document.querySelector('.task-btn-magic');


    taskBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Убираем активный класс у всех
            taskBtns.forEach(b => b.classList.remove('active'));
            // Ставим нажатой
            btn.classList.add('active');
            
            const mode = btn.dataset.mode;
            
            if (mode === 'image') {
                startImageMode();
            } if (mode === 'dialog') {
                switchBackToDialog();
            } else if (mode === 'grammar') {
                // Тут будет логика грамматики (пока заглушка)
                addMessage('Режим Грамматика скоро появится!', 'incoming');
                // Возврат на диалог визуально
                document.querySelector('[data-mode="dialog"]').classList.add('active');
                btn.classList.remove('active');
            }
            // mode === 'dialog' ничего особенного делать не надо, это дефолт
        });
    });

    if (magicBtn) {
        magicBtn.addEventListener('click', (e) => {
            handleMagicButton();
        });
    }

    // 1. Загрузка настроек
    const settings = loadUserSettings();
    state.settings = settings;
    
    // Применяем тему
    applyTheme(settings.theme);
    
    // Обновляем заголовок (тема и уровень берутся из URL или дефолтов, см. ниже)
    parseUrlParams();
    updateChatHeader();

    // 2. Инициализация видео-менеджера
    // При завершении загрузки видео запускаем приветствие
    videoManager.init(() => {
        enableChatInterface();
        sendInitialGreeting();
    });

    // Предзагрузка видео с нужным префиксом
    videoManager.preloadWithPrefix(settings.videoPrefix);

    // debug
    console.log('debug', settings);

    // 3. Настройка UI слушателей
    setupUIListeners(handleSendMessage, handleTaskClick);

    // 4. Настройка видеозвонка
    setupVideoCallHandlers();

    // 5. Слушатель изменений настроек (если есть другое окно настроек)
    window.addEventListener('settingsChanged', (e) => {
        if (e.detail?.theme) applyTheme(e.detail.theme);
        if (e.detail?.avatar || e.detail?.aiLanguage) {
            const newSettings = loadUserSettings();
            state.settings = newSettings;
            videoManager.preloadWithPrefix(newSettings.videoPrefix);
        }
    });

    // 6. Слушатель окончания речи (разблокировка ввода)
    window.addEventListener('tts-finished', () => {
        setInputLocked(false);
    });
}

function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const urlTopic = params.get('topic');
    const urlLevel = params.get('level');
    
    if (urlTopic) state.topic = decodeURIComponent(urlTopic).slice(0, 100);
    if (urlLevel) state.level = decodeURIComponent(urlLevel).slice(0, 50);
}

function enableChatInterface() {
    if (elements.voiceBtn) elements.voiceBtn.classList.remove('hidden');
    if (elements.videoCallBtn) {
        elements.videoCallBtn.disabled = false;
        elements.videoCallBtn.style.opacity = '';
        elements.videoCallBtn.style.cursor = '';
        elements.videoCallBtn.title = '';
    }
    if (document.getElementById('chatStatus')) {
        document.getElementById('chatStatus').textContent = 'онлайн';
    }
}

// === ЛОГИКА ОТПРАВКИ СООБЩЕНИЙ ===
async function handleSendMessage() {
    if (state.isInputLocked || !elements.messageInput) return;
    
    const text = elements.messageInput.value.trim();
    if (!text) return;

    // ПРОВЕРКА РЕЖИМА КАРТИНКИ
    if (isImageMode()) {   // Нужно импортировать переменную или проверить состояние
        // Очищаем поле
        elements.messageInput.value = '';
        toggleSendVoiceButtons(false);
        
        // Показываем сообщение пользователя
        addMessage(text, 'outgoing');
        
        // Вызываем обработчик режима картинки
        await handleImageModeResponse(text);
        return; // Выходим, не отправляя в общий чат
    }

    // --- ОБЫЧНЫЙ РЕЖИМ ДИАЛОГА (старый код) ---
    addMessage(text, 'outgoing');
    state.conversationHistory.push({ role: 'user', content: text });
    
    elements.messageInput.value = '';
    toggleSendVoiceButtons(false);
    
    showTyping();
    if (state.isVideoCallActive && !state.isAvatarSpeaking) {
        videoManager.switchTo('thinking', 'calm');
        if (elements.callStatusText) elements.callStatusText.textContent = 'Аватар думает...';
    }

    setInputLocked(true);
    const aiResponseResult = await callAI(buildSystemPrompt(), text); // Получаем объект { text, error }

    if (aiResponseResult.text && !aiResponseResult.error) {
        const parsed = parseAIResponse(aiResponseResult.text); // Теперь в parsed будет xp_reward

        console.log(parsed.text, parsed.feedback);

        // Обновляем фон
        updateChatBackground(parsed.color);

        // --- Обработка XP и отправка на сервер ---
        let earnedXp = parsed.xp_reward;

        if (state.isVideoCallActive) {
            earnedXp *= 2; 
        }

        // 1. Обновляем локальное состояние (для мгновенного отображения в ui)
        state.currentXp = (state.currentXp || 0) + earnedXp;
        state.maxXpForLevel = state.maxXpForLevel || 100;
        updateXpProgress(state.currentXp, state.maxXpForLevel, earnedXp);

        // 2. Отправляем на сервер для сохранения в БД
        const userId = localStorage.getItem('currentUserId');
        if (userId && earnedXp > 0) {
            // Используем POST или PATCH, передаем данные в теле или query
            fetch(`http://${HOST}:8002/profile/${userId}/xp?amount=${earnedXp}`, {
                method: 'PATCH'
            })
            .then(res => res.json())
            .then(data => {
                console.log(`Сервер подтвердил XP. Новый баланс в БД: ${data.new_xp}`);
                
                // ВАЖНО: Синхронизируем локальное состояние с базой!
                // Если в базе вдруг было другое число, мы его подтянем
                state.currentXp = data.new_xp; 
                
                // Обновляем UI с актуальным числом из базы
                // updateXpProgress(state.currentXp, state.maxXpForLevel, earnedXp);
            })
            .catch(err => console.error('Ошибка сохранения XP:', err));
        }

        // Если видеозвонок активен и аватар молчит -> озвучиваем
        if (state.isVideoCallActive && !state.isAvatarSpeaking) {
            await ttsService.speak(parsed.text, parsed.emotion);
            hideTyping();
            // Добавляем ответ
            const isMasked = state.isVideoCallActive; // Маскируем, если идет видеозвонок (по логике оригинала)
            addMessage(parsed.text, 'incoming', parsed);
            state.conversationHistory.push({ role: 'assistant', content: parsed.text });
        } else {
            setInputLocked(false); // Разблокируем, если не было озвучки
            hideTyping();
            addMessage(parsed.text, 'incoming', parsed);
            state.conversationHistory.push({ role: 'assistant', content: parsed.text });
        }
    } else {
        setInputLocked(false);
        addMessage('Ошибка получения ответа от ИИ.', 'incoming');
    }
}

function handleTaskClick(taskName) {
    console.log(`Выбрана задача: ${taskName}`);
    // Здесь можно добавить логику подстановки шаблонов в поле ввода
    // Например: elements.messageInput.value = `Расскажи про ${taskName}...`;
}

// === ЛОГИКА ВИДЕОЗВОНКА ===
function setupVideoCallHandlers() {
    if (!elements.videoCallBtn || !elements.endCallBtn) return;

    elements.videoCallBtn.addEventListener('click', startVideoCall);
    elements.endCallBtn.addEventListener('click', endVideoCall);
}

async function startVideoCall() {
    if (state.isVideoCallActive) return;
    
    console.log('📞 Старт видеозвонка');
    state.isVideoCallActive = true;
    
    // UI изменения
    if (elements.videoCallPanel) elements.videoCallPanel.classList.add('active');
    if (elements.videoCallBtn) elements.videoCallBtn.classList.add('active');
    if (chatHeader) {  chatHeader.classList.add('hidden');  console.log('hui');}
        // if (elements.taskBar) elements.taskBar.classList.add('hidden');
    if (elements.callStatusText) elements.callStatusText.textContent = 'Подключение...';
    
    // Скрываем ввод, показываем голосовую кнопку
    // if (elements.sendBtn) elements.sendBtn.classList.remove('visible'); временно!
    if (elements.messagesContainer) elements.messagesContainer.style.padding = '38vh 16px 16px';
    if (elements.messagesContainer) elements.messagesContainer.style.borderRadius = '24px 24px 0px 0px';
    // if (elements.messageInput) elements.messageInput.classList.add('hidden'); временно!
    // if (elements.voiceBtn) {
    //     elements.voiceBtn.classList.remove('hidden');
    //     elements.voiceBtn.classList.add('open');
    // }

    try {
        // Приветственное видео
        videoManager.switchTo('greeting', 'calm');
        const greetingVideo = document.getElementById('greetingVideo');
        if (greetingVideo) {
            greetingVideo.loop = false;
            greetingVideo.currentTime = 0;
            await greetingVideo.play();
            
            if (elements.callStatusText) elements.callStatusText.textContent = 'Аватар подключён';

            // Обработчик окончания приветствия
            const onGreetingEnd = () => {
                if (greetingVideo) greetingVideo.loop = true;
                startAvatarIdleMode();
                greetingVideo.removeEventListener('ended', onGreetingEnd);
            };
            greetingVideo.addEventListener('ended', onGreetingEnd, { once: true });
        }
    } catch (error) {
        console.error('Ошибка старта звонка:', error);
        if (elements.callStatusText) elements.callStatusText.textContent = '️ Ошибка видео';
        startAvatarIdleMode();
    }
}

function startAvatarIdleMode() {
    console.log('🔄 Аватар в режиме ожидания');
    state.isAvatarSpeaking = false;
    videoManager.switchTo('idle', 'calm');
    if (elements.callStatusText) elements.callStatusText.textContent = 'Аватар слушает... 😌';
    
    const idleVideo = document.getElementById('idleVideo');
    if (idleVideo) idleVideo.play().catch(e => console.warn('Ошибка idle видео:', e));
}

function endVideoCall() {
    if (!state.isVideoCallActive) return;
    
    console.log(' Завершение звонка');
    state.isVideoCallActive = false;
    state.isAvatarSpeaking = false;
    
    ttsService.stop();
    videoManager.stopAll();
    
    // Сброс UI
    if (elements.videoCallPanel) elements.videoCallPanel.classList.remove('active');
    if (elements.videoCallBtn) elements.videoCallBtn.classList.remove('active');
    if (elements.taskBar) elements.taskBar.classList.remove('hidden');
    if (chatHeader) {  chatHeader.classList.remove('hidden');  console.log('hui');}
    if (elements.messagesContainer) elements.messagesContainer.style.padding = '16px 16px 16px 16px';
    if (elements.messagesContainer) elements.messagesContainer.style.borderRadius = '0px 0px 0px 0px';
    if (elements.callStatusText) elements.callStatusText.textContent = 'Соединение...';
    
    if (elements.messageInput) {
        elements.messageInput.classList.remove('hidden');
        elements.messageInput.disabled = false;
    }
    if (elements.sendBtn && elements.messageInput.value.trim()) {
        elements.sendBtn.classList.add('visible');
    }
    
    setInputLocked(false);
}

// === ПРИВЕТСТВИЕ ПРИ СТАРТЕ ===
async function sendInitialGreeting() {
    showTyping();
    const response = await getInitialGreeting();
    hideTyping();
    
    if (response) {
        const parsed = parseAIResponse(response);
        updateChatBackground(parsed.color);

        console.log(parsed);
        
        addMessage(parsed.text, 'incoming', parsed);
        state.conversationHistory.push({ role: 'assistant', content: parsed.text });
        
        // Если сразу активен видеозвонок (опционально), можно озвучить
        // Но по логике оригинала звонок начинается по кнопке, поэтому здесь просто текст
    }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', loadTopicIcon);
document.addEventListener('DOMContentLoaded', initApp);

// Очистка при закрытии вкладки
window.addEventListener('beforeunload', () => {
    videoManager.stopAll();
    ttsService.stop();
});