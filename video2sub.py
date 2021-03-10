#!/usr/bin/env python3
import ast
import flask
from flask.json import jsonify
import werkzeug
import sys
import sqlite3
import json
import os
import time
import base64
import urllib.parse
import urllib.request
import traceback
import zlib
import secrets
import functools
import csv
import io
import math
from threading import Thread
from cv2 import cv2  # make VSCode happy
import numpy as np
if os.name == 'nt':
    import win32file
    class FileLock:
        def __init__(self, path):
            self.path = path
            self.handle = None
            self.shared()
        def exclusive(self):
            self.close()
            self.handle = win32file.CreateFile(self.path, win32file.GENERIC_READ, 0, None, win32file.OPEN_EXISTING, 0, None)
        def shared(self):
            self.close()
            self.handle = win32file.CreateFile(self.path, win32file.GENERIC_READ, win32file.FILE_SHARE_READ, None, win32file.OPEN_EXISTING, 0, None)
        def close(self):
            if self.handle is not None:
                self.handle.Close()
                self.handle = None
else:
    import fcntl
    class FileLock:
        def __init__(self, path):
            self.fd = os.open(path, os.O_RDONLY)
        def exclusive(self):
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def shared(self):
            fcntl.flock(self.fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        def close(self):
            os.close(self.fd)

sys.stdout.reconfigure(errors='replace')
sys.stderr.reconfigure(errors='replace')

version = '1.0'
dbver = 1

if len(sys.argv) != 4:
    print('请使用launcher启动器')
    print('若要手动启动后端：')
    print('  %s [主机名] [端口名] [视频/数据库文件名]'%os.path.basename(sys.argv[0]))
    sys.exit(1)
host = sys.argv[1]
port = sys.argv[2]
if sys.argv[3].lower().endswith('.v2s'):
    dbfile = sys.argv[3]
    if not os.path.isfile(dbfile):
        print('无法打开数据库文件')
        sys.exit(1)
    with sqlite3.connect(dbfile) as conn:
        video = os.path.join(os.path.dirname(dbfile), conn.cursor().execute("SELECT value FROM config WHERE key = 'file'").fetchone()[0])
else:
    video = sys.argv[3]
    dbfile = os.path.splitext(video)[0] + '.v2s'

try:
    lock = FileLock(video)
except Exception:
    print('无法打开文件:', video)
    sys.exit(1)
try:
    lock.exclusive()
    lock.shared()
except Exception:
    print('无法取得文件锁（文件被占用？）')
    sys.exit(1)

gconfig = ast.literal_eval(open('config.txt', 'r', encoding='utf_8_sig').read())

mime = {
    '.jpg': 'image/jpeg',
    '.bmp': 'image/bmp',
}

class VideoReader:
    def __init__(self):
        self.file = video
        self.cap = cv2.VideoCapture(self.file)
        if not self.cap.isOpened():
            raise Exception('无法打开视频：%s'%self.file)
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.nframes = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.logs = []
    def read(self, frame):
        if self.cap.get(cv2.CAP_PROP_POS_FRAMES) != frame:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
        succ, img = self.cap.read()
        if succ:
            return img
        self.cap.release()
        self.cap = cv2.VideoCapture(self.file)
        if self.cap.isOpened():
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
            succ, img = self.cap.read()
            if succ:
                self.logs.append(('读取视频帧%d/%d时发生错误，已尝试恢复；请考虑先转码一遍视频'%(frame, self.nframes), 'E'))
                return img
        self.logs.append(('读取视频帧%d/%d时发生错误；请考虑先转码一遍视频'%(frame, self.nframes), 'E'))
        return np.zeros((self.height, self.width, 3), np.uint8)
    def close(self):
        self.cap.release()
    def writelog(self, db):
        if len(self.logs) > 0:
            for str, level in self.logs:
                log(str, level, db=db)
            self.logs = []
            return True
        else:
            return False



def connect_db():
    return sqlite3.connect(dbfile, timeout=999999)

cap = VideoReader()
width = cap.width
height = cap.height
fps = cap.fps
nframes = cap.nframes

def fpsfix(fps):
    fpsdict = {
        '23.976': (24000,1001),
        '29.970': (30000,1001),
        '59.940': (60000,1001),
    }
    key = '%.3f'%fps
    if gconfig['fix_ntsc_fps'] and key in fpsdict:
        return fpsdict[key]
    else:
        return (fps, 1)

def frame2sec(n, fps):
    a, b = fpsfix(fps)
    return n * b / a

##############################################################################

conn = connect_db()
c = conn.cursor()
c.execute('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value)')

c.execute("INSERT OR IGNORE INTO config VALUES ('create_date', datetime('now','localtime'))")
c.execute("INSERT OR IGNORE INTO config VALUES ('create_ver', ?)", (version,))

c.execute("INSERT OR IGNORE INTO config VALUES ('db_ver', ?)", (dbver,))
file_dbver = c.execute("SELECT value FROM config WHERE key = 'db_ver'").fetchone()[0]
if dbver < file_dbver:
    print("版本过低，请升级")
    sys.exit(1)
if file_dbver < dbver:
    print("正在升级数据库")
    if file_dbver == 1:
        assert False

c.execute("INSERT OR REPLACE INTO config VALUES ('lastopen_date',datetime('now','localtime'))")
c.execute("INSERT OR REPLACE INTO config VALUES ('lastopen_ver', ?)", (version,))

c.execute("INSERT OR REPLACE INTO config VALUES ('file', ?)", (os.path.basename(video),))

c.executemany('INSERT OR IGNORE INTO config VALUES (?,?)', [(k, json.dumps(v)) for k, v in gconfig['default'].items()])


c.execute('CREATE TABLE IF NOT EXISTS filedb (file_id INTEGER PRIMARY KEY AUTOINCREMENT, format TEXT, data BLOB)')
c.execute('''
    CREATE TABLE IF NOT EXISTS imgdb (
        imgdb_id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER,
        imgdb_l INT, imgdb_t INT, imgdb_w INT, imgdb_h INT,
        FOREIGN KEY(file_id) REFERENCES filedb(file_id)
    )''')

c.execute('CREATE TABLE IF NOT EXISTS thumbnail (frame_id INT UNIQUE, imgdb_id INT)')
c.execute('''
    CREATE TABLE IF NOT EXISTS ocrresult (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state TEXT,
        date TEXT,
        frame_start INT,
        frame_end INT,
        imgdb_id INT,
        engine TEXT,
        left INT,
        top INT,
        right INT,
        bottom INT,
        position INT,
        ocrtext TEXT,
        comment TEXT
    )''')
c.execute('CREATE INDEX IF NOT EXISTS itemstate ON ocrresult (state)')

c.execute('CREATE TABLE IF NOT EXISTS jobrange (id INTEGER PRIMARY KEY)')

c.execute('CREATE TABLE IF NOT EXISTS logs (date TEXT, level CHAR(1), message TEXT, checkpoint_id INTEGER)')
c.execute('CREATE TABLE IF NOT EXISTS checkpoint (checkpoint_id INTEGER PRIMARY KEY AUTOINCREMENT, dbver INT, date TEXT, message TEXT, data BLOB)')

if file_dbver < dbver:
    if file_dbver == 1:
        assert False
    c.execute("INSERT OR REPLACE INTO config VALUES ('db_ver', ?)", (dbver,))
    print("数据库升级完成")
    
conn.commit()

logid_start = c.execute('SELECT MAX(rowid) FROM logs').fetchone()[0]
logid_start = logid_start if logid_start is not None else 0

def getconfig(db, key):
    val = db.cursor().execute('SELECT value FROM config WHERE key = ?', (key,)).fetchone()
    return val[0] if val is not None else None
def putconfig(db, key, val):
    db.cursor().execute('INSERT OR REPLACE INTO config VALUES (?, ?)', (key, val))

#levels: [E]rror [W]arning [I]nfo [S]uccess [C]heckpoint
def log(str, level='I', checkpoint_id=None, db=None):
    #db = None
    if db != None:
        db.cursor().execute("INSERT INTO logs VALUES (datetime('now','localtime'), ?, ?, ?)", (level, str, checkpoint_id))
    else:
        print(level, str)

def thread_yield():
    time.sleep(0.001)  # 好像没用

def addfile(fmt, blob, db):
    c = db.cursor()
    c.execute('INSERT INTO filedb (format, data) VALUES (?, ?)', (fmt, blob))
    return c.lastrowid

def addimages(imglist, db, fmt='.jpg', fmtparam=None):
    succ, blob = cv2.imencode(fmt, cv2.vconcat(imglist), fmtparam)
    assert succ
    file_id = addfile(fmt, blob, db)
    c = db.cursor()
    result = []
    t = 0
    for img in imglist:
        l = 0
        h = img.shape[0]
        w = img.shape[1]
        c.execute('INSERT INTO imgdb (file_id, imgdb_l, imgdb_t, imgdb_w, imgdb_h) VALUES (?,?,?,?,?)', (file_id, l, t, w, h))
        result.append(c.lastrowid)
        t += h
    return result

def db2json(db, sql, *param):
    c = db.cursor()
    row = c.execute(sql, *param).fetchall()
    col = [x[0] for x in c.description]
    return flask.jsonify({
        'col': col,
        'row': row,
    })

def checkpoint(message, generate_log=True):
    dump = zlib.compress(
        json.dumps(
            c.execute('SELECT * FROM ocrresult').fetchall(),
            ensure_ascii=False, separators=(',', ':')).encode(),
        level=1)
    c.execute("INSERT INTO checkpoint (dbver, date, message, data) VALUES (?, datetime('now','localtime'), ?, ?)", (dbver, message, dump))
    checkpoint_id = c.lastrowid
    if generate_log:
        log('已创建恢复点 #%d %s'%(checkpoint_id, message), 'C', checkpoint_id=checkpoint_id, db=conn)
    print('checkpoint #%d (%s) is %.2fKB (gzip)' % (checkpoint_id, message, len(dump)/1024))
    return checkpoint_id

def rollback(checkpoint_id):
    checkpoint_dbver, msg, dump = c.execute('SELECT dbver, message, data FROM checkpoint WHERE checkpoint_id = ?', (checkpoint_id,)).fetchone()
    if checkpoint_dbver != dbver:
        return '版本不符', msg
    c.execute('DELETE FROM ocrresult')
    rows = json.loads(zlib.decompress(dump).decode())
    if len(rows):
        c.executemany('INSERT INTO ocrresult VALUES (' + ','.join(['?']*len(rows[0])) + ')', rows)
    return None, msg

##############################################################################

thumb_h = gconfig['thumbnail']['height']
thumb_w = int(width / height * thumb_h)
thumb_npart = gconfig['thumbnail']['npart']
thumb_fmt = '.jpg'
thumb_fmtparam = [int(cv2.IMWRITE_JPEG_QUALITY), gconfig['thumbnail']['jpg_quality']]

subthumb_w = gconfig['subthumb']['width']
subthumb_fmt = '.jpg'
subthumb_fmtparam = [int(cv2.IMWRITE_JPEG_QUALITY), gconfig['subthumb']['jpg_quality']]

frame_fmt = '.bmp'
frame_fmtparam = None


##############################################################################

class ImageVConcat:
    def __init__(self, imglist):
        self.h, self.w, _ = imglist[0].shape
        pad = np.zeros((self.h, self.w, 3), np.uint8)
        self.hdict = {}
        self.n = len(imglist)
        cat = []
        cath = 0
        for img in imglist:
            if len(cat):
                cat.append(pad)
                cath += self.h
            cat.append(img)
            for i in range(cath, cath + self.h):
                self.hdict[i] = []
            cath += self.h
        self.img = cv2.vconcat(cat)
        assert self.img.shape[0] == cath
        #print(self.hdict)
    def addresult(self, left, top, right, bottom, ocrtext, comment):
        left, top, right, bottom = int(left), int(top), int(right), int(bottom)
        #print(left, top, right, bottom, ocrtext, comment)
        for i in range(top, bottom):
            if i in self.hdict:
                self.hdict[i].append((top, bottom, left, right, ocrtext, comment))
    def getresult(self):
        result = []
        for h0 in range(0, 2*self.h*self.n, 2*self.h):
            s = set()
            for i in range(h0, h0 + self.h):
                print(h0, self.hdict[i])
                s.update(self.hdict[i])
            ocrtext = '\n'.join([ocrtext for top, bottom, left, right, ocrtext, comment in sorted(s)])
            comment = '#'.join([comment for top, bottom, left, right, ocrtext, comment in sorted(s)])
            result.append(('done', ocrtext, comment))
        return result

ocr_stop = False


class BaiduOcr:
    token = None
    lastreq = 0
    def __init__(self, arg):
        self.service = arg
        self.use_batch = not arg.endswith('_basic')
        self.ocr_batch = gconfig['baiduocr']['batch_size'] if self.use_batch else 1
        self.ninvoke = 0

    def fetch_token(self):
        if BaiduOcr.token is not None:
            return
        params = {'grant_type': 'client_credentials',
                'client_id': gconfig['baiduocr']['API_KEY'],
                'client_secret': gconfig['baiduocr']['SECRET_KEY']}
        post_data = urllib.parse.urlencode(params)
        post_data = post_data.encode('utf-8')
        req = urllib.request.Request(gconfig['baiduocr']['TOKEN_URL'], post_data)
        f = urllib.request.urlopen(req, timeout=5)
        result_str = f.read()

        result_str = result_str.decode()
        result = json.loads(result_str)
        if ('access_token' in result.keys() and 'scope' in result.keys()):
            if not 'brain_all_scope' in result['scope'].split(' '):
                raise Exception('please ensure has check the  ability')
            BaiduOcr.token = result['access_token']
        else:
            raise Exception('please overwrite the correct API_KEY and SECRET_KEY')
    def request(self, url, data):
        req = urllib.request.Request(url, data.encode('utf-8'))
        f = urllib.request.urlopen(req)
        result_str = f.read()
        result_str = result_str.decode()
        return result_str
    def run(self, imglist):
        mintimediff = 1 / gconfig['baiduocr']['qps_limit']
        if self.use_batch:
            vcat = ImageVConcat(imglist)
            imglist = [vcat.img]
        else:
            results = []
        for img in imglist:
            errmsg = None
            try:
                if time.time() - BaiduOcr.lastreq < mintimediff:
                    time.sleep(mintimediff - (time.time() - BaiduOcr.lastreq))
                self.fetch_token()
                url = gconfig['baiduocr']['OCR_URL'] + self.service + "?access_token=" + BaiduOcr.token
                #print(url)
                succ, blob = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 99])
                assert succ
                file_content = blob.tobytes()
                #with open('dump.jpg', 'wb') as f:
                #    f.write(file_content)
                self.ninvoke += 1
                result = self.request(url, urllib.parse.urlencode({
                    'image': base64.b64encode(file_content),
                    'language_type': gconfig['baiduocr']['language_type'],
                    'probability': 'true',
                }))
                result_json = json.loads(result)
                if 'error_msg' in result_json:
                    errmsg = result_json['error_msg']
                if "words_result" not in result_json:
                    raise Exception(str(result_json))
                print(str(result_json))

                if self.use_batch:
                    for words_result in result_json["words_result"]:
                        left = words_result['location']['left']
                        top = words_result['location']['top']
                        right = left + words_result['location']['width']
                        bottom = top + words_result['location']['height']
                        vcat.addresult(left, top, right, bottom, words_result["words"], str(words_result))
                    results = vcat.getresult()
                else:
                    results.append(('done', '\n'.join([words_result["words"] for words_result in result_json["words_result"]]), str(result_json)))
            except Exception as e:
                traceback.print_exc()
                if errmsg is None:
                    errmsg = str(e)
                if self.use_batch:
                    results = [('error', errmsg)] * vcat.n
                else:
                    results.append(('error', errmsg))
            BaiduOcr.lastreq = time.time()
            if ocr_stop:
                break
        return results
    def done(self):
        return '调用了%d次百度文字识别API(%s)'%(self.ninvoke,self.service)

