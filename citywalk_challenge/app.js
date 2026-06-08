// ========== 全局状态 ==========
var state = {
  currentPosition: null,
  heading: null,
  isRecording: false,
  isPaused: false,
  trajectory: [],
  startTime: null,
  elapsedTime: 0,
  timerInterval: null,
  autoInterval: null,
  map: null,
  userMarker: null,
  routePolyline: null,
  startMarker: null,
  endMarker: null,
  geolocation: null,
  // 模拟模式
  isSimulating: false,
  simTimer: null,
  simHeading: 0,
};

// ========== DOM ==========
var dom = {
  map: document.getElementById('map'),
  mapArea: document.getElementById('mapArea'),
  recordBtn: document.getElementById('recordBtn'),
  diceBtn: document.getElementById('diceBtn'),
  moreBtn: document.getElementById('moreBtn'),
  moreMenu: document.getElementById('moreMenu'),
  importInput: document.getElementById('importInput'),
  importBtn: document.getElementById('importBtn'),
  exportBtn: document.getElementById('exportBtn'),
  shareBtn: document.getElementById('shareBtn'),
  simBtn: document.getElementById('simBtn'),
  diceModal: document.getElementById('diceModal'),
  diceConfirm: document.getElementById('diceConfirm'),
  diceDirection: document.getElementById('diceDirection'),
  shareModal: document.getElementById('shareModal'),
  shareClose: document.getElementById('shareClose'),
  shareDownload: document.getElementById('shareDownload'),
  shareCanvas: document.getElementById('shareCanvas'),
  recBadge: null,
  statsChip: null,
};

// ========== 初始化 ==========
function init() {
  if (typeof AMap === 'undefined') {
    console.error('高德地图 API 加载失败，请检查网络连接或安全密钥配置');
    showToast('地图加载失败，请检查网络');
    return;
  }
  initMap();
  createOverlay();
  bindEvents();
  startLocation();
}

// ========== 高德地图 ==========
function initMap() {
  state.map = new AMap.Map('map', {
    zoom: 16,
    center: [116.397428, 39.90923],
    viewMode: '2d',
  });

  // 创建定位标记（DIV 类型，确保在最上层）
  var markerContent = document.createElement('div');
  markerContent.className = 'user-location-marker';
  markerContent.style.cssText = 'width:16px;height:16px;background:#4096ff;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.4);transform:translate(-8px,-8px);';

  state.userMarker = new AMap.Marker({
    content: markerContent,
    zIndex: 1001,
  });
  state.map.add(state.userMarker);
  state.userMarker.hide();  // 初始隐藏，定位成功后显示

  // 点击地图添加手动轨迹点
  state.map.on('click', function(e) {
    if (!state.isRecording || state.isPaused) return;
    addPoint(e.lnglat.lng, e.lnglat.lat);
  });
}

// ========== 定位 ==========
function startLocation() {
  // 创建定位标记（DIV 类型，确保在最上层）
  var markerContent = document.createElement('div');
  markerContent.className = 'user-location-marker';
  markerContent.style.cssText = 'width:16px;height:16px;background:#4096ff;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.4);transform:translate(-8px,-8px);';

  state.userMarker = new AMap.Marker({
    content: markerContent,
    zIndex: 1001,
  });
  state.map.add(state.userMarker);
  state.userMarker.hide();  // 初始隐藏，定位成功后显示

  // 高德高精度定位优先，失败后降级为 IP 定位
  useGaoDeHighAccuracyLocation(function(err) {
    console.warn('高德高精度定位失败，降级使用 IP 定位:', err);
    useGaoDeIpLocation();
  });
}

