---
name: mobile-map-tracker
description: 纯前端移动地图轨迹记录网页的开发方法（高德JS API 2.0 版，高德高精度定位 → IP 兜底，不含 WGS-84 转换）
source: auto-skill
extracted_at: '2026-06-08T10:00:00.000Z'
---

# 移动端地图轨迹记录网页开发

## 概述

纯前端移动端轨迹记录网页。使用**高德地图 JS API 2.0** 直接渲染地图。包含自动定位记录轨迹、手动点击添加轨迹点、骰子导航提示、导入导出和分享图片（含地图瓦片底图 + 轨迹叠加）功能。

## 技术栈

- **HTML/CSS/JavaScript** — 纯前端，无后端
- **高德地图 JS API 2.0** — 地图 + Marker + Polyline + Geolocation 插件
- **Canvas API** — 动态生成 player 图标 + 分享图片渲染（异步加载高德瓦片 API 后叠加轨迹）
- **高德 Geolocation** — `Geolocation.getCurrentPosition` 定时调用（每 3 秒）获取位置用于自动记录
- **Node.js 纯函数测试** — `test.js` 验证瓦片坐标转换、Canvas 映射、notifyTileLoaded 协作等核心逻辑

## 核心设计理念

1. **启动时获取定位** — 高德高精度定位（GPS/基站/WiFi 混合，返回 GCJ-02），失败后 IP 定位兜底，地图自动居中
2. **动态图标生成** — 使用 Canvas 2D 生成 player 图标 data URL，不依赖外部图片文件
3. **自动定位记录轨迹** — 录制中通过 `setInterval` 每 3 秒调用高德 `Geolocation.getCurrentPosition` 获取位置，自动添加轨迹点（含防重复逻辑）
4. **手动点击辅助** — 录制中也可点击地图手动添加点
5. **分享图片含底图** — 异步加载高德瓦片 API 后叠加轨迹生成分享图

> **定位策略决策**：完全使用高德定位，不依赖浏览器原生 `navigator.geolocation`。高德 `Geolocation` 插件在 `enableHighAccuracy: true` 时自动使用 GPS/基站/WiFi 混合定位，直接返回 GCJ-02 坐标，无需 WGS-84→GCJ-02 转换。

## 高德地图配置

### 引入方式

在 `index.html` 末尾按顺序引入：

```html
<!-- 1. 安全密钥（必须在地图脚本之前） -->
<script>
  window._AMapSecurityConfig = {
    securityJsCode: 'fe24904399016ca077f5314a90d528a4',
  };
</script>
<!-- 2. 地图 JS API -->
<script src="https://webapi.amap.com/maps?v=2.0&key=你的Key&plugin=AMap.Geolocation"></script>
```

### 初始化

```javascript
state.map = new AMap.Map('map', {
  zoom: 16,
  center: [经度, 纬度],  // 注意：[lng, lat] 顺序
  viewMode: '2d',
});
```

### 定位（浏览器优先 + IP 兜底）

启动时先尝试浏览器定位，精度<500m 才使用；失败则用高德 IP 定位；都失败则用默认中心。

```javascript
function startLocation() {
  // 高德定位控件（仅 UI 显示）
  state.geolocation = new AMap.Geolocation({
    enableHighAccuracy: false,
    timeout: 8000,
    position: 'LB',
    buttonOffset: new AMap.Pixel(10, 20),
    showMarker: false,
    showCircle: false,
    panToLocation: false,
    zoomToAccuracy: false,
  });
  state.map.addControl(state.geolocation);

  // 优先浏览器定位
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        if (pos.coords.accuracy < 500) {
          state.map.setCenter([pos.coords.longitude, pos.coords.latitude]);
        }
        showDefaultMarker();
      },
      function() {
        // 失败 → 高德 IP 定位
        getIPLocation();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  } else {
    getIPLocation();
  }
}

function getIPLocation() {
  // 动态加载 JSONP 脚本
  var script = document.createElement('script');
  script.src = 'https://restapi.amap.com/v3/ip?key=你的Key&callback=ipLocationCallback';
  window.ipLocationCallback = function(data) {
    if (data.status === '1' && data.location) {
      var coords = data.location.split(',');
      state.map.setCenter([parseFloat(coords[0]), parseFloat(coords[1])]);
    }
    showDefaultMarker();
  };
  document.body.appendChild(script);
}

function showDefaultMarker() {
  var center = state.map.getCenter();
  var iconDataUrl = createPlayerIcon();
  var markerIcon = new AMap.Icon({
    size: new AMap.Size(96, 96),
    imageSize: new AMap.Size(96, 96),
    image: iconDataUrl,
  });
  state.userMarker = new AMap.Marker({
    position: [center.lng, center.lat],
    icon: markerIcon,
    offset: new AMap.Pixel(-48, -48),
    zIndex: 1000,
    draggable: false,
  });
  state.map.add(state.userMarker);
}
```