class ChineseOcr:
    ocr_batch = 5
    global ocr_stop
    def __init__(self, arg):
        if arg == 'multi':
            self.textLine = b'false'
        if arg == 'single':
            self.textLine = b'true'
    def run(self, imglist):
        results = []
        for img in imglist:
            format = '.bmp'
            succ, blob = cv2.imencode(format, img)
            assert succ
            #with open('dump.bmp', 'wb') as f:
            #    f.write(blob.tobytes())
            try:
                data = b'{"imgString":"data:%s;base64,%s","textAngle":false,"textLine":%s}' % (mime[format].encode(), base64.b64encode(blob.tobytes()), self.textLine)
                req = urllib.request.urlopen(gconfig['chineseocr']['url'], data, timeout=5)
                rsp = json.load(req)
                result = ('done', '\n'.join([item['text'] for item in rsp['res']]))
            except Exception as e:
                traceback.print_exc()
                result = ('error', str(e))
            results.append(result)
            if ocr_stop:
                break
        return results
    def done(self):
        return None

class DummyOcr:
    ocr_batch = 30
    def run(self, imglist):
        if gconfig['dummyocr']['always_error']:
            return [('error', None)] * len(imglist)
        else:
            return [('done', gconfig['dummyocr']['text'])] * len(imglist)
    def done(self):
        return None

