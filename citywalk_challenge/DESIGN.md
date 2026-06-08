# 轨迹记录器 — 设计文档

## 概述

纯前端移动端轨迹记录网页。使用 **高德地图 JS API 2.0** 直接渲染地图，包含自动定位记录轨迹、手动点击添加轨迹点、骰子导航提示、导入导出和分享图片（含高德瓦片底图 + 轨迹叠加）功能。

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 地图 | 高德地图 JS API 2.0（GCJ-02 坐标系） |
| 定位 | 高德高精度定位（GPS/基站/WiFi 混合）→ IP 定位兜底 |
| 渲染 | Canvas 2D（分享图片生成） |
| 测试 | Node.js 纯函数测试（`test.js`） |
| 部署 | 纯静态文件，无后端 |

### 引入顺序

```html
<!-- 1. 安全密钥（必须在地图脚本之前） -->
<script>
  window._AMapSecurityConfig = {
    securityJsCode: 'fe24904399016ca077f5314a90d528a4',
  };
</script>
<!-- 2. 地图 JS API -->
<script src="https://webapi.amap.com/maps?v=2.0&key=b7eb76f7d4d29e6979387be9a75677fa&plugin=AMap.Geolocation"></script>
```

---

## 架构

### 文件结构

```
road_switcher/
├── index.html           # 页面结构 + 脚本引入
├── style.css            # 全部样式
├── app.js               # 全部业务逻辑
├── package.json         # npm 脚本配置
├── test.js              # 自动化测试（Node.js）
├── sample_trajectory.json  # 示例轨迹数据
├── DESIGN.md            # 本文档
└── .qwen/skills/        # （已删除）
```

### 页面布局

```
┌────────────────────────┐
│   Map Area (100%)      │  <- 高德地图 + 定位标记
│   + recording overlay  │  <- 录制状态 + 实时距离
├────────────────────────┤
│ [录制] [掷骰子] [更多] │  <- 底部三个图标按钮
└────────────────────────┘
         ▼
┌────────────────────────┐
│  更多菜单 (底部弹出)    │
│  - 导入轨迹             │
│  - 导出轨迹             │
│  - 分享轨迹             │
│  - 模拟模式             │
└────────────────────────┘
```

### 全局状态 (`state`)

```javascript
var state = {
  currentPosition: null,    // { lng, lat, accuracy, timestamp }
  heading: null,            // 当前朝向（角度）
  isRecording: false,       // 是否正在录制
  isPaused: false,          // 是否暂停
  trajectory: [],           // 轨迹点数组 [{ lng, lat, heading, timestamp }]
  startTime: null,          // 录制开始时间戳
  elapsedTime: 0,           // 已用时长（ms）
  timerInterval: null,      // 计时器 ID
  autoInterval: null,       // 自动定位定时器 ID
  map: null,                // AMap.Map 实例
  userMarker: null,         // 用户位置 Marker
  routePolyline: null,      // 轨迹线 Polyline
  startMarker: null,        // 起点标记
  endMarker: null,          // 终点标记
  geolocation: null,        // AMap.Geolocation 控件实例
  isSimulating: false,      // 模拟模式开关
  simTimer: null,           // 模拟定时器 ID
  simHeading: 0,            // 模拟朝向
};
```

### DOM 引用 (`dom`)

```javascript
var dom = {
  map, mapArea, recordBtn, diceBtn, moreBtn, moreMenu,
  importInput, importBtn, exportBtn, shareBtn,
  diceModal, diceConfirm, diceDirection,
  shareModal, shareClose, shareDownload, shareCanvas,
  recBadge, statsChip,
};
```

---

## 功能模块

### 1. 地图初始化

- **默认中心**：北京 `[116.397428, 39.90923]`
- **默认缩放**：16 级
- **视图模式**：2D
- **点击事件**：录制中点击地图手动添加轨迹点

```javascript
function initMap() {
  state.map = new AMap.Map('map', {
    zoom: 16,
    center: [116.397428, 39.90923],
    viewMode: '2d',
  });
  state.map.on('click', function(e) {
    if (!state.isRecording || state.isPaused) return;
    addPoint(e.lnglat.lng, e.lnglat.lat);
  });
}
```

---

### 2. 定位

使用 **高德 Geolocation 插件** 进行精确定位，定位策略如下：