// 高德高精度定位（GPS/基站/WiFi 混合，返回 GCJ-02）
function useGaoDeHighAccuracyLocation(failCb) {
  console.log('使用高德高精度定位...');
  state.geolocation = new AMap.Geolocation({
    enableHighAccuracy: true,  // 高精度模式
    timeout: 15000,
    showButton: true,
    buttonPosition: 'RB',
    buttonOffset: new AMap.Pixel(10, -20),
    showMarker: false,
    showCircle: false,
    panToLocation: false,
    zoomToAccuracy: false,
  });
  state.map.addControl(state.geolocation);
  bindGeolocationButton();

  setTimeout(function() {
    state.geolocation.getCurrentPosition(function(status, result) {
      if (status === 'complete') {
        onLocationSuccess(result);
      } else {
        if (failCb) failCb(status + ': ' + (result.message || ''));
      }
    });
  }, 1500);
}

// 高德 IP 定位兜底（无需权限，返回 GCJ-02）
function useGaoDeIpLocation() {
  console.log('使用高德 IP 定位兜底...');
  // 如果高德定位控件已创建，重新初始化一下（可能之前没创建）
  if (!state.geolocation) {
    state.geolocation = new AMap.Geolocation({
      enableHighAccuracy: false,
      timeout: 10000,
      showButton: true,
      buttonPosition: 'RB',
      buttonOffset: new AMap.Pixel(10, -20),
      showMarker: false,
      showCircle: false,
      panToLocation: false,
      zoomToAccuracy: false,
    });
    state.map.addControl(state.geolocation);
    bindGeolocationButton();
  }

  setTimeout(function() {
    state.geolocation.getCurrentPosition(function(status, result) {
      if (status === 'complete') {
        onLocationSuccess(result);
        showToast('IP 定位成功（精度较低）');
      } else {
        console.error('高德 IP 定位也失败:', status, result);
        showToast('定位失败，请点击右下角定位按钮');
      }
    });
  }, 1500);
}

function bindGeolocationButton() {
  function ensureButton() {
    // AMap 2.0 的 Geolocation 控件按钮 class
    var btn = state.map.getContainer().querySelector('.amap-geolocation-button');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', function() {
        state.geolocation.getCurrentPosition(function(status, result) {
          if (status === 'complete') {
            onLocationSuccess(result);
          } else {
            console.warn('高德定位失败(按钮):', status, result);
            showToast('定位失败: ' + (result.message || '请检查定位权限'));
          }
        });
      });
    }
  }

  ensureButton();

  // 高德控件可能是异步创建的，监听 DOM 变化
  var observer = new MutationObserver(ensureButton);
  observer.observe(state.map.getContainer(), { childList: true, subtree: true });
}

function onLocationSuccess(result) {
  // 高德 2.0 API 兼容：result.position 或 result.lng/lat
  var lng, lat;
  if (result.position) {
    lng = result.position.lng;
    lat = result.position.lat;
  } else if (result.lng !== undefined && result.lat !== undefined) {
    lng = result.lng;
    lat = result.lat;
  } else {
    console.error('无法解析定位结果:', result);
    showToast('定位数据异常');
    return;
  }

  state.currentPosition = {
    lng: lng,
    lat: lat,
    accuracy: result.accuracy || 0,
    timestamp: Date.now(),
  };
  console.log('定位成功:', lng, lat, '精度:', result.accuracy, '米');
  // 地图跳转到当前位置
  state.map.setCenter([lng, lat]);
  // 显示定位标记并更新位置
  setTimeout(function() {
    if (state.userMarker) {
      state.userMarker.setPosition([lng, lat]);
      state.userMarker.show();
    }
    console.log('定位标记已显示:', [lng, lat]);
  }, 300);
}

function showDefaultMarker(lnglat) {
  // 移除旧的 CircleMarker（如果存在）
  if (state.userMarker && state.userMarker.getContent) {
    // 检查是否是旧的 CircleMarker
    var content = state.userMarker.getContent();
    if (content && content.className && content.className === 'user-location-circle-marker') {
      state.map.remove(state.userMarker);
      state.userMarker = null;
    }
  }

  // 如果已有 DIV Marker，更新位置并显示
  if (state.userMarker) {
    if (lnglat) {
      state.userMarker.setPosition(lnglat);
    }
    state.userMarker.show();
    console.log('定位标记已更新:', state.userMarker.getPosition());
    return;
  }
}

