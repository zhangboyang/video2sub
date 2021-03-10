#!/usr/bin/env python3
import ast
import sys
import os
import subprocess
import json
import urllib.request
import time
import traceback
import secrets
import socket
from threading import Thread
from datetime import datetime
if os.name == 'nt':
    import win32con
    import win32console
    import win32api
    import win32gui
    import win32file
    import winerror
    windows = True
else:
    import signal
    import fcntl
    windows = False

if windows:
    class LockedFileWriter:
        def __init__(self, path):
            while True:
                try:
                    self.handle = win32file.CreateFile(path, win32file.GENERIC_READ | win32file.GENERIC_WRITE, win32file.FILE_SHARE_READ, None, win32file.TRUNCATE_EXISTING, 0, None)
                    break
                except win32file.error as e:
                    if e.winerror != winerror.ERROR_SHARING_VIOLATION:
                        raise e
                    time.sleep(0.1)
        def write(self, b):
            n = win32file.WriteFile(self.handle, b)[1]
            assert n == len(b)
        def close(self):
            self.handle.Close()
    def file_select(title, flt):
        try:
            ret = win32gui.GetOpenFileNameW(
                hwndOwner=win32console.GetConsoleWindow(),
                Title=title,
                MaxFile=1048576,
                Flags=
                    win32con.OFN_ALLOWMULTISELECT |
                    win32con.OFN_PATHMUSTEXIST |
                    win32con.OFN_FILEMUSTEXIST |
                    win32con.OFN_HIDEREADONLY |
                    win32con.OFN_EXPLORER |
                    win32con.OFN_DONTADDTORECENT |
                    win32con.OFN_NOCHANGEDIR,
                Filter=flt)
            files = ret[0].split('\0')
            if len(files) > 1:
                files = [os.path.join(files[0], file) for file in files[1:]]
            return files
        except win32gui.error:
            return []
    class ListSelectDialog:
        className = 'VIDEO2SUB_SELECTDLG'
        def __init__(self, title, msg, lst):
            self.title = title
            self.msg = msg
            self.lst = lst
            self.selitem = None
            wc = win32gui.WNDCLASS()
            wc.style = win32con.CS_VREDRAW | win32con.CS_HREDRAW
            wc.SetDialogProc()
            wc.cbWndExtra = win32con.DLGWINDOWEXTRA
            wc.hInstance = win32gui.dllhandle
            wc.hCursor = win32gui.LoadCursor(0, win32con.IDC_ARROW)
            wc.hbrBackground = win32con.COLOR_WINDOW + 1
            wc.lpszClassName = self.className
            try:
                win32gui.RegisterClass(wc)
            except win32gui.error as e:
                if e.winerror != winerror.ERROR_CLASS_ALREADY_EXISTS:
                    raise e
        def DoModel(self):
            style = win32con.DS_SETFONT | win32con.DS_MODALFRAME | win32con.WS_POPUP | win32con.WS_SYSMENU | win32con.WS_VISIBLE | win32con.WS_CAPTION | win32con.CS_DBLCLKS
            s = win32con.WS_CHILD | win32con.WS_VISIBLE
            win32gui.DialogBoxIndirect(win32gui.dllhandle, [
                [self.title, (0, 0, 180, 148), style, None, (12, "宋体"), None, self.className],
                [128, "确定", win32con.IDOK, (68, 127, 50, 14), s | win32con.WS_TABSTOP | win32con.BS_DEFPUSHBUTTON],
                [128, "取消", win32con.IDCANCEL, (123, 127, 50, 14), s | win32con.WS_TABSTOP | win32con.BS_PUSHBUTTON],
                [130, self.msg, -1, (7, 7, 166, 13), s | win32con.SS_LEFT],
                [131, None, 1000, (7, 22, 166, 98), s | win32con.WS_TABSTOP | win32con.LBS_NOINTEGRALHEIGHT | win32con.LBS_NOTIFY | win32con.WS_VSCROLL | win32con.WS_BORDER]
            ], win32console.GetConsoleWindow(), {
                win32con.WM_COMMAND: self.OnCommand,
                win32con.WM_INITDIALOG: self.OnInitDialog,
            })
        def OnCommand(self, hwnd, msg, wparam, lparam):
            if wparam == win32con.IDCANCEL:
                self.selitem = None
                win32gui.EndDialog(hwnd, 0)
            elif wparam == win32con.IDOK or (win32api.LOWORD(wparam) == 1000 and win32api.HIWORD(wparam) == win32con.LBN_DBLCLK):
                listbox = win32gui.GetDlgItem(hwnd, 1000)
                sel = win32gui.SendMessage(listbox, win32con.LB_GETCURSEL, 0, 0)
                self.selitem = self.lst[sel] if 0 <= sel and sel < len(self.lst) else None
                if self.selitem is not None:
                    win32gui.EndDialog(hwnd, 0)
                else:
                    win32api.MessageBox(hwnd, '请从列表中选择一个项目', self.title, win32con.MB_ICONWARNING)
        def OnInitDialog(self, hwnd, msg, wparam, lparam):
            l, t, r, b = win32gui.GetWindowRect(hwnd)
            pl, pt, pr, pb = win32gui.GetWindowRect(win32gui.GetParent(hwnd) if win32gui.GetParent(hwnd) else win32gui.GetDesktopWindow())
            xoff = ((pr - pl) - (r - l)) // 2
            yoff = ((pb - pt) - (b - t)) // 2
            win32gui.SetWindowPos(hwnd, win32con.HWND_TOP, pl + xoff, pt + yoff, 0, 0, win32con.SWP_NOSIZE)
            listbox = win32gui.GetDlgItem(hwnd, 1000)
            for item in self.lst:
                win32gui.SendMessage(listbox, win32con.LB_ADDSTRING, 0, item[1])
            #win32gui.SendMessage(listbox, win32con.LB_SETCURSEL, 0, 0)
    def list_select(title, msg, lst):
        print('请在弹出的窗口中进行选择')
        dlg = ListSelectDialog(title, msg, lst)
        dlg.DoModel()
        return dlg.selitem