1. **高德高精度定位**（`enableHighAccuracy: true`）：自动使用 GPS/基站/WiFi 混合定位，返回 GCJ-02 坐标
2. **高德 IP 定位兜底**：如果高精度定位失败（如非 HTTPS 环境、GPS 信号弱等），降级为 IP 定位

#### 高精度定位配置

| 参数 | 值 | 说明 |
|------|-----|------|
| `enableHighAccuracy` | `true` | 开启精确定位 |
| `timeout` | `15000` | 超时 15 秒 |
| `showButton` | `true` | 显示重新定位按钮 |
| `buttonPosition` | `'RB'` | 按钮位置：右下角 |
| `buttonOffset` | `new AMap.Pixel(10, -20)` | 按钮偏移 |
| `showMarker` | `false` | 不显示自带标记 |
| `showCircle` | `false` | 不显示精度圈 |
| `panToLocation` | `false` | 不自动跳转 |
| `zoomToAccuracy` | `false` | 不自适应缩放 |

#### IP 定位兜底配置

| 参数 | 值 | 说明 |
|------|-----|------|
| `enableHighAccuracy` | `false` | 使用 IP 定位（无需权限） |
| `timeout` | `10000` | 超时 10 秒 |

> 其余参数同上。

> 以上十项 `false` 是因为我们自己在 `onLocationSuccess` 中手动处理跳转和标记显示。

#### 流程

1. 创建 AMap.Geolocation 控件并添加到地图
2. 绑定右下角重新定位按钮点击事件
3. 页面加载 **1.5 秒后**自动调用 `getCurrentPosition`（等待地图控件渲染完成）
4. 定位成功后：
   - 更新 `state.currentPosition`
   - `state.map.setCenter([lng, lat])` 跳转到当前位置
   - 通过 `state.userMarker` 显示蓝色圆点标记

#### 定位标记

DIV 类型 Marker，通过自定义 DOM 元素渲染蓝色圆点（白色边框 + 阴影）：

```javascript
var markerContent = document.createElement('div');
markerContent.style.cssText = 'width:16px;height:16px;background:#4096ff;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.4);transform:translate(-8px,-8px);';
state.userMarker = new AMap.Marker({ content: markerContent, zIndex: 1001 });
state.map.add(state.userMarker);
```

---

### 3. 录制控制

#### 状态流转

```
[空闲] → 点击录制 → [录制中]
  ↑              ↓ 点击暂停
  |          [暂停中] → 点击继续 → [录制中]
  ↑              ↓ 点击暂停/停止
  └──────── [空闲]
```

#### 录制中行为

- **计时**：`setInterval` 每秒更新已用时长
- **自动定位记录**：`setInterval` 每 3 秒调用高德 `Geolocation.getCurrentPosition` 获取位置（返回 GCJ-02）
- **手动添加**：点击地图添加轨迹点
- **顶部覆盖层**：显示录制状态指示灯 + 累计距离

#### 自动定位记录（`startAutoTrack`）

录制启动后通过 `setInterval` 每 3 秒调用高德定位获取位置：

| 参数 | 值 | 说明 |
|------|-----|------|
| `enableHighAccuracy` | `true` | 高精度（自动使用 GPS/基站/WiFi） |
| `timeout` | `10000` | 超时 10s |

**防重复记录策略**：

```
距离阈值 ≥ 15 米 → 记录新点
距离 < 0.5 米 且 时间差 > 30 秒 → 记录新点（GPS 漂移兜底）
其他情况 → 忽略
```

- 第一点无条件记录
- 停止录制时 `clearInterval(state.autoInterval)` 清理定时器

---

### 4. 轨迹绘制

录制停止后绘制完整轨迹：

1. **轨迹线**：`AMap.Polyline`，红色 `#ff4d4f`，线宽 5
2. **起点标记**：绿色圆 `#52c41a`，白色边框
3. **终点标记**：红色圆 `#ff4d4f`，白色边框
4. **视野适配**：`state.map.setFitView([state.routePolyline])`

停止录制后清除旧轨迹（`clearRoute`），防止重复叠加。

---

### 5. 骰子导航

随机生成方向提示，点击骰子按钮弹出：

| 结果 | SVG 图标 | 说明 |
|------|----------|------|
| 前进 | 向上箭头 | 继续前行 |
| 向左转 | 左转箭头 | 左转 |
| 向右转 | 右转箭头 | 右转 |

- 骰子弹出时有 360° 旋转动画
- 方向文字紫色 `#667eea`
- 点击确认或遮罩关闭

