// js/ui-controller.js
import { state } from './state.js';
import { isValidHexColor, hexToRgb, rgbToHex } from './utils.js';
import ttsService from './tts-service.js';
import { HOST } from './config.js'; 
import videoManager from './video-manager.js';

// === КОНФИГУРАЦИЯ ===
const TRANSLATION_API = `http://${HOST}:8003/translate`;

// === ЗАПРОС ПЕРЕВОДА + ПИНЬИНЯ ===
export async function fetchTranslation(text, direction = 'zh-ru') {
    try {
        const resp = await fetch(TRANSLATION_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, direction })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        console.error('❌ Translation error:', e);
        return { translation: '', pinyin: '', warning: 'Ошибка загрузки' };
    }
}

/**
 * Отправляет китайский текст на бэкенд для сохранения в words_learned.
 * Бэкенд должен самостоятельно разбить текст на слова (jieba/HanLP) 
 * и обновить массив/JSON в БД.
 */
async function saveWordsLearned(chineseText) {
    const userId = localStorage.getItem('currentUserId');
    if (!userId || !chineseText) return;

    const WORDS_API = `http://${window.location.hostname}:8005`;

    try {
        // Fire-and-forget: не блокируем UI и перевод
        await fetch(`${WORDS_API}/api/users/${userId}/words-learned`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chineseText })
        });
    } catch (err) {
        console.warn('⚠️ Не удалось сохранить слова в БД:', err);
    }
}

// === ОБНОВЛЕНИЕ ФОНА ЧАТА ===
export function updateChatBackground(hexColor) {
    if (!hexColor || !isValidHexColor(hexColor)) return;

    let finalColor = hexColor;
    const isDark = document.body.getAttribute('data-theme') === 'dark';

    if (isDark) {
        const rgb = hexToRgb(hexColor);
        if (rgb) {
            const factor = 0.25;
            finalColor = rgbToHex(
                Math.floor(rgb.r * factor),
                Math.floor(rgb.g * factor),
                Math.floor(rgb.b * factor)
            );
        }
    }

    document.body.style.transition = 'background-color 1.5s ease-in-out';
    document.body.style.backgroundColor = finalColor;
}