// ========== 顶部覆盖层 ==========
function createOverlay() {
  var overlay = document.createElement('div');
  overlay.className = 'recording-overlay';
  overlay.innerHTML =
    '<div class="recording-badge" id="recBadge"><div class="recording-dot"></div><span id="recText">录制中</span></div>' +
    '<div class="stats-chip" id="statsChip"><span id="statsText">0m</span></div>';
  dom.mapArea.appendChild(overlay);
  dom.recBadge = document.getElementById('recBadge');
  dom.statsChip = document.getElementById('statsChip');
}

function updateOverlay() {
  if (state.isRecording && !state.isPaused) {
    dom.recBadge.classList.add('show');
    dom.statsChip.classList.add('show');
    dom.recBadge.querySelector('#recText').textContent = '录制中';
    var dist = calcDist();
    dom.statsChip.querySelector('#statsText').textContent = dist.toFixed(0) + 'm';
  } else {
    dom.recBadge.classList.remove('show');
    dom.statsChip.classList.remove('show');
  }
}

// ========== 录制控制 ==========
function toggleRecord() {
  if (!state.isRecording) {
    startRecord();
  } else if (state.isPaused) {
    resumeRecord();
  } else {
    stopRecord();
  }
}

function startRecord() {
  if (!state.currentPosition) {
    showToast('等待定位中...');
    return;
  }

  state.isRecording = true;
  state.isPaused = false;
  state.trajectory = [];
  state.startTime = Date.now();
  state.elapsedTime = 0;

  dom.recordBtn.className = 'bar-btn recording';
  dom.recordBtn.querySelector('svg').innerHTML = '<rect x="7" y="6" width="3.5" height="12" rx="1" fill="#ff4d4f"/><rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="#ff4d4f"/>';
  dom.recordBtn.querySelector('.btn-label').textContent = '暂停';

  startTimer();
  startAutoTrack();
  updateOverlay();
}

function pauseRecord() {
  state.isPaused = true;
  clearInterval(state.timerInterval);
  clearInterval(state.autoInterval);

  dom.recordBtn.className = 'bar-btn paused';
  dom.recordBtn.querySelector('.btn-label').textContent = '继续';
}

function resumeRecord() {
  state.isPaused = false;

  dom.recordBtn.className = 'bar-btn recording';
  dom.recordBtn.querySelector('.btn-label').textContent = '暂停';

  startTimer();
  startAutoTrack();
  updateOverlay();
}

function stopRecord() {
  state.isRecording = false;
  state.isPaused = false;

  clearInterval(state.timerInterval);
  clearInterval(state.autoInterval);

  // 清理模拟模式
  stopSimulation();

  dom.recordBtn.className = 'bar-btn';
  dom.recordBtn.querySelector('svg').innerHTML = '<circle cx="12" cy="12" r="8" fill="#ff4d4f"/>';
  dom.recordBtn.querySelector('.btn-label').textContent = '录制';

  drawRoute();
  updateOverlay();
}

// 记录轨迹点（自动定位模式）
var lastAutoTrackPoint = null;  // 上一个自动记录的点

function startAutoTrack() {
  // 使用高德定位定时获取位置
  lastAutoTrackPoint = null;
  
  // 立即获取一次
  doAutoTrackLocation();
  
  // 每 3 秒尝试获取一次
  state.autoInterval = setInterval(doAutoTrackLocation, 3000);
}