else:
    class LockedFileWriter:
        def __init__(self, path):
            self.f = open(path, 'r+b')
            fcntl.flock(self.f.fileno(), fcntl.LOCK_EX)
            self.f.seek(0)
            self.f.truncate()
        def write(self, b):
            n = self.f.write(b)
            assert n == len(b)
            self.f.flush()
        def close(self):
            self.f.close()
    def list_select(title, msg, lst):
        print(msg + ':')
        for i, item in enumerate(lst):
            print('  %d. %s' % (i + 1, item[1]))
        while True:
            print('请输入编号: ', end='', flush=True)
            try:
                sel = int(input())
                if 1 <= sel and sel <= len(lst):
                    return lst[sel - 1]
            except ValueError:
                pass
            print('无效输入')

sys.stdout.reconfigure(errors='replace')
sys.stderr.reconfigure(errors='replace')

if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    bundle_dir = os.path.abspath(sys._MEIPASS)
else:
    bundle_dir = os.path.dirname(os.path.abspath(__file__))

EXTENSIONS_VIDEO = "*.3g2;*.3gp;*.3gp2;*.3gpp;*.amv;*.asf;*.avi;*.bik;*.bin;*.crf;*.dav;*.divx;*.drc;*.dv;*.dvr-ms;*.evo;*.f4v;*.flv;*.gvi;*.gxf;*.iso;*.m1v;*.m2v;" \
    "*.m2t;*.m2ts;*.m4v;*.mkv;*.mov;*.mp2;*.mp2v;*.mp4;*.mp4v;*.mpe;*.mpeg;*.mpeg1;" \
    "*.mpeg2;*.mpeg4;*.mpg;*.mpv2;*.mts;*.mtv;*.mxf;*.mxg;*.nsv;*.nuv;" \
    "*.ogg;*.ogm;*.ogv;*.ogx;*.ps;" \
    "*.rec;*.rm;*.rmvb;*.rpl;*.thp;*.tod;*.tp;*.ts;*.tts;*.txd;*.vob;*.vro;*.webm;*.wm;*.wmv;*.wtv;*.xesc"

class BackendDiedError(Exception):
    pass

fail = False

gconfig = ast.literal_eval(open(os.path.join(bundle_dir, 'config.txt'), 'r', encoding='utf_8_sig').read())
url = None
backend = None
frontend = None
session = None
lastwatch = 0
video = None
backendlog = None
backendlog_file = os.path.join(bundle_dir, 'backendlog_%s_%d.txt' % (datetime.now().strftime('%Y%m%d_%H%M%S'), os.getpid()))
backendlog_preserve = False