### 动态 player 图标（Canvas 2D 生成）

不依赖外部图片文件，用 Canvas 2D 绘制后转为 data URL：

```javascript
function createPlayerIcon() {
  var canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 96;
  var ctx = canvas.getContext('2d');

  // 紫色渐变圆形背景
  var grad = ctx.createRadialGradient(48, 48, 10, 48, 48, 46);
  grad.addColorStop(0, '#764ba2');
  grad.addColorStop(1, '#667eea');
  ctx.beginPath();
  ctx.arc(48, 48, 46, 0, Math.PI * 2);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke();

  // 红色朝上箭头
  ctx.beginPath();
  ctx.moveTo(48, 18);
  ctx.lineTo(36, 38);
  ctx.lineTo(54, 38);
  ctx.closePath();
  ctx.fillStyle = '#ff4d4f'; ctx.fill();

  // 白色身体圆点
  ctx.beginPath();
  ctx.arc(48, 58, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();

  return canvas.toDataURL();
}
```

### 轨迹绘制

```javascript
var path = state.trajectory.map(function(p) { return [p.lng, p.lat]; });
state.routePolyline = new AMap.Polyline({
  path: path,
  strokeColor: '#ff4d4f',
  strokeWeight: 5,
  strokeOpacity: 0.85,
  lineJoin: 'round',
  lineCap: 'round',
});
state.map.add(state.routePolyline);
state.map.setFitView([state.routePolyline]);
```

### 录制逻辑（自动定位记录 + 手动点击辅助）

- **开始**：清空轨迹 → 记录 startTime → 启动 `watchPosition` 持续监听位置 → 地图点击事件也可手动添加点
- **暂停/继续**：清除/恢复计时器
- **停止**：清除 `watchPosition` → 清除定时器 → 绘制完整轨迹线 → 起终点标记

#### 自动定位记录

点击录制后，通过 `navigator.geolocation.watchPosition` 持续监听位置变化，自动添加轨迹点。

```javascript
function startAutoTrack() {
  // 清除旧的 watch（防止重复注册）
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
  }

  state.watchId = navigator.geolocation.watchPosition(
    function(position) {
      if (!state.isRecording || state.isPaused) return;

      var lng = position.coords.longitude;
      var lat = position.coords.latitude;
      var accuracy = position.coords.accuracy;

      // 精度太差就忽略（> 50 米）
      if (accuracy > 50) return;

      if (state.trajectory.length === 0) {
        addPoint(lng, lat);  // 第一点无条件记录
      } else {
        var last = state.trajectory[state.trajectory.length - 1];
        var dist = haversine(last.lat, last.lng, lat, lng);
        var timeDiff = Date.now() - last.timestamp;

        // 至少移动 15 米才记录新点（避免静止时重复记录）
        // 但如果停在原地超过 30 秒也会重新记录（处理 GPS 漂移）
        // 用户走回头路时，相同坐标会因为距离差 >= 15 米被正常记录
        if (dist >= 15 || (dist < 0.5 && timeDiff > 30000)) {
          addPoint(lng, lat);
        }
      }
    },
    function(err) {
      // 定位失败不处理，下一次定时再试
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000,  // 允许使用 3 秒内的缓存定位
    }
  );
}
```

#### 停止时清理定位 watcher

```javascript
function stopRecord() {
  state.isRecording = false;
  state.isPaused = false;

  clearInterval(state.timerInterval);
  clearInterval(state.autoInterval);

  // 清理定位 watcher
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  dom.recordBtn.className = 'bar-btn';
  dom.recordBtn.querySelector('svg circle').setAttribute('r', '8');
  dom.recordBtn.querySelector('.btn-label').textContent = '录制';

  drawRoute();
  updateOverlay();
}
```

#### 点击地图手动添加点（辅助功能）

录制中仍然可以通过点击地图添加点，与自动记录互补：

```javascript
state.map.on('click', function(e) {
  if (!state.isRecording || state.isPaused) return;
  addPoint(e.lnglat.lng, e.lnglat.lat);
});
```

### 导入导出

- 导出：JSON blob → `URL.createObjectURL` → 创建 `<a download>` 触发下载
- 导入：`FileReader` 读取 `.json` → 解析 → 绘制轨迹

