---
name: amap-geolocation-debugging
description: 高德地图 JS API 2.0 定位功能排查与修复方法（包括安全密钥、版本格式、结果格式兼容、错误提示、默认标记替换）
source: auto-skill
extracted_at: '2026-06-08T09:50:00.000Z'
---

# 高德地图 JS API 2.0 定位功能排查与修复

## 问题诊断流程

当高德地图加载后无法显示当前位置时，按以下步骤排查：

### 1. 确认高德 API 是否加载成功

- 检查 `window.AMap` 是否存在
- 检查安全密钥 `window._AMapSecurityConfig` 是否在地图脚本**之前**设置
- 引入顺序必须是：安全密钥 → 地图脚本

```html
<!-- 必须严格按此顺序 -->
<script>
  window._AMapSecurityConfig = { securityJsCode: '你的密钥' };
</script>
<script src="https://webapi.amap.com/maps?v=2.0&key=你的Key&plugin=AMap.Geolocation"></script>
```

#### 1.1 安全密钥导致脚本完全加载失败

**现象**：控制台输出 `AMap is not defined`，且没有其他 JS 错误。

**原因**：在高德 JS API 2.0 中，一旦配置了 `window._AMapSecurityConfig`，高德后台会对安全密钥进行校验。如果密钥配置不正确（IP 白名单不匹配、安全密钥与 Key 未绑定等），**整个地图脚本会被拒绝加载**，不会输出任何错误信息。

**排查步骤**：
1. 临时注释掉 `window._AMapSecurityConfig`
2. 刷新页面，看 `AMap` 是否能加载
3. 如果注释后正常，说明是安全密钥配置问题

**解决方法**：
- 登录高德开放平台 → 安全密钥管理
- 为你的 JS API Key 配置对应的安全密钥（`securityJsCode`）
- IP 白名单设置为 `0.0.0.0/0` 或生产服务器 IP
- 取消 HTML 中的注释

**本地开发建议**：本地开发/测试阶段可以先注释掉安全密钥，部署到正式环境时再配好。

```javascript
// 在 init() 中添加容错检查
function init() {
  if (typeof AMap === 'undefined') {
    console.error('高德地图 API 加载失败，请检查网络连接或安全密钥配置');
    showToast('地图加载失败，请检查网络');
    return;
  }
  // ...
}
```

#### 1.2 版本号格式错误

**现象**：控制台报错 `<AMap JSAPI> Sorry, We don't support version 2.0.15`

**原因**：高德地图 JS API 2.0 的版本号只能是 `2.0`，**不能带补丁号**（如 `2.0.15`、`2.0.5` 等），否则会返回不支持版本的错误。

**修复**：URL 中始终使用 `v=2.0`

```html
<!-- ✅ 正确 -->
<script src="https://webapi.amap.com/maps?v=2.0&key=你的Key"></script>
<!-- ❌ 错误 -->
<script src="https://webapi.amap.com/maps?v=2.0.15&key=你的Key"></script>
```

### 2. 兼容高德 2.0 定位结果格式差异

高德 2.0 在不同模式下返回的坐标格式可能不同：

- 浏览器精确定位模式：`result.position.lng` / `result.position.lat`
- 简化/IP 定位模式：`result.lng` / `result.lat`

**修复方式**：不要直接访问 `result.position.lng`，改为兼容两种格式：

```javascript
function onLocationSuccess(result) {
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
  // 使用 lng, lat 继续处理...
}
```

### 3. 添加错误处理与用户提示

原始代码常见问题：定位失败时没有任何反馈，用户不知道发生了什么。

**必须处理的回调状态：**

```javascript
state.geolocation.getCurrentPosition(function(status, result) {
  if (status === 'complete') {
    onLocationSuccess(result);
  } else if (status === 'error') {
    // 定位失败（权限被拒、硬件故障等）
    console.warn('高德定位失败:', status, result);
    showToast('定位失败: ' + (result.message || '未知错误'));
  } else if (status === 'timeout') {
    // 定位超时
    showToast('定位超时，请检查网络或定位权限');
    // 可尝试 IP 定位兜底
    setTimeout(function() {
      state.geolocation.getCurrentPosition(function(s2, r2) {
        if (s2 === 'complete') {
          onLocationSuccess(r2);
        } else {
          showToast('自动定位失败，请点击右下角定位按钮');
        }
      });
    }, 5000);
  } else {
    showToast('自动定位失败，请点击右下角定位按钮');
  }
});
```

### 4. `enableHighAccuracy` 触发坐标转换接口异常

**现象**：点击定位时报错 `MIME 类型（"application/json"）不是有效的 JavaScript MIME 类型`

**原因**：`enableHighAccuracy: true` 时，`AMap.Geolocation` 会获取浏览器的 WGS-84 坐标，然后自动调用高德 `/v3/assistant/coordinate/convert` 接口做坐标转换。该接口使用 JSONP 方式调用，但在安全密钥校验失败或 `file://` 协议下，返回的是 JSON 而非 JavaScript，引发 MIME 错误。

**修复**：本地开发时将 `enableHighAccuracy` 设为 `false`，让高德使用 IP 定位（直接返回 GCJ-02，不需要坐标转换）：

```javascript
state.geolocation = new AMap.Geolocation({
  enableHighAccuracy: false,  // 本地开发关闭，避免触发坐标转换 JSONP
  timeout: 10000,
  // ...
});
```

> IP 定位精度较低（约几百米到几公里）。生产环境需要高精度时，确保部署在 HTTPS 上并正确配置安全密钥。

### 5. 定位标记改用高德默认样式

自定义 SVG Marker 可能因为 data URL 编码或 base64 问题导致不显示。改用 `AMap.CircleMarker` 更可靠：