def createocr(engine, h):
    if engine == 'dummyocr':
        return DummyOcr()
    if engine.startswith('chineseocr:'):
        return ChineseOcr(engine[len('chineseocr:'):])
    if engine.startswith('baiduocr:'):
        return BaiduOcr(engine[len('baiduocr:'):])
    assert False, "无效OCR引擎名"+engine

def run_ocrjob():
    global ocr_stop
    cap = VideoReader()
    conn = connect_db()
    c = conn.cursor()

    total = c.execute("SELECT COUNT(id) FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id)").fetchone()[0]
    progress = c.execute("SELECT COUNT(id) FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id) AND state != 'waitocr' AND state != 'error'").fetchone()[0]
    emptycnt = c.execute("SELECT COUNT(id) FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id) AND state != 'waitocr' AND state != 'error' AND ocrtext == ''").fetchone()[0]
    errcnt = c.execute("SELECT COUNT(id) FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id) AND state == 'error'").fetchone()[0]

    period_frames = 0
    period_start = 0

    curengine = ''
    ocr = None

    while True:
        lines = c.execute("SELECT id, engine, top, bottom, frame_start FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id) AND state = 'waitocr' ORDER BY engine, top, frame_start").fetchall()
        if len(lines) == 0:
            break
        lines.reverse()
        while True:
            if ocr_stop:
                cap.writelog(conn)
                msg = ocr.done()
                if msg:
                    log(msg, 'I', db=conn)
                log('OCR任务已暂停', 'W', db=conn)
                conn.commit()
                conn.close()
                cap.close()
                return
            # show status
            if len(lines) == 0 or (time.time() - period_start) > 5:
                speed = period_frames / (time.time() - period_start)
                log('OCR任务进度: %.1f%% [总共%d, 完成%d(空项%d), 错误%d, 剩余%d, fps=%.1f]' % (int((progress+errcnt)/total*1000)/10, total, progress, emptycnt, errcnt, total-progress-errcnt, speed), db=conn)
                conn.commit()
                period_frames = 0
                period_start = time.time()
            
            if len(lines) == 0:
                break
            
            # collect batch
            batch = []
            _, engine0, top0, bottom0, _ = lines[-1]
            if engine0 != curengine:
                curengine = engine0
                if ocr:
                    msg = ocr.done()
                    if msg:
                        log(msg, 'I', db=conn)
                ocr = createocr(engine0, bottom0+1 - top0)
            while len(lines) > 0 and len(batch) < ocr.ocr_batch:
                _, engine, top, bottom, _ = lines[-1]
                if (engine, top, bottom) == (engine0, top0, bottom0):
                    batch.append(lines.pop())
                else:
                    break
            print(batch)
            
            # process batch
            parts = []
            subthumbs = []
            for id, engine, top, bottom, frame_id in batch:
                img = cap.read(frame_id)
                img = img[top:bottom+1]
                parts.append(img)
                h = int(subthumb_w * (bottom+1 - top) / width)
                img = cv2.resize(img, (subthumb_w, h), interpolation=cv2.INTER_AREA)
                subthumbs.append(img)

            result = ocr.run(parts)  # [ (state, ocrtext, comment)
            print('\n'.join(['OCR[%d]: %s'%(batch[i][0], result[i] if i < len(result) else None) for i in range(len(batch))]))
            imgdb_ids = addimages(subthumbs, conn, subthumb_fmt, subthumb_fmtparam)
            for i, r in enumerate(result):
                assert type(r) is tuple
                c.execute('UPDATE ocrresult SET %s, imgdb_id = ? WHERE id = ?' %
                    ', '.join(['state = ?', 'ocrtext = ?', 'comment = ?'][:len(r)]),
                    r + (imgdb_ids[i], batch[i][0]))
                if r[0] == 'error':
                    errcnt += 1
                else:
                    if r[1] == '':
                        emptycnt += 1
                    progress += 1
            period_frames += len(result)
            conn.commit()
            thread_yield()
    
    cap.writelog(conn)
    msg = ocr.done()
    if msg:
        log(msg, 'I', db=conn)
    msg = 'OCR任务已完成(空项数%d)'%emptycnt if errcnt == 0 else 'OCR任务已完成(空项数%d)，但有%d个错误发生，请使用“继续OCR”功能来重试错误项'%(emptycnt,errcnt)
    log(msg, 'S', db=conn)
    if emptycnt:
        log('OCR结果中有空项，请注意处理', 'W', db=conn)
    conn.commit()
    conn.close()
    cap.close()