function doAutoTrackLocation() {
  if (!state.isRecording || state.isPaused || !state.geolocation) return;
  
  state.geolocation.getCurrentPosition(function(status, result) {
    if (!state.isRecording || state.isPaused) return;
    if (status !== 'complete') return;  // 定位失败就跳过
    
    var lng = result.position.lng;
    var lat = result.position.lat;
    var accuracy = result.accuracy || 999;

    // 精度太差就忽略（> 50 米）
    if (accuracy > 50) return;

    // 如果轨迹为空或上一个点距离太远，记录新点
    if (state.trajectory.length === 0) {
      addPoint(lng, lat);
    } else {
      var last = state.trajectory[state.trajectory.length - 1];
      var dist = haversine(last.lat, last.lng, lat, lng);
      // 至少移动 15 米才记录新点（避免静止时重复记录）
      // 但如果用户走回头路，相同坐标超过 30 秒也会重新记录
      var timeDiff = Date.now() - last.timestamp;
      if (dist >= 15 || (dist < 0.5 && timeDiff > 30000)) {
        addPoint(lng, lat);
      }
    }
  });
}

function addPoint(lng, lat) {
  state.trajectory.push({
    lng: lng,
    lat: lat,
    heading: state.heading,
    timestamp: Date.now(),
  });
  updateOverlay();
}

// ========== 计时 ==========
function startTimer() {
  var base = Date.now() - state.elapsedTime;
  state.timerInterval = setInterval(function() {
    if (!state.isPaused) {
      state.elapsedTime = Date.now() - base;
      updateOverlay();
    }
  }, 1000);
}

// ========== 距离 ==========
function calcDist() {
  var total = 0;
  for (var i = 1; i < state.trajectory.length; i++) {
    total += haversine(
      state.trajectory[i-1].lat, state.trajectory[i-1].lng,
      state.trajectory[i].lat, state.trajectory[i].lng
    );
  }
  return total;
}

function haversine(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var r = function(d) { return d * Math.PI / 180; };
  var dLat = r(lat2 - lat1);
  var dLng = r(lng2 - lng1);
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ========== WGS-84 到 GCJ-02 坐标转换 ==========
// 解决浏览器 GPS 坐标（WGS-84）直接显示在高德地图上（GCJ-02）偏移几十米的问题
var PI = 3.1415926535897932384626;
var X_PI = PI * 3000.0 / 180.0;
var a = 6378245.0;  // 长半轴
var ee = 0.00669342162296594323;  // 偏心率平方

function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return { lng: lng, lat: lat };
  return transform(lng, lat);
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transform(lng, lat) {
  var dLat = transformLat(lng - 105.0, lat - 35.0);
  var dLng = transformLng(lng - 105.0, lat - 35.0);
  var radLat = lat / 180.0 * PI;
  var magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  var sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return {
    lng: lng + dLng,
    lat: lat + dLat,
  };
}

function transformLat(x, y) {
  var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

// ========== 绘制轨迹 ==========
function drawRoute() {
  // 清除旧轨迹
  if (state.routePolyline) { state.map.remove(state.routePolyline); state.routePolyline = null; }
  if (state.startMarker) { state.map.remove(state.startMarker); state.startMarker = null; }
  if (state.endMarker) { state.map.remove(state.endMarker); state.endMarker = null; }

  if (state.trajectory.length < 2) return;

  var path = [];
  for (var i = 0; i < state.trajectory.length; i++) {
    path.push([state.trajectory[i].lng, state.trajectory[i].lat]);
  }

  // 轨迹线
  state.routePolyline = new AMap.Polyline({
    path: path,
    strokeColor: '#ff4d4f',
    strokeWeight: 5,
    strokeOpacity: 0.85,
    lineJoin: 'round',
    lineCap: 'round',
  });
  state.map.add(state.routePolyline);

  // 起点标记（绿色圆点）
  state.startMarker = new AMap.CircleMarker({
    position: path[0],
    radius: 8,
    fillColor: '#52c41a',
    strokeColor: '#ffffff',
    strokeWeight: 2,
    zIndex: 999,
  });
  state.map.add(state.startMarker);

  // 终点标记（红色圆点）
  state.endMarker = new AMap.CircleMarker({
    position: path[path.length - 1],
    radius: 8,
    fillColor: '#ff4d4f',
    strokeColor: '#ffffff',
    strokeWeight: 2,
    zIndex: 999,
  });
  state.map.add(state.endMarker);

  // 适应视野
  state.map.setFitView([state.routePolyline]);
}

// ========== 工具函数 ==========
function pad(n) { return String(n).padStart(2, '0'); }

function formatMs(ms) {
  var s = Math.floor(ms / 1000);
  return pad(Math.floor(s/3600)) + ':' + pad(Math.floor((s%3600)/60)) + ':' + pad(s%60);
}

function formatTs(ts) {
  var d = new Date(ts);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
}

function formatDist(m) {
  return m >= 1000 ? (m/1000).toFixed(2)+' km' : m.toFixed(0)+' m';
}

// ========== 骰子 ==========
var diceOpts = ['前进', '向左转', '向右转'];

function rollDice() {
  var result = diceOpts[Math.floor(Math.random() * diceOpts.length)];
  dom.diceDirection.textContent = result;
  dom.diceDirection.style.display = 'flex';
  dom.diceDirection.style.justifyContent = 'center';
  dom.diceDirection.classList.add('show');
  dom.diceModal.classList.add('show');
}

function closeDice() {
  dom.diceModal.classList.remove('show');
}

// ========== 更多菜单 ==========
function toggleMore() {
  dom.moreMenu.classList.toggle('show');
}

function closeMore() {
  dom.moreMenu.classList.remove('show');
}

// ========== 导出 ==========
function doExport() {
  if (state.trajectory.length === 0) {
    showToast('没有可导出的轨迹');
    return;
  }
  var data = {
    version: '1.0',
    exportTime: new Date().toISOString(),
    startTime: state.trajectory[0].timestamp,
    endTime: state.trajectory[state.trajectory.length-1].timestamp,
    totalTime: state.elapsedTime,
    totalDistance: calcDist(),
    points: state.trajectory,
  };
  var json = JSON.stringify(data, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'trajectory_' + formatTs(data.startTime).replace(/ /g, '_') + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  closeMore();
  showToast('导出成功');
}

// ========== 导入 ==========
function doImport(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!data.points || !Array.isArray(data.points)) throw new Error('文件格式错误');
      state.trajectory = data.points.map(function(p) {
        return { lng: p.lng, lat: p.lat, heading: p.heading, timestamp: p.timestamp };
      });
      clearRoute();
      drawRoute();
      showToast('导入成功，共 ' + data.points.length + ' 个点');
    } catch (err) {
      showToast('导入失败: ' + err.message);
    }
  };
  reader.readAsText(file);
  closeMore();
}

