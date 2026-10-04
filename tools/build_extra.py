#!/usr/bin/env python3
"""Add photo lessons to the app.

Usage: python3 tools/build_extra.py new_lesson.json [more.json ...]
Each file holds one lesson in the same shape as the built-in LESSONS (see README in this folder).
The script checks the lesson, records every English line in the natural voices
(woman/man, normal and slow, plus dialogue voices), checks each clip with a speech
recogniser, and appends the lesson to lessons/extra.json. Nothing is written if a check fails.
"""
import json, os, re, sys, difflib, subprocess
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRA = os.path.join(ROOT, 'lessons', 'extra.json')
TTS = os.environ.get('TTS_DIR', os.path.expanduser('~/.cache/english-tts'))
VOICES = {'f': 'bf_isabella', 'm': 'bm_fable'}
FA = re.compile(r'[؀-ۿ]')

def h32(t):
    h = 0x811c9dc5; b = t.encode('utf-16-le')
    for i in range(0, len(b), 2):
        h ^= int.from_bytes(b[i:i+2], 'little'); h = (h * 0x01000193) & 0xffffffff
    return format(h, '08x')

def problems(l, existing_ids):
    p = []
    s = lambda x: isinstance(x, str) and x.strip() != ''
    if not re.fullmatch(r'x\d+', str(l.get('id', ''))): p.append('id must be x<number>')
    if l.get('id') in existing_ids: p.append('id already used')
    t = l.get('title') or {}
    if not (s(t.get('fa')) and FA.search(t['fa']) and s(t.get('en'))): p.append('title needs fa (Dari) and en')
    if not s(l.get('emoji')): p.append('emoji missing')
    if not isinstance(l.get('from'), list) or not l['from']: p.append('from: list the photo ids used')
    ph = l.get('phrases') or []
    if len(ph) != 6: p.append('needs exactly 6 phrases')
    for i, x in enumerate(ph):
        if x.get('id') != f"{l.get('id')}p{i+1}": p.append(f'phrase {i+1} id must be {l.get("id")}p{i+1}')
        for k in ('en', 'fa', 'emoji'):
            if not s(x.get(k)): p.append(f'phrase {i+1} missing {k}')
        if s(x.get('fa')) and not FA.search(x['fa']): p.append(f'phrase {i+1} fa is not Dari script')
        if s(x.get('en')) and FA.search(x['en']): p.append(f'phrase {i+1} en has Dari letters')
        if not isinstance(x.get('hint'), str): p.append(f'phrase {i+1} hint must be a string (Dari-letter pronunciation)')
        n = len(str(x.get('en', '')).split(' '))
        if not (isinstance(x.get('gap'), int) and 0 <= x['gap'] < n): p.append(f'phrase {i+1} gap must be a word index 0..{n-1}')
    tr = l.get('trap') or {}
    for k in ('title', 'text', 'example', 'brief'):
        if not s(tr.get(k)): p.append(f'trap missing {k}')
    d = tr.get('drill') or {}
    if not s(d.get('q')) or not isinstance(d.get('options'), list) or sum(1 for o in d['options'] if o.get('ok')) != 1 or len(d['options']) != 3:
        p.append('trap.drill needs q and 3 options with exactly one ok')
    tk = l.get('talk') or {}
    if not (s(tk.get('fa')) and s(tk.get('role'))): p.append('talk needs fa (Dari topic) and role (English role-play for ChatGPT)')
    dg = l.get('dialog') or {}
    lines, qs = dg.get('lines') or [], dg.get('qs') or []
    if not (4 <= len(lines) <= 6): p.append('dialog needs 4-6 lines')
    for i, x in enumerate(lines):
        if not (isinstance(x, list) and len(x) == 3 and x[0] in ('f', 'm') and s(x[1]) and s(x[2]) and FA.search(x[2])): p.append(f'dialog line {i+1} must be ["f"|"m", English, Dari]')
    if len(qs) != 2 or any(not (isinstance(q, list) and len(q) == 2 and s(q[0]) and isinstance(q[1], list) and len(q[1]) == 3) for q in qs):
        p.append('dialog needs 2 questions: [Dari question, [right, wrong, wrong]]')
    return p