// === ДОБАВЛЕНИЕ СООБЩЕНИЯ В ЧАТ ===
export function addMessage(text, type, aiData = {}) {
    const { masked = false } = "";
    const messagesContainer = document.getElementById('messagesContainer');
    const typingIndicator = document.getElementById('typingIndicator');
    
    if (!messagesContainer || !typingIndicator) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}${masked ? ' masked' : ''}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Обработка ссылок в тексте
    const formattedText = text.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" style="color:#FF9800;text-decoration:none">$1</a>'
    );
    bubble.innerHTML = `<span class="message-text">${formattedText}</span>`;

    // === 1. КЛИК ПО ТЕКСТУ: ПЕРЕВОД + ПИНЬИНЬ ===
    if ((type === 'incoming' && aiData?.text) || type === 'outgoing') {
        const textSpan = bubble.querySelector('.message-text');
        const rawText = textSpan.textContent;

        // Проверяем, есть ли в тексте китайские иероглифы
        const isChinese = /[\u4e00-\u9fff]/.test(rawText);

        if (isChinese) {
            textSpan.classList.add('ai-text', type); 
            
            textSpan.addEventListener('click', async (e) => {
                e.stopPropagation();
                
                const existing = messageDiv.querySelector('.translation-popup');
                if (existing) {
                    videoManager.switchTo('thinking', 'calm');
                    await ttsService.speak(rawText, "calm");
                    return;
                }
                
                textSpan.classList.add('active');
                
                // === 🆕 НОВОЕ: Сохраняем слова в БД при ПЕРВОМ клике ===
                if (!messageDiv.dataset.wordsSaved) {
                    messageDiv.dataset.wordsSaved = 'true'; // Защита от дублей
                    saveWordsLearned(rawText);
                }
                
                const popup = document.createElement('div');
                popup.className = `translation-popup loading ${type}`;
                popup.innerHTML = '<div class="loader"> Перевод...</div>';
                bubble.appendChild(popup);

                let result;

                // Если видеозвонок активен, озвучиваем задание
                if (state.isVideoCallActive && !state.isAvatarSpeaking) {
                    videoManager.switchTo('thinking', 'calm');
                    result = await fetchTranslation(rawText);
                    await ttsService.speak(rawText, "calm");
                } else {
                    result = await fetchTranslation(rawText);
                }
                

                
                popup.className = `translation-popup ${type}`;
                popup.innerHTML = `
                    ${result.pinyin ? `<div class="pinyin-row ${type}">${result.pinyin}</div>` : ''}
                    ${result.translation ? `<div class="translation-row ${type}">${result.translation}</div>` : ''}
                    ${result.warning ? `<div class="warning-row">⚠️ ${result.warning}</div>` : ''}
                `;
            });
        }
    }

    // === 2. КНОПКА "?": ПОЯСНЕНИЕ (FEEDBACK) ===
    const showExplainBtn = (
        type === 'incoming' && 
        aiData?.feedback
        // aiData.correct_status !== 'good'
    );

    if (showExplainBtn) {
        console.log("hello");
        const helpBtn = document.createElement('button');
        helpBtn.className = 'explain';
        helpBtn.textContent = '💡';
        helpBtn.title = 'Пояснение на русском';
        bubble.appendChild(helpBtn);

        helpBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            const existing = messageDiv.querySelector('.explanation-content');
            if (existing) {
                existing.remove();
                helpBtn.classList.remove('process');
                return;
            }

            helpBtn.classList.add('process'); // Запускаем анимацию

            const explanationDiv = document.createElement('div');
            explanationDiv.className = 'explanation-content';
            
            // Цвет полоски в зависимости от статуса
            const colors = { bad: '#e33529', normal: '#c29d19', good: '#5fc219' };
            const borderColor = colors[aiData.correct_status] || '#c29d19';

            explanationDiv.style.borderLeftColor = borderColor; 
            
            explanationDiv.innerHTML = `
                <div class="explanation-text">${aiData.feedback}</div>
            `;

            bubble.appendChild(explanationDiv);

            // ОЗВУЧКА (только если видеозвонок активен)
            if (state.isVideoCallActive && ttsService?.speak) {
                try {
                    await ttsService.speak(aiData.feedback, 'calm');
                } catch (err) {
                    console.error('TTS error:', err);
                } finally {
                    helpBtn.classList.remove('process');
                }
            } else {
                helpBtn.classList.remove('process');
            }
        });
    }

    messageDiv.appendChild(bubble);

    // === ЛОГИКА СКРЫТОГО СООБЩЕНИЯ (МАСКА) ===
    if (masked) {
        const revealHandler = (e) => {
            if (e.target.tagName === 'A' || e.target.classList.contains('explain')) return;
            messageDiv.classList.add('revealed');
            if (navigator.vibrate) navigator.vibrate(10);
            messageDiv.removeEventListener('click', revealHandler);
            messageDiv.removeEventListener('touchend', revealHandler);
        };
        messageDiv.addEventListener('click', revealHandler);
        messageDiv.addEventListener('touchend', revealHandler);
    }
    
    messagesContainer.insertBefore(messageDiv, typingIndicator);
    scrollToBottom();
    return messageDiv;
}

// === УТИЛИТЫ ===
export function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) container.scrollTop = container.scrollHeight;
}

export function showTyping() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
        indicator.style.display = 'flex';
        scrollToBottom();
    }
}

export function hideTyping() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.style.display = 'none';
}

// === УПРАВЛЕНИЕ ВВОДОМ ===
export function setInputLocked(locked) {
    const messageInput = document.getElementById('messageInput');
    const voiceBtn = document.getElementById('voiceBtn');
    const sendBtn = document.getElementById('sendBtn');
    
    if (!messageInput || !voiceBtn || !sendBtn) return;

    messageInput.disabled = locked;
    voiceBtn.disabled = locked;
    sendBtn.disabled = locked;
    state.isInputLocked = locked;

    if (locked) {
        messageInput.placeholder = 'Аватар говорит...';
        messageInput.style.opacity = '0.6';
        voiceBtn.style.opacity = '0.5';
        voiceBtn.style.pointerEvents = 'none';
    } else {
        messageInput.placeholder = 'Введите сообщение...';
        messageInput.style.opacity = '1';
        voiceBtn.style.opacity = '1';
        voiceBtn.style.pointerEvents = 'auto';
    }
}