function clearRoute() {
  if (state.routePolyline) { state.map.remove(state.routePolyline); state.routePolyline = null; }
  if (state.startMarker) { state.map.remove(state.startMarker); state.startMarker = null; }
  if (state.endMarker) { state.map.remove(state.endMarker); state.endMarker = null; }
}

// ========== 分享 ==========
function doShare() {
  if (state.trajectory.length < 2) {
    showToast('没有可分享的轨迹');
    closeMore();
    return;
  }
  renderShareImage();
  dom.shareModal.classList.add('show');
  closeMore();
}

function renderShareImage() {
  var canvas = dom.shareCanvas;
  var W = 720, H = 900;
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');

  // 全画布底色
  ctx.fillStyle = '#f5f7fa';
  ctx.fillRect(0, 0, W, H);

  var mapH = Math.floor(H * 0.65);
  var r = 12;
  var x = 8, y = 8, w = W - 16, h = mapH - 16;

  // 圆角裁剪区域
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
  ctx.clip();

  // 地图底色
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(x, y, w, h);

  // 绘制真实地图瓦片 + 轨迹叠加
  var bounds = getTrajBounds();
  if (bounds) {
    drawMapAndRouteOnCanvas(ctx, x, y, w, h, bounds);
  }

  ctx.restore();

  // 圆角边框
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 下半 - 数据
  drawStatsCanvas(ctx, W, H, mapH);
  // 转为图片
  canvas.src = canvas.toDataURL('image/png');
}

