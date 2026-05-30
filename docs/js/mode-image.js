// js/mode-image.js
import { state } from './state.js';
import { callAI } from './ai-service.js';
import { addMessage, showTyping, hideTyping, setInputLocked, updateChatBackground, scrollToBottom, updateXpProgress } from './ui-controller.js'; // Добавим updateXpProgress
import videoManager from './video-manager.js';
import ttsService from './tts-service.js';
import {HOST} from './config.js';
import { parseAIResponse, isValidHexColor } from './utils.js';

let currentImageTask = null; // Текущее задание
let isImageModeActive = false; // Флаг активного режима

// Загрузка списка картинок
async function loadImagesList() {
    try {
        const response = await fetch('./js/images.json');
        if (!response.ok) throw new Error('Не удалось загрузить список картинок');
        return await response.json();
    } catch (error) {
        console.error('Ошибка загрузки images.json:', error);
        return [];
    }
}

// Выбор случайной картинки
function pickRandomImage(images) {
    if (!images || images.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * images.length);
    return images[randomIndex];
}

// Запуск режима "Описание картинки"
export async function startImageMode() {
    if (isImageModeActive) return;
    isImageModeActive = true;
    
    console.log('🖼️ Запуск режима: Описание картинки');

    videoManager.switchTo('thinking', 'calm');
    
    // 1. Загружаем список
    const images = await loadImagesList();
    currentImageTask = pickRandomImage(images);
    
    if (!currentImageTask) {
        addMessage('⚠️ Ошибка: не найдено картинок для задания.', 'incoming');
        switchBackToDialog();
        return;
    }

    // For ever Lang

    let taskPrompt = ''; 

    // 2. Определяем язык
    const isChinese = state.settings.aiLanguage === 'zh';
    console.log('Текущий язык:', isChinese ? 'Китайский' : 'Русский');
    
    // 3. Присваиваем значение в зависимости от языка
    console.log('Выбран китайский промпт');
    taskPrompt = `请看上图。详细描述你看到了什么？`; // Китайский текст

    // Если видеозвонок активен, озвучиваем задание
    if (state.isVideoCallActive && !state.isAvatarSpeaking) {
        showTyping();
        await ttsService.speak(taskPrompt, 'calm');
        hideTyping();
        // 2. Отправляем картинку пользователю
        sendImageCard(currentImageTask);
        scrollToBottom();
    } else {
        // Если звонка нет, просто пишем текст
        // 2. Отправляем картинку пользователю
        sendImageCard(currentImageTask);
        scrollToBottom();
    }
    
    // Блокируем ввод, пока пользователь не начнет писать (опционально, можно оставить открытым)
    // setInputLocked(false); 
}

// Отправка карточки с картинкой в чат
function sendImageCard(imageData) {
    const container = document.getElementById('messagesContainer');
    const typingIndicator = document.getElementById('typingIndicator');
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message incoming image-task';

    state.conversationHistory.push({ role: 'assistant', content: `Опиши мне картинку: Описание: ${imageData.topic_hint}` });    

    console.log(`Опиши мне картинку: Описание: ${imageData.topic_hint}`);

    msgDiv.innerHTML = `
        <div class="image-task-container">
            <img src="${imageData.url}" alt="Задание" style="width: 100%; border-radius: 20px; display: block; box-shadow: var(--shadow-soft);">
        </div>
    `;
    
    container.insertBefore(msgDiv, typingIndicator);
    container.scrollTop = container.scrollHeight;
}