ocr_thread = None
def startocr():
    global ocr_stop
    global ocr_thread
    if ocr_thread is not None:
        ocr_thread.join()
    ocr_stop = False
    ocr_thread = Thread(target=run_ocrjob)
    ocr_thread.start()

##############################################################################



def make_thumbnail():
    cap = VideoReader()
    conn = connect_db()
    c = conn.cursor()
    if getconfig(conn, 'thumb_h') != thumb_h:
        putconfig(conn, 'thumb_h', thumb_h)
        c.execute('DELETE FROM thumbnail')
    start = c.execute('SELECT MAX(frame_id) + 1 FROM thumbnail').fetchone()[0]
    start = 0 if start is None else start
    if start < nframes - 1:
        for part_start in range(start, nframes, thumb_npart):
            parts = []
            frame_ids = []
            for i in range(part_start, min(part_start + thumb_npart, nframes)):
                img = cap.read(i)
                img = cv2.resize(img, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
                parts.append(img)
                frame_ids.append(i)
            imgdb_ids = addimages(parts, conn, thumb_fmt, thumb_fmtparam)
            c.executemany('INSERT INTO thumbnail (frame_id, imgdb_id) VALUES (?, ?)', list(zip(frame_ids, imgdb_ids)))
            if int(part_start / nframes * 100) != int((part_start - thumb_npart) / nframes * 100):
                log('生成缩略图: %d%%' % int(part_start / nframes * 100), db=conn)
                conn.commit()
            thread_yield()
        cap.writelog(conn)
        log('生成缩略图已完成', 'I', db=conn)
        conn.commit()
    conn.close()
    cap.close()

def checkwaitocr(db):
    if db.cursor().execute("SELECT COUNT(id) FROM ocrresult WHERE state == 'waitocr'").fetchone()[0]:
        log('有未完成的OCR任务，可使用“继续OCR”功能继续上次的进度', 'W', db=db)
def do_init():
    conn = connect_db()
    c = conn.cursor()
    t = Thread(target=make_thumbnail)
    t.start()
    t.join()
    log('后端已启动', 'S', db=conn)
    checkwaitocr(db=conn)
    conn.commit()
    conn.close()

init_thread = Thread(target=do_init)
init_thread.start()



##############################################################################


app = flask.Flask(__name__)
session = None

def session_header_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwds):
        if 'X-VIDEO2SUB-SESSION' not in flask.request.headers or flask.request.headers['X-VIDEO2SUB-SESSION'] != session:
            return flask.make_response('', 403)
        return f(*args, **kwds)
    return wrapper