---

### 6. 导入/导出

#### 导出

JSON 格式，包含：

```json
{
  "version": "1.0",
  "exportTime": "2026-06-08T08:57:13.883Z",
  "startTime": 1780905433882,
  "endTime": 1780910815882,
  "totalTime": 5382000,
  "totalDistance": 0,
  "points": [
    { "lng": 113.633118, "lat": 34.755983, "heading": 0, "timestamp": 1780905433882 }
  ]
}
```

文件名：`trajectory_2026-06-08_09:00:00.json`

#### 导入

- 文件类型限制：`.json`
- 解析后更新 `state.trajectory`，清除旧轨迹，重新 `drawRoute()`
- 显示导入点数 toast 提示

---

### 7. 分享图片

生成 720×900 的 PNG 图片，含地图底图 + 轨迹 + 统计数据。

#### 布局

```
┌──────────────────────┐
│                      │
│   地图区域 (65%, 585px)│  <- 圆角裁剪
│   含真实高德瓦片底图   │
│   + 轨迹叠加          │
│                      │
├──────────────────────┤
│  轨迹分享             │
├──────────────────────┤
│  距离    |  1.23 km  │
│  用时    |  00:45:30  │
│  开始时间|  09:00:00  │
│  轨迹点数|  120 个    │
├──────────────────────┤
│        轨迹记录器     │
└──────────────────────┘
```

#### 地图底图渲染方案

**不截取 AMap DOM canvas**（受跨域限制，`toDataURL` 不可用），改为 **异步加载高德瓦片 API** 后叠加轨迹。

##### 流程

```
renderShareImage()
  → 创建 720×900 Canvas
  → 圆角裁剪区域 (x=8, y=8, w=704, h=585)
  → drawMapAndRouteOnCanvas(ctx, 8, 8, 704, 585, map.getBounds())
    → loadMapTiles(ctx, ...)      // 异步加载瓦片
      → notifyTileLoaded() × N    // 计数器等待全部瓦片加载
    → drawRouteOverlay(ctx, ...)  // 在瓦片上叠加轨迹
  → drawStatsCanvas(ctx, ...)     // 绘制统计数据
  → canvas.toDataURL('image/png') // 转为可下载图片
```

##### 瓦片加载

高德瓦片 URL：

```
https://webrd0{0-3}.is.autonavi.com/appmaptile?x={col}&y={row}&z={zoom}&lang=zh_cn&size=1&scl=1&style=8
```

- `webrd00` ~ `webrd03` 四台负载均衡（`col % 4`）
- 坐标系：Web Mercator（与经纬度转换函数配合）
- 返回：256×256 PNG

##### 坐标转换

| 函数 | 说明 | 公式 |
|------|------|------|
| `lonToTile(lng, zoom)` | 经度→瓦片列 | `floor((lng+180)/360 × 2^zoom)` |
| `latToTile(lat, zoom)` | 纬度→瓦片行 | `floor((1 - log(tan(latRad)+sec(latRad))/π) / 2 × 2^zoom)` |
| `tileToLon(col, row, zoom)` | 列→经度 | `col/2^zoom × 360 - 180` |
| `tileToLat(row, col, zoom)` | 行→纬度 | `atan(0.5×(exp(n)-exp(-n))) × 180/π` |
| `lonLatToCanvas(lng, lat, bounds, w, h, tx, ty)` | 经纬度→Canvas | 线性映射到 bounds 范围 |

##### 计数器机制

`waitForTiles` + `notifyTileLoaded` 协作：

- `loadMapTiles` 计算需要加载的瓦片总数，设置 `_tileLoadTotal`
- 每块瓦片加载完成（`onload`/`onerror`）调用 `notifyTileLoaded()` 计数
- 计数器达到总数时执行回调队列中的函数
- 支持多组回调，回调执行后清空队列

##### 轨迹叠加

在瓦片加载完成后，将轨迹点按 `bounds` 线性映射到 Canvas 坐标：

```javascript
function toC(lat, lng) {
  var lngFrac = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
  var latFrac = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat);
  return [tx + lngFrac * w, ty + latFrac * h];
}
```

- 起点：绿色圆点 `#52c41a`（半径 5，白边 2）
- 终点：红色圆点 `#ff4d4f`（半径 5，白边 2）
- 轨迹线：红色 `#ff4d4f`，线宽 3