// 简易地图网格（模拟街道布局）
function drawSimpleMapGrid(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 主路
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 8;
  for (var i = 0; i < 5; i++) {
    var ly = y + h * (i / 4);
    ctx.beginPath();
    ctx.moveTo(x, ly);
    ctx.lineTo(x + w, ly);
    ctx.stroke();
  }
  for (var j = 0; j < 6; j++) {
    var lx = x + w * (j / 5);
    ctx.beginPath();
    ctx.moveTo(lx, y);
    ctx.lineTo(lx, y + h);
    ctx.stroke();
  }

  // 次路
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 3;
  for (var k = 0; k < 8; k++) {
    var sy = y + h * (k / 7);
    ctx.beginPath();
    ctx.moveTo(x, sy);
    ctx.lineTo(x + w, sy);
    ctx.stroke();
  }

  // 色块（模拟建筑/绿地）
  ctx.fillStyle = '#d4e6c3';
  ctx.fillRect(x + w * 0.15, y + h * 0.25, w * 0.12, h * 0.15);
  ctx.fillStyle = '#f5deb3';
  ctx.fillRect(x + w * 0.5, y + h * 0.5, w * 0.15, h * 0.1);

  ctx.restore();
}

// 获取轨迹的 bounds（兼容旧版 AMap）
function getTrajBounds() {
  if (!state.trajectory || state.trajectory.length === 0) return null;

  var minLat = Infinity, maxLat = -Infinity;
  var minLng = Infinity, maxLng = -Infinity;

  for (var i = 0; i < state.trajectory.length; i++) {
    var p = state.trajectory[i];
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  // 扩展边界让轨迹不贴边
  var latPad = (maxLat - minLat) * 0.15 || 0.001;
  var lngPad = (maxLng - minLng) * 0.15 || 0.001;

  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad
  };
}

// 在分享图片上绘制轨迹
function drawRouteOnShareCanvas(ctx, x, y, w, h, bounds) {
  if (state.trajectory.length < 2) return;

  function toC(lat, lng) {
    var lngFrac = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 0.001);
    var latFrac = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 0.001);
    return [x + lngFrac * w, y + latFrac * h];
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
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 起点
  var sp = toC(state.trajectory[0].lat, state.trajectory[0].lng);
  ctx.beginPath(); ctx.arc(sp[0], sp[1], 6, 0, Math.PI * 2);
  ctx.fillStyle = '#52c41a'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

  // 终点
  var ep = toC(state.trajectory[state.trajectory.length - 1].lat, state.trajectory[state.trajectory.length - 1].lng);
  ctx.beginPath(); ctx.arc(ep[0], ep[1], 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ff4d4f'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
}

function drawMapAndRouteOnCanvas(ctx, tx, ty, tw, th, bounds) {
  // 1. 加载瓦片底图
  loadMapTiles(ctx, tx, ty, tw, th, bounds, function() {
    // 2. 在瓦片上叠加轨迹
    drawRouteOverlay(ctx, tx, ty, tw, th, bounds);
  });
}