@app.route('/')
def serve_home():
    return flask.redirect('/ui/ui.html')

@app.route('/ui/<path:filename>')
def serve_ui(filename):
    return flask.send_from_directory('ui', filename)

@app.route('/getpid', methods=['POST'])
def serve_getpid():
    return flask.jsonify(os.getpid())

@app.route('/session', methods=['POST'])
def serve_session():
    global session
    session = secrets.token_hex()
    return flask.jsonify(session)

@app.route('/havesession', methods=['POST'])
def serve_havesession():
    global session
    return flask.jsonify(session is not None)

@app.route('/info', methods=['POST'])
@session_header_required
def serve_info():
    return flask.jsonify({
        'file': os.path.basename(video),
        'width': width,
        'height': height,
        'fps': fps,
        'nframes': nframes,
        'thumb_w': thumb_w,
        'thumb_h': thumb_h,
    })

@app.route('/file')
def serve_img():
    file_id = flask.request.args.get('id', type=int)
    row = c.execute('SELECT format, data FROM filedb WHERE file_id = ?', (file_id,)).fetchone()
    return flask.Response(row[1], mimetype=mime[row[0]])

@app.route('/frame')
def serve_frame():
    frame_id = flask.request.args.get('id', type=int)
    frame = cap.read(frame_id)
    if cap.writelog(conn):
        conn.commit()
    succ, blob = cv2.imencode(frame_fmt, frame, frame_fmtparam)
    assert succ
    return flask.Response(blob.tobytes(), mimetype=mime[frame_fmt])

@app.route('/thumbnail', methods=['POST'])
@session_header_required
def serve_thumbnail():
    return db2json(conn, 'SELECT frame_id, imgdb.* FROM thumbnail JOIN imgdb USING (imgdb_id) ORDER BY frame_id')

@app.route('/logs', methods=['POST'])
@session_header_required
def serve_logs():
    return db2json(conn, '''
        SELECT id, id > ? AS cursession, date, level, message, checkpoint_id FROM (
            SELECT * FROM (SELECT ROWID AS id, * FROM logs WHERE checkpoint_id IS NULL ORDER BY ROWID DESC LIMIT ?)
            UNION ALL
            SELECT * FROM (SELECT ROWID AS id, * FROM logs WHERE checkpoint_id IS NOT NULL ORDER BY ROWID DESC LIMIT ?)
        ) ORDER BY id''', (logid_start, gconfig['max_log'], gconfig['max_checkpoint']))