### 分享图片（Canvas 720x900，含真实高德瓦片底图 + 轨迹叠加）

> **注意**：不再直接截取 AMap canvas（受跨域限制），改为异步加载真实高德瓦片 API，再叠加轨迹。

#### 完整流程

```javascript
function renderShareImage() {
  var canvas = dom.shareCanvas;
  var W = 720, H = 900;
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');

  // 底色
  ctx.fillStyle = '#f5f7fa';
  ctx.fillRect(0, 0, W, H);

  var mapH = Math.floor(H * 0.65);
  var r = 12, x = 8, y = 8, w = W - 16, h = mapH - 16;

  // 圆角裁剪
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  // ... 圆角路径 ...
  ctx.closePath();
  ctx.clip();

  // ✅ 注意：不要用 drawSimpleMapGrid（假网格）替代真实瓦片
  var bounds = getTrajBounds();  // 用轨迹 bounds，不是 map.getBounds()
  if (bounds) {
    drawMapAndRouteOnCanvas(ctx, x, y, w, h, bounds);
  }
  ctx.restore();

  // 圆角边框
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  // ... 描边 ...

  // 统计数据
  drawStatsCanvas(ctx, W, H, mapH);
}
```

#### 瓦片加载 + 轨迹绘制函数

```javascript
function drawMapAndRouteOnCanvas(ctx, tx, ty, tw, th, bounds) {
  // 1. 加载瓦片底图
  loadMapTiles(ctx, tx, ty, tw, th, bounds, function() {
    // 2. 在瓦片上叠加轨迹
    drawRouteOverlay(ctx, tx, ty, tw, th, bounds);
  });
}

function loadMapTiles(ctx, tx, ty, tw, th, bounds, callback) {
  var zoom = state.map.getZoom();

  // 计算需要加载的瓦片范围
  var tileMinX = lonToTile(bounds.minLng, zoom);
  var tileMaxX = lonToTile(bounds.maxLng, zoom);
  var tileMinY = latToTile(bounds.minLat, zoom);
  var tileMaxY = latToTile(bounds.maxLat, zoom);

  var tiles = [];
  for (var row = tileMinY; row <= tileMaxY; row++) {
    for (var col = tileMinX; col <= tileMaxX; col++) {
      tiles.push({ row: row, col: col });
      total++;
    }
  }

  // 异步加载每个瓦片，等待全部完成后回调
  var loaded = 0, total = tiles.length;
  function onTileLoad() { loaded++; if (loaded >= total) callback(); }

  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i];
    var img = new Image();
    img.crossOrigin = 'anonymous';
    var tileUrl = 'https://webrd0' + (t.col % 4) + '.is.autonavi.com/appmaptile?x=' + t.col + '&y=' + t.row + '&z=' + zoom + '&lang=zh_cn&size=1&scl=1&style=8';

    img.onload = function() {
      var lon = tileToLon(t.col, t.row, zoom);
      var lat = tileToLat(t.row, t.col, zoom);
      var pos = lonLatToCanvas(lon, lat, bounds, tw, th, tx, ty);
      ctx.drawImage(this, pos.x, pos.y, 256, 256);
      onTileLoad();
    };
    img.onerror = function() {
      var lon = tileToLon(t.col, t.row, zoom);
      var lat = tileToLat(t.row, t.col, zoom);
      var pos = lonLatToCanvas(lon, lat, bounds, tw, th, tx, ty);
      ctx.fillStyle = '#e5e5e5';
      ctx.fillRect(pos.x, pos.y, 256, 256);
      onTileLoad();
    };
    img.src = tileUrl;
  }
}

function drawRouteOverlay(ctx, tx, ty, tw, th, bounds) {
  if (state.trajectory.length < 2) return;

  function toC(lat, lng) {
    var lngFrac = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 0.001);
    var latFrac = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 0.001);
    return [tx + lngFrac * tw, ty + latFrac * th];
  }

  // 轨迹线
  ctx.beginPath();
  var fp = toC(state.trajectory[0].lat, state.trajectory[0].lng);
  ctx.moveTo(fp[0], fp[1]);
  for (var i = 1; i < state.trajectory.length; i++) {
    var p = toC(state.trajectory[i].lat, state.trajectory[i].lng);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.strokeStyle = '#ff4d4f';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 起点（绿圆）/ 终点（红圆）
  var sp = toC(state.trajectory[0].lat, state.trajectory[0].lng);
  ctx.beginPath(); ctx.arc(sp[0], sp[1], 5, 0, Math.PI*2);
  ctx.fillStyle = '#52c41a'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

  var ep = toC(state.trajectory[state.trajectory.length-1].lat, state.trajectory[state.trajectory.length-1].lng);
  ctx.beginPath(); ctx.arc(ep[0], ep[1], 5, 0, Math.PI*2);
  ctx.fillStyle = '#ff4d4f'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
}

// 经纬度 <-> 瓦片坐标转换
function lonToTile(lng, zoom) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
}
function latToTile(lat, zoom) {
  var latRad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(latRad) + 1/Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
}
function tileToLon(col, row, zoom) {
  return col / Math.pow(2, zoom) * 360 - 180;
}
function tileToLat(row, col, zoom) {
  var n = Math.PI - 2 * Math.PI * row / Math.pow(2, zoom);
  return Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) * 180 / Math.PI;
}
function lonLatToCanvas(lng, lat, bounds, w, h, tx, ty) {
  var x = tx + (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng) * w;
  var y = ty + (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat) * h;
  return { x: x, y: y };
}
```

