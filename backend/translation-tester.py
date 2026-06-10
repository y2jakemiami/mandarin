# test_api.py
import requests

# Тест перевода
resp = requests.post("http://localhost:8003/translate", json={"text": "Привет! Я голоден, хочу есть. Что ты сегодня ешь?", "direction": "ru-zh"})
print("🇨🇳 Перевод:", resp.json())

resp = requests.post("http://localhost:8003/translate", json={"text": "你好！我饿了，想吃东西。你今天吃什么？", "direction": "zh-ru"})
print("🇨🇳 Перевод:", resp.json())