@app.route('/state', methods=['POST'])
@session_header_required
def serve_state():
    loaded = not init_thread.is_alive()
    ocractive = ocr_thread is not None and ocr_thread.is_alive()
    lastjob = c.execute("SELECT COUNT(id) FROM ocrresult WHERE state = 'waitocr' or state = 'error'").fetchone()[0]

    ocrconf = json.loads(getconfig(conn, 'OCR'))
    ocrtop, ocrbottom = ocrconf['top'], ocrconf['bottom']
    if ocrtop >= 0 and ocrbottom >= 0:
        curarea = c.execute('SELECT COUNT(id) FROM ocrresult WHERE top = ? AND bottom = ?', (ocrtop, ocrbottom)).fetchone()[0]
    else:
        curarea = 0

    return flask.jsonify({
        'loaded': loaded,
        'ocractive': ocractive,
        'lastjob': lastjob,
        'curarea': curarea,
    })

@app.route('/exportass', methods=['POST'])
@session_header_required
def serve_exportass():
    row = c.execute("SELECT frame_start, frame_end, ocrtext, top, bottom, position FROM ocrresult WHERE state = 'done' AND ocrtext != '' ORDER BY frame_start, frame_end").fetchall()
    if len(row) == 0:
        log('无字幕数据', 'I', db=conn)
        conn.commit()
        return ''
    outfile = os.path.splitext(video)[0] + gconfig['export_suffix'] + '.ass'
    if os.path.exists(outfile) and not gconfig['export_overwrite']:
        log('输出文件已存在，请先删除：%s'%outfile, 'E', db=conn)
        conn.commit()
        return ''
    def frame2timestr(frame, fps, alignment):
        fn, shiftframe, eps, shift100 = alignment
        sec100 = getattr(math, fn)(frame2sec(frame + shiftframe, fps) * 100 + eps) + shift100
        sec100 = sec100 if sec100 >= 0 else 0
        fs = sec100 % 100
        s = sec100 // 100 % 60
        m = sec100 // 100 // 60 % 60
        h = sec100 // 100 // 60 // 60
        return '%d:%02d:%02d.%02d'%(h,m,s,fs)
    best_top = c.execute("SELECT top, COUNT(top) cnt FROM ocrresult WHERE state = 'done' AND ocrtext != '' AND position = 8 GROUP BY top ORDER BY cnt DESC LIMIT 1").fetchone()
    best_bottom = c.execute("SELECT bottom, COUNT(bottom) cnt FROM ocrresult WHERE state = 'done' AND ocrtext != '' AND position = 2 GROUP BY bottom ORDER BY cnt DESC LIMIT 1").fetchone()
    best_height = c.execute("SELECT bottom+1-top, COUNT(bottom+1-top) cnt FROM ocrresult WHERE state = 'done' AND ocrtext != '' AND position = 2 GROUP BY bottom+1-top ORDER BY cnt DESC LIMIT 1").fetchone()
    best_top = best_top[0] if best_top is not None else 10
    best_bottom = best_bottom[0] if best_bottom is not None else 10
    best_height = best_height[0] if best_height is not None else c.execute("SELECT bottom+1-top, COUNT(bottom+1-top) cnt FROM ocrresult WHERE state = 'done' AND ocrtext != '' GROUP BY bottom+1-top ORDER BY cnt DESC LIMIT 1").fetchone()[0]
    f = open(outfile, 'w', encoding='utf_8_sig', newline='\r\n')
    s = gconfig['ass_format']['header']
    s = s.replace('{{文件名}}', os.path.basename(video))
    s = s.replace('{{视频宽度}}', str(width))
    s = s.replace('{{视频高度}}', str(height))
    s = s.replace('{{字幕高度}}', str(best_height))
    s = s.replace('{{上半屏顶边距}}', str(best_top))
    s = s.replace('{{下半屏底边距}}', str(height-best_bottom-1))
    f.write(s)
    for frame_start, frame_end, ocrtext, top, bottom, position in row:
        s = gconfig['ass_format']['bottom_half' if position == 2 else 'top_half']
        start_time = frame2timestr(frame_start, fps, gconfig['ass_format']['time_alignment']['start'])
        end_time = frame2timestr(frame_end+1, fps, gconfig['ass_format']['time_alignment']['end'])
        s = s.replace('{{开始时间}}', start_time)
        s = s.replace('{{结束时间}}', end_time)
        s = s.replace('{{字幕文本}}', ocrtext.replace('\n', '\\N'))
        f.write(s)
    f.close()
    log('已导出至：%s'%outfile, 'S', db=conn)
    conn.commit()
    return 'ok'

@app.route('/exportcsv', methods=['POST'])
@session_header_required
def serve_exportcsv():
    outfile = os.path.splitext(video)[0] + gconfig['export_suffix'] + '.csv'
    output = io.StringIO()
    row = c.execute('SELECT * FROM ocrresult ORDER BY frame_start,frame_end,top,bottom,engine,id').fetchall()
    col = [x[0] for x in c.description]
    w = csv.writer(output)
    w.writerow(col)
    for r in row:
        w.writerow(map(lambda x: x if x is not None else 'SQLITE_NULL', r))
    if os.path.exists(outfile) and not gconfig['export_overwrite']:
        log('输出文件已存在，请先删除：%s'%outfile, 'E', db=conn)
        output.close()
        conn.commit()
        return ''
    with open(outfile, 'wb') as f:
        f.write(output.getvalue().encode('utf_8_sig'))
    log('已导出至：%s'%outfile, 'S', db=conn)
    output.close()
    conn.commit()
    return 'ok'