def alloc_hostport():
    host = gconfig['host']
    port_range = list(range(*gconfig['port']))
    while len(port_range) > 0:
        port = secrets.choice(port_range)
        port_range = [p for p in port_range if p != port]
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return (host, port)
            except:
                pass
    raise Exception('无可用后端通信端口')

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
    global url
    global video
    global session
    global lastwatch
    global backendlog
    hostport = alloc_hostport()
    cmdline = exe('video2sub.py') + [hostport[0], str(hostport[1]), file]
    if silent:
        if backendlog is not None:
            backendlog.close()
        with open(backendlog_file, 'a', errors='replace') as f:
            f.write('>>>>> [%s] >>>>> %s\n' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), json.dumps(cmdline, ensure_ascii=False)))
        backendlog = open(backendlog_file, 'ab')
    backend = subprocess.Popen(cmdline, stdout=backendlog if silent else None, stderr=subprocess.STDOUT if silent else None)
    video = os.path.basename(file)
    url = 'http://%s:%d' % hostport
    session = None
    lastwatch = 0
    if api('/getpid') != backend.pid:
        raise Exception("pid mismatch")
    if not nosession:
        session = api('/session')
        waitsec = 0.1
        while not api('/state')['loaded']:
            watch()
            time.sleep(waitsec)
            waitsec = min(waitsec * 2, 1)
        watch()

def check_backend():
    if backend.poll() is not None:
        raise BackendDiedError()

def run_frontend():
    global frontend
    apppath = 'APP-win32-x64' if windows else 'APP-linux-x64'
    appexe = 'APP'
    appconf = os.path.join(apppath, 'resources', 'app', 'nativefier.json')
    with open(appconf + '-template', 'r', encoding='utf-8') as f:
        conf = json.load(f)
    conf['targetUrl'] = url
    w = LockedFileWriter(appconf)
    w.write(json.dumps(conf, ensure_ascii=False, separators=(',', ':')).encode())
    frontend = subprocess.Popen(exe(os.path.join(apppath, appexe)) + ['--disable-smooth-scrolling'], close_fds=True)
    waitsec = 0.1
    while not api('/havesession'):
        time.sleep(waitsec)
        waitsec = min(waitsec * 2, 1)
    w.close()

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
            req = urllib.request.urlopen(req)
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
    logs = api('/logs')
    for arr in logs['row']:
        row = dict(zip(logs['col'], arr))
        if row['cursession'] and row['id'] > lastwatch:
            print(video, '#', row['date'], '#', row['level'], row['message'])
            lastwatch = row['id']

try:
    files = sys.argv[1:]
    if windows and len(files) == 0:
        print('请从弹出的窗口中选择要处理的文件')
        print('  若只指定一个文件，则使用图形界面模式')
        print('  若指定多个文件，则使用批处理模式')
        print()
        files = file_select('请选择要处理的文件', '视频文件 (%s)\0%s\0video2sub 数据库文件 (*.v2s)\0*.v2s\0所有文件 (*.*)\0*.*\0'%(EXTENSIONS_VIDEO, EXTENSIONS_VIDEO))
    files = [os.path.abspath(p) for p in files]
    os.chdir(bundle_dir)
    if len(files) == 0:
        print('使用方法:')
        print('  %s [视频/数据库文件...]'%os.path.basename(sys.argv[0]))
        print('若只指定一个文件，则使用图形界面模式')
        print('若指定多个文件，则使用批处理模式')
    elif len(files) == 1:
        print('图形界面模式')
        print('=====')
        run_backend(files[0], nosession=True)
        run_frontend()
        frontend.wait()
    elif len(files) > 1:
        print('批处理模式')
        print('=====')
        print('文件列表:\n  '+'\n  '.join(map(os.path.basename, files)))
        print('=====')
        op = list_select('批处理模式', '已选择%d个文件，请选择要执行的操作'%len(files), [
            ('ocr', '批量OCR'),
            ('exportass', '批量导出ASS'),
            ('exportcsv', '批量导出CSV'),
            ('gui', '同时打开多个图形界面进行操作'),
        ])
        if op is not None:
            print('操作:', op[1])
            op = op[0]
        else:
            print('没有选择操作')
        print('=====')
        start_time = time.time()
        success = 0
        if op is None:
            success = -1
        elif op == 'ocr':
            print('正从第一个文件“%s”中读取OCR设置'%os.path.basename(files[0]))
            run_backend(files[0], silent=True)
            ocrconfig = api('/loadconfig', {'key':'OCR'})
            backend.kill()
            backend.wait()
            print('将要使用的OCR设置:', ocrconfig)
            print('=====')
            for file in files:
                print('正处理:', os.path.basename(file))
                run_backend(file, silent=True)
                file_start_time = time.time()
                for i in range(9999999):
                    api('/saveconfig', {'key':'OCR', 'value':ocrconfig, 'msg':'设定批处理OCR设置: '+str(ocrconfig)})
                    state = api('/state')
                    if state['lastjob'] > 0 or state['curarea'] == 0:
                        if i > 10:
                            print('迭代次数过多，已放弃')
                            break
                        if i > 0:
                            print('迭代（第%d次）'%i)

                        if state['lastjob'] > 0:
                            print('数据库中有未处理完毕的项目，执行“继续OCR”操作')
                            ret = api('/continueocr', {'item_range': None, 'restarttype': ''})
                        elif state['curarea'] == 0:
                            print('数据库中无该OCR区域的项目，执行“新OCR”操作')
                            ret = api('/startocr', {'frame_range': None})
                        else:
                            assert False

                        if ret == b'ok':
                            while api('/state')['ocractive']:
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
                backend.wait()
                print('耗时%.2f秒'%(time.time() - file_start_time))
                print('=====')
        elif op.startswith('export'):
            for file in files:
                print('正处理:', os.path.basename(file))
                run_backend(file, silent=True)
                if api('/' + op) == b'ok':
                    success += 1
                watch()
                backend.kill()
                backend.wait()
                print('=====')
        elif op == 'gui':
            success = -1
            children = []
            waiters = []
            def do_wait(i):
                children[i].wait()
                print('已退出:', os.path.basename(files[i]))
            def do_join():
                for waiter in waiters:
                    waiter.join()
            try:
                for i, file in enumerate(files):
                    if i > 0:
                        time.sleep(1)
                    print('正打开:', os.path.basename(file))
                    children.append(subprocess.Popen(exe('launcher.py') + [file], close_fds=True))
                    waiters.append(Thread(target=do_wait, args=(i,)))
                    waiters[i].start()
                if windows:
                    joiner = Thread(target=do_join)
                    joiner.start()
                    while joiner.is_alive(): # avoid join() which can't be interrupted
                        time.sleep(1)
                else:
                    do_join()
            except:
                traceback.print_exc()
            if not windows:
                for child in children:
                    child.send_signal(signal.SIGINT)
            do_join()
        else:
            assert False
        if success >= 0:
            print('共%d个文件，成功%d个，失败%d个，耗时%.2f秒'%(len(files), success, len(files)-success, time.time()-start_time))
            if success != len(files):
                backendlog_preserve = True
        if windows:
            print('按回车退出程序')
            input()
except KeyboardInterrupt:
    print('手动中断')
except Exception as e:
    if isinstance(e, BackendDiedError):
        print('（后端异常退出）')
    else:
        print('===== 异常 =====')
        traceback.print_exc()
    if backendlog is not None:
        backendlog.close()
        with open(backendlog_file, 'r', errors='replace') as f:
            lines = f.readlines()
            for i in range(len(lines)):
                if lines[-i - 1].startswith('>>>>>'):
                    lines = lines[-i:] if i > 0 else []
                    break
            maxshow = 50
            if len(lines) > maxshow:
                print('===== 后端日志的最后 %d 行 ====='%maxshow)
                lines = lines[-maxshow:]
            else:
                print('===== 后端日志 =====')
            print(''.join(lines), end='')
    fail = True
except:
    traceback.print_exc()
    fail = True

if backend:
    backend.kill()
    backend.wait()
if frontend:
    frontend.kill()
    frontend.wait()

if backendlog is not None:
    backendlog.close()
    if not fail and not backendlog_preserve and os.path.exists(backendlog_file):
        os.remove(backendlog_file)
    else:
        print('（后端日志已存储为: %s）'%backendlog_file)

if fail:
    print('=====')
    if windows:
        print('遇到致命错误，按回车退出程序')
        input()
    else:
        print('遇到致命错误')
    sys.exit(1)
else:
    sys.exit(0)
