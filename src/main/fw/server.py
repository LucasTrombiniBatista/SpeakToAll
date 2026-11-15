"""Motor reserva do SpeakToAll: faster-whisper (CTranslate2) rodando no Python embutido.

Usado quando o Windows (Controle Inteligente de Aplicativos) bloqueia o whisper-server.exe.
Fala o mesmo "idioma" do motor nativo para o engine.js mudar pouco:

  Servidor:  server.py --model DIR --port N [--threads N] [--language pt] [--beam 1] [--prompt TXT]
             GET  /health
             POST /inference?language=pt   corpo = WAV PCM 16-bit mono 16 kHz
                  -> {"text", "language", "segments": [{"start", "end", "text"}]}  (segundos)

  Arquivo:   server.py --model DIR --file AUDIO.wav --out BASE [...]
             imprime "[hh:mm:ss.mmm --> hh:mm:ss.mmm]  texto" e "progress = N%" (como o whisper-cli)
             e grava BASE.json no formato do whisper-cli: {"transcription": [{"offsets": {from, to}, "text"}]}
"""
import argparse
import io
import json
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from faster_whisper import WhisperModel


def read_wav(src):
    """WAV PCM 16-bit (o app sempre grava 16 kHz mono) -> float32 em [-1, 1].

    Lê com o módulo wave em vez do PyAV: a API do av muda entre versões e quebrou no teste.
    """
    with wave.open(src) as w:
        if w.getsampwidth() != 2:
            raise ValueError('WAV precisa ser PCM 16-bit')
        channels, rate = w.getnchannels(), w.getframerate()
        audio = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != 16000:
        # Reamostragem linear simples; o app já entrega 16 kHz, isto é só uma rede de segurança.
        n = int(round(len(audio) * 16000 / rate))
        audio = np.interp(np.linspace(0, len(audio), n, endpoint=False), np.arange(len(audio)), audio).astype(np.float32)
    return audio


class Engine:
    def __init__(self, args):
        self.args = args
        self.model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=args.threads)
        self.lock = threading.Lock()  # um ditado por vez, como o whisper-server

    def run(self, audio, language=None, on_segment=None):
        lang = language or self.args.language
        with self.lock:
            segments, info = self.model.transcribe(
                audio,
                language=None if lang in (None, '', 'auto') else lang,
                beam_size=self.args.beam,
                best_of=self.args.beam,
                temperature=0.0,  # sem fallback de temperatura: re-decodificar multiplica o tempo
                initial_prompt=self.args.prompt or None,
                vad_filter=False,
            )
            out = []
            for s in segments:
                seg = {'start': float(s.start), 'end': float(s.end), 'text': s.text}
                out.append(seg)
                if on_segment:
                    on_segment(seg, info.duration)
        return out, info.language


def serve(engine, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # sem log por requisição
            pass

        def send_json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if urlparse(self.path).path == '/health':
                return self.send_json(200, {'status': 'ok'})
            self.send_json(404, {'error': 'not found'})

        def do_POST(self):
            url = urlparse(self.path)
            if url.path != '/inference':
                return self.send_json(404, {'error': 'not found'})
            try:
                size = int(self.headers.get('Content-Length') or 0)
                audio = read_wav(io.BytesIO(self.rfile.read(size)))
                language = (parse_qs(url.query).get('language') or [None])[0]
                segments, lang = engine.run(audio, language)
                text = ''.join(s['text'] for s in segments).strip()
                self.send_json(200, {'text': text, 'language': lang, 'segments': segments})
            except Exception as e:  # noqa: BLE001 - o erro volta para o app
                self.send_json(500, {'error': str(e)})

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'listening on 127.0.0.1:{port}', flush=True)
    server.serve_forever()


def fmt(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{s:02d}.{ms:03d}'


def transcribe_file(engine, path, base):
    def on_segment(seg, duration):
        print(f"[{fmt(seg['start'])} --> {fmt(seg['end'])}]  {seg['text'].strip()}", flush=True)
        if duration:
            print(f'progress = {min(100, int(seg["end"] * 100 / duration))}%', flush=True)

    segments, _ = engine.run(read_wav(path), on_segment=on_segment)
    with open(base + '.json', 'w', encoding='utf-8') as f:
        json.dump({'transcription': [
            {'offsets': {'from': int(s['start'] * 1000), 'to': int(s['end'] * 1000)}, 'text': s['text']} for s in segments
        ]}, f, ensure_ascii=False)
    print('progress = 100%', flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model', required=True)
    p.add_argument('--port', type=int, default=0)
    p.add_argument('--threads', type=int, default=0)
    p.add_argument('--language', default='auto')
    p.add_argument('--beam', type=int, default=1)
    p.add_argument('--prompt', default='')
    p.add_argument('--file')
    p.add_argument('--out')
    args = p.parse_args()
    # Saída em UTF-8 mesmo com o console em cp1252 (texto em português, chinês etc.)
    sys.stdout.reconfigure(encoding='utf-8')
    engine = Engine(args)
    if args.file:
        transcribe_file(engine, args.file, args.out or args.file.rsplit('.', 1)[0])
    else:
        serve(engine, args.port)


if __name__ == '__main__':
    main()