```javascript
// ❌ 避免：自定义 SVG Icon（data URL 编码容易出错）
var markerIcon = new AMap.Icon({
  size: new AMap.Size(24, 24),
  image: 'data:image/svg+xml;base64,...',
});

// ✅ 推荐：CircleMarker 原生渲染
// 注意：属性名是 fillColor/strokeColor/strokeWeight，不是 fillStyle/strokeStyle/strokeWidth
state.userMarker = new AMap.CircleMarker({
  position: [lng, lat],
  radius: 10,
  fillColor: '#4096ff',
  strokeColor: '#ffffff',
  strokeWeight: 2,
  fillOpacity: 1,
  zIndex: 1000,
});
state.map.add(state.userMarker);
```

**CircleMarker 属性对照**（高德 2.0 正确属性名）：

| 错误属性名 | 正确属性名 | 说明 |
|-----------|-----------|------|
| `fillStyle` | `fillColor` | 填充颜色 |
| `strokeStyle` | `strokeColor` | 描边颜色 |
| `strokeWidth` | `strokeWeight` | 描边宽度 |

### 6. 定位标记被瓦片遮挡 — CircleMarker zIndex 不生效

**现象**：`setCenter` 已跳转到当前位置，`CircleMarker` 也创建成功，但界面上看不见。

**原因**：高德地图 2.0 中 `CircleMarker` 的 `zIndex` 属性**不生效**，CircleMarker 作为矢量覆盖物会被地图瓦片遮挡。

**修复**：使用 DOM 型 `AMap.Marker` + 自定义 HTML 元素，通过 CSS 保证显示在最上层：

```javascript
// ❌ CircleMarker（zIndex 不生效，可能被瓦片遮挡）
state.userMarker = new AMap.CircleMarker({
  position: [lng, lat],
  zIndex: 1000,
  // ...
});

// ✅ 推荐：DOM 型 Marker + HTML 元素
var markerContent = document.createElement('div');
markerContent.style.cssText = 'width:16px;height:16px;background:#4096ff;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.4);transform:translate(-8px,-8px);';

state.userMarker = new AMap.Marker({
  content: markerContent,
  zIndex: 1001,
});
state.map.add(state.userMarker);
state.userMarker.hide();  // 初始隐藏
// 定位成功后：
state.userMarker.setPosition([lng, lat]);
state.userMarker.show();
```

> 同样适用于起终点 marker——如果 `AMap.CircleMarker` 在地图上不可见，也改用 DOM 型 Marker。

### 7. 定位标记创建时序问题

**现象**：地图已跳转到当前位置但蓝色圆圈不显示。

**原因**：`setCenter` 是异步操作，立即调用 `showDefaultMarker` 时地图可能还没渲染到新位置，或者 CircleMarker 需要在地图渲染完成后才能显示。

**修复**：
1. `setCenter` 后延迟创建 marker（`setTimeout` 300ms）
2. 直接传入定位坐标而不是依赖 `map.getCenter()`
3. 每次创建前先移除旧 marker 避免叠加

```javascript
function onLocationSuccess(result) {
  // ...解析坐标...
  state.map.setCenter([lng, lat]);
  // 延迟确保地图已渲染，直接传入坐标
  setTimeout(function() {
    showDefaultMarker([lng, lat]);
  }, 300);
}

function showDefaultMarker(lnglat) {
  // 先移除旧标记
  if (state.userMarker) {
    state.map.remove(state.userMarker);
    state.userMarker = null;
  }
  lnglat = lnglat || [state.map.getCenter().lng, state.map.getCenter().lat];
  state.userMarker = new AMap.CircleMarker({
    position: lnglat,
    // ...
  });
  state.map.add(state.userMarker);
}
```

### 7. 检查 DOM 引用完整性

**常见错误**：HTML 中有 `id="xxx"` 的元素，但 `dom` 对象中缺少对应引用，导致 `dom.xxx is undefined`。

```javascript
// 确保 dom 对象中引用了所有需要操作的元素
var dom = {
  simBtn: document.getElementById('simBtn'),  // ← 容易遗漏
  // ... 其他引用
};
```

### 8. 浏览器环境限制

- **HTTPS 要求**：`navigator.geolocation` 只在 HTTPS 或 `localhost`/`file://` 下可用
- **权限请求**：浏览器会弹出定位权限对话框，用户拒绝后定位会静默失败
- **IP 定位兜底**：当浏览器定位不可用时，高德 IP 定位是有效的降级方案

## 快速检查清单

| 检查项 | 方法 |
|--------|------|
| AMap 加载成功？ | 控制台 `window.AMap` 是否为对象 |
| 安全密钥在地图脚本前？ | 检查 HTML 中 script 顺序 |
| 版本号格式正确？ | 使用 `v=2.0`，不要带补丁号 |
| 安全密钥导致脚本失败？ | 临时注释安全密钥测试 |
| 坐标读取兼容两种格式？ | 同时支持 `result.position` 和 `result.lng` |
| 有错误提示？ | 处理 `error`、`timeout` 等状态 |
| enableHighAccuracy 触发坐标转换？ | 本地开发设为 false |
| 用户能手动触发定位？ | 高德控件按钮点击绑定事件 |
| DOM 引用完整？ | 对比 HTML id 和 dom 对象属性 |
| 定位标记属性名正确？ | `fillColor`/`strokeColor`/`strokeWeight` |
| 标记创建有时序问题？ | 延迟 + 先移除旧标记 + 直接传坐标 |
| 定位标记可靠？ | 用 `CircleMarker` 代替自定义 SVG |
| 定位标记被遮挡？ | CircleMarker zIndex 不生效时用 DOM 型 Marker + CSS |
| 分享图片用真实瓦片？ | 调用 `drawMapAndRouteOnCanvas` 而非 `drawSimpleMapGrid` |