#### 为什么不用 `map.getContainer().querySelector('canvas')` 了

- AMap canvas 可能被跨域污染，导致 `toDataURL` 不可用
- 截取的是当前视口 DOM canvas，缩放/旋转后可能模糊
- 直接调用高德瓦片 API 可获得更清晰的真实底图

#### 高德瓦片 API 说明

- **URL 格式**：`https://webrd0{0-3}.is.autonavi.com/appmaptile?x={col}&y={row}&z={zoom}&lang=zh_cn&size=1&scl=1&style=8`
- **负载均衡**：`webrd00` ~ `webrd03` 四台服务器轮换（`col % 4`）
- **坐标系**：GCJ-02（高德坐标系），与 AMap JS API 一致
- **返回**：256x256 PNG 瓦片

## 界面架构

```
+------------------------+
|   Map Area (60-80%)    |  <- 高德地图 + 动态生成的 player 图标
|   + recording overlay  |  <- 录制状态 + 实时距离
+------------------------+
|  [录制]  [掷骰子]  [更多] |  <- 底部三个图标按钮
+------------------------+
```

## 关键注意事项

1. **高德坐标顺序** — `[经度, 纬度]`（`[lng, lat]`），与 Leaflet 相反
2. **动态图标** — 使用 `createPlayerIcon()` 生成 data URL 作为 marker icon，不依赖 `img/` 目录
3. **定位优先级** — 浏览器定位 → 高德 IP 定位 → 默认坐标（北京）
4. **浏览器定位精度** — `accuracy < 500m` 才使用，过宽则降级
5. **IP 定位** — 通过 JSONP 动态加载，城市级精度
6. **自动定位记录** — 录制中通过 `navigator.geolocation.watchPosition` 持续监听，自动添加轨迹点
7. **防重复记录** — 距离阈值 15 米 + 时间兜底 30 秒，既避免静止重复又保留回头路
8. **定位 watcher 清理** — 停止录制时必须 `clearWatch(state.watchId)`，否则后台持续消耗电量
9. **viewport** — CSS 使用 `100dvh` 而非 `100vh`
10. **安全区域** — `padding-bottom: max(12px, env(safe-area-inset-bottom))`
11. **高德插件** — 在 URL 的 `plugin=` 参数中添加
12. **安全密钥** — 通过 `window._AMapSecurityConfig` 在地图脚本前设置
13. **分享底图** — 异步加载高德瓦片 API 生成真实底图（`loadMapTiles`），再叠加轨迹（`drawRouteOverlay`），不再截取 AMap DOM canvas
14. **轨迹 canvas 映射** — 用 `map.getBounds()` 的经纬度范围映射到 canvas 坐标（`lonLatToCanvas`）
15. **弹窗** — `modal-backdrop` 点击关闭
16. **自动化测试** — `node test.js` 可验证瓦片坐标转换、Canvas 映射、notifyTileLoaded 协作等核心逻辑
17. **CircleMarker zIndex 不生效** — 高德 2.0 中 CircleMarker 的 zIndex 无效，定位标记等需要始终在顶层的元素应改用 DOM 型 AMap.Marker + CSS
18. **分享图片不要用简易网格** — `renderShareImage` 中必须调用 `drawMapAndRouteOnCanvas`（真实瓦片），`drawSimpleMapGrid` 只是备用方案
19. **起终点 Marker** — 建议用 `AMap.CircleMarker`（绿色起点/红色终点），属性用 `fillColor`/`strokeColor`/`strokeWeight`
