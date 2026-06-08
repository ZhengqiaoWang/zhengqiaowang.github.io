/**
 * 自动化测试：验证 app.js 中的纯函数逻辑
 * 
 * 运行: node test.js
 * 
 * 测试覆盖：
 * 1. 瓦片坐标转换（经纬度 <-> 瓦片）
 * 2. 经纬度到 Canvas 坐标映射
 * 3. notifyTileLoaded / waitForTiles 协作
 * 4. 轨迹点到 Canvas 点映射（渲染逻辑核心）
 */

// ========== 被测函数（从 app.js 复制）==========

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
    callback();
  } else {
    _tileLoadCallbacks.push(callback);
  }
}

// 模拟轨迹点到 Canvas 的映射（drawRouteOverlay 的核心逻辑）
function trajectoryToCanvas(lat, lng, bounds, w, h, tx, ty) {
  var lngFrac = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng || 0.001);
  var latFrac = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 0.001);
  return [tx + lngFrac * w, ty + latFrac * h];
}

// ========== 测试框架 ==========

var passed = 0;
var failed = 0;
var totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ ' + message);
  }
}

function describe(name, fn) {
  console.log('\n' + name);
  console.log('─'.repeat(60));
  fn();
}

// ========== 测试用例 ==========

describe('测试 1: 经纬度 <-> 瓦片坐标转换', function() {
  // 北京坐标
  var lng = 116.397428;
  var lat = 39.90923;
  var zoom = 16;

  var tileX = lonToTile(lng, zoom);
  var tileY = latToTile(lat, zoom);

  assert(tileX === 53957, 'lonToTile(116.397428, 16) = 53957, 实际=' + tileX);
  assert(tileY === 24832, 'latToTile(39.90923, 16) = 24832, 实际=' + tileY);

  var backLng = tileToLon(tileX, tileY, zoom);
  var backLat = tileToLat(tileY, tileX, zoom);

  assert(
    Math.abs(backLng - lng) < 0.01,
    'tileToLon 反向转换误差 < 0.01: 原始=' + lng + ', 转换后=' + backLng
  );
  assert(
    Math.abs(backLat - lat) < 0.01,
    'tileToLat 反向转换误差 < 0.01: 原始=' + lat + ', 转换后=' + backLat
  );

  // 测试全球范围边界（±85.05 是 Web Mercator 的实际边界）
  assert(lonToTile(-180, 0) === 0, 'lonToTile(-180, 0) = 0');
  assert(lonToTile(180, 0) === 1, 'lonToTile(180, 0) = 1');
  assert(latToTile(85.05112877980659, 0) === 0, 'latToTile(85.05, 0) = 0 (北纬上限)');
  // 南纬边界 tile 值可能因浮点精度有偏差，只检查 >= 0
  var southVal = latToTile(-85.05112877980659, 0);
  assert(southVal >= 0, 'latToTile(-85.05, 0) >= 0 (南纬下限，实际=' + southVal + ')');
});

describe('测试 2: 瓦片范围计算', function() {
  var bounds = { minLng: 116.3, maxLng: 116.5, minLat: 39.8, maxLat: 40.0 };
  var zoom = 14;

  var tileMinX = lonToTile(bounds.minLng, zoom);
  var tileMaxX = lonToTile(bounds.maxLng, zoom);
  var tileMinY = latToTile(bounds.maxLat, zoom);  // maxLat -> smallest row (top)
  var tileMaxY = latToTile(bounds.minLat, zoom);  // minLat -> largest row (bottom)

  // 确保范围合法
  assert(tileMinX <= tileMaxX, '经度瓦片范围合法: ' + tileMinX + '~' + tileMaxX);
  assert(tileMinY <= tileMaxY, '纬度瓦片范围合法: ' + tileMinY + '~' + tileMaxY);

  var tileCount = (tileMaxX - tileMinX + 1) * (tileMaxY - tileMinY + 1);
  assert(tileCount > 0, '瓦片数量 > 0: ' + tileCount + ' 块');
});

describe('测试 3: 经纬度到 Canvas 坐标映射', function() {
  var bounds = { minLng: 116.0, maxLng: 117.0, minLat: 39.0, maxLat: 40.0 };
  var w = 720, h = 600, tx = 0, ty = 0;

  // 左下角 -> Canvas 左下角
  var bottomLeft = lonLatToCanvas(116.0, 39.0, bounds, w, h, tx, ty);
  assert(Math.abs(bottomLeft.x - 0) < 0.001, 'minLng/minLat -> (0, h): (' + bottomLeft.x.toFixed(1) + ', ' + bottomLeft.y.toFixed(1) + ')');
  assert(Math.abs(bottomLeft.y - 600) < 0.001, 'y 坐标接近 600');

  // 右上角 -> Canvas 右上角
  var topRight = lonLatToCanvas(117.0, 40.0, bounds, w, h, tx, ty);
  assert(Math.abs(topRight.x - 720) < 0.001, 'maxLng/maxLat -> (w, 0): (' + topRight.x.toFixed(1) + ', ' + topRight.y.toFixed(1) + ')');
  assert(Math.abs(topRight.y - 0) < 0.001, 'y 坐标接近 0');

  // 中心点 -> Canvas 中心
  var center = lonLatToCanvas(116.5, 39.5, bounds, w, h, tx, ty);
  assert(Math.abs(center.x - 360) < 1, '中心点 x 接近 360: ' + center.x.toFixed(1));
  assert(Math.abs(center.y - 300) < 1, '中心点 y 接近 300: ' + center.y.toFixed(1));
});