def main(files):
    data = json.load(open(EXTRA, encoding='utf-8')) if os.path.exists(EXTRA) else {'version': 1, 'audio': [], 'lessons': []}
    builtin = {f'l{i}' for i in range(1, 11)}
    used = builtin | {x['id'] for x in data['lessons']}
    new = [json.load(open(f, encoding='utf-8')) for f in files]
    bad = False
    for l in new:
        pr = problems(l, used); used.add(l.get('id'))
        if pr: bad = True; print('LESSON', l.get('id'), 'PROBLEMS:'); [print('  -', x) for x in pr]
    if bad: print('Nothing written. Fix the problems and run again.'); sys.exit(1)

    sys.path.insert(0, TTS); os.chdir(TTS)
    import numpy as np, soundfile as sf, sherpa_onnx
    from kokoro_onnx import Kokoro
    k = Kokoro('kokoro-v1.0.onnx', 'voices-v1.0.bin')
    d = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/'
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=d+'encoder.int8.onnx', decoder=d+'decoder.int8.onnx', joiner=d+'joiner.int8.onnx', tokens=d+'tokens.txt', model_type='nemo_transducer', num_threads=4)
    NUM = {'1':'one','2':'two','3':'three','4':'four','5':'five','6':'six','7':'seven','8':'eight','9':'nine','10':'ten','12':'twelve'}
    def words(s):
        s = s.lower().replace("o'clock", 'oclock').replace('o clock', 'oclock').replace('to day', 'today').replace('to morrow', 'tomorrow')
        s = re.sub(r'\bok\b', 'okay', s); s = re.sub(r'\b(\d+)\b', lambda m: NUM.get(m.group(1), m.group(1)), s)
        return re.sub(r"[^a-z' ]", ' ', s).split()
    def errs(t, hy):
        return sum(max(i2-i1, j2-j1) for op,i1,i2,j1,j2 in difflib.SequenceMatcher(None, words(t), words(hy)).get_opcodes() if op != 'equal')
    def trim(a, sr, cut=42):
        a = a.astype('float32'); idx = np.where(np.abs(a) > 10 ** (-cut/20))[0]
        if not len(idx): return a
        a = a[max(0, idx[0]-int(.03*sr)): idx[-1]+int(.05*sr)].copy(); f = int(.04*sr); a[-f:] *= np.linspace(1, 0, f)
        return np.concatenate([np.zeros(int(.12*sr), 'float32'), a, np.zeros(int(.15*sr), 'float32')])
    def heard(a, sr):
        s = rec.create_stream(); s.accept_waveform(sr, a); rec.decode_stream(s); return s.result.text
    def save(a, sr, path):
        os.makedirs(os.path.dirname(path), exist_ok=True); tmp = path + '.wav'; sf.write(tmp, a, sr)
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',tmp,'-ac','1','-ar','24000','-c:a','libmp3lame','-b:a','56k', path], check=True); os.remove(tmp)
    def take(t, voice, speeds):
        best = None; src = t if len(t.split()) > 1 else t[0].upper() + t[1:] + '.'
        for sp in speeds:
            for cut in (42, 36):
                a, sr = k.create(src, voice=VOICES[voice], speed=sp, lang='en-gb'); a = trim(a, sr, cut)
                hy = heard(a, sr); e = errs(t, hy)
                if best is None or e < best[0]: best = (e, a, sr, hy)
                if e == 0: return best
        return best
    report = []
    def clip(t, voice, folder, speeds, stretch_from=None):
        path = os.path.join(ROOT, 'audio', folder, h32(t) + '.mp3')
        e, a, sr, hy = take(t, voice, speeds)
        if e and stretch_from:  # slow take misheard: stretch the clear normal clip instead
            src = os.path.join(ROOT, 'audio', stretch_from, h32(t) + '.mp3')
            subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src,'-filter:a','atempo=0.78','-ac','1','-ar','24000','-c:a','libmp3lame','-b:a','56k',path], check=True)
            report.append((folder, t, 0, 'stretched')); return
        save(a, sr, path); report.append((folder, t, e, hy))
    for l in new:
        texts = [x['en'] for x in l['phrases']] + [l['trap']['example']] + ([l['trap']['drill']['say']] if l['trap']['drill'].get('say') else [])
        for t in texts:
            for v in ('f', 'm'):
                clip(t, v, v, (0.9, 0.85, 0.95, 0.8))
                clip(t, v, v + 's', (0.72, 0.68, 0.76, 0.8), stretch_from=v)
            if h32(t) not in data['audio']: data['audio'].append(h32(t))
        for spk, en, fa in l['dialog']['lines']:
            clip(en, spk, 'd', (0.92, 0.88, 0.97, 0.85))
        data['lessons'].append(l)
    tmp = EXTRA + '.tmp'; json.dump(data, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); os.replace(tmp, EXTRA)
    off = [r for r in report if r[2]]
    print(f'Added {len(new)} lesson(s), {len(report)} clips. {len(off)} clip(s) the recogniser heard differently:')
    for f, t, e, hy in off: print(f'  [{f}] {t!r} -> heard {hy!r}')

if __name__ == '__main__':
    if len(sys.argv) < 2: print(__doc__); sys.exit(2)
    main(sys.argv[1:])
