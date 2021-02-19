"use strict";

let app = null;
let geval = eval;

function strcmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
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
      if (typeof a[i] === 'number') {
        return a[i] - b[i];
      } else {
        return strcmp(a[i], b[i]);
      }
    }
  }
  return 0;
}

///////////////////////////////////////////////////////////////////////////////
let curedit = null;
function savecur() {
  if (curedit) {
    let upd_item = id2item.get(curedit[colmap['id']]);
    if (upd_item && !upd_item.locked) {
      let upd_data = ziprow(ocrresult.col, upd_item.r);
      let upd_text = app.$refs.editbox.value;
      if (upd_data.state == 'done' && upd_data.ocrtext != upd_text) {
        upd_data.ocrtext = curedit[colmap['ocrtext']] = upd_text;
        tbllock(upd_item);
        app.refreshafter(axios.post('/updateresult', {
          changes: [upd_data],
          checkpoint: '“手动修改：'+upd_data.ocrtext+'”之前',
          message: '手动修改已保存：'+upd_data.ocrtext,
          compatlog: true,
        }));
      }
    }
  }
}
function tbledit(item, scrolltype) {
  let newedit = item ? JSON.parse(JSON.stringify(item.r)) : null;

  let change_item = false;
  if (newedit) {
    if (!curedit || curedit[colmap['id']] != newedit[colmap['id']]) {
      change_item = true;
      app.setframepos(newedit[colmap['frame_start']], scrolltype);
    }
  }
  if (newedit && newedit[colmap['state']] == 'done') {
    if (curedit && change_item) {
      savecur();
    }
    app.$refs.editbox.readOnly = item.locked;
    if (item.locked || change_item || (curedit && array_cmp(curedit, newedit) != 0)) {
      app.$refs.editbox.value = newedit[colmap['ocrtext']];
      app.$refs.editbox.focus();
      app.$refs.editbox.setSelectionRange(0, 0);
      app.setocrsel(1, [newedit[colmap['top']], newedit[colmap['bottom']]-1]);
    }
  } else {
    if (curedit) {
      savecur();
    }
    app.$refs.editbox.value = '';
    app.$refs.editbox.readOnly = true;
    app.setocrsel(0);
  }
  curedit = newedit;
  if (!tblselect.has(item)) {
    tblsel([item]);
  }
  updatetblstyle();
}
function updatetbledit() {
  if (curedit) {
    let item = id2item.get(curedit[colmap['id']]);
    if (item && tblselect.has(item)) {
      tbledit(item);
    } else {
      tbledit(null);
    }
  }
}

///////////////////////////////////////////////////////////////////////////////


let lastresult = '';
let ocrresult = {col:[],row:[]};
let colmap = {};
let id2item = new Map(); // id => { ele: <tr>, sortkey: [], r: [c1, c2...] }

let tableele = null;
let tblview = new Set();
let tblitem = [];
let viewopt = {
  filter: null,
  sortkey: null,
};
let tblsortfunc = [
  ['按帧范围','[frame_start,frame_end,top,bottom,engine,id]'],
  ['按帧OCR区域','[top,bottom,frame_start,frame_end,engine,id]'],
  ['按引擎名称','[engine,frame_start,frame_end,top,bottom,id]'],
];
let tblfltfunc = [
  ['全部','true'],
  ['所有非空',"state == 'done' && ocrtext != ''"],
  ['待清理',"state == 'merged' || (state == 'done' && ocrtext == '')"],
  ['等待OCR',"state == 'waitocr'"],
  ['OCR失败',"state == 'error'"],
];
function setviewopt(filter, sortkey) {
  if (filter !== null) {
    let fn = null;
    app.tblflterr = false;
    try {
      fn = new Function(...ocrresult.col, 'return '+filter);
    } catch(e) {
      app.tblflterr = true;
    }
    viewopt.filter = function (item) {
      try {
        return fn.apply(this, item.r);
      } catch(e) {
        app.tblflterr = true;
        return false;
      }
    };
  }
  if (sortkey !== null) {
    let fn = new Function(...ocrresult.col, 'return '+sortkey);
    viewopt.sortkey = function (item) {
      return fn.apply(this, item.r);
    };
  }
  if (filter !== null || sortkey !== null) {
    updateview();
  }
}
function sortedview() {
  let sortkey = ['frame_start', 'frame_end', 'top', 'bottom'];
  return Array.from(tblview).sort((a, b) => {
    for (let key of sortkey) {
      if (a.r[colmap[key]] !== b.r[colmap[key]]) {
        return a.r[colmap[key]] - b.r[colmap[key]];
      }
    }
    let t = strcmp(a.r[colmap['engine']], b.r[colmap['engine']]);
    return t != 0 ? t : (a.r[colmap['id']] - b.r[colmap['id']]);
  });
}