@app.route('/importcsv', methods=['POST'])
@session_header_required
def serve_importcsv():
    try:
        with conn:
            csvfile = flask.request.files['csv'].read()
            encoding = 'utf_8_sig' if csvfile.startswith(b'\xEF\xBB\xBF') else None
            r = csv.reader(io.TextIOWrapper(io.BytesIO(csvfile), encoding=encoding))
            col = next(r)
            colmap = dict([(c, i) for i, c in enumerate(col)])
            coltype = dict(c.execute("SELECT name,type FROM pragma_table_info('ocrresult')").fetchall())
            def convertvalue(v, c):
                if v == 'SQLITE_NULL':
                    return None
                if coltype[c].startswith('INT'):
                    return int(v)
                return v
            ins = []
            upd = []
            asnew = int(flask.request.form['asnew'])
            for row in r:
                id = row[colmap['id']]
                if id == '':
                    continue
                if int(id) == 0 or asnew:
                    ins.append(tuple([convertvalue(v, c) for v, c in zip(row, col) if c != 'id']))
                else:
                    upd.append(tuple([convertvalue(v, c) for v, c in zip(row, col) if c != 'id'] + [int(id)]))

            checkpoint(flask.request.form['checkpoint'])
            # FIXME: sql inject
            c.executemany('UPDATE ocrresult SET ' + ','.join([c + ' = ?' for c in col if c != 'id']) + ' WHERE id = ?', upd)
            updcnt = c.rowcount
            c.executemany('INSERT INTO ocrresult (' + ','.join([c for c in col if c != 'id']) + ') VALUES (' + ','.join(['?' for c in col if c != 'id']) + ')', ins)
            inscnt = c.rowcount
            log('导入CSV文件成功，修改了%d条字幕，新增了%d条字幕'%(updcnt,inscnt), 'S', db=conn)
    except Exception:
        traceback.print_exc()
        log('导入CSV文件失败，请查看控制台中的错误详细信息', 'E', db=conn)
        conn.commit()
    return ''

@app.route('/checkpoint', methods=['POST'])
@session_header_required
def serve_checkpoint():
    data = flask.request.get_json()
    msg = data['msg']
    checkpoint(msg)
    conn.commit()
    return ''

@app.route('/rollback', methods=['POST'])
@session_header_required
def serve_rollback():
    if init_thread.is_alive():
        log('请等待后端启动完成', 'E', db=conn)
        conn.commit()
        return ''
    if ocr_thread is not None and ocr_thread.is_alive():
        log('请先暂停OCR任务', 'E', db=conn)
        conn.commit()
        return ''
    data = flask.request.get_json()
    checkpoint_id = data['checkpoint_id']
    err, msg = rollback(checkpoint_id)
    if err is None:
        log('已还原到恢复点 #%d %s'%(checkpoint_id, msg), 'S', db=conn)
        checkwaitocr(db=conn)
    else:
        log('无法还原到恢复点 #%d (%s)'%(checkpoint_id, err), 'E', db=conn)
    conn.commit()
    return ''

@app.route('/loadconfig', methods=['POST'])
@session_header_required
def serve_loadconfig():
    data = flask.request.get_json()
    value = getconfig(conn, data['key'])
    if value:
        return value
    default_value = json.dumps(data['default_value'])
    c.execute('INSERT INTO config VALUES (?, ?)', (data['key'], default_value))
    conn.commit()
    return default_value

@app.route('/saveconfig', methods=['POST'])
@session_header_required
def serve_saveconfig():
    data = flask.request.get_json()
    putconfig(conn, data['key'], json.dumps(data['value']))
    msg = data['msg'] if 'msg' in data else ('%s设置已保存' % data['key'])
    if len(msg):
        log(msg, 'I', db=conn)
    conn.commit()
    return ''

@app.route('/allengines', methods=['POST'])
@session_header_required
def serve_allengines():
    return flask.jsonify(gconfig['allengines'])

@app.route('/updateresult', methods=['POST'])
@session_header_required
def serve_updateresult():
    data = flask.request.get_json()
    checkpoint_id = None
    if data['checkpoint']:
        checkpoint_id = checkpoint(data['checkpoint'], not data['compatlog'])
    cols = [x[0] for x in c.execute("SELECT name FROM pragma_table_info('ocrresult')").fetchall() if x[0] != 'id']
    upd = []
    ins = []
    for item in data['changes']:
        if 'id' in item and item['id'] > 0:
            if all(col in item for col in cols):
                upd.append(tuple([item[col] for col in cols] + [item['id']]))
            else:
                curcols = [col for col in cols if col in item]
                c.execute('UPDATE ocrresult SET ' + ','.join([c + ' = ?' for c in curcols]) + ' WHERE id = ?', tuple(item[c] for c in curcols) + (item['id'],))
        else:
            ins.append(tuple([item[col] for col in cols]))
    c.executemany('UPDATE ocrresult SET ' + ','.join([c + ' = ?' for c in cols]) + ' WHERE id = ?', upd)
    updcnt = c.rowcount
    c.executemany('INSERT INTO ocrresult (' + ','.join([c for c in cols]) + ') VALUES (' + ','.join(['?' for c in cols]) + ')', ins)
    inscnt = c.rowcount
    c.execute("DELETE FROM ocrresult WHERE state = 'delete'")
    delcnt = c.rowcount
    if data['message']:
        log(data['message'], 'S', db=conn, checkpoint_id=checkpoint_id if data['compatlog'] else None)
    conn.commit()
    return flask.jsonify({
        'updcnt': updcnt,
        'inscnt': inscnt,
        'delcnt': delcnt,
    })