##### 备用渲染

`renderShareImage` 中同时保留 `drawSimpleMapGrid`（简易网格模拟街道布局）作为备用方案。

---

### 8. 模拟模式

用于在室内等无法移动场景下测试录制功能。

#### 行为

- 开启后每秒移动 1-2 米
- 方向随机偏移（每次 ±0~45°）
- 实时更新地图上的用户位置标记
- 录制中自动将模拟位置添加为轨迹点
- 同时更新 `state.currentPosition`

#### 参数

```javascript
var dist = 1 + Math.random();      // 1-2 米
state.simHeading += (Math.random() - 0.5) * 90;  // 方向偏移
var rad = state.simHeading * Math.PI / 180;
var newLat = lat + (dist / 111111) * cos(rad);
var newLng = lng + (dist / (111111 * cos(lat))) * sin(rad);
```

#### UI

- 菜单项背景变浅蓝 `#e6f7ff`
- 文字切换为"停止模拟"

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 定位方案 | 高德 Geolocation 插件 | 提供高精度定位（GPS/基站/WiFi 混合），失败时降级 IP 定位 |
| 分享底图 | 高德瓦片 API 异步加载 | AMap canvas 跨域污染，无法 toDataURL |
| 防重复记录 | 距离 15m + 时间 30s | 静止不重复 + 回头路可重复 |
| 坐标系 | GCJ-02（高德） | 与高德地图 API 一致 |
| 测试 | Node.js 纯函数 | 无需浏览器环境，验证核心算法 |

---

## 自动化测试

运行：`npm test`

| 测试类 | 覆盖内容 | 用例数 |
|--------|----------|--------|
| 经纬度 ↔ 瓦片坐标转换 | lonToTile/latToTile 正反向，全球边界 | 8 |
| 瓦片范围计算 | bounds → 瓦片范围，合法性 | 3 |
| 经纬度到 Canvas 映射 | 边界点、中心点 | 6 |
| notifyTileLoaded 协作 | 计数器 + 回调队列 | 8 |
| 轨迹点到 Canvas 映射 | 起点/终点/中间点 | 5 |
| 边缘情况 - 单点 | 单点轨迹 bounds | 1 |
| 边缘情况 - 极小范围 | 极小范围映射 | 2 |

---

## 工具函数

| 函数 | 说明 |
|------|------|
| `pad(n)` | 补零，如 `5` → `'05'` |
| `formatMs(ms)` | 毫秒 → `HH:MM:SS` |
| `formatTs(ts)` | 时间戳 → `YYYY-MM-DD HH:mm:ss` |
| `formatDist(m)` | 米 → `1.23 km` / `350 m` |
| `haversine(lat1, lng1, lat2, lng2)` | 两点球面距离（米） |
| `calcDist()` | 整条轨迹总距离 |
| `getTrajBounds()` | 轨迹经纬度范围（含 15% 边距） |
| `showToast(msg)` | 浮动提示（2 秒自动消失） |

---

## CSS 要点

| 规则 | 说明 |
|------|------|
| `100dvh` | 使用动态视口高度，适配移动端地址栏 |
| `safe-area-inset-bottom` | 刘海屏安全区域适配 |
| 录制按钮 | 64px 圆形，录制时缩小 + 脉冲动画 |
| 暂停状态 | 黄色 `#faad14` |
| 弹窗动画 | `scale(0.85) → scale(1)` + Y 轴位移 |
| 骰子动画 | 360° 旋转 + 缩放 |
| `backdrop-filter: blur(10px)` | 磨砂玻璃效果 |

---

## 事件绑定

| 元素 | 事件 | 处理 |
|------|------|------|
| `recordBtn` | `click` | `toggleRecord()` |
| `diceBtn` | `click` | `rollDice()` |
| `diceConfirm` / backdrop | `click` | `closeDice()` |
| `moreBtn` | `click` | `toggleMore()` |
| 全局 | `click` | 关闭菜单 |
| `importBtn` | `click` | 触发文件选择 |
| `importInput` | `change` | `doImport(file)` |
| `exportBtn` | `click` | `doExport()` |
| `shareBtn` | `click` | `doShare()` |
| `simBtn` | `click` | `toggleSimulation()` |
| `shareClose` / backdrop | `click` | 关闭分享弹窗 |
| `shareDownload` | `click` | `downloadShare()` |
| 地图 | `click` | 录制中手动添加点 |
