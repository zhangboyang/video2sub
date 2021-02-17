#!/usr/bin/env python3
import ast
import sys
import os
import subprocess
import json
import urllib.request
import time
import traceback
import sqlite3
if os.name == 'nt':
    import win32gui
    import win32con
    windows = True
else:
    windows = False

sys.stdout.reconfigure(errors='replace')
sys.stderr.reconfigure(errors='replace')

if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    bundle_dir = sys._MEIPASS
else:
    bundle_dir = os.path.dirname(os.path.abspath(__file__))

os.chdir(bundle_dir)

EXTENSIONS_VIDEO = "*.3g2;*.3gp;*.3gp2;*.3gpp;*.amv;*.asf;*.avi;*.bik;*.bin;*.crf;*.dav;*.divx;*.drc;*.dv;*.dvr-ms;*.evo;*.f4v;*.flv;*.gvi;*.gxf;*.iso;*.m1v;*.m2v;" \
    "*.m2t;*.m2ts;*.m4v;*.mkv;*.mov;*.mp2;*.mp2v;*.mp4;*.mp4v;*.mpe;*.mpeg;*.mpeg1;" \
    "*.mpeg2;*.mpeg4;*.mpg;*.mpv2;*.mts;*.mtv;*.mxf;*.mxg;*.nsv;*.nuv;" \
    "*.ogg;*.ogm;*.ogv;*.ogx;*.ps;" \
    "*.rec;*.rm;*.rmvb;*.rpl;*.thp;*.tod;*.tp;*.ts;*.tts;*.txd;*.vob;*.vro;*.webm;*.wm;*.wmv;*.wtv;*.xesc"

gconfig = ast.literal_eval(open('config.txt', 'r', encoding='utf_8_sig').read())
url = 'http://127.0.0.1:%d' % gconfig['port']
backend = None
frontend = None
session = None
lastwatch = None
video = None

def exe(path):
    if windows:
        root, ext = os.path.splitext(path)
        if ext == '.py':
            if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
                ext = '.exe'
            else:
                return ['python', path]
        return [root + ext]
    else:
        if os.path.isabs(path):
            return [path]
        else:
            return [os.path.join('.', path)]

def run_backend(file, silent=False, nosession=False):
    global backend
    global video
    global session
    global lastwatch
    video = os.path.basename(file)
    backend = subprocess.Popen(exe('video2sub.py') + [file], stdout=subprocess.DEVNULL if silent else None, stderr=subprocess.DEVNULL if silent else None)
    session = None
    lastwatch = None
    if api('/getpid') != backend.pid:
        raise Exception("pid mismatch")
    if not nosession:
        session = api('/session')

def check_backend():
    if backend.poll() is not None:
        raise Exception('backend died')

def run_frontend():
    global frontend
    apppath = 'APP-win32-x64' if windows else 'APP-linux-x64'
    appexe = 'APP'
    with open(os.path.join(apppath, 'resources', 'app', 'nativefier.json'), 'r+', encoding='utf-8') as f:
        conf = json.load(f)
        conf['targetUrl'] = url
        f.seek(0)
        f.truncate()
        json.dump(conf, f)
    frontend = subprocess.Popen(exe(os.path.join(apppath, appexe)), close_fds=True)

def api(path, data=b'', retry=True):
    while True:
        try:
            req = urllib.request.Request(url + path)
            if session is not None:
                req.add_header('X-VIDEO2SUB-SESSION', session)
            if data is not None and type(data) is not bytes:
                data = json.dumps(data).encode('utf-8')
                req.add_header('Content-Type', 'application/json')
            req.data = data
            req = urllib.request.urlopen(req, timeout=5)
            rsp = req.read()
            try:
                return json.loads(rsp.decode('utf-8'))
            except:
                return rsp
        except urllib.error.HTTPError as e:
            raise e
        except Exception as e:
            check_backend()
            if not retry:
                return None
            time.sleep(0.1)