export function toggleSendVoiceButtons(hasText) {
    const sendBtn = document.getElementById('sendBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    if (!sendBtn || !voiceBtn) return;

    if (hasText) {
        sendBtn.classList.add('visible');
        voiceBtn.style.display = 'none';
    } else {
        sendBtn.classList.remove('visible');
        voiceBtn.style.display = 'flex';
    }
}

// === ЗАГОЛОВОК И ТЕМА ===
export function updateChatHeader() {
    const chatTitle = document.getElementById('chatTitle');
    const chatStatus = document.getElementById('chatStatus');
    
    if (chatTitle) chatTitle.textContent = state.topic;
    if (chatStatus) {
        chatStatus.textContent = state.level !== 'Любой уровень' ? `HSKK ${state.level}` : 'онлайн';
    }
}

export function applyTheme(themeName) {
    if (themeName === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    } else {
        document.body.removeAttribute('data-theme');
    }
}

// === ПРОГРЕСС XP ===
export function updateXpProgress(currentXp = 0, maxXpForLevel = 100, earnedXp = 0) {
    const xpProgressFill = document.getElementById('xpProgressFill');
    const currentXpDisplay = document.getElementById('currentXpDisplay');

    if (!xpProgressFill || !currentXpDisplay) return;

    const percent = Math.min(100, Math.max(0, (currentXp / maxXpForLevel) * 100));
    xpProgressFill.style.width = `${percent}%`;
    currentXpDisplay.textContent = `${currentXp}/${maxXpForLevel}`;

    if (earnedXp > 0) {
        currentXpDisplay.style.color = 'var(--accent-orange)';
        setTimeout(() => {
            if (currentXpDisplay) currentXpDisplay.style.color = 'var(--text-main)';
        }, 300);
    }
}

// === ИНИЦИАЛИЗАЦИЯ СОБЫТИЙ ===
export function setupUIListeners(onSendMessage, onTaskClick) {
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const taskBtns = document.querySelectorAll('.task-btn');
    const voiceBtn = document.getElementById('voiceBtn');

    // Инициализация прогресса
    updateXpProgress(state.currentXp || 0, state.maxXpForLevel || 100);

    // Ввод текста
    if (messageInput) {
        messageInput.addEventListener('input', () => {
            toggleSendVoiceButtons(messageInput.value.trim().length > 0);
        });
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !state.isInputLocked) onSendMessage();
        });
    }

    // Кнопка отправки
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            if (!state.isInputLocked) onSendMessage();
        });
    }

    // Голосовой ввод
    if (voiceBtn) {
        let recordingTimeout;
        let isRecording = false;

        const startRecording = (e) => {
            e.preventDefault();
            if (state.isInputLocked) return;
            isRecording = true;
            voiceBtn.style.background = '#FF9800';
            startVoiceCapture();
        };

        const stopRecording = (e) => {
            e.preventDefault();
            if (!isRecording) return;
            isRecording = false;
            voiceBtn.style.background = '#B8B8B8';
            
            if (window.currentMediaRecorder) {
                window.currentMediaRecorder.stop();
                window.currentMediaRecorder = null;
            }
            if (window.currentAudioStream) {
                window.currentAudioStream.getTracks().forEach(track => track.stop());
                window.currentAudioStream = null;
            }
        };

        const startVoiceCapture = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                window.currentAudioStream = stream;
                const mediaRecorder = new MediaRecorder(stream);
                window.currentMediaRecorder = mediaRecorder;
                const audioChunks = [];

                mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

                mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'recording.webm');

                    try {
                        const resp = await fetch(`http://${HOST}:5000/recognize`, {
                            method: 'POST', body: formData
                        });
                        if (!resp.ok) throw new Error(`STT error: ${resp.status}`);
                        
                        const result = await resp.json();
                        if (result.text) {
                            messageInput.value = result.text;
                            toggleSendVoiceButtons(true);
                            await onSendMessage();
                        }
                    } catch (err) {
                        console.error('STT Error:', err);
                        addMessage('Ошибка распознавания речи.', 'incoming');
                    }
                };

                mediaRecorder.start();
                recordingTimeout = setTimeout(() => {
                    if (mediaRecorder.state === 'recording') mediaRecorder.stop();
                }, 10000);

            } catch (err) {
                console.error('Mic Error:', err);
                addMessage('Нет доступа к микрофону.', 'incoming');
                voiceBtn.style.background = '#B8B8B8';
            }
        };

        voiceBtn.addEventListener('mousedown', startRecording);
        voiceBtn.addEventListener('touchstart', startRecording);
        voiceBtn.addEventListener('mouseup', stopRecording);
        voiceBtn.addEventListener('touchend', stopRecording);
        voiceBtn.addEventListener('mouseleave', stopRecording);
    }

    // Кнопки задач
    if (taskBtns) {
        taskBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                taskBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (onTaskClick) onTaskClick(btn.textContent);
            });
        });
    }
}