function loadMapTiles(ctx, tx, ty, tw, th, bounds, callback) {
  var zoom = state.map.getZoom();
  var total = 0;

  // 高德地图瓦片使用标准 Web Mercator 坐标计算 x/y/z
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

  _tileLoadTotal = total;
  _tileLoadCount = 0;

  if (total === 0) {
    if (callback) callback();
    notifyTileLoaded();
    return;
  }

  for (var i = 0; i < tiles.length; i++) {
    (function(t) {
      var img = new Image();

      // 高德道路瓦片 (Web Mercator 坐标系)
      var tileUrl = 'https://webrd0' + (t.col % 4) + '.is.autonavi.com/appmaptile?x=' + t.col + '&y=' + t.row + '&z=' + zoom + '&lang=zh_cn&size=1&scl=1&style=8';

      // 预计算位置
      var lon = tileToLon(t.col, t.row, zoom);
      var lat = tileToLat(t.row, t.col, zoom);
      var pos = lonLatToCanvas(lon, lat, bounds, tw, th, tx, ty);

      img.onload = function() {
        ctx.drawImage(this, pos.x, pos.y, 256, 256);
        notifyTileLoaded();
      };
      img.onerror = function() {
        ctx.fillStyle = '#e5e5e5';
        ctx.fillRect(pos.x, pos.y, 256, 256);
        notifyTileLoaded();
      };
      img.src = tileUrl;
    })(tiles[i]);
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

  // 起点
  var sp = toC(state.trajectory[0].lat, state.trajectory[0].lng);
  ctx.beginPath(); ctx.arc(sp[0], sp[1], 5, 0, Math.PI*2);
  ctx.fillStyle = '#52c41a'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

  // 终点
  var ep = toC(state.trajectory[state.trajectory.length-1].lat, state.trajectory[state.trajectory.length-1].lng);
  ctx.beginPath(); ctx.arc(ep[0], ep[1], 5, 0, Math.PI*2);
  ctx.fillStyle = '#ff4d4f'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
}

// 经纬度转瓦片坐标
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

// 等待所有瓦片加载完成的工具函数
var _tileLoadCallbacks = [];
var _tileLoadCount = 0;
var _tileLoadTotal = 0;

function notifyTileLoaded() {
  _tileLoadCount++;
  if (_tileLoadCount >= _tileLoadTotal) {
    var cbs = _tileLoadCallbacks.slice();
    _tileLoadCallbacks = [];
    _tileLoadCount = 0;
    _tileLoadTotal = 0;
    for (var i = 0; i < cbs.length; i++) {
      cbs[i]();
    }
  }
}

function waitForTiles(callback) {
  if (_tileLoadTotal === 0 || _tileLoadCount >= _tileLoadTotal) {
    // 没有正在加载的瓦片，直接回调
    callback();
  } else {
    // 注册回调，等瓦片全部加载完再执行
    _tileLoadCallbacks.push(callback);
  }
}

function drawStatsCanvas(ctx, W, H, startY) {
  ctx.fillStyle = '#333';
  ctx.font = 'bold 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('轨迹分享', W/2, startY + 36);

  ctx.beginPath();
  ctx.moveTo(30, startY + 52);
  ctx.lineTo(W - 30, startY + 52);
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 1;
  ctx.stroke();

  var dist = calcDist();
  var st = state.trajectory[0] ? state.trajectory[0].timestamp : Date.now();
  var et = state.trajectory[state.trajectory.length-1] ? state.trajectory[state.trajectory.length-1].timestamp : Date.now();
  var dur = et - st;

  var stats = [
    { label: '距离', value: formatDist(dist) },
    { label: '用时', value: formatMs(dur) },
    { label: '开始时间', value: formatTs(st) },
    { label: '轨迹点数', value: state.trajectory.length + ' 个' },
  ];

  var lh = 50, y0 = startY + 77;
  for (var i = 0; i < stats.length; i++) {
    var rowY = y0 + i * lh;
    if (i > 0) {
      ctx.beginPath(); ctx.moveTo(30, rowY - 12); ctx.lineTo(W-30, rowY-12);
      ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = '#999';
    ctx.font = '14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(stats[i].label, 30, rowY + 8);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(stats[i].value, W-30, rowY + 12);
  }

  ctx.fillStyle = '#ccc';
  ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('轨迹记录器', W/2, H - 20);
}

function getBounds() {
  var mnL = Infinity, mxL = -Infinity, mnG = Infinity, mxG = -Infinity;
  for (var i = 0; i < state.trajectory.length; i++) {
    if (state.trajectory[i].lat < mnL) mnL = state.trajectory[i].lat;
    if (state.trajectory[i].lat > mxL) mxL = state.trajectory[i].lat;
    if (state.trajectory[i].lng < mnG) mnG = state.trajectory[i].lng;
    if (state.trajectory[i].lng > mxG) mxG = state.trajectory[i].lng;
  }
  return { minLat: mnL, maxLat: mxL, minLng: mnG, maxLng: mxG };
}

function downloadShare() {
  dom.shareCanvas.toBlob(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '轨迹_' + formatTs(state.trajectory[0].timestamp) + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('保存成功');
  });
}

// ========== 模拟模式 ==========
function toggleSimulation() {
  if (!state.isSimulating) {
    startSimulation();
  } else {
    stopSimulation();
  }
  closeMore();
}

function startSimulation() {
  if (!state.currentPosition) {
    showToast('等待定位中...');
    return;
  }

  state.isSimulating = true;
  state.simHeading = Math.random() * 360;

  dom.simBtn.style.background = '#e6f7ff';
  dom.simBtn.querySelector('span').textContent = '停止模拟';

  showToast('模拟模式已开启，正在随机移动');

  // 每秒移动 1-2 米
  state.simTimer = setInterval(function() {
    if (!state.isSimulating) return;

    // 随机改变方向（每次偏移 0-45 度）
    state.simHeading += (Math.random() - 0.5) * 90;
    if (state.simHeading < 0) state.simHeading += 360;
    if (state.simHeading >= 360) state.simHeading -= 360;

    // 随机距离 1-2 米
    var dist = 1 + Math.random();
    var rad = state.simHeading * Math.PI / 180;

    var newLat = state.currentPosition.lat + (dist / 111111) * Math.cos(rad);
    var newLng = state.currentPosition.lng + (dist / (111111 * Math.cos(state.currentPosition.lat * Math.PI / 180))) * Math.sin(rad);

    state.currentPosition = {
      lng: newLng,
      lat: newLat,
      accuracy: 5,
      timestamp: Date.now(),
    };

    // 如果在录制中，添加轨迹点
    if (state.isRecording && !state.isPaused) {
      state.trajectory.push({
        lng: newLng,
        lat: newLat,
        heading: state.simHeading,
        timestamp: Date.now(),
      });
      drawRoute();
      updateOverlay();
    }

    // 更新地图上的用户位置标记
    if (state.userMarker) {
      state.userMarker.setPosition([newLng, newLat]);
    }
    state.map.setCenter([newLng, newLat]);
  }, 1000);
}

function stopSimulation() {
  state.isSimulating = false;
  if (state.simTimer) {
    clearInterval(state.simTimer);
    state.simTimer = null;
  }

  dom.simBtn.style.background = '';
  dom.simBtn.querySelector('span').textContent = '模拟模式';
}

// ========== Toast ==========
function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;z-index:9999;transition:opacity 0.3s;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(function() { t.style.opacity = '0'; }, 2000);
}