let tblselect = new Set();
let tblselect0 = new Set();
let tbllastsel = null;

function tbllock(item) {
  if (item) {
    item.locked = true;
    item.ele.dataset.lock = 'locked';
    if (curedit && curedit[colmap['id']] == item.r[colmap['id']]) {
      app.$refs.editbox.readOnly = true;
    }
  }
}

function updatetblstyle() {
  let lastitem = null;
  tblitem.forEach((item) => {
    let tag = [];
    let state = item.r[colmap['state']];
    let frame_start = item.r[colmap['frame_start']];
    if (state == 'done') {
      if (!lastitem || frame_start != lastitem.r[colmap['frame_end']] + 1) {
        tag.push('primary');
      }
      lastitem = item;
    }
    if (tblselect.has(item)) {
      tag.push('sel');
    }
    if (curedit && item.r[colmap['id']] == curedit[colmap['id']]) {
      tag.push('cur');
    }
    let tagstr = tag.join(' ');
    if (item.ele.dataset.tag != tagstr) {
      item.ele.dataset.tag = tagstr;
    }
    let lockstr = item.locked ? 'locked' : '';
    if (item.ele.dataset.lock != lockstr) {
      item.ele.dataset.lock = lockstr;
    }
  });
}
function updateselect() {
  tblselect.forEach((item) => {
    if (!tblview.has(item)) {
      tblselect.delete(item);
    }
  });
  tblselect0.forEach((item) => {
    if (!tblview.has(item)) {
      tblselect0.delete(item);
    }
  });
  if (!tblview.has(tbllastsel)) {
    tbllastsel = null;
  }
  
  updatetbledit();
  updatetblstyle();

  if (tblselect.size == 0) {
    app.selinfo = '';
    app.selinfo2 = '空';
  } else if (tblselect.size == id2item.size) {
    app.selinfo = '全部';
    app.selinfo2 = '';
  } else {
    app.selinfo = tblselect.size.toString();
    app.selinfo2 = ' / ' + id2item.size.toString();
  }
  app.tblinfo = '共'+id2item.size+'条字幕' + (id2item.size!=tblview.size?'（筛选后共'+tblview.size+'条）':'');
}
function tblclick(e) {
  let item = this.myitem;
  e.stopPropagation();
  e.preventDefault();

  if (e.shiftKey && tbllastsel) {
    tblselect = new Set(tblselect0);
    let flag = 0;
    tblitem.forEach((curitem) => {
      if (curitem === tbllastsel) flag ^= 1;
      if (curitem === item) flag ^= 1;
      if (flag || curitem === tbllastsel || curitem === item) {
        tblselect.add(curitem);
      }
    });
  } else {
    if (e.ctrlKey) {
      if (tblselect.has(item)) {
        tblselect.delete(item);
      } else {
        tblselect.add(item);
      }
    } else {
      tblselect.clear();
      tblselect.add(item);
    }
    tbllastsel = item;
    tblselect0 = new Set(tblselect);
  }
  updateselect();
  tbledit(item);
}
function tblsel(list) {
  tblselect = new Set(list);
  tblselect0 = new Set(list);
  tbllastsel = list.length == 1 ? list[0] : null;
  updateselect();
}
function tblselnone() {
  tblsel([]);
}
function tblselall() {
  tblsel(tblitem);
}
function removeelement(item) {
  if (item.ele) {
    item.ele.remove();
    item.ele = null;
    item.tblidx = -1;
  }
}
function updateelement(item, lastele, rebuildtable) {
  if (item.ele === null) {
    item.ele = document.createElement('tr');
    item.ele.myitem = item;
    for (let i = 0; i < 5; i++) {
      item.ele.appendChild(document.createElement('td'));
    }
    item.ele.addEventListener('click', tblclick);
    item.ele.addEventListener('mousedown', function (e) {
      if (e.shiftKey) {
        e.preventDefault();
      }
    });
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
  item.ele.children[0].innerText = row.frame_start + '-' + row.frame_end;
  item.ele.children[1].innerText = row.top + '-' + (row.bottom-1);
  item.ele.children[2].innerText = row.engine;
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
function updateview(needdelete, needupdate) {
  let fullupdate = (needdelete === undefined && needupdate === undefined);
  if (fullupdate) {
    tblview.forEach((item) => removeelement(item));
    tblview.clear();
    needdelete = new Set();
    needupdate = new Set(id2item.values());
    app.tblflterr = false;
  }
  let tbllast = tblview.size;
  let tblchange = 0;
  needupdate.forEach((item) => {
    if (viewopt.filter(item)) {
      tblview.add(item);
      item.sortkey = viewopt.sortkey(item);
      if (!item.ele) {
        tblchange++;
      }
    } else {
      needdelete.add(item);
    }
  });
  needdelete.forEach((item) => {
    tblview.delete(item);
    needupdate.delete(item);
    if (item.ele) {
      tblchange++;
    }
    removeelement(item);
  });
  
  tblitem = Array.from(tblview.values());
  tblitem.sort((a, b) => array_cmp(a.sortkey, b.sortkey));

  let rebuildtable = false;
  let lasttblidx = -1;
  for (let item of tblitem) {
    if (item.tblidx >= 0) {
      if (item.tblidx < lasttblidx) {
        rebuildtable = true;
        break;
      }
      lasttblidx = item.tblidx;
    }
  }

  if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
    rebuildtable = rebuildtable || tblchange > Math.sqrt(tbllast);
  }

  tableele = document.getElementById('ocrresult');

  let lastele = null;
  tblitem.forEach((item, i) => {
    item.tblidx = i;
    if (needupdate.has(item)) {
      updateelement(item, lastele, rebuildtable);
    }
    lastele = item.ele;
  });

  if (rebuildtable) {
    tableele.tBodies[0].innerHTML = '';
    tblitem.forEach((item) => tableele.tBodies[0].appendChild(item.ele));
  }

  updateselect();
}
function updateresult(jsonstr) {
  let needdelete = new Set();
  let needupdate = new Set();

  if (lastresult !== jsonstr) {
    ocrresult = JSON.parse(lastresult = jsonstr);

    ocrresult.col.forEach((k, i) => colmap[k] = i);
    if (viewopt.filter === null || viewopt.sortkey === null) {
      setviewopt(app.tblflt, app.tblsort);
    }

    let delmap = new Map(id2item);
    ocrresult.row.forEach((r, i) => delmap.delete(r[colmap['id']]));
    delmap.forEach((item, id) => id2item.delete(id));
    needdelete = new Set(delmap.values());

    for (let r of ocrresult.row) {
      let id = r[colmap['id']];
      let item = id2item.get(id);
      if (item === undefined) {
        item = { ele: null, sortkey: null, tblidx: -1, locked: false, mergedto: null, r: r };
        id2item.set(id, item);
      } else {
        item.locked = false;
        if (array_equal(item.r, r)) {
          continue;
        }
        item.mergedto = null;
        item.r = r;
      }
      needupdate.add(item);
    }
  } else {
    for (let r of ocrresult.row) {
      let id = r[colmap['id']];
      let item = id2item.get(id);
      if (item !== undefined) {
        item.locked = false;
      }
    }
  }

  let changed = needdelete.size > 0 || needupdate.size > 0;

  updateview(needdelete, needupdate); // may modify needdelete, needupdate

  return changed;
}


///////////////////////////////////////////////////////////////////////////////

Vue.component('imgdb', {
  props: ['src'],
  data() {
    return {
      imgloaded: false,
    };
  },
  template: 
`<div v-if="src.hasOwnProperty('file_id')" class="imgdb" :style="{ width: src.imgdb_w+'px', height: src.imgdb_h+'px' }">
<img :src="'/file?id='+src.file_id" :style="{ top: '-'+src.imgdb_t+'px', left: '-'+src.imgdb_l+'px' }" @load="imgload" draggable="false">
</div>`,
  watch: {
    src: {
      deep: true,
      handler(newsrc, oldsrc) {
        if (newsrc.hasOwnProperty('file_id') && oldsrc.hasOwnProperty('file_id')) {
          if (newsrc.file_id === oldsrc.file_id) {
            if (this.imgloaded) {
              this.$emit('my-load');
              return;
            }
          }
        }
        this.imgloaded = false;
      },
    },
  },
  methods: {
    imgload() {
      if (!this.imgloaded) {
        this.imgloaded = true;
        this.$emit('my-load');
      }
    },
  },
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
    ocrselsv: [-1, -1],
    ocrselmode: 0,
    framescale: 1,

    pos: -1,
    mousepos: -1, mouseposdown: 0, // timebar
    pixeldata: null,

    editorfontsize: 20,

    tblsortfunc: tblsortfunc,
    tblsort: tblsortfunc[0][1],
    tblfltfunc: tblfltfunc,
    tblflt: tblfltfunc[0][1],
    tblflterr: false,
    selinfo: '',
    selinfo2: '',
    tblinfo: '',

    logs: {col:[],row:[]},
    checkpointonly: 0,
    morelog: 0,
    waitstatus: 0,
    noautoscrollstatus: 0,
    pageerror: 0,
    statetimer: null,
    rerefresh: false,

    ocrconfig: { engine: '', top: -1, bottom: -1 },
    engines: new Map(),

    codeeditor: 0,
    codeedit: null,
    myscript: { scripts: [] },
    scriptuploadtimer: null,
    scriptsel: null,
    scriptsel2: null,
    scripttemplate: `// 自定义脚本
function (items) {
  for (let item of items) {
    // item.id             字幕唯一内部ID
    // item.state          字幕状态：waitocr, error, done, merged
    // item.frame_start    字幕起始帧
    // item.frame_end      字幕结束帧(含)
    // item.engine         使用的OCR引擎名
    // item.top            字幕区域Y1
    // item.bottom         字幕区域Y2(不含)
    // item.ocrtext        字幕文本
  }
  //return '处理完毕';
}
`,
    defaultscripts: [
      { name: '合并相同', locked: true, value: `// 合并相同：合并相邻且文字完全相同的字幕
function (items) {
  if (items.length < 2) {
    alert('请选择多条字幕');
    return '没有合并字幕';
  }
  let lastitem = null;
  for (let item of items) {
    if (lastitem != null) {
      if (item.state == 'done' && lastitem.state == 'done') { // 都是已OCR字幕
        if (item.frame_start - 1 == lastitem.frame_end) { // 相邻
          if (item.ocrtext == lastitem.ocrtext) { // 文字完全相同
            lastitem.frame_end = item.frame_end;
            item.state = 'merged';
            item.comment = '已合并到上一字幕';
            continue;
          }
        }
      }
    }
    if (item.state != 'merged') {
      lastitem = item;
    }
  }
}
` },
      { name: '强制合并相邻', locked: true, value: `// 强制合并相邻：合并相邻字幕，不论文字是否相同
function (items) {
  if (items.length < 2) {
    alert('请选择多条字幕');
    return '没有合并字幕';
  }
  if (confirm('确定要强制合并相邻字幕吗？')) {
    let lastitem = null;
    for (let item of items) {
      if (lastitem != null) {
        if (item.state == 'done' && lastitem.state == 'done') { // 都是已OCR字幕
          if (item.frame_start - 1 == lastitem.frame_end) { // 相邻
            lastitem.frame_end = item.frame_end;
            item.state = 'merged';
            item.comment = '已合并到上一字幕';
            continue;
          }
        }
      }
      if (item.state == 'done') {
        lastitem = item;
      }
    }
  } else {
    return '没有合并字幕';
  }
}
` },
      { name: '清理', locked: true, value: `// 清理：删除空字幕、被合并字幕
function (items) {
  let n = 0;
  for (let item of items) {
    // 删除空字幕
    if (item.state == 'done' && item.ocrtext == '') {
      item.state = 'delete';
      n++;
    }
    // 删除被合并字幕
    if (item.state == 'merged') {
      item.state = 'delete';
      n++;
    }
  }
  return '清理了' + n + '条字幕';
}
` },
      { name: '删除', locked: true, value: `// 删除：删除操作范围内的所有字幕
function (items) {
  let n = items.length;
  if (confirm('确定要删除'+ n +'条字幕吗？')) {
    for (let item of items) {
      item.state = 'delete';
    }
    return '删除了' + n + '条字幕';
  }
  return '没有删除字幕';
}
` },
      { name: '克隆', locked: true, value: `// 克隆：克隆一份选中的字幕
function (items) {
  let n = items.length;
  if (confirm('确定要克隆'+ n +'条字幕吗？')) {
    for (let i = 0; i < n; i++) {
      let newitem = JSON.parse(JSON.stringify(items[i]));
      newitem.id = 0;
      items.push(newitem);
    }
    return '克隆了'+ n + '条字幕';
  }
  return '没有克隆字幕';
}
` },
      ],

    myprompt: null,
  },
  watch: {
    pos() {
      //updateselect();
      [this.$refs.prevframe, this.$refs.curframe, this.$refs.nextframe].forEach((ref) => {
        ref.style.color = 'gray';
        ref.style.textDecoration = 'line-through';
      });
    },
    editorfontsize() { this.saveui(); },
    tblsort(newsort, oldsort) {
      if (newsort !== oldsort) {
        setviewopt(null, newsort);
      }
    },
    tblflt(newflt, oldflt) {
      if (newflt != oldflt) {
        setviewopt(newflt, null);
      }
    },
  },
  async mounted() {
    let session = (await axios.post('/session')).data;
    axios.defaults.headers.common['X-VIDEO2SUB-SESSION'] = session;
    this.info = (await axios.post('/info')).data;
    this.ocrconfig = await this.loadconfig('OCR')
    this.setocrsel(0);
    this.engines = new Map((await axios.post('/allengines')).data);
    let uiconfig = await this.loadconfig('UI')
    this.setframescale(uiconfig.disp_h);
    this.editorfontsize = uiconfig.editorfontsize;
    this.myscript = await this.loadconfig('SCRIPT', { lastid: 0, scripts: [] });
    this.myscript.scripts = this.defaultscripts.concat(this.myscript.scripts.filter((s)=>!s.locked));
    this.scriptsel = this.myscript.scripts.slice(-1)[0];
    this.pos = 0;
    tbledit(null);
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
      if (fileele.files.length > 0) {
        fromdata.append("csv", fileele.files[0]);
        fromdata.append('asnew', asnew);
        fromdata.append('checkpoint', asnew ? '执行“添加CSV”之前' : '执行“导入CSV”之前');
        this.setwaitstatus();
        this.refreshafter(axios.post('/importcsv', fromdata, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }));
        fileele.value = '';
      }
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
      this.mousexydown = 1;
      let y = this.framemouse(e)[1];
      this.ocrsel_origin = y;
      this.ocrsel = [y, y];
    },
    framemouseup(e) {
      if (this.mousexydown) {
        this.mousexydown = 0;
        this.framemousemove(e);
        if (confirm(this.ocrselmode?'确定要修改选中的'+tblselect.size+'条字幕的OCR区域吗？':'确定要修改新项目的OCR区域吗？')) {
          this.saveocrsel();
        } else {
          this.setocrsel(-1);
        }
      }
    },
    inputocrsel() {
      this.showmyprompt((this.ocrselmode?'修改选中的'+tblselect.size+'条字幕的OCR区域':'修改新项目的OCR区域') + '\n请输入OCR区域信息，格式为“Y1-Y2”', this.ocrsel[0]+'-'+this.ocrsel[1], (val) => {
        if (val !== null) {
          let newsel = val.split('-').map((v) => parseInt(v, 10));
          if (newsel.length == 2 && newsel[0] >= 0 && newsel[1] >= 0) {
            newsel.sort((a, b) => a - b);
            if (newsel[1] < this.info.height) {
              this.setocrsel(-1, newsel);
              this.saveocrsel();
              return;
            }
          }
          alert('无效值');
        }
      })
    },
    saveocrsel() {
      if (this.ocrselmode == 0) {
        this.ocrconfig.top = this.ocrsel[0];
        this.ocrconfig.bottom = this.ocrsel[1];
        this.saveconfig('OCR', this.ocrconfig, 'OCR区域已设定 (Y1='+this.ocrconfig.top+', Y2='+this.ocrconfig.bottom+')');
      } else if (this.ocrselmode == 1) {
        let selrange = tblitem.filter((item) => tblselect.has(item));
        let changes = selrange.map((item) => ziprow(ocrresult.col, item.r));
        let top = this.ocrsel[0], bottom = this.ocrsel[1]+1;
        changes.forEach((item) => (item.top = top, item.bottom = bottom));
        if (curedit) {
          curedit[colmap['top']] = top;
          curedit[colmap['bottom']] = bottom;
        }
        app.refreshafter(axios.post('/updateresult', {
          changes: changes,
          checkpoint: '“修改'+selrange.length+'条字幕的OCR范围”之前',
          message: '已修改'+selrange.length+'条字幕的OCR范围',
          compatlog: true,
        }));
        selrange.forEach((item) => tbllock(item));
      }
    },
    setocrsel(mode, newsel) {
      if (mode == 1) {
        this.ocrsel = [newsel[0], newsel[1]];
        this.ocrselmode = 1;
      } else if (mode == 0) {
        this.ocrsel = [this.ocrconfig.top, this.ocrconfig.bottom];
        this.ocrselmode = 0;
      } else {
        if (newsel) {
          this.ocrsel = [newsel[0], newsel[1]];
        } else {
          this.ocrsel = [this.ocrselsv[0], this.ocrselsv[1]];
        }
      }
      this.ocrselsv = [this.ocrsel[0], this.ocrsel[1]];
    },


    imgload(ref) {
      ref.style.color = 'black';
      ref.style.textDecoration = '';
    },


    findneighbor() {
      if (!curedit) return [null, null, null];
      let curid = curedit[colmap['id']];
      let curr = null;
      let prev = null;
      let next = null;
      let multisel = tblselect.size > 1;
      for (let i = 0; i < tblitem.length; i++) {
        let item = tblitem[i];
        if (multisel && !tblselect.has(item)) {
          continue;
        }
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
      if (prev && curr && !curr.locked) {
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
          if (next) tbledit(next, 1);
          tbllock(prev);
          tbllock(trueprev);
          tbllock(curr, true);
          curr.mergedto = trueprev;
          updatetbledit();
          this.refreshafter(axios.post('/updateresult', {
            changes: [lastitem, item],
            checkpoint: '“与上条合并：'+lastitem.ocrtext+'”之前',
            message: '已合并到上一字幕：'+lastitem.ocrtext,
            compatlog: true,
          }));
          //console.log(ziprow(ocrresult.col,trueprev.r), ziprow(ocrresult.col,prev.r), ziprow(ocrresult.col,curr.r));
        } else {
          alert('起始帧与上条字幕结束帧不相邻，拒绝合并');
        }
      }
    },
    jumpprev() {
      let prev = this.findneighbor()[0];
      if (prev) {
        tbledit(prev, 1);
      } else {
        savecur();
      }
    },
    jumpnext() {
      let next = this.findneighbor()[2];
      if (next) {
        tbledit(next, 1);
      } else {
        savecur();
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
    jumppos(t) {
      if (curedit) {
        this.pos = [curedit[colmap['frame_start']], curedit[colmap['frame_end']]][t];
      }
    },


    barpos(e) {
      return Math.max(0, Math.min(this.info.nframes - 1,
        Math.floor((e.clientX - this.$refs.barbg.getBoundingClientRect().left) / this.$refs.barbg.clientWidth * this.info.nframes)));
    },
    setframepos(n, scrolltype) {
      this.pos = n;
      if (tblview.size > 0 && scrolltype) {
        let tblsorted = sortedview();
        let target = tblsorted.findIndex((item) => item.r[colmap['frame_start']] >= n);
        let item;
        if (target < 0) {
          item = tblsorted.slice(-1)[0];
        } else {
          if (tblsorted[target].r[colmap['frame_start']] > n) {
            target--;
          }
          item = target >= 0 ? tblsorted[target] : tblsorted[0];
        }

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
    pos2percent(n, leftmargin) {
      let w = Math.floor(document.body.clientWidth);
      let p = n / this.info.nframes * 100 + '%';
      if (leftmargin) {
        return 'min('+p+','+(w-leftmargin)+'px)';
      } else {
        return p;
      }
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

    tblselall() {
      this.tblflt = this.tblfltfunc[0][1];
      this.tblsort = this.tblsortfunc[0][1];
      setviewopt(this.tblflt, this.tblsort);
      tblselall();
    },
    tblselnone() { tblselnone(); },

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
    checkselect() {
      if (!tblitem.some((item) => tblselect.has(item))) {
        alert('请先选中要处理的字幕');
        return false;
      }
      return true;
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
      let items = sortedview().filter((item) => tblselect.has(item)).map((item) => ziprow(ocrresult.col, item.r));
      let old = JSON.stringify(items, ocrresult.col);
      try {
        message = f(items);
      } catch(e) {
        alert('运行时错误:\n'+e);
        return false;
      }
      //console.log(old);
      let changed = JSON.stringify(items, ocrresult.col) != old;
      if (message !== '') this.setwaitstatus();
      this.refreshafter(axios.post('/updateresult', {
        changes: changed ? items : [],
        checkpoint: changed ? '运行脚本“'+s.name+'”之前' : '',
        message: typeof message === 'string' ? message : ('执行脚本“'+s.name+'”成功' + (changed ? '' : '，但没有任何条目被修改')),
        compatlog: s.locked&&changed,
      }));
      items.forEach((item) => tbllock(id2item.get(item.id)));
      updatetbledit();
      return true;
    },

    startocr() {
      if (ocrresult.row.length == 0) {
        this.setwaitstatus();
        this.refreshafter(axios.post('/startocr', { ocr_start: 0, ocr_end: this.info.nframes }));
        return;
      }
      this.showmyprompt('请输入OCR帧范围，格式为“起-终”', 0+'-'+(this.info.nframes-1), (val) => {
        if (val !== null) {
          let timesel = val.split('-').map((v) => parseInt(v, 10));
          if (timesel.length == 2 && timesel[0] >= 0 && timesel[1] >= 0) {
            timesel.sort((a, b) => a - b);
            if (timesel[0] >= 0 && timesel[1] <= (this.info.nframes-1)) {
              this.setwaitstatus();
              this.refreshafter(axios.post('/startocr', { ocr_start: timesel[0], ocr_end: timesel[1]+1 }));
              return;
            }
          }
          alert('无效值');
        }
      });
    },
    continueocr(restarttype) {
      let ocr_range = Array.from(tblselect).map((item) => item.r[colmap['id']]);
      if (ocr_range.length == 0) {
        alert('请先选中要处理的字幕');
        return;
      }
      if (restarttype == 'all') {
        if (!confirm("确认要更换引擎再次OCR吗？")) {
          return;
        }
      }
      this.refreshafter(axios.post('/continueocr', { ocr_range: ocr_range, restarttype: restarttype }));
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
      this.rerefresh = true;
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
        let newresultdata = (await axios.post('/loadresult', null, { transformResponse: []})).data;
        if (!this.rerefresh) {
          if (updateresult(newresultdata)) {
            this.scrollstatus();
            this.redrawtimebar();
          }
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