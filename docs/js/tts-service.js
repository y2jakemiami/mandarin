// js/tts-service.js
import { TTS_CONFIG } from './config.js';
import { state } from './state.js';
import videoManager from './video-manager.js';

class TTSService {
    constructor() {
        this.currentAudio = null;
    }

    // Генерация и воспроизведение речи
    async speak(text, emotion = 'calm') {
        if (!state.isVideoCallActive || state.isAvatarSpeaking) {
            console.warn('TTS заблокирован: звонок не активен или аватар уже говорит');
            return;
        }

        try {
            state.isAvatarSpeaking = true;
            
            // Обновляем статус в UI через видео-менеджер (или можно вынести в UI контроллер)
            const statusEl = document.getElementById('callStatusText');
            if (statusEl) statusEl.textContent = 'Аватар думает...';

            // Переключаем видео на "думает" перед началом генерации
            // videoManager.switchTo('thinking', 'calm');

            // Формируем URL для запроса к TTS серверу
            const voice = state.settings.aiLanguage === 'zh' 
                ? state.settings.voiceZh 
                : state.settings.voiceRu;
                
            const response = await fetch(
                `${TTS_CONFIG.serverUrl}/generate-speech?voice=${TTS_CONFIG.voice}&text=${encodeURIComponent(text)}`,
                { method: 'POST', mode: 'cors' }
            );
            
            if (!response.ok) {
                throw new Error(`Ошибка TTS сервера: ${response.status}`);
            }

            const audioBlob = await response.blob();
            
            // Очищаем предыдущее аудио, если было
            if (this.currentAudio) {
                this.currentAudio.pause();
                URL.revokeObjectURL(this.currentAudio.src);
                this.currentAudio = null;
            }

            // Создаем новый аудио объект
            this.currentAudio = new Audio(URL.createObjectURL(audioBlob));

            console.log(`🔊 Начинаю озвучку (${emotion}):`, text);
            
            // Переключаем видео на режим разговора с нужной эмоцией
            videoManager.switchTo('talking', emotion);
            
            if (statusEl) {
                // Получаем эмодзи из утилит (импорт нужен, но чтобы избежать циклических зависимостей, 
                // лучше передать строку или импортировать utils здесь, если структура позволяет)
                // Для простоты используем хардкод или импортируем utils
                import('./utils.js').then(({ getEmotionEmoji }) => {
                    if (statusEl) statusEl.textContent = `Аватар говорит ${getEmotionEmoji(emotion)}...`;
                }).catch(() => {
                    if (statusEl) statusEl.textContent = 'Аватар говорит...';
                });
            }

            // Настройка событий окончания воспроизведения
            this.currentAudio.onended = () => this.finishSpeaking();
            this.currentAudio.onerror = (e) => {
                console.error('❌ Ошибка воспроизведения аудио:', e);
                this.finishSpeaking();
            };

            await this.currentAudio.play();

        } catch (error) {
            console.error('💥 Критическая ошибка TTS:', error);
            if (document.getElementById('callStatusText')) {
                document.getElementById('callStatusText').textContent = '⚠️ Ошибка озвучки';
            }
            this.finishSpeaking(true); // Принудительно завершаем с флагом ошибки
        }
    }

    // Завершение речи и возврат в режим ожидания
    finishSpeaking(isError = false) {
        console.log('✅ Аватар закончил говорить');
        
        if (this.currentAudio) {
            URL.revokeObjectURL(this.currentAudio.src);
            this.currentAudio = null;
        }

        state.isAvatarSpeaking = false;
        
        // Разблокировка ввода должна происходить в главном контроллере, 
        // но здесь мы можем вызвать событие или просто вернуть управление
        // В данной архитектуре лучше вызвать callback, но для простоты вернемся в idle
        
        videoManager.switchTo('idle', 'calm');
        
        const statusEl = document.getElementById('callStatusText');
        if (statusEl) statusEl.textContent = 'Аватар слушает... 😌';
        
        // Сообщаем главному модулю, что можно разблокировать ввод
        window.dispatchEvent(new CustomEvent('tts-finished', { detail: { isError } }));
    }
    
    // Экстренная остановка
    stop() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            URL.revokeObjectURL(this.currentAudio.src);
            this.currentAudio = null;
        }
        state.isAvatarSpeaking = false;
    }
}

export default new TTSService();