@app.route('/loadresult', methods=['POST'])
@session_header_required
def serve_loadresult():
    return db2json(conn, 'SELECT * FROM ocrresult LEFT JOIN imgdb USING (imgdb_id)')

@app.route('/startocr', methods=['POST'])
@session_header_required
def serve_startocr():
    if init_thread.is_alive():
        log('请等待后端启动完成', 'E', db=conn)
        conn.commit()
        return ''
    ocrconf = json.loads(getconfig(conn, 'OCR'))
    ocrengine, ocrtop, ocrbottom = ocrconf['engine'], ocrconf['top'], ocrconf['bottom']
    ocrleft, ocrright = 0, width-1
    position = 2 if ocrbottom >= height // 2 else 8
    if ocrtop < 0 or ocrbottom < 0:
        log('请先指定字幕在屏幕上的范围', 'E', db=conn)
        conn.commit()
        return ''
    if ocr_thread is not None and ocr_thread.is_alive():
        log('已有OCR任务运行中，无法启动新任务', 'E', db=conn)
        conn.commit()
        return ''
    checkpoint('“新OCR”之前 [%s]'%ocrengine)
    data = flask.request.get_json()
    frame_range = data['frame_range']
    if frame_range is None:
        frame_range = list(range(0, nframes))
    c.execute('DELETE FROM jobrange')
    for frame_id in sorted(frame_range):
        c.execute("INSERT INTO ocrresult (date, state, frame_start, frame_end, engine, left, top, right, bottom, position) VALUES (datetime('now','localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?)", ('waitocr', frame_id, frame_id, ocrengine, ocrleft, ocrtop, ocrright, ocrbottom, position))
        c.execute('INSERT INTO jobrange VALUES (?)', (c.lastrowid,))
    log('OCR任务已提交 [%s]'%ocrengine, db=conn)
    conn.commit()
    startocr()
    return 'ok'

@app.route('/stopocr', methods=['POST'])
@session_header_required
def serve_stopocr():
    global ocr_stop
    if ocr_thread is None or not ocr_thread.is_alive():
        log('无运行中的OCR任务', 'I', db=conn)
        conn.commit()
        return ''
    ocr_stop = True
    log('暂停请求已提交', 'I', db=conn)
    conn.commit()
    return ''

@app.route('/continueocr', methods=['POST'])
@session_header_required
def serve_continueocr():
    if init_thread.is_alive():
        log('请等待后端启动完成', 'E', db=conn)
        conn.commit()
        return ''
    if ocr_thread is not None and ocr_thread.is_alive():
        log('已有OCR任务运行中，无法启动新任务', 'E', db=conn)
        conn.commit()
        return ''
    data = flask.request.get_json()
    if data['item_range'] is not None:
        if len(data['item_range']) > 0:
            c.execute('DELETE FROM jobrange')
            c.executemany('INSERT INTO jobrange VALUES (?)', [(id,) for id in sorted(data['item_range'])])
    else:
        c.execute("INSERT OR IGNORE INTO jobrange SELECT id FROM ocrresult WHERE (state = 'waitocr' OR state = 'error')")
    restarttype = data['restarttype']
    new_engine = json.loads(getconfig(conn, 'OCR'))['engine']
    if restarttype == '':
        errcnt = c.execute("""
            SELECT COUNT(id) FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id) AND
                (state = 'error' OR state = 'waitocr')""").fetchone()[0]
        if errcnt == 0:
            log('没有任务要做', db=conn)
            conn.commit()
            return ''
        checkpoint('“继续OCR”之前 [%s]'%new_engine)
        c.execute("UPDATE ocrresult SET state = 'waitocr', engine = ? WHERE (state = 'waitocr' OR state = 'error') AND EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id)", (new_engine,))
    elif restarttype == 'all':
        donecnt = c.execute("""
            SELECT COUNT(id) FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id) AND
                (state = 'waitocr' OR state = 'error' OR state = 'waitocr' OR state = 'done')""").fetchone()[0]
        if donecnt == 0:
            log('没有任务要做', db=conn)
            conn.commit()
            return ''
        checkpoint('“重新OCR”之前 [%s]'%new_engine)
        c.execute("UPDATE ocrresult SET state = 'waitocr', engine = ? WHERE (state = 'waitocr' OR state = 'error' OR state = 'waitocr' OR state = 'done') AND EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id)", (new_engine,))
    elif restarttype == 'empty':
        emptycnt = c.execute("""
            SELECT COUNT(id) FROM ocrresult WHERE EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id) AND
                (state = 'done' AND ocrtext = '')""").fetchone()[0]
        if emptycnt == 0:
            log('没有任务要做', db=conn)
            conn.commit()
            return ''
        checkpoint('“空项OCR”之前 [%s]'%new_engine)
        c.execute("UPDATE ocrresult SET state = 'waitocr', engine = ? WHERE (state = 'done' AND ocrtext = '') AND EXISTS (SELECT * FROM jobrange WHERE ocrresult.id = jobrange.id)", (new_engine,))
    else:
        assert False
    log('OCR任务已提交 [%s]'%new_engine, db=conn)
    conn.commit()
    startocr()
    return 'ok'

@app.after_request
def add_header(response):
    response.cache_control.no_cache = True
    response.cache_control.no_store = True
    response.cache_control.must_revalidate = True
    response.cache_control.max_age = 0
    response.expires = werkzeug.http.parse_date('Thu, 19 Nov 1981 08:52:00 GMT')
    response.headers['Pragma'] = 'no-cache'
    response.close_connection = True
    return response

app.run(threaded=False, host=host, port=port)