def watch():
    global lastwatch
    if lastwatch is None:
        with sqlite3.connect(':memory:') as db:
            lastwatch = (db.cursor().execute("SELECT datetime('now','localtime')").fetchone()[0], 0)
    logs = api('/logs')
    for arr in logs['row']:
        row = dict(zip(logs['col'], arr))
        curr = (row['date'], row['id'])
        if curr > lastwatch:
            print(video, '#', row['date'], '#', row['level'], row['message'])
            lastwatch = curr

try:
    files = sys.argv[1:]
    if windows and len(files) == 0:
        print('请选择文件')
        print('  若只指定一个视频文件，则使用图形界面模式')
        print('  若指定多个视频文件，则使用批处理模式')
        print()
        try:
            ret = win32gui.GetOpenFileNameW(
                MaxFile=1048576,
                Flags=
                    win32con.OFN_ALLOWMULTISELECT |
                    win32con.OFN_PATHMUSTEXIST |
                    win32con.OFN_FILEMUSTEXIST |
                    win32con.OFN_HIDEREADONLY |
                    win32con.OFN_EXPLORER |
                    win32con.OFN_DONTADDTORECENT |
                    win32con.OFN_NOCHANGEDIR,
                Filter='视频文件 (%s)\0%s\0所有文件 (*.*)\0*.*\0'%(EXTENSIONS_VIDEO, EXTENSIONS_VIDEO))
            files = ret[0].split('\0')
            if len(files) > 1:
                files = [os.path.join(files[0], file) for file in files[1:]]
        except win32gui.error:
            pass
    if len(files) == 0:
        print('使用方法：')
        print('  %s [视频文件...]'%os.path.basename(sys.argv[0]))
        print('若只指定一个视频文件，则使用图形界面模式')
        print('若指定多个视频文件，则使用批处理模式')
    elif len(files) == 1:
        print('图形界面模式')
        run_backend(files[0], nosession=True)
        run_frontend()
        frontend.wait()
        backend.kill()
    elif len(files) > 1:
        start_time = time.time()
        print('批处理模式')
        print('将要按顺序处理以下文件：\n  '+'\n  '.join(map(os.path.basename, files)))
        print('正从第一个文件“%s”中读取OCR设置'%os.path.basename(files[0]))
        run_backend(files[0], silent=True)
        ocrconfig = api('/loadconfig', {'key':'OCR'})
        backend.kill()
        print('将要使用的OCR设置:', ocrconfig)
        success = 0
        for file in files:
            print('正处理:', os.path.basename(file))
            run_backend(file, silent=True)
            time.sleep(1)
            file_start_time = time.time()
            while not api('/state')['loaded']:
                watch()
                time.sleep(1)
            watch()
            info = api('/info')
            for i in range(9999999):
                state = api('/state')
                if state['nresult'] == 0 or state['nwaitocr'] > 0 or state['nerror'] > 0:
                    if i > 10:
                        print('重试次数过多，已放弃')
                        break
                    if i > 0:
                        print('重试(第%d次)'%i)
                    api('/saveconfig', {'key':'OCR', 'value':ocrconfig, 'msg':'设定批处理OCR设置: '+str(ocrconfig)})
                    if state['nresult'] == 0:
                        print('数据库中无任何OCR记录, 执行“新OCR”操作')
                        ret = api('/startocr', {'ocr_start':0, 'ocr_end':info['nframes']})
                    else:
                        print('数据库中有待处理的项目，执行“继续OCR”操作')
                        ret = api('/continueocr', {'ocr_start':0, 'ocr_end':info['nframes'], 'restarttype':''})
                    if ret == b'ok':
                        while api('/state')['ocrjob']:
                            watch()
                            time.sleep(1)
                    else:
                        watch()
                        print('无法启动OCR任务，请检查第一个文件的OCR设置是否正确')
                        break
                    watch()
                else:
                    print('没有要做的任务' if i == 0 else '任务已完成')
                    success += 1
                    break
            backend.kill()
            print('耗时%.2f秒'%(time.time() - file_start_time))
        print('共%d个文件，成功%d个，耗时%.2f秒'%(len(files),success,time.time()-start_time))
except:
    traceback.print_exc()

if backend:
    backend.kill()
if frontend:
    frontend.kill()