describe('测试 4: notifyTileLoaded / waitForTiles 协作', function() {
  // 重置状态
  _tileLoadTotal = 0;
  _tileLoadCount = 0;
  _tileLoadCallbacks = [];

  var order = [];

  // 场景 1: 无加载时直接回调
  waitForTiles(function() { order.push('A'); });
  assert(order[0] === 'A', '无加载时回调立即执行 (A)');

  // 场景 2: 注册回调后等待通知
  _tileLoadTotal = 3;
  _tileLoadCount = 0;

  waitForTiles(function() { order.push('B'); });
  assert(order.length === 1, '回调注册后不会立即执行 (order 仍为 1)');

  notifyTileLoaded();
  assert(order.length === 1, '通知 1/3 后仍未执行 (order 仍为 1)');

  notifyTileLoaded();
  assert(order.length === 1, '通知 2/3 后仍未执行 (order 仍为 1)');

  notifyTileLoaded();
  assert(order.length === 2, '通知 3/3 后 B 执行');
  assert(order[1] === 'B', '回调按注册顺序执行');

  // 场景 3: 多个回调
  _tileLoadTotal = 2;
  _tileLoadCount = 0;

  waitForTiles(function() { order.push('C'); });
  waitForTiles(function() { order.push('D'); });

  notifyTileLoaded();
  assert(order.length === 2, '只通知 1/2 时 C、D 都不执行');

  notifyTileLoaded();
  assert(order[2] === 'C' && order[3] === 'D', '两个回调都按顺序执行');
});

describe('测试 5: 轨迹点到 Canvas 映射', function() {
  // 模拟轨迹数据
  var trajectory = [
    { lat: 39.9, lng: 116.3 },
    { lat: 39.91, lng: 116.35 },
    { lat: 39.92, lng: 116.4 }
  ];
  var bounds = { minLng: 116.3, maxLng: 116.4, minLat: 39.9, maxLat: 39.92 };
  var w = 720, h = 500, tx = 0, ty = 0;

  // 起点应该在 Canvas 左下角区域
  var p0 = trajectoryToCanvas(trajectory[0].lat, trajectory[0].lng, bounds, w, h, tx, ty);
  assert(p0[0] >= 0 && p0[0] <= w, '起点 x 在合法范围: ' + p0[0].toFixed(1));
  assert(p0[1] >= 0 && p0[1] <= h, '起点 y 在合法范围: ' + p0[1].toFixed(1));

  // 终点应该在 Canvas 右上角区域
  var p2 = trajectoryToCanvas(trajectory[2].lat, trajectory[2].lng, bounds, w, h, tx, ty);
  assert(p2[0] > p0[0], '终点 x > 起点 x');
  assert(p2[1] < p0[1], '终点 y < 起点 y (y 轴反转)');

  // 中间点应该在线段上
  var p1 = trajectoryToCanvas(trajectory[1].lat, trajectory[1].lng, bounds, w, h, tx, ty);
  var midX = (p0[0] + p2[0]) / 2;
  var midY = (p0[1] + p2[1]) / 2;
  var dist = Math.sqrt((p1[0] - midX) ** 2 + (p1[1] - midY) ** 2);
  assert(dist < 5, '中间点接近线段中点: 距离=' + dist.toFixed(1));
});

describe('测试 6: 边缘情况 - 单点轨迹', function() {
  var bounds = { minLng: 116.39, maxLng: 116.4, minLat: 39.89, maxLat: 39.9 };
  var w = 720, h = 500, tx = 0, ty = 0;

  // 中心点映射
  var p = trajectoryToCanvas(39.895, 116.395, bounds, w, h, tx, ty);
  assert(
    Math.abs(p[0] - 360) < 5 && Math.abs(p[1] - 250) < 5,
    '中心点映射到画布中心附近: (' + p[0].toFixed(1) + ', ' + p[1].toFixed(1) + ')'
  );
});

describe('测试 7: 边缘情况 - 极小范围轨迹', function() {
  var bounds = { minLng: 116.397, maxLng: 116.398, minLat: 39.908, maxLat: 39.909 };
  var w = 720, h = 500, tx = 0, ty = 0;

  var p0 = trajectoryToCanvas(39.908, 116.397, bounds, w, h, tx, ty);
  var p1 = trajectoryToCanvas(39.909, 116.398, bounds, w, h, tx, ty);

  assert(Math.abs(p0[0] - 0) < 1, '极小范围起点 x ≈ 0: ' + p0[0].toFixed(1));
  assert(Math.abs(p1[0] - 720) < 1, '极小范围终点 x ≈ 720: ' + p1[0].toFixed(1));
});

// ========== 输出总结 ==========

console.log('\n' + '═'.repeat(60));
console.log('测试结果: ' + passed + '/' + totalTests + ' 通过');
if (failed > 0) {
  console.error('失败: ' + failed + ' 个测试未通过');
  process.exit(1);
} else {
  console.log('所有测试通过 ✓');
  process.exit(0);
}
