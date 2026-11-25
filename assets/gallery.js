/* ============================================================
   gallery.js —— 图库页逻辑
   数据来自 assets/gallery/photos.json（由 scripts/gallery/build.mjs 生成），
   这里只做三件事：筛（地点 / 年份 / 标签组合）、分批铺网格、开灯箱。
   ============================================================ */

(function () {
    'use strict';

    var el = function (id) { return document.getElementById(id); };
    var PAGE = 24;                                     // 一次铺多少张
    var state = { city: null, year: null, tags: new Set() };
    var photos = [];
    var list = [];                                     // 当前筛选结果
    var shown = 0;                                     // 已经铺到页面上的数量

    var fmtDate = function (d) { return String(d || '').replace(/-/g, '.'); };

    /* ---------- 筛选 ---------- */
    // skipKind / skipValue：算某个选项的「还有多少张」时，跳过它自己那一维
    function match(p, skipKind, skipValue) {
        if (skipKind !== 'city' && state.city && p.city !== state.city) return false;
        if (skipKind !== 'year' && state.year && p.date.slice(0, 4) !== state.year) return false;
        for (var t of state.tags) {
            if (skipKind === 'tag' && t === skipValue) continue;
            if (p.tags.indexOf(t) < 0) return false;
        }
        if (skipKind === 'tag' && skipValue && p.tags.indexOf(skipValue) < 0) return false;
        if (skipKind === 'city' && skipValue && p.city !== skipValue) return false;
        if (skipKind === 'year' && skipValue && p.date.slice(0, 4) !== skipValue) return false;
        return true;
    }

    function countOf(kind, value) {
        var n = 0;
        for (var p of photos) if (match(p, kind, value)) n++;
        return n;
    }

    /* ---------- 三行筛选项 ---------- */
    function buildRail(box, kind, values, pressedOf, onPick) {
        var prevScroll = box.scrollLeft;
        box.textContent = '';
        for (var v of values) {
            var n = countOf(kind, v);
            var pressed = pressedOf(v);
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.dataset.kind = kind;
            b.setAttribute('aria-pressed', String(pressed));
            b.disabled = n === 0 && !pressed;
            b.append(v);
            var s = document.createElement('span');
            s.className = 'chip__n';
            s.textContent = n;
            b.append(s);
            b.addEventListener('click', function (v) { return function () { onPick(v); }; }(v));
            box.append(b);
        }
        box.scrollLeft = prevScroll;
        box.dataset.noscroll = box.scrollWidth <= box.clientWidth ? '1' : '';
    }

    var CITIES = [];
    var YEARS = [];

    function renderFilters() {
        // 标签按「当前还能选出多少张」排序，有货的往前站
        var seen = new Set();
        var pool = [];
        for (var p of photos) {
            for (var t of p.tags) if (!seen.has(t)) { seen.add(t); pool.push(t); }
        }
        var tagItems = pool
            .map(function (t) { return [t, countOf('tag', t)]; })
            .filter(function (x) { return x[1] > 0 || state.tags.has(x[0]); })
            .sort(function (a, b) { return b[1] - a[1]; });

        buildRail(el('railCity'), 'city', CITIES, function (v) { return state.city === v; }, function (v) {
            state.city = state.city === v ? null : v;
            render();
        });
        buildRail(el('railYear'), 'year', YEARS, function (v) { return state.year === v; }, function (v) {
            state.year = state.year === v ? null : v;
            render();
        });
        buildRail(el('railTag'), 'tag', tagItems.map(function (x) { return x[0]; }),
            function (v) { return state.tags.has(v); }, function (v) {
                if (state.tags.has(v)) state.tags.delete(v);
                else state.tags.add(v);
                render();
            });
    }

    function renderSummary() {
        var box = el('summary');
        var parts = [];
        if (state.city) parts.push(state.city);
        if (state.year) parts.push(state.year + ' 年');
        state.tags.forEach(function (t) { parts.push('#' + t); });
        if (!parts.length) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        var span = document.createElement('span');
        span.append('已选 ');
        var b1 = document.createElement('b');
        b1.textContent = parts.join(' · ');
        var b2 = document.createElement('b');
        b2.textContent = String(list.length);
        span.append(b1, '，共 ', b2, ' 张');
        el('summaryText').replaceChildren(span);
    }

    /* ---------- 网格 ---------- */
    function makeShot(p) {
        var fig = document.createElement('figure');
        fig.className = 'shot';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'shot__btn';
        btn.setAttribute('aria-label', p.city + ' ' + fmtDate(p.date) + '，查看大图与拍摄信息');

        var img = document.createElement('img');
        img.className = 'shot__img';
        img.alt = p.city + ' ' + fmtDate(p.date);
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = p.w;
        img.height = p.h;
        img.dataset.loading = '1';
        img.addEventListener('load', function () {
            img.dataset.ready = '1';
            delete img.dataset.loading;
        }, { once: true });
        img.addEventListener('error', function () {
            img.dataset.ready = '1';
            delete img.dataset.loading;
        }, { once: true });
        img.src = p.thumb;

        var badge = document.createElement('span');
        badge.className = 'shot__badge';
        badge.textContent = p.tags.map(function (t) { return '#' + t; }).join(' ');

        btn.append(img, badge);
        btn.addEventListener('click', function () { openLightbox(p); });

        var meta = document.createElement('div');
        meta.className = 'shot__meta';
        var d = document.createElement('span');
        d.textContent = fmtDate(p.date).slice(5);
        var sep = document.createElement('span');
        sep.className = 'shot__sep';
        sep.textContent = '/';
        var place = document.createElement('span');
        place.className = 'shot__place';
        place.textContent = p.city;
        meta.append(d, sep, place);

        fig.append(btn, meta);
        return fig;
    }

    function appendPage() {
        var grid = el('grid');
        var end = Math.min(shown + PAGE, list.length);
        var frag = document.createDocumentFragment();
        for (var i = shown; i < end; i++) frag.append(makeShot(list[i]));
        grid.append(frag);
        shown = end;
        updateSentinel();
    }

    function updateSentinel() {
        var s = el('sentinel');
        var bar = s.querySelector('.sentinel__bar');
        if (!list.length) {
            s.hidden = true;
            return;
        }
        s.hidden = false;
        if (shown >= list.length) {
            bar.style.display = 'none';
            el('sentinelText').textContent = '共 ' + list.length + ' 张，已经到底了';
        } else {
            bar.style.display = '';
            el('sentinelText').textContent = '已显示 ' + shown + ' / ' + list.length + ' 张';
        }
    }

    function render() {
        list = photos.filter(function (p) { return match(p, null, null); });
        shown = 0;
        el('grid').textContent = '';

        renderFilters();
        renderSummary();

        if (!list.length) {
            var empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = photos.length
                ? '没有符合当前筛选的照片。'
                : '图库里还没有照片。';
            el('grid').append(empty);
            el('sentinel').hidden = true;
            return;
        }
        appendPage();
    }

    var io = new IntersectionObserver(function (entries) {
        for (var e of entries) {
            if (e.isIntersecting && shown < list.length) appendPage();
        }
    }, { rootMargin: '600px 0px' });

    /* ---------- 灯箱 ---------- */
    var lb, current = null;

    function openLightbox(p) {
        current = p;
        var i = list.findIndex(function (x) { return x.id === p.id; });
        el('lbIdx').textContent = String(i + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0');

        var img = el('lbImg');
        img.src = p.src;
        img.alt = p.city + ' ' + fmtDate(p.date);
        el('lbWhere').textContent = p.city;
        el('lbWhen').textContent = fmtDate(p.date);

        var rows = [
            ['机身', p.camera],
            ['镜头', p.lens],
            ['焦距', p.focal],
            ['光圈', p.f],
            ['快门', p.shutter],
            ['感光度', p.iso]
        ];
        var exif = el('lbExif');
        exif.textContent = '';
        for (var r of rows) {
            if (!r[1]) continue;                       // 没有这一项就不显示，不留空行
            var dt = document.createElement('dt');
            dt.textContent = r[0];
            var dd = document.createElement('dd');
            dd.textContent = r[1];
            exif.append(dt, dd);
        }
        exif.hidden = exif.childElementCount === 0;

        var tags = el('lbTags');
        tags.textContent = '';
        for (var t of p.tags) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.dataset.kind = 'tag';
            b.textContent = '#' + t;
            b.addEventListener('click', function (t) {
                return function () {
                    state.tags.add(t);
                    lb.close();
                    render();
                };
            }(t));
            tags.append(b);
        }
        tags.hidden = !p.tags.length;

        if (!lb.open) lb.showModal();
    }

    function step(dir) {
        if (!list.length || !current) return;
        var i = list.findIndex(function (x) { return x.id === current.id; });
        openLightbox(list[(i + dir + list.length) % list.length]);
    }

    function bindLightbox() {
        lb = el('lb');
        el('lbClose').addEventListener('click', function () { lb.close(); });
        lb.addEventListener('click', function (e) { if (e.target === lb) lb.close(); });
        lb.querySelector('[data-dir="prev"]').addEventListener('click', function () { step(-1); });
        lb.querySelector('[data-dir="next"]').addEventListener('click', function () { step(1); });
        lb.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        });
        // 从灯箱跳出去筛选之前，先关掉，否则背后的页面没法滚
        lb.addEventListener('close', function () { current = null; });
    }

    /* ---------- 启动 ---------- */
    function boot(data) {
        photos = (data.photos || []).slice().sort(function (a, b) {
            return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
        });

        var citySet = new Set(), yearSet = new Set(), tagSet = new Set();
        for (var p of photos) {
            citySet.add(p.city);
            yearSet.add(p.date.slice(0, 4));
            for (var t of p.tags) tagSet.add(t);
        }
        CITIES = Array.from(citySet).sort();
        YEARS = Array.from(yearSet).sort().reverse();

        el('statPhotos').textContent = photos.length;
        el('statCities').textContent = CITIES.length;
        el('statYears').textContent = YEARS.length;
        el('statTags').textContent = tagSet.size;

        bindLightbox();
        io.observe(el('sentinel'));

        el('clear').addEventListener('click', function () {
            state.city = null;
            state.year = null;
            state.tags.clear();
            render();
        });

        render();
        document.documentElement.dataset.galleryReady = '1';
    }

    function fail(msg) {
        var box = el('grid');
        if (!box) return;
        box.textContent = '';
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = msg;
        box.append(empty);
        el('sentinel').hidden = true;
        document.documentElement.dataset.galleryReady = '1';
    }

    fetch('assets/gallery/photos.json', { cache: 'no-cache' })
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(boot)
        .catch(function (err) {
            console.error('[gallery]', err);
            fail('照片数据没能加载出来（assets/gallery/photos.json）。'
                + '如果是在本地直接双击打开本页，浏览器会拦掉读取 JSON：请用本地服务器打开，或者直接上看线上的图库页。');
        });
})();