// ========== 事件 ==========
function bindEvents() {
  dom.recordBtn.addEventListener('click', toggleRecord);

  dom.diceBtn.addEventListener('click', rollDice);
  dom.diceConfirm.addEventListener('click', closeDice);
  dom.diceModal.querySelector('.modal-backdrop').addEventListener('click', closeDice);

  dom.moreBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleMore(); });
  document.addEventListener('click', function(e) {
    if (!dom.moreMenu.contains(e.target) && e.target !== dom.moreBtn) closeMore();
  });

  dom.importBtn.addEventListener('click', function(e) { e.stopPropagation(); dom.importInput.click(); });
  dom.importInput.addEventListener('change', function() {
    if (dom.importInput.files.length > 0) { doImport(dom.importInput.files[0]); dom.importInput.value = ''; }
  });

  dom.exportBtn.addEventListener('click', function(e) { e.stopPropagation(); doExport(); });
  dom.shareBtn.addEventListener('click', function(e) { e.stopPropagation(); doShare(); });
  dom.simBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleSimulation(); });

  dom.shareClose.addEventListener('click', function() { dom.shareModal.classList.remove('show'); });
  dom.shareModal.querySelector('.modal-backdrop').addEventListener('click', function() { dom.shareModal.classList.remove('show'); });
  dom.shareDownload.addEventListener('click', downloadShare);
}

// ========== 启动 ==========
init();