// Обработка ответа пользователя в этом режиме
export async function handleImageModeResponse(userText) {
    if (!isImageModeActive || !currentImageTask) return;

    state.conversationHistory.push({ role: 'user', content: userText });
    showTyping();
    setInputLocked(true);

    videoManager.switchTo('thinking', 'calm');

    // Формируем промпт для оценки
    // --- ИЗМЕНЕНИЕ: Добавляем xp_reward в промт ---
    const evaluationPrompt = `
Ты — преподаватель китайского языка. Твой уровень строгого оценивания зависит от уровня HSK пользователя.
Пользователь выполнил задание: описал картинку.
Текст пользователя: "${userText}"
Уровень студента: HSK ${state.level || 1}
Контекст картинки: ${currentImageTask.topic_hint}


Не используй эмодзи и форматирования (только {.,?!-})

Твоя задача:
1. Проанализировать описание. Насколько оно точное? Использована ли лексика по теме? Есть ли грамматические ошибки?
2. Дать краткий комментарий (1-2 предложения), что было хорошо, а что можно улучшить.
3. Начислить XP от 0 до 15 за качество ответа (грамматика, лексика, содержание), где 15 - отличное описание, а 0 - практически не разобрать.
4. Дать подсказку и вежливое объяснение (1-2 предложения).

[ГЛАВНЫЕ ПРАВИЛА]
1. Ответ СТРОГО в формате чистого JSON. Без markdown, без \`\`\`json, без пояснений.
2. Поле "text" — твой комментарий студенту. Пиши СТРОГО на китайском (упрощённые иероглифы). Лексика уровня HSK ${state.level || 1}.
3. Поле "correct_status" — оценка ответа студента:
   - "good": ответ на китайском, грамматически верный, по теме
   - "normal": есть мелкие ошибки, но смысл понятен
   - "bad": серьёзные ошибки или ответ не по теме
4. Поле "xp_reward" — число от 0 до 15:
   - 12-15: идеальный развёрнутый ответ
   - 8-11: хорошо, мелкие ошибки
   - 4-7: понятно, но много ошибок
   - 0-3: бессмыслица или игнор
5. Поле "emotion" — твоя реакция: "calm" | "happy" | "sad" | "surprised"
6. Поле "feedback" — СТРОГО НА РУССКОМ:
   - Подсказка и Объяснение ошибки студента
   - НИКАКОГО пиньиня
   - Кратко, понятно, педагогично

[СТРУКТУРА ОТВЕТА — ТОЛЬКО ЭТИ 5 ПОЛЕЙ]
{
    "text": "Твой комментарий на китайском",
    "correct_status": "good",
    "xp_reward": 10,
    "emotion": "happy",
    "feedback": "Пояснение на русском. Без иероглифов!"
}

[ПРИМЕРЫ]

Пример 1 (студент ошибся):
Студент: "wo qu xuexiao"
Твой JSON:
{
    "text": "你去学校做什么？",
    "correct_status": "normal",
    "xp_reward": 3,
    "emotion": "calm",
    "feedback": "После глагола 去 обычно указывается цель действия."
}

Пример 2 (студент ответил отлично):
Студент: "我喜欢吃北京烤鸭，因为很好吃。"
Твой JSON:
{
    "text": "好极了！你知道怎么自己做吗？",
    "correct_status": "good",
    "xp_reward": 14,
    "emotion": "happy",
    "feedback": "Твой китайский превосходен! Ты правильно использовал 因为 для объяснения причины."
}
`;

    const aiResponseResult = await callAI(evaluationPrompt, userText); // Обновляем имя переменной
    console.log(evaluationPrompt, userText);

    // Проверяем, есть ли ошибка и есть ли текст
    if (aiResponseResult.text && !aiResponseResult.error) {

        const parsed = parseAIResponse(aiResponseResult.text); // Теперь в parsed будет xp_reward

        console.log(aiResponseResult, parsed);
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
                updateXpProgress(state.currentXp, state.maxXpForLevel, earnedXp);
            })
            .catch(err => console.error('Ошибка сохранения XP:', err));
        }

        // Обновляем UI (прогресс бар)
        // updateXpProgress(state.currentXp, state.maxXpForLevel, earnedXp);

        const isChinese = state.settings.aiLanguage === 'zh';
        console.log('Текущий язык:', isChinese ? 'Китайский' : 'Русский');

        let resultText = '';

        resultText = `${parsed.text}`;

        console.log(parsed);

        // Озвучка результата, если звонок активен
        if (state.isVideoCallActive && !state.isAvatarSpeaking) {
            await ttsService.speak(resultText, parsed.emotion);
            hideTyping();
            addMessage(resultText, 'incoming', parsed);
            state.conversationHistory.push({ role: 'assistant', content: parsed.text });
        }
        else{
            hideTyping();
            addMessage(resultText, 'incoming', parsed);
            state.conversationHistory.push({ role: 'assistant', content: parsed.text });
        }
    } else {
        // Обработка ошибки получения ответа от ИИ
        console.error('Ошибка получения ответа от ИИ в режиме картинки:', aiResponseResult.error);
        addMessage('Ошибка получения оценки от ИИ.', 'incoming');
        // Важно: не забыть сбросить блокировку ввода
        setInputLocked(false);
        // И, возможно, вернуться к диалогу
    }
    switchBackToDialog();
}


// Возврат в обычный режим диалога
export function switchBackToDialog() {
    const containers = document.querySelectorAll('.image-task-container');
    containers.forEach(container => {
        container.classList.add('stop-shimmer');
    });
    isImageModeActive = false;
    currentImageTask = null;
    
    // Сбрасываем активную кнопку в UI (если нужно визуальное переключение)
    const buttons = document.querySelectorAll('.task-btn');
    buttons.forEach(btn => {
        if (btn.dataset.mode === 'dialog') btn.classList.add('active');
        else btn.classList.remove('active');
    });

    console.log('✅ Возврат в режим Диалог');
    setInputLocked(false);
    
    // Можно добавить приветственное сообщение для продолжения беседы
    // addMessage('Отлично! Продолжим разговор?', 'incoming');
}

export function isImageMode() {
    return isImageModeActive;
}