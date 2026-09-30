/* app.js — Thư viện tra cứu luật lao động (Second Wind)
 * Web tĩnh, đọc dữ liệu từ data/*.json do Apps Script (XuatBan.gs) sinh ra.
 * Định tuyến bằng hash:
 *   #/                      trang chủ
 *   #/nhom/<ma>             đọc theo nhóm (tình huống hoặc chương)
 *   #/dieu/<id>[?nhom=<ma>] đọc 1 điều
 *   #/tim?q=...&nhom=...&vb=...&phat=1
 *   #/doi-chieu/<id>        đối chiếu 3 cột Luật – Hướng dẫn – Mức phạt
 */
(function () {
  'use strict';

  var S = {
    meta: null, nhom: null,
    vb: {},            // ma_vb -> văn bản
    dieu: {},          // id -> điều (có thêm ma_vb, _vb)
    thuTu: [],         // id theo thứ tự văn bản
    nguoc: {},         // id -> [id điều dẫn chiếu tới nó]
    nhomMap: {},       // ma -> nhóm (cả 2 kiểu)
    idx: [],           // chỉ mục tìm kiếm
    mode: luuDoc('tvl_mode') || 'th',
    fs: +luuDoc('tvl_fs') || 16,
    ptab: null
  };
  var app = document.getElementById('app');

  // ---------- tiện ích ----------
  function luuDoc(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function luuGhi(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Bỏ dấu, giữ nguyên độ dài chuỗi (để tô sáng đúng vị trí)
  function fold(s) {
    var out = '';
    s = String(s || '');
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === 'đ' || c === 'Đ') { out += 'd'; continue; }
      var n = c.normalize('NFD');
      out += (n.length ? n[0] : c).toLowerCase();
    }
    return out;
  }
  function soTuId(id) {
    var i = id.lastIndexOf('-D'), n = id.slice(i + 2);
    return String(parseInt(n, 10)) + n.replace(/^\d+/, '');
  }
  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
  }
  function nhomCua(d) {
    // nhóm hiển thị mặc định của 1 điều theo chế độ hiện tại
    if (S.mode === 'ch') return d.chuong ? d.ma_vb + '-C' + d.chuong : null;
    return d.nhom[0] || (d.chuong ? d.ma_vb + '-C' + d.chuong : null);
  }
  function dsNhom() { return S.mode === 'ch' ? S.nhom.chuong : S.nhom.tinh_huong; }
  function tenNhom(n) { return n.so ? 'Chương ' + n.so + '. ' + n.ten : n.ten; }
  function loaiVbClass(loai) { return loai === 'Luật' ? '' : (loai === 'Thông tư' ? 'tt' : 'nd'); }
  function pillTinhTrang(v) {
    var c = v.tinh_trang === 'Còn hiệu lực' ? 'pill-ok' : 'pill-warn';
    return v.tinh_trang ? '<span class="pill ' + c + '">' + esc(v.tinh_trang) + '</span>' : '';
  }

  // ---------- nạp dữ liệu ----------
  function napDuLieu() {
    return Promise.all([fetchJson('data/meta.json'), fetchJson('data/nhom.json')]).then(function (r) {
      S.meta = r[0]; S.nhom = r[1];
      S.nhom.tinh_huong.forEach(function (n) { S.nhomMap[n.ma] = n; });
      S.nhom.chuong.forEach(function (n) { S.nhomMap[n.ma] = n; });
      return Promise.all(S.meta.van_ban.map(function (v) { return fetchJson('data/van-ban/' + v.slug + '.json'); }));
    }).then(function (ds) {
      ds.forEach(function (v) {
        S.vb[v.ma_vb] = v;
        v.dieu.forEach(function (d) {
          d.ma_vb = v.ma_vb; d._vb = v;
          S.dieu[d.id] = d; S.thuTu.push(d.id);
        });
      });
      S.thuTu.forEach(function (id) {
        S.dieu[id].lien_ket.forEach(function (l) {
          if (l.loai === 'Nội bộ') (S.nguoc[l.den_id] = S.nguoc[l.den_id] || []).push(id);
        });
        var d = S.dieu[id];
        S.idx.push({ id: id, tt: fold(d.tieu_de), t: fold('dieu ' + d.so + ' ' + d.tieu_de), b: fold(d.noi_dung), k: fold(d.tu_khoa) });
      });
      if (S.mode === 'ch' && !S.nhom.chuong.length) S.mode = 'th';
      if (S.mode === 'th' && !S.nhom.tinh_huong.length) S.mode = 'ch';
    });
  }

  // ---------- định tuyến ----------
  function route() {
    var h = location.hash.replace(/^#/, '') || '/';
    var qi = h.indexOf('?');
    var p = qi >= 0 ? h.slice(0, qi) : h;
    var q = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
    var seg = p.split('/').filter(Boolean).map(decodeURIComponent);
    window.scrollTo(0, 0);
    if (!seg.length) return trangChu();
    if (seg[0] === 'nhom' && seg[1]) return docNhom(seg[1]);
    if (seg[0] === 'dieu' && seg[1]) return docDieu(seg[1], q.get('nhom'));
    if (seg[0] === 'tim') return timKiem(q);
    if (seg[0] === 'doi-chieu' && seg[1]) return doiChieu(seg[1]);
    app.innerHTML = '<div class="error">Không tìm thấy trang. <a href="#/">Về trang chủ</a></div>';
  }

  // ---------- trang chủ ----------
  function theNhom(n) {
    if (n.so) {
      return '<a class="cd" href="#/nhom/' + encodeURIComponent(n.ma) + '"><div class="ic roman">' + esc(n.so) + '</div>' +
        '<h3>' + esc(n.ten) + '</h3><div class="m">' + n.dieu_ids.length + ' điều · ' + khoangDieu(n) + '</div></a>';
    }
    return '<a class="cd" href="#/nhom/' + encodeURIComponent(n.ma) + '"><div class="ic">' + esc(n.icon || '📄') + '</div>' +
      '<h3>' + esc(n.ten) + '</h3><div class="m">' + n.dieu_ids.length + ' điều</div>' +
      (n.mo_ta ? '<div class="d">' + esc(n.mo_ta) + '</div>' : '') + '</a>';
  }
  function khoangDieu(n) {
    if (!n.dieu_ids.length) return '';
    var a = S.dieu[n.dieu_ids[0]], b = S.dieu[n.dieu_ids[n.dieu_ids.length - 1]];
    return a && b ? 'Điều ' + a.so + (a === b ? '' : '–' + b.so) : '';
  }

  function trangChu() {
    document.title = (S.meta.ten || 'Thư viện luật') + ' – Second Wind';
    var tong = S.thuTu.length;
    var goiY = (S.meta.goi_y_tim || []).map(function (g) {
      return '<a class="chip" href="#/tim?q=' + encodeURIComponent(g) + '">' + esc(g) + '</a>';
    }).join('');
    var vbHtml = S.meta.van_ban.map(function (v) {
      return '<div class="vb-row"><div class="vb-type ' + loaiVbClass(v.loai) + '">' + esc((v.loai || '').slice(0, 4).toUpperCase()) + '</div>' +
        '<div class="i"><b>' + esc(v.ten) + '</b><span>' + esc(v.so_hieu) + (v.hieu_luc_tu ? ' · hiệu lực ' + esc(v.hieu_luc_tu) : '') +
        ' · ' + v.so_dieu + ' điều' + (v.pham_vi === 'Trích' ? ' (trích)' : '') + '</span></div>' + pillTinhTrang(v) + '</div>';
    }).join('');
    var nhomLon = S.nhom.tinh_huong.slice().sort(function (a, b) { return b.dieu_ids.length - a.dieu_ids.length; }).slice(0, 5);
    var cta = S.meta.cta_url ? '<div class="cta-band"><div><b style="font-size:17px">' + esc(S.meta.cta_tieu_de || 'Doanh nghiệp bạn đang tuân thủ đến đâu?') +
      '</b><p>Bộ Đo khám chỉ ra các điểm rủi ro trong hợp đồng, lương, BHXH của doanh nghiệp.</p></div><a class="btn" href="' + esc(S.meta.cta_url) + '">Đo khám miễn phí →</a></div>' : '';

    app.innerHTML =
      '<section class="hero"><div class="hero-in">' +
      '<h1>Tra cứu luật lao động theo tình huống doanh nghiệp gặp</h1>' +
      '<p>Toàn văn ' + tong + ' điều. Tra theo tình huống hoặc theo chương luật, và xem song song văn bản hướng dẫn cùng mức phạt.</p>' +
      '<form class="search" id="homeSearch" role="search"><span aria-hidden="true">🔎</span>' +
      '<input name="q" placeholder="Gõ từ khóa: thử việc, làm thêm giờ, trợ cấp thôi việc…" aria-label="Từ khóa"><kbd>/</kbd>' +
      '<button class="btn" type="submit">Tìm</button></form>' +
      '<div class="chips">' + goiY + '</div>' +
      '<div class="stats"><div><b>' + tong + '</b>điều</div><div><b>' + S.nhom.tinh_huong.length + '</b>nhóm tình huống</div>' +
      '<div><b>' + S.nhom.chuong.length + '</b>chương</div><div><b>' + esc(S.meta.cap_nhat || '') + '</b>cập nhật</div></div>' +
      '</div></section>' +
      '<section class="sec"><div class="sec-head"><div><h2>Tra cứu theo nhóm chế định</h2><p class="sub" id="cdSub"></p></div>' +
      '<div class="seg" id="homeSeg" role="group" aria-label="Cách nhóm">' +
      '<button data-k="th">Theo tình huống (' + S.nhom.tinh_huong.length + ')</button>' +
      '<button data-k="ch">Theo chương (' + S.nhom.chuong.length + ')</button></div></div>' +
      '<div class="cd-grid" id="cdGrid"></div></section>' +
      '<section class="sec" style="padding-top:0"><div class="two">' +
      '<div class="card"><h3>Văn bản trong thư viện</h3>' + vbHtml + '</div>' +
      '<div class="card"><h3>Nhóm nhiều điều nhất</h3><ul class="link-list">' + nhomLon.map(function (n) {
        return '<li><a href="#/nhom/' + encodeURIComponent(n.ma) + '">' + esc(n.icon || '') + ' ' + esc(n.ten) + '<small>' + n.dieu_ids.length + ' điều</small></a></li>';
      }).join('') + '</ul></div></div></section>' + cta;

    function veLuoi() {
      document.getElementById('cdGrid').innerHTML = dsNhom().map(theNhom).join('');
      document.getElementById('cdSub').textContent = S.mode === 'ch'
        ? 'Đọc theo đúng bố cục của văn bản.' : 'Chọn đúng tình huống đang gặp. Một điều có thể thuộc nhiều nhóm.';
      document.querySelectorAll('#homeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === S.mode); });
    }
    document.querySelectorAll('#homeSeg button').forEach(function (b) {
      b.onclick = function () { S.mode = b.dataset.k; luuGhi('tvl_mode', S.mode); veLuoi(); };
    });
    veLuoi();
    ganTimKiem(document.getElementById('homeSearch'));
  }

  // ---------- đọc ----------
  function docNhom(ma) {
    var n = S.nhomMap[ma];
    if (!n || !n.dieu_ids.length) { app.innerHTML = '<div class="error">Nhóm này chưa có điều nào. <a href="#/">Về trang chủ</a></div>'; return; }
    S.mode = n.so ? 'ch' : 'th';
    docDieu(n.dieu_ids[0], ma);
  }

  function veCay(nhomMa, idHienTai) {
    var html = '<div class="seg" id="treeSeg"><button data-k="th">Tình huống</button><button data-k="ch">Chương</button></div>' +
      '<button class="btn ghost sm tree-toggle" id="treeToggle" type="button">☰ Mục lục</button><div class="tree-body">' +
      '<div class="grp">' + (S.mode === 'ch' ? 'Chương' : 'Nhóm tình huống') + '</div>';
    dsNhom().forEach(function (n) {
      var mo = n.ma === nhomMa;
      html += '<a class="node lv1' + (mo ? ' open' : '') + '" href="#/nhom/' + encodeURIComponent(n.ma) + '">' +
        (n.so ? esc(n.so) + '. ' : esc(n.icon || '') + ' ') + esc(n.ten) + '<span class="n">' + n.dieu_ids.length + '</span></a>';
      if (mo) {
        var mucTruoc = null;
        n.dieu_ids.forEach(function (id) {
          var d = S.dieu[id];
          if (!d) return;
          if (S.mode === 'ch' && d.muc && d.muc !== mucTruoc) {
            html += '<div class="muc-h">Mục ' + esc(d.muc) + '. ' + esc(d.ten_muc) + '</div>';
            mucTruoc = d.muc;
          }
          html += '<a class="node lv2' + (id === idHienTai ? ' on' : '') + '" href="#/dieu/' + encodeURIComponent(id) + '?nhom=' + encodeURIComponent(n.ma) + '">' +
            'Điều ' + esc(d.so) + '. ' + esc(d.tieu_de) + '</a>';
        });
      }
    });
    return html + '</div>';
  }

  function refMapCua(d) {
    var m = {};
    d.lien_ket.forEach(function (l) { if (l.loai === 'Nội bộ') m[soTuId(l.den_id)] = l.den_id; });
    return m;
  }

  function noiDungHtml(d) {
    var refMap = refMapCua(d);
    return String(d.noi_dung || '').split('\n').map(function (raw) {
      var line = raw.trim(); if (!line) return '';
      var cls = 'p', so = '', body = line, m;
      if ((m = line.match(/^(\d+)\.\s*(.*)$/))) { cls = 'k'; so = m[1] + '.'; body = m[2]; }
      else if ((m = line.match(/^([a-zđ])\)\s*(.*)$/))) { cls = 'd'; so = m[1] + ')'; body = m[2]; }
      var html = esc(body).replace(/Điều\s+(\d+[a-z]?)/g, function (all, n) {
        var id = refMap[n];
        return id ? '<a class="ref" data-id="' + id + '" href="#/dieu/' + id + '">' + all + '</a>' : all;
      });
      return '<p class="' + cls + '">' + (so ? '<b>' + so + '</b>' : '') + '<span>' + html + '</span></p>';
    }).join('');
  }

  function docDieu(id, nhomMa) {
    var d = S.dieu[id];
    if (!d) { app.innerHTML = '<div class="error">Không có điều ' + esc(id) + '. <a href="#/">Về trang chủ</a></div>'; return; }
    var v = d._vb;
    if (nhomMa && S.nhomMap[nhomMa]) S.mode = S.nhomMap[nhomMa].so ? 'ch' : 'th';
    if (!nhomMa || !S.nhomMap[nhomMa] || S.nhomMap[nhomMa].dieu_ids.indexOf(id) < 0) nhomMa = nhomCua(d);
    var n = S.nhomMap[nhomMa];
    document.title = 'Điều ' + d.so + '. ' + d.tieu_de + ' – ' + v.ten;

    var ds = n ? n.dieu_ids : S.thuTu.filter(function (x) { return S.dieu[x].ma_vb === d.ma_vb; });
    var i = ds.indexOf(id), truoc = S.dieu[ds[i - 1]], sau = S.dieu[ds[i + 1]];
    var q = n ? '?nhom=' + encodeURIComponent(n.ma) : '';
    var bai = (d.bai || []).map(function (b) {
      return '<a class="rel-row" href="' + esc(b.url) + '" target="_blank" rel="noopener"><span class="pill pill-pri">Bài viết</span><div class="i"><b>' + esc(b.tieu_de) + '</b>' +
        (b.muc_rui_ro ? '<span class="s">Mức rủi ro: ' + esc(b.muc_rui_ro) + '</span>' : '') + '</div>↗</a>';
    }).join('');
    var soHd = d.lien_ket.filter(function (l) { return l.loai === 'Hướng dẫn'; }).length;
    var soPh = d.lien_ket.filter(function (l) { return l.loai === 'Xử phạt'; }).length;

    app.innerHTML =
      '<div class="reader">' +
      '<aside class="tree collapsed" id="tree" aria-label="Mục lục">' + veCay(nhomMa, id) + '</aside>' +
      '<article class="art">' +
      '<nav class="crumb"><a href="#/">Thư viện</a> › ' + (n ? '<a href="#/nhom/' + encodeURIComponent(n.ma) + '">' + esc(tenNhom(n)) + '</a> › ' : '') + 'Điều ' + esc(d.so) + '</nav>' +
      '<div class="meta"><span class="pill pill-luat">' + esc(v.so_hieu) + '</span>' +
      (d.chuong ? '<span class="pill pill-pri">Chương ' + esc(d.chuong) + (d.muc ? ' · Mục ' + esc(d.muc) : '') + '</span>' : '') + pillTinhTrang(v) + '</div>' +
      (v.tinh_trang && v.tinh_trang !== 'Còn hiệu lực' ? '<div class="banner">⚠ Văn bản ' + esc(v.tinh_trang.toLowerCase()) + (v.thay_the_boi ? '. Xem văn bản thay thế: ' + esc(v.thay_the_boi) : '') + '. Kiểm tra lại trước khi áp dụng.</div>' : '') +
      '<h1>Điều ' + esc(d.so) + '. ' + esc(d.tieu_de) + '</h1>' +
      '<div class="toolbar">' +
      '<a class="btn sm" href="#/doi-chieu/' + encodeURIComponent(id) + '">⇆ Đối chiếu 3 cột</a>' +
      '<button class="btn ghost sm" id="btnCopy" type="button">🔗 Sao chép link</button>' +
      '<button class="btn ghost sm" id="btnNho" type="button" aria-label="Chữ nhỏ hơn">A−</button>' +
      '<button class="btn ghost sm" id="btnTo" type="button" aria-label="Chữ to hơn">A+</button>' +
      '<button class="btn ghost sm" type="button" onclick="window.print()">🖨 In</button></div>' +
      '<div class="body-law" id="body" style="--fs:' + S.fs + 'px">' + noiDungHtml(d) + '</div>' +
      (d.diem_nho ? '<div class="keybox"><b>📌 Điểm cần nhớ</b>' + esc(d.diem_nho) + '</div>' : '') +
      (bai ? '<div class="rel"><h2>Bài phân tích liên quan</h2>' + bai + '</div>' : '') +
      '<div class="pn">' +
      (truoc ? '<a href="#/dieu/' + truoc.id + q + '"><small>← Điều trước</small>Điều ' + esc(truoc.so) + '. ' + esc(truoc.tieu_de) + '</a>' : '<span class="ph"></span>') +
      (sau ? '<a class="next" href="#/dieu/' + sau.id + q + '"><small>Điều sau →</small>Điều ' + esc(sau.so) + '. ' + esc(sau.tieu_de) + '</a>' : '<span class="ph"></span>') +
      '</div></article>' +
      '<aside class="side" aria-label="Đối chiếu song song"><h2>Đối chiếu song song</h2>' +
      '<p class="hint">Văn bản hướng dẫn, mức phạt và điều được dẫn chiếu, xem ngay tại đây.</p>' +
      '<div class="ptabs" id="ptabs">' +
      '<button data-t="hd">Hướng dẫn<span class="c">' + soHd + '</span></button>' +
      '<button data-t="ph">Mức phạt<span class="c">' + soPh + '</span></button>' +
      '<button data-t="dc">Dẫn chiếu</button></div><div id="peek"></div>' +
      (S.meta.cta_url ? '<div class="mini-cta"><b>' + esc(S.meta.cta_tieu_de || 'Kiểm tra tuân thủ') + '</b>Đo khám miễn phí, có kết quả ngay.<br><a class="btn sm" style="margin-top:8px" href="' + esc(S.meta.cta_url) + '">Đo khám →</a></div>' : '') +
      '</aside></div>';

    // cây mục lục
    document.querySelectorAll('#treeSeg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.k === S.mode);
      b.onclick = function () {
        S.mode = b.dataset.k; luuGhi('tvl_mode', S.mode);
        location.hash = '#/dieu/' + id + (nhomCua(d) ? '?nhom=' + encodeURIComponent(nhomCua(d)) : '');
      };
    });
    document.getElementById('treeToggle').onclick = function () { document.getElementById('tree').classList.toggle('collapsed'); };
    var on = document.querySelector('.tree .node.on'), tree = document.getElementById('tree');
    if (on && window.innerWidth > 820) tree.scrollTop = Math.max(0, on.offsetTop - tree.clientHeight / 2);

    // công cụ
    document.getElementById('btnCopy').onclick = function () {
      var url = location.href, b = this;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
        b.textContent = '✓ Đã sao chép';
      }, function () { window.prompt('Sao chép link:', url); });
    };
    function doiCo(k) { S.fs = Math.min(21, Math.max(13, S.fs + k)); luuGhi('tvl_fs', S.fs); document.getElementById('body').style.setProperty('--fs', S.fs + 'px'); }
    document.getElementById('btnNho').onclick = function () { doiCo(-1); };
    document.getElementById('btnTo').onclick = function () { doiCo(1); };

    // bấm dẫn chiếu → mở ở cột phải, không rời trang
    document.getElementById('body').addEventListener('click', function (e) {
      var a = e.target.closest('a.ref');
      if (!a || window.innerWidth <= 820) return;
      e.preventDefault();
      moTab('dc', a.dataset.id);
    });

    // tab đối chiếu
    function moTab(t, focusId) {
      S.ptab = t;
      document.querySelectorAll('#ptabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
      document.getElementById('peek').innerHTML = veTab(d, t, focusId);
    }
    document.querySelectorAll('#ptabs button').forEach(function (b) { b.onclick = function () { moTab(b.dataset.t); }; });
    moTab(soHd ? 'hd' : soPh ? 'ph' : 'dc');
  }

  function theDieu(l, vtLabel) {
    var t = S.dieu[l.den_id];
    if (!t) return '';
    return '<div class="peek"><h3><a href="#/dieu/' + t.id + '">Điều ' + esc(t.so) + '. ' + esc(t.tieu_de) + '</a></h3>' +
      '<div class="vt">' + esc(t._vb.so_hieu) + (l.den_vi_tri ? ' · ' + (vtLabel || '') + esc(l.den_vi_tri) : '') + (l.ghi_chu ? ' · ' + esc(l.ghi_chu) : '') + '</div>' +
      '<div class="body-law">' + noiDungHtml(t) + '</div></div>';
  }

  function veTab(d, t, focusId) {
    if (t === 'hd' || t === 'ph') {
      var loai = t === 'hd' ? 'Hướng dẫn' : 'Xử phạt';
      var ds = d.lien_ket.filter(function (l) { return l.loai === loai; });
      if (!ds.length) return '<div class="empty">' + (t === 'hd'
        ? 'Chưa nạp văn bản hướng dẫn cho điều này.'
        : 'Chưa nạp mức phạt cho điều này.') + '</div>';
      return ds.map(function (l) { return theDieu(l, t === 'ph' ? 'áp dụng ' : ''); }).join('');
    }
    // Dẫn chiếu nội bộ
    var ra = d.lien_ket.filter(function (l) { return l.loai === 'Nội bộ'; });
    var vao = S.nguoc[d.id] || [];
    if (focusId) {
      var l = ra.filter(function (x) { return x.den_id === focusId; })[0] || { den_id: focusId };
      return theDieu(l) + '<a class="btn ghost sm" href="#/dieu/' + focusId + '">Mở trang điều →</a>';
    }
    if (!ra.length && !vao.length) return '<div class="empty">Điều này không dẫn chiếu và không được điều nào dẫn chiếu tới.</div>';
    var h = '';
    if (ra.length) h += '<div class="grp" style="font-size:12px;font-weight:700;color:var(--sw-muted);margin:4px 0">Điều này dẫn chiếu tới</div><div class="mini-list">' +
      ra.map(function (l) { var x = S.dieu[l.den_id]; return x ? '<a href="#/dieu/' + x.id + '" data-peek="' + x.id + '">Điều ' + esc(x.so) + '. ' + esc(x.tieu_de) + (l.den_vi_tri ? ' <small>(' + esc(l.den_vi_tri) + ')</small>' : '') + '</a>' : ''; }).join('') + '</div>';
    if (vao.length) h += '<div class="grp" style="font-size:12px;font-weight:700;color:var(--sw-muted);margin:12px 0 4px">Được dẫn chiếu bởi</div><div class="mini-list">' +
      vao.map(function (id) { var x = S.dieu[id]; return '<a href="#/dieu/' + x.id + '">Điều ' + esc(x.so) + '. ' + esc(x.tieu_de) + '</a>'; }).join('') + '</div>';
    return h;
  }

  // ---------- tìm kiếm ----------
  function ganTimKiem(form) {
    if (!form) return;
    form.onsubmit = function (e) {
      e.preventDefault();
      var q = form.q.value.trim();
      if (q) location.hash = '#/tim?q=' + encodeURIComponent(q);
    };
  }

  // Khớp nguyên từ trên chuỗi đã bỏ dấu (tránh "thu" khớp "thuận")
  function reTu(t) {
    return new RegExp('(^|[^a-z0-9])(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=$|[^a-z0-9])', 'g');
  }
  function demKhop(re, s, max) {
    re.lastIndex = 0; var c = 0;
    while (re.exec(s) && c < max) c++;
    return c;
  }
  function chayTim(q) {
    var fq = fold(q).replace(/\s+/g, ' ').trim();
    var toks = fq.split(' ').filter(function (t) { return t.length > 0; });
    if (!toks.length) return [];
    var reCum = reTu(fq), reToks = toks.map(reTu);
    var kq = [];
    S.idx.forEach(function (x) {
      var all = x.t + ' | ' + x.b + ' | ' + x.k;
      for (var i = 0; i < reToks.length; i++) { reToks[i].lastIndex = 0; if (!reToks[i].test(all)) return; }
      var cumT = demKhop(reCum, x.t, 1), cumB = demKhop(reCum, x.b, 10), cumK = demKhop(reCum, x.k, 1);
      var s = cumT * 60 + cumB * 6 + cumK * 25 + (x.tt === fq ? 80 : 0);
      reToks.forEach(function (re) { s += demKhop(re, x.t, 1) * 8 + demKhop(re, x.b, 5); });
      kq.push({ id: x.id, s: s, fb: x.b, cum: (cumT + cumB + cumK) > 0 });
    });
    return kq.sort(function (a, b) { return b.s - a.s || S.thuTu.indexOf(a.id) - S.thuTu.indexOf(b.id); });
  }

  function viTriDau(re, s) { re.lastIndex = 0; var m = re.exec(s); return m ? m.index + m[1].length : -1; }
  function toSang(text, ftext, toks, fq) {
    // lấy đoạn quanh lần xuất hiện đầu tiên (ưu tiên cả cụm)
    var pos = viTriDau(reTu(fq), ftext);
    if (pos < 0) toks.some(function (t) { pos = viTriDau(reTu(t), ftext); return pos >= 0; });
    var a = Math.max(0, pos - 80), b = Math.min(text.length, (pos < 0 ? 0 : pos) + 170);
    if (pos < 0) { a = 0; b = 170; }
    var doan = text.slice(a, b), fdoan = ftext.slice(a, b);
    var marks = [];
    [fq].concat(toks).forEach(function (t) {
      if (!t) return;
      var re = reTu(t), m;
      while ((m = re.exec(fdoan))) { var st = m.index + m[1].length; marks.push([st, st + t.length]); }
    });
    marks.sort(function (x, y) { return x[0] - y[0]; });
    var out = '', cur = 0;
    marks.forEach(function (m) {
      if (m[0] < cur) return;
      out += esc(doan.slice(cur, m[0])) + '<mark>' + esc(doan.slice(m[0], m[1])) + '</mark>';
      cur = m[1];
    });
    out += esc(doan.slice(cur));
    return (a > 0 ? '…' : '') + out.replace(/\n/g, ' ') + (b < text.length ? '…' : '');
  }

  function timKiem(params) {
    var q = params.get('q') || '';
    var fNhom = params.get('nhom') || '', fVb = params.get('vb') || '', fPhat = params.get('phat') === '1', fAll = params.get('all') === '1';
    document.title = 'Tìm: ' + q + ' – Thư viện luật';
    var tatCa = chayTim(q);
    var coCum = tatCa.filter(function (r) { return r.cum; }).length;
    var chiCum = coCum > 0 && !fAll && /\s/.test(q.trim());
    if (chiCum) tatCa = tatCa.filter(function (r) { return r.cum; });
    var soThem = chayTim(q).length - tatCa.length;
    var kq = tatCa.filter(function (r) {
      var d = S.dieu[r.id];
      if (fNhom && d.nhom.indexOf(fNhom) < 0) return false;
      if (fVb && d.ma_vb !== fVb) return false;
      if (fPhat && !d.lien_ket.some(function (l) { return l.loai === 'Xử phạt'; })) return false;
      return true;
    });
    var fq = fold(q).trim(), toks = fq.split(/\s+/).filter(Boolean);

    function link(k, v) {
      var p = new URLSearchParams(); p.set('q', q);
      if (fNhom) p.set('nhom', fNhom); if (fVb) p.set('vb', fVb); if (fPhat) p.set('phat', '1'); if (fAll) p.set('all', '1');
      if (v) p.set(k, v); else p.delete(k);
      return '#/tim?' + p.toString();
    }
    var demNhom = {};
    tatCa.forEach(function (r) { S.dieu[r.id].nhom.forEach(function (m) { demNhom[m] = (demNhom[m] || 0) + 1; }); });
    var demVb = {};
    tatCa.forEach(function (r) { var m = S.dieu[r.id].ma_vb; demVb[m] = (demVb[m] || 0) + 1; });

    var loc = '<h3>Nhóm tình huống</h3>' + S.nhom.tinh_huong.filter(function (n) { return demNhom[n.ma]; }).map(function (n) {
      var on = fNhom === n.ma;
      return '<label><input type="checkbox" ' + (on ? 'checked' : '') + ' data-go="' + link('nhom', on ? '' : n.ma) + '"> ' + esc(n.ten) + '<span>' + demNhom[n.ma] + '</span></label>';
    }).join('') +
      '<h3>Văn bản</h3>' + S.meta.van_ban.filter(function (v) { return demVb[v.ma_vb]; }).map(function (v) {
        var on = fVb === v.ma_vb;
        return '<label><input type="checkbox" ' + (on ? 'checked' : '') + ' data-go="' + link('vb', on ? '' : v.ma_vb) + '"> ' + esc(v.so_hieu) + '<span>' + demVb[v.ma_vb] + '</span></label>';
      }).join('') +
      '<h3>Loại</h3><label><input type="checkbox" ' + (fPhat ? 'checked' : '') + ' data-go="' + link('phat', fPhat ? '' : '1') + '"> Chỉ điều có mức phạt</label>';

    var ds = kq.slice(0, 60).map(function (r) {
      var d = S.dieu[r.id];
      return '<div class="res"><a class="t" href="#/dieu/' + d.id + '">Điều ' + esc(d.so) + '. ' + esc(d.tieu_de) + '</a>' +
        '<div class="s">' + toSang(d.noi_dung, r.fb, toks, fq) + '</div><div class="m"><span class="pill pill-luat">' + esc(d._vb.so_hieu) + '</span>' +
        d.nhom.map(function (m) { return S.nhomMap[m] ? '<span class="pill pill-pri">' + esc(S.nhomMap[m].ten) + '</span>' : ''; }).join('') +
        (d.chuong ? '<span class="pill pill-blue">Chương ' + esc(d.chuong) + '</span>' : '') + '</div></div>';
    }).join('');

    app.innerHTML =
      '<div class="sr-top"><form class="search" id="srSearch" role="search" style="max-width:none;box-shadow:none"><span aria-hidden="true">🔎</span>' +
      '<input name="q" value="' + esc(q) + '" aria-label="Từ khóa"><button class="btn" type="submit">Tìm</button></form></div>' +
      '<div class="sr"><aside class="filters"><b>' + kq.length + ' kết quả</b>' + loc + '</aside>' +
      '<div class="results">' +
      (chiCum && soThem > 0 ? '<p class="sub">Đang hiện các điều chứa đúng cụm "' + esc(q) + '". <a href="' + link('all', '1') + '">Xem thêm ' + soThem + ' điều chứa từng từ riêng lẻ</a></p>' : '') +
      (ds || '<div class="empty">Không tìm thấy điều nào khớp. Thử bỏ bớt từ khóa hoặc gõ không dấu.</div>') +
      (kq.length > 60 ? '<p class="sub">Hiện 60 kết quả đầu. Thêm từ khóa để thu hẹp.</p>' : '') +
      '<p class="sub" style="margin-top:16px">Tìm không phân biệt có dấu: gõ "thu viec" cũng ra "thử việc".</p></div></div>';

    var f = document.getElementById('srSearch');
    ganTimKiem(f);
    if (!q) f.q.focus();
    document.querySelectorAll('.filters input[data-go]').forEach(function (i) {
      i.onchange = function () { location.hash = i.dataset.go; };
    });
  }

  // ---------- đối chiếu 3 cột ----------
  function doiChieu(id) {
    var d = S.dieu[id];
    if (!d) { app.innerHTML = '<div class="error">Không có điều ' + esc(id) + '.</div>'; return; }
    var v = d._vb;
    document.title = 'Đối chiếu Điều ' + d.so + ' – Thư viện luật';
    var hd = d.lien_ket.filter(function (l) { return l.loai === 'Hướng dẫn'; });
    var ph = d.lien_ket.filter(function (l) { return l.loai === 'Xử phạt'; });
    function cot(ds, loai) {
      if (!ds.length) return '<div class="empty">' + (loai === 'hd'
        ? 'Chưa có văn bản hướng dẫn cho điều này. Có thể điều này áp dụng trực tiếp, hoặc chưa được nạp.'
        : 'Chưa nạp mức phạt cho điều này.') + '</div>';
      return ds.map(function (l) {
        var t = S.dieu[l.den_id]; if (!t) return '';
        var head = '<div class="vt">' + esc(t._vb.so_hieu) + ' · Điều ' + esc(t.so) + (l.den_vi_tri ? ' · ' + esc(l.den_vi_tri) : '') + '</div>';
        if (loai === 'ph') return '<div class="pen">' + head.replace('class="vt"', 'class="vt"') + '<div class="body-law">' + noiDungHtml(t) + '</div></div>';
        return '<div class="peek">' + head + '<h3>' + esc(t.tieu_de) + '</h3><div class="body-law">' + noiDungHtml(t) + '</div></div>';
      }).join('');
    }
    var ds = S.thuTu.filter(function (x) { return S.dieu[x].ma_vb === d.ma_vb; });
    var i = ds.indexOf(id), truoc = S.dieu[ds[i - 1]], sau = S.dieu[ds[i + 1]];
    app.innerHTML = '<div class="cmp">' +
      '<div class="sec-head"><div><nav class="crumb"><a href="#/">Thư viện</a> › <a href="#/dieu/' + id + '">Điều ' + esc(d.so) + '</a> › Đối chiếu</nav>' +
      '<h1 style="font-size:22px;margin:4px 0 0">Đối chiếu: Điều ' + esc(d.so) + '. ' + esc(d.tieu_de) + '</h1></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      (truoc ? '<a class="btn ghost sm" href="#/doi-chieu/' + truoc.id + '">← Điều ' + esc(truoc.so) + '</a>' : '') +
      (sau ? '<a class="btn ghost sm" href="#/doi-chieu/' + sau.id + '">Điều ' + esc(sau.so) + ' →</a>' : '') +
      '<a class="btn ghost sm" href="#/dieu/' + id + '">Về trang điều</a></div></div>' +
      '<div class="par">' +
      '<section><p class="lbl">📕 Luật</p><h2>' + esc(v.so_hieu) + ' · Điều ' + esc(d.so) + '</h2><div class="body-law">' + noiDungHtml(d) + '</div></section>' +
      '<section><p class="lbl">📗 Hướng dẫn</p><h2>Nghị định / Thông tư</h2>' + cot(hd, 'hd') + '</section>' +
      '<section><p class="lbl">⚠ Mức phạt</p><h2>Xử phạt vi phạm hành chính</h2>' + cot(ph, 'ph') + '</section>' +
      '</div></div>';
  }

  // ---------- khởi động ----------
  function khungChung() {
    var foot = document.getElementById('foot');
    foot.textContent = (S.meta.mien_tru || '') + (S.meta.cap_nhat ? ' · Cập nhật ' + S.meta.cap_nhat : '') + ' · © Second Wind';
    var cta = document.getElementById('headCta');
    if (S.meta.cta_url) { cta.href = S.meta.cta_url; cta.hidden = false; }
    ganTimKiem(document.getElementById('headSearch'));
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        var i = document.querySelector('#homeSearch input, #srSearch input, #headSearch input');
        if (i) { e.preventDefault(); i.focus(); }
      }
    });
  }

  napDuLieu().then(function () {
    khungChung();
    window.addEventListener('hashchange', route);
    route();
  }).catch(function (e) {
    app.innerHTML = '<div class="error">Không tải được dữ liệu thư viện (' + esc(e.message) + ').<br>' +
      'Nếu đang mở file trực tiếp trên máy, hãy chạy qua máy chủ tĩnh: <code>python -m http.server</code> trong thư mục thu-vien-luat.</div>';
  });
})();
