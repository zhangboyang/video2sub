"use strict";

let app = null;
let geval = eval;

function lower_bound(arr, compare) {
  let first = 0, last = arr.length - 1, middle;
  while (first <= last) {
    middle = 0 | (first + last) / 2;
    if (compare(arr[middle])/*arr[middle] < n*/) first = middle + 1;
    else last = middle - 1;
  }
  return first;
}

function ziprow(col, arr) {
  let obj = {};
  col.forEach((key, i) => obj[key] = arr[i]);
  return obj;
}
function array_equal(a, b) {
  let n = a.length;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
function array_cmp(a, b) {
  let n = a.length;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

let lastresult = '';
let ocrresult = {col:[],row:[]};
let colmap = {};
let tblitem = []; // { ele: <tr>, sortkey: [], r: [c1, c2...] }
let id2item = new Map(); // id => item

function updateselect() {
  //console.log('updateselect');
  let sel_start = app.timesel[0];
  let sel_end = app.timesel[1];
  let notselall = sel_start != 0 || sel_end != app.info.nframes - 1;
  let max_end = -1000;
  tblitem.forEach((item) => {
    let frame_start = item.r[colmap['frame_start']];
    let frame_end = item.r[colmap['frame_end']];
    let tag = [];
    if (frame_start <= max_end + 1) {
      tag.push('sticky');
    }
    if (notselall && sel_start <= frame_start && frame_start <= sel_end) {
      tag.push('sel');
    }
    if (frame_start <= app.pos && app.pos <= frame_end) {
      tag.push('cur');
    }
    let tagstr = tag.join(' ');
    if (item.ele.dataset.tag != tagstr) {
      item.ele.dataset.tag = tagstr;
    }
    max_end = Math.max(max_end, frame_end);
  });
}
function tblop(e) {
  e.preventDefault();
  let item = this.mytblitem;
  let r = ziprow(ocrresult.col, item.r);
  app.timesel = [app.pos, r.frame_start].sort((a,b)=>a-b);
}
function tbllock(item) {
  if (item) {
    item.locked = true;
    item.ele.dataset.lock = 'locked';
  }
}
function updatetbledit() {
  if (app.curedit) {
    let item = id2item.get(app.curedit[colmap['id']]);
    item = item ? item : null;
    tbledit(item);
  }
}
function tbledit(item, scrolltype) {
  if (item) {
    app.setframepos(item.r[colmap['frame_start']], scrolltype);
    app.curedit = JSON.parse(JSON.stringify(item.r));
  } else {
    app.curedit = null;
  }
}
function tblclick(e) {
  if (e.shiftKey) {
    tblop.call(this, e);
    return;
  }
  let item = this.mytblitem;
  tbledit(item);
}
function updateresult(jsonstr) {
  if (lastresult === jsonstr) {
    tblitem.forEach((item) => {
      if (item.locked) {
        item.locked = false;
        item.ele.dataset.lock = '';
      }
    });
    updatetbledit();
    return false;
  }
  ocrresult = JSON.parse(lastresult = jsonstr);

  let tableele = document.getElementById('ocrresult');

  let c = colmap;
  ocrresult.col.forEach((k, i) => c[k] = i);

  let domlast = tblitem.length;
  let domchange = 0;

  let needdelete = new Map(id2item);
  ocrresult.row.forEach((r, i) => needdelete.delete(r[c['id']]));
  needdelete.forEach((item, id) => id2item.delete(id));
  needdelete = new Set(needdelete.values());
  tblitem = tblitem.filter((item) => !needdelete.has(item));
  domchange += needdelete.size;

  let needupdate = new Set();
  ocrresult.row.forEach((r) => {
    let id = r[c['id']];
    let item = id2item.get(id);
    if (item === undefined) {
      item = { ele: null, sortkey: null, locked: false, mergedto: null, r: r };
      tblitem.push(item);
      id2item.set(id, item);
      domchange++;
    } else {
      item.locked = false;
      item.ele.dataset.lock = '';
      if (array_equal(item.r, r)) {
        return;
      }
      item.mergedto = null;
      item.r = r;
    }
    item.sortkey = [r[c['frame_start']], r[c['frame_end']], r[c['top']]];
    needupdate.add(item);
  });

  if (needdelete.size + needupdate.size === 0) {
    return false;
  }

  let rebuildtable = false;
  if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
    rebuildtable = domchange > Math.sqrt(domlast);
  }
  //console.log(domlast, domchange, rebuildtable);

  needdelete.forEach((item) => item.ele.remove());

  tblitem.sort((a, b) => array_cmp(a.sortkey, b.sortkey));
  let lastele = null;
  tblitem.forEach((item) => {
    if (needupdate.has(item)) {
      if (item.ele === null) {
        item.ele = document.createElement('tr');
        item.ele.mytblitem = item;
        for (let i = 0; i < 5; i++) {
          item.ele.appendChild(document.createElement('td'));
        }
        item.ele.addEventListener('click', tblclick);
        item.ele.addEventListener('mousedown', function (e) {
          if (e.shiftKey) {
            e.preventDefault();
          }
        });

        item.ele.children[0].innerText = '至此';
        item.ele.children[0].mytblitem = item;
        item.ele.children[0].addEventListener('click', tblop);
        item.ele.children[0].setAttribute('title', '设置操作范围为“当前选中项”至“此项”（Shift+单击条目也可执行此操作）');

        item.ele.dataset.sel = '';
        if (!rebuildtable) {
          if (lastele === null) {
            tableele.tBodies[0].prepend(item.ele);
          } else {
            lastele.after(item.ele);
          }
        }
      }
      let row = ziprow(ocrresult.col, item.r);
      item.ele.dataset.state = row.state;
      item.ele.dataset.empty = row.ocrtext == '' ? 'empty' : '';
      item.ele.children[1].innerText = row.frame_start + '-' + row.frame_end;
      item.ele.children[2].innerText = row.engine + '(' + row.top + '-' + row.bottom + ')';
      item.ele.children[3].textContent = row.state == 'done' ? (row.ocrtext == '' ? '(空)' : row.ocrtext) :
        row.state == 'waitocr' ? '等待OCR' :
        row.state == 'error' ? 'OCR失败：' + row.ocrtext :
        row.state == 'merged' ? row.comment : row.state;
      if (row.file_id) {
        let img = document.createElement('div');
        img.classList.add('img');
        img.style.backgroundImage = 'url(/file?id=' + row.file_id + ')';
        img.style.height = row.imgdb_h+'px';
        img.style.width = row.imgdb_w+'px';
        img.style.backgroundPositionX = '-'+row.imgdb_l+'px';
        img.style.backgroundPositionY = '-'+row.imgdb_t+'px';
        item.ele.children[4].innerHTML = '';
        item.ele.children[4].appendChild(img);
      }
    }
    lastele = item.ele;
  });

  if (rebuildtable) {
    tableele.tBodies[0].innerHTML = '';
    tblitem.forEach((item) => tableele.tBodies[0].appendChild(item.ele));
  }

  updateselect();
  updatetbledit();
  return true;
}


Vue.component('imgdb', {
  props: ['src'],
  template: 
`<div v-if="src.hasOwnProperty('file_id')" class="imgdb" :style="{ width: src.imgdb_w+'px', height: src.imgdb_h+'px' }">
<img :src="'/file?id='+src.file_id" :style="{ top: '-'+src.imgdb_t+'px', left: '-'+src.imgdb_l+'px' }" draggable="false">
</div>`
})

app = new Vue({
  el: '#app',
  data: {
    loaded: 0,
    info: {file: '', width: 100, height: 100, thumb_w: 100, thumb_h: 100, fps: 0, nframes: 100},
    thumbnail: {col:[],row:[]},

    mousexy: [-1, -1], // frame image
    mousexydown: 0,
    ocrsel_origin: -1,
    ocrsel: [-1, -1],
    framescale: 1,

    pos: 0,
    mousepos: -1, mouseposdown: 0, // timebar
    pixeldata: null,

    curedit: undefined,
    cureditocrsel: null,
    editorfontsize: 20,
    nresult: 0,

    logs: {col:[],row:[]},
    checkpointonly: 0,
    morelog: 0,
    waitstatus: 0,
    noautoscrollstatus: 0,
    pageerror: 0,
    statetimer: null,
    rerefresh: false,

    ocrconfig: { engine: '', top: -1, bottom: -1 },
    engines: new Map([
      ['chineseocr:multi', 'chineseocr(多行模式) -- 推荐“新OCR”使用'],
      ['chineseocr:single', 'chineseocr(单行模式)'],
      ['baiduocr:accurate', '百度OCR(高精度,批量) -- 推荐“重新OCR”使用'],
      ['baiduocr:accurate_basic', '百度OCR(高精度,单独)'],
      ['baiduocr:general', '百度OCR(标准版,批量)'],
      ['baiduocr:general_basic', '百度OCR(标准版,单独)'],
      ['dummy', 'dummy(调试用)'],
    ]),

    codeeditor: 0,
    codeedit: null,
    myscript: { scripts: [] },
    scriptuploadtimer: null,
    scriptsel: null,
    scriptsel2: null,
    scripttemplate: `// 自定义脚本
function (ocrresult) {
}
`,
    defaultscripts: [
      { name: '统计信息', locked: true, value: `// 统计信息
function (ocrresult) {
  alert('共'+ocrresult.length+'条字幕');
  return '';
}
` },
      { name: '合并相同', locked: true, value: `// 合并相同：合并相邻且文字完全相同的字幕
function (ocrresult) {
  let lastitem = null;
  ocrresult.forEach((item) => {
    if (lastitem != null) {
      if (item.state == 'done' && lastitem.state == 'done') { // 都是已OCR字幕
        if (item.frame_start - 1 == lastitem.frame_end) { // 相邻
          if (item.ocrtext == lastitem.ocrtext) { // 文字完全相同
            lastitem.frame_end = item.frame_end;
            item.state = 'merged';
            item.comment = '已合并到上一字幕';
            return;
          }
        }
      }
    }
    lastitem = item;
  });
}
` },
      { name: '强制合并相邻', locked: true, value: `// 强制合并相邻：合并相邻字幕，不论文字是否相同
function (ocrresult) {
  if (confirm('确定要强制合并相邻字幕吗？')) {
    let lastitem = null;
    ocrresult.forEach((item) => {
      if (lastitem != null) {
        if (item.state == 'done' && lastitem.state == 'done') { // 都是已OCR字幕
          if (item.frame_start - 1 == lastitem.frame_end) { // 相邻
            lastitem.frame_end = item.frame_end;
            item.state = 'merged';
            item.comment = '已合并到上一字幕';
            return;
          }
        }
      }
      if (item.state == 'done') {
        lastitem = item;
      }
    });
  } else {
    return '没有合并字幕';
  }
}
` },
      { name: '清理', locked: true, value: `// 清理：删除空字幕、被合并字幕
function (ocrresult) {
  ocrresult.forEach((item) => {
    // 删除空字幕
    if (item.state == 'done' && item.ocrtext == '') {
      item.state = 'delete';
    }
    // 删除被合并字幕
    if (item.state == 'merged') {
      item.state = 'delete';
    }
  });
}
` },
      { name: '删除', locked: true, value: `// 删除：删除操作范围内的所有字幕
function (ocrresult) {
  let n = ocrresult.length;
  if (confirm('确定要删除'+ n +'条字幕吗？')) {
    ocrresult.forEach((item) => item.state = 'delete');
    return '删除了' + n + '条字幕';
  }
  return '没有删除字幕';
}
` },
      ],

    timesel: [0, 100],

    myprompt: null,
  },
  watch: {
    timesel() { updateselect(); },
    pos() { updateselect(); },
    editorfontsize() { this.saveui(); },
    curedit(newr, oldr) {
      this.cureditocrsel = newr ? [newr[colmap['top']], newr[colmap['bottom']]] : null;
      if (newr && newr[colmap['state']] == 'done') {
        let item = id2item.get(newr[colmap['id']]);
        let different_item = JSON.stringify(newr) != JSON.stringify(oldr);
        if (item.locked || different_item) {
          if (different_item && oldr) {
            let upd = ziprow(ocrresult.col, oldr);
            let upd_item = id2item.get(upd.id);
            if (upd_item && !upd_item.locked && upd.state == 'done' && upd.ocrtext != this.$refs.editbox.value) {
              upd.ocrtext = this.$refs.editbox.value;
              this.refreshafter(axios.post('/updateresult', {
                changes: [upd],
                checkpoint: '“手动修改”之前',
                message: '手动修改已保存：'+upd.ocrtext,
              }));
              tbllock(upd_item);
            }
          }
          this.$refs.editbox.value = newr[colmap['ocrtext']];
          this.$refs.editbox.readOnly = item.locked;
          this.$refs.editbox.focus();
          this.$refs.editbox.setSelectionRange(0, 0);
        }
      } else {
        this.$refs.editbox.value = '';
        this.$refs.editbox.readOnly = true;
      }
    },
  },
  async mounted() {
    let session = (await axios.post('/session')).data;
    axios.defaults.headers.common['X-VIDEO2SUB-SESSION'] = session;
    this.info = (await axios.post('/info')).data;
    this.ocrconfig = await this.loadconfig('OCR', { engine: 'chineseocr:multi', top: -1, bottom: -1 })
    this.ocrsel = [this.ocrconfig.top, this.ocrconfig.bottom-1];
    this.timesel = [0, this.info.nframes-1];
    let uiconfig = await this.loadconfig('UI', { disp_h: 360, editorfontsize: 20 })
    this.setframescale(uiconfig.disp_h);
    this.editorfontsize = uiconfig.editorfontsize;
    this.curedit = null;
    this.myscript = await this.loadconfig('SCRIPT', { lastid: 0, scripts: [] });
    this.myscript.scripts = this.defaultscripts.concat(this.myscript.scripts.filter((s)=>!s.locked));
    this.scriptsel = this.myscript.scripts.slice(-1)[0];
    window.onmouseup = (e) => this.appmouseup(e);
    window.onmousemove = (e) => this.appmousemove(e);
    window.addEventListener("resize", this.appresize);
    this.codeedit = CodeMirror(this.$refs.codemirror, {
      value: '',
      mode: 'javascript',
      lineNumbers: true,
      tabSize: 2,
    });
    this.codeedit.on('change', () => this.savescript());
    this.refresh();
  },
  methods: {
    ziprowidx(dbresult, idx) {
      return ziprow(dbresult.col, dbresult.row[idx]);
    },
    ziprowarr(dbresult) {
      return dbresult.row.map((r) => ziprow(dbresult.col, r));
    },

    exportass() {
      this.setwaitstatus();
      this.refreshafter(axios.post('/exportass'));
    },
    exportcsv() {
      this.setwaitstatus();
      this.refreshafter(axios.post('/exportcsv'));
    },
    importcsv(asnew) {
      let fileele = [this.$refs.csvfile0, this.$refs.csvfile1][asnew];
      let fromdata = new FormData();
      fromdata.append("csv", fileele.files[0]);
      fromdata.append('asnew', asnew);
      fromdata.append('checkpoint', asnew ? '执行“添加CSV”之前' : '执行“导入CSV”之前');
      this.setwaitstatus();
      this.refreshafter(axios.post('/importcsv', fromdata, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      }));
    },

    setframescale(h) { this.framescale = h / this.info.height; this.saveui(); },
    getdisph() { return Math.round(this.info.height*this.framescale); },
    getdispw() { return Math.round(this.info.width*this.framescale); },

    y2percent(y) {
      return y / this.info.height * 100 + '%';
    },
    framemouse(e) {
      let rect = this.$refs.frameevent.getBoundingClientRect();
      return [
        Math.max(0, Math.min(this.info.width - 1, Math.round((e.clientX - rect.left) / (rect.right - rect.left) * this.info.width))),
        Math.max(0, Math.min(this.info.height - 1, Math.round((e.clientY - rect.top) / (rect.bottom - rect.top) * this.info.height)))
      ];
    },
    framemousemove(e) {
      this.mousexy = this.framemouse(e);
    },
    videomousemove(e) {
      if (this.mousexydown) {
        let y = this.framemouse(e)[1];
        this.ocrsel = [this.ocrsel_origin, y].sort((a, b) => a - b);
        //console.log(this.ocrsel);
      }
    },
    framemousedown(e) {
      if (this.cureditocrsel === null) {
        this.mousexydown = 1;
        let y = this.framemouse(e)[1];
        this.ocrsel_origin = y;
        this.ocrsel = [y, y];
      }
    },
    framemouseup(e) {
      if (this.mousexydown) {
        this.mousexydown = 0;
        this.framemousemove(e);
        if (this.ocrsel[0] != this.ocrconfig.top || this.ocrsel[1] != this.ocrconfig.bottom-1) {
          if (this.ocrconfig.top == -1 || confirm('确定要修改OCR区域吗？')) {
            this.ocrconfig.top = this.ocrsel[0];
            this.ocrconfig.bottom = this.ocrsel[1]+1;
            this.saveconfig('OCR', this.ocrconfig, 'OCR区域已设定 (Y1='+this.ocrconfig.top+', Y2='+(this.ocrconfig.bottom-1)+')');
          } else {
            this.ocrsel[0] = this.ocrconfig.top;
            this.ocrsel[1] = this.ocrconfig.bottom-1;
          }
        }
      }
    },

    findneighbor() {
      if (!this.curedit) return [null, null, null];
      let curid = this.curedit[colmap['id']];
      let curr = null;
      let prev = null;
      let next = null;
      for (let i = 0; i < tblitem.length; i++) {
        let item = tblitem[i];
        if (item.r[colmap['id']] == curid) {
          curr = item;
        }
        if (item.r[colmap['state']] == 'done') {
          if (curr === null) {
            prev = item;
          } else if (curr !== item) {
            next = item;
            break;
          }
        }
      }
      return [prev, curr, next];
    },
    mergeprev() {
      let [prev, curr, next] = this.findneighbor();
      if (prev && curr) {
        let item = ziprow(ocrresult.col, curr.r);
        if (item.state != 'done') {
          return;
        }
        let trueprev = prev;
        while (trueprev.mergedto !== null) {
          trueprev = trueprev.mergedto;
        }
        if (item.frame_start - 1 == prev.r[colmap['frame_end']]) { // 相邻
          let lastitem = ziprow(ocrresult.col, trueprev.r);
          lastitem.frame_end = item.frame_end;
          item.state = 'merged';
          item.comment = '已合并到上一字幕';
          tbledit(next ? next : trueprev, 1);
          tbllock(prev);
          tbllock(trueprev);
          tbllock(curr, true);
          curr.mergedto = trueprev;
          updatetbledit();
          this.refreshafter(axios.post('/updateresult', {
            changes: [lastitem, item],
            checkpoint: '“与上条合并”之前',
            message: '修改已保存',
          }));
          console.log(ziprow(ocrresult.col,trueprev.r), ziprow(ocrresult.col,prev.r), ziprow(ocrresult.col,curr.r));
        } else {
          alert('起始帧与上条字幕结束帧不相邻，拒绝合并');
        }
      }
    },
    jumpprev() {
      let prev = this.findneighbor()[0];
      if (prev) {
        tbledit(prev, 1);
      }
    },
    jumpnext() {
      let next = this.findneighbor()[2];
      if (next) {
        tbledit(next, 1);
      }
    },
    editorkeydown(e) {
      if (e.keyCode == 38) {
        this.jumpprev();
      } else if (e.keyCode == 40 || (e.keyCode == 13 && !e.ctrlKey)) {
        this.jumpnext();
      } else if (e.keyCode == 13 && e.ctrlKey) {
        this.mergeprev();
      } else if (e.key === "Escape") {
        tbledit(null);
      } else {
        return;
      }
      e.preventDefault();
    },
    editorwheel(e) {
      if (e.deltaY > 0) {
        this.jumpnext();
      } else if (e.deltaY < 0) {
        this.jumpprev();
      } else {
        return;
      }
      e.preventDefault();
    },


    barpos(e) {
      return Math.max(0, Math.min(this.info.nframes - 1,
        Math.floor((e.clientX - this.$refs.barbg.getBoundingClientRect().left) / this.$refs.barbg.clientWidth * this.info.nframes)));
    },
    setframepos(n, scrolltype) {
      this.pos = n;
      let item = tblitem[lower_bound(tblitem, (item)=>ziprow(ocrresult.col,item.r).frame_start < this.pos)];
      if (item&&scrolltype) {
        if (scrolltype === 2) {
          tbledit(null);
          item.ele.scrollIntoView(true);
        } else {
          item.ele.scrollIntoView({block: "nearest", inline: "nearest"});
        }
      }
    },
    setpos(e) {
      this.setframepos(this.barpos(e), 2);
    },
    setmousepos(e) {
      this.mousepos = this.barpos(e);
      if (this.mouseposdown) this.setpos(e);
    },
    timebarmouseup(e) {
      if (this.mouseposdown) {
        this.mouseposdown = 0;
        let rect = this.$refs.barbg.getBoundingClientRect();
        if (e.clientY < rect.top || e.clientY >= rect.bottom) {
          this.mousepos = -1;
        }
      } 
    },
    timebarmousemove(e) {
      if (this.mouseposdown) {
        this.mousepos = this.barpos(e);
        this.setpos(e);
      }
    },
    pos2percent(n) {
      return n / this.info.nframes * 100 + '%';
    },
    redrawtimebar() {
      let w = Math.floor(document.body.clientWidth);
      if (this.$refs.canvas.width != w) {
        this.$refs.canvas.width = w;
        this.$refs.canvas.style.width = w+'px';
      }
      if (this.$refs.canvas.height != 1) {
        this.$refs.canvas.height = 1;
      }
      let ctx = this.$refs.canvas.getContext('2d');
      if (this.pixeldata === null || this.pixeldata.width != w) {
        this.pixeldata = ctx.createImageData(w, 1);
      }
      let buffer = this.pixeldata.data;
      buffer.fill(0);

      let state_color = [
        null,
        [176,94,0], // 1: waitocr
        [84, 168, 0],  // 2: done (ocrtext != '')
        [255,0,0],  // 3: error
      ];
      let f = w / this.info.nframes;
      tblitem.forEach((item) => {
        let p = 0;
        switch (item.r[colmap['state']]) {
          case 'waitocr': p = 1; break;
          case 'done': p = item.r[colmap['ocrtext']] != '' ? 2 : 0; break;
          case 'error': p = 3; break;
        }
        if (p > 0) {
          for (let i = item.r[colmap['frame_start']]; i <= item.r[colmap['frame_end']]; i++) {
            let j = Math.floor(i * f);
            buffer[j * 4] = Math.max(buffer[j * 4], p);
          }
        }
      });
      for (let i = 0; i < w * 4; i += 4) {
        let p = buffer[i];
        if (p) {
          buffer[i] = state_color[p][0];
          buffer[i + 1] = state_color[p][1];
          buffer[i + 2] = state_color[p][2];
          buffer[i + 3] = 255;
        }
      }
      ctx.putImageData(this.pixeldata, 0, 0);
    },

    showcodeedit(show) {
      this.codeeditor = show;
      if (show) {
        if (this.myscript.scripts.every((x) => x.locked)) {
          this.newscript();
        }
        this.changescript();
        this.$nextTick(function() {
          this.codeedit.refresh();
        });
      } else {
        this.savescript(true);
      }
    },
    changescript() {
      if (this.scriptsel != null) {
        this.codeedit.getDoc().setValue(this.scriptsel.value);
        this.scriptsel2 = this.scriptsel;
        this.codeedit.scrollTo(0, 0);
        this.codeedit.setOption("readOnly", this.scriptsel.locked);
        this.uploadscript(true);
      }
    },
    renamescript() {
      if (this.scriptsel.locked) {
        alert('不能修改此脚本！');
        return;
      }
      this.showmyprompt('请输入新的名字', this.scriptsel.name, (newname) => {
        if (newname !== null) {
          this.scriptsel.name = newname;
        }
      });
    },
    clonescript() {
      if (!confirm('确定要克隆一份吗？')) {
        return;
      }
      this.myscript.scripts.push(JSON.parse(JSON.stringify(this.scriptsel)));
      this.scriptsel = this.myscript.scripts.slice(-1)[0];
      this.scriptsel.name += ' (副本)';
      this.scriptsel.locked = false;
      this.changescript();
    },
    delscript() {
      if (this.scriptsel.locked) {
        alert('不能删除此脚本！');
        return;
      }
      if (!confirm('确定要删除此脚本吗？')) {
        return;
      }
      let idx = this.myscript.scripts.indexOf(this.scriptsel);
      this.myscript.scripts = this.myscript.scripts.filter((s) => s !== this.scriptsel);
      this.scriptsel = this.myscript.scripts[idx] ? this.myscript.scripts[idx] : this.myscript.scripts.slice(-1)[0];
      this.changescript();
    },
    newscript() {
      this.myscript.scripts.push({
        name: '我的脚本' + (++this.myscript.lastid),
        locked: false,
        value: this.scripttemplate,
      });
      this.scriptsel = this.myscript.scripts.slice(-1)[0];
      this.changescript();
    },
    savescript(uploadnow) {
      if (this.scriptsel2 === this.scriptsel) {
        if (!this.scriptsel.locked) {
          this.scriptsel.value = this.codeedit.getDoc().getValue();
        }
      }
      if (this.scriptuploadtimer !== null) {
        clearTimeout(this.scriptuploadtimer);
        this.scriptuploadtimer = null;
      }
      if (uploadnow) {
        this.uploadscript();
      } else {
        this.scriptuploadtimer = setTimeout(this.uploadscript, 1000);
      }
    },
    uploadscript() {
      this.scriptuploadtimer = null;
      this.saveconfig('SCRIPT', this.myscript, '');
    },
    runscript(s) {
      let f;
      let message;
      try {
        f = geval('('+s.value+')');
      } catch(e) {
        alert('语法错误: ('+e.lineNumber+'行 '+ e.columnNumber+'列)\n'+e);
        return false;
      }
      let zocrresult = this.ziprowarr(ocrresult).filter((item) => this.timesel[0] <= item.frame_start && item.frame_start <= this.timesel[1]);
      let old = JSON.stringify(zocrresult, ocrresult.col);
      try {
        message = f(zocrresult);
      } catch(e) {
        alert('运行时错误:\n'+e);
        return false;
      }
      console.log(old);
      let changed = JSON.stringify(zocrresult, ocrresult.col) != old;
      if (message !== '') this.setwaitstatus();
      this.refreshafter(axios.post('/updateresult', {
        changes: changed ? zocrresult : [],
        checkpoint: changed ? '运行脚本“'+s.name+'”之前' : '',
        message: typeof message === 'string' ? message : ('执行脚本“'+s.name+'”成功' + (changed ? '' : '，但没有任何条目被修改')),
      }));
      zocrresult.forEach((item) => tbllock(id2item.get(item.id)));
      updatetbledit();
      return true;
    },

    startocr() {
      if (confirm('确定对该范围内所有帧执行新OCR吗？\n一般该操作只需要执行一次')) {
        this.setwaitstatus();
        this.refreshafter(axios.post('/startocr', { ocr_start: this.timesel[0], ocr_end: this.timesel[1]+1 }));
      }
    },
    continueocr(restarttype) {
      if (restarttype == 'all') {
        if (!confirm("确认要更换引擎再次OCR吗？")) {
          return;
        }
      }
      this.refreshafter(axios.post('/continueocr', { ocr_start: this.timesel[0], ocr_end: this.timesel[1]+1, restarttype: restarttype }));
    },
    async stopocr() {
      this.setwaitstatus();
      this.refreshafter(axios.post('/stopocr'));
    },

    createcheckpoint() {
      this.showmyprompt('请输入备注（可选）：', '手动创建的恢复点', (msg) => {
        if (msg !== null) {
          this.checkpoint(msg);
        }
      });
    },
    async checkpoint(msg) {
      this.setwaitstatus();
      this.refreshafter(axios.post('/checkpoint', { msg: msg }));
    },
    async rollback(checkpoint_id) {
      if (confirm('确定要恢复到 #'+checkpoint_id+' 吗？\n字幕数据将被替换为恢复点中的数据。')) {
        this.checkpointonly = 0;
        this.morelog = 0;
        this.setwaitstatus();
        this.refreshafter(axios.post('/rollback', { checkpoint_id: checkpoint_id }));
      }
    },

    async saveui() {
      await this.saveconfig('UI', { disp_h: this.getdisph(), editorfontsize:this.editorfontsize }, '');
    },

    appmouseup(e) {
      this.framemouseup(e);
      this.timebarmouseup(e);
    },
    appmousemove(e) {
      this.videomousemove(e);
      this.timebarmousemove(e);
    },
    appresize(e) {
      this.redrawtimebar();
    },
    scrollstatus() {
      if (!this.noautoscrollstatus) {
        this.$nextTick(function() {
          this.$refs.logs.scrollTop = this.$refs.logs.scrollHeight;
        });
      }
    },
    setwaitstatus() {
      this.waitstatus = 1;
      this.scrollstatus();
    },

    async loadconfig(key, default_value) {
      return (await axios.post('/loadconfig', {key:key, default_value:default_value})).data;
    },
    async saveconfig(key, value, msg) {
      if (msg != '') {
        this.setwaitstatus();
      }
      await axios.post('/saveconfig', {key:key, value:value, msg:msg});
      if (msg != '') {
        this.refreshnow();
      }
    },
    refreshafter(p) {
      p.then(() => this.refreshnow());
    },
    refreshnow() {
      if (this.statetimer === null) {
        this.rerefresh = true;
      } else {
        clearTimeout(this.statetimer);
        this.refresh();
      }
    },
    async refresh() {
      this.rerefresh = false;
      this.statetimer = null;
      try {
        if (this.thumbnail.row.length < this.info.nframes) {
          this.thumbnail = Object.freeze((await axios.post('/thumbnail')).data);
          //console.log(this.thumbnail.row.length, this.info.nframes);
        }
        
      } catch (err) {
        console.log(err);
      }
      try {
        if (updateresult((await axios.post('/loadresult', null, { transformResponse: []})).data)) {
          this.scrollstatus();
          this.redrawtimebar();
          this.nresult = ocrresult.row.length;
        }

        let lastline = JSON.stringify(this.logs.row.slice(-1));
        this.logs = Object.freeze((await axios.post('/logs')).data);
        if (lastline != JSON.stringify(this.logs.row.slice(-1))) {
          this.scrollstatus();
        }
        this.waitstatus = 0;
      } catch (err) {
        console.log(err);
        this.pageerror = 1;
        this.scrollstatus();
      }
      this.loaded = 1;
      if (this.rerefresh) {
        await this.refresh();
        return;
      }
      this.statetimer = setTimeout(this.refresh, 1000);
    },

    showmyprompt(message, value, callback) {
      this.myprompt = {
        message: message,
        value: value,
        callback: callback,
      };
      this.$nextTick(function() {
        this.$refs.promptbox.focus();
        this.$refs.promptbox.select();
      });
    },
    mypromptok() {
      this.myprompt.callback(this.myprompt.value);
      this.myprompt = null;
    },
    mypromptcancel() {
      this.myprompt.callback(null);
      this.myprompt = null;
    },
    mypromptkeydown(e) {
      if (e.keyCode == 13) {
        this.mypromptok();
      } else if (e.key === "Escape") {
        this.mypromptcancel();
      } else {
        return;
      }
      e.preventDefault();
    },
  },
});