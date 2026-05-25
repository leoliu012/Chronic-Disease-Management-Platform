function getBaseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl || wx.getStorageSync('apiBaseUrl') || 'http://127.0.0.1:3000';
}

function getPatientToken() {
  const app = getApp();
  return app.globalData.patientToken || wx.getStorageSync('patientToken') || '';
}

function getDemoOpenId() {
  const app = getApp();
  let demoOpenId = app.globalData.demoOpenId || wx.getStorageSync('demoOpenId') || '';
  if (!demoOpenId) {
    demoOpenId = `demo-openid-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    app.globalData.demoOpenId = demoOpenId;
    wx.setStorageSync('demoOpenId', demoOpenId);
  }
  return demoOpenId;
}

function clearPatientSession() {
  const app = getApp();
  app.globalData.patientToken = '';
  app.globalData.patientId = '';
  app.globalData.patient = null;
  app.globalData.bindingStatus = 'UNBOUND';
  wx.removeStorageSync('patientToken');
  wx.removeStorageSync('patientId');
  wx.removeStorageSync('patient');
  wx.setStorageSync('bindingStatus', 'UNBOUND');
}

/**
 * 彻底重置本机患者身份。
 *
 * 与 clearPatientSession 的区别：clearPatientSession 只清会话 token（供 token 过期后
 * 用同一 demoOpenId 重新 demo-login 找回原绑定）；本函数在清会话之外，还会轮换
 * demoOpenId —— 即丢弃当前设备身份。
 *
 * 为什么必须轮换 demoOpenId：服务端的绑定申请按 demoOpenId 关联，只要 demoOpenId
 * 不变，bind 页自动调用的 demo-login 就会重新命中那条 APPROVED 绑定，把旧患者档案
 * 和 token 一起“复活”。用户点「清除本机会话 / 切换身份」期望的是换一个干净身份重新
 * 搜索绑定，因此这里轮换 demoOpenId，下次 getDemoOpenId() 会生成一个全新的。
 */
function resetPatientIdentity() {
  clearPatientSession();
  const app = getApp();
  app.globalData.demoOpenId = '';
  wx.removeStorageSync('demoOpenId');
}

function persistPatientSession(payload) {
  const app = getApp();
  const patient = payload && payload.patient;
  const token = payload && payload.patientToken;
  const demoOpenId = (payload && payload.demoOpenId) || getDemoOpenId();
  const bindingStatus = (payload && payload.bindingStatus) || 'UNBOUND';

  app.globalData.demoOpenId = demoOpenId;
  app.globalData.bindingStatus = bindingStatus;
  wx.setStorageSync('demoOpenId', demoOpenId);
  wx.setStorageSync('bindingStatus', bindingStatus);

  if (token && patient && patient.id) {
    app.globalData.patientToken = token;
    app.globalData.patientId = patient.id;
    app.globalData.patient = patient;
    wx.setStorageSync('patientToken', token);
    wx.setStorageSync('patientId', patient.id);
    wx.setStorageSync('patient', patient);
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_WRITE_REQUEST_TIMEOUT_MS = 120000;

function isWriteMethod(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method || 'GET').toUpperCase());
}

function getRequestTimeout(options) {
  if (typeof options.timeout === 'number' && options.timeout > 0) return options.timeout;
  return isWriteMethod(options.method) ? DEFAULT_WRITE_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
}

function normalizeRequestError(err) {
  const raw = (err && (err.errMsg || err.message)) || '';
  if (/timeout/i.test(raw)) {
    return new Error('请求超时：后端可能仍在处理中，请稍后刷新确认结果');
  }
  if (/fail|request/i.test(raw)) {
    return new Error(raw || '网络请求失败，请检查 API 地址和后端服务');
  }
  return new Error(raw || '网络请求失败，请检查 API 地址和后端服务');
}

function buildQuery(query) {
  if (!query) return '';
  const pairs = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

function request(options) {
  const url = `${getBaseUrl()}${options.url}${buildQuery(options.query)}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method || 'GET',
      data: options.data || undefined,
      timeout: getRequestTimeout(options),
      header: {
        'content-type': 'application/json',
        ...(options.header || {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }

        const message =
          (res.data && (res.data.message || res.data.error)) ||
          `请求失败：HTTP ${res.statusCode}`;
        reject(new Error(Array.isArray(message) ? message.join('；') : message));
      },
      fail(err) {
        reject(normalizeRequestError(err));
      }
    });
  });
}

function patientRequest(options) {
  const token = getPatientToken();
  if (!token) {
    return Promise.reject(new Error('请先完成患者身份绑定并等待护士审核'));
  }

  return request({
    ...options,
    url: `/patient-app${options.url}`,
    header: {
      ...(options.header || {}),
      'X-Patient-Token': token
    }
  }).catch((error) => {
    if (/token|session|401|Unauthorized|expired/i.test(error.message || '')) {
      clearPatientSession();
    }
    throw error;
  });
}

function openMiniProgramPage(url, options) {
  const opts = options || {};
  if (!url) {
    wx.showToast({ title: '页面地址为空', icon: 'none' });
    return;
  }

  const onFail = opts.onFail || function fallbackFailed(err) {
    wx.showToast({
      title: (err && err.errMsg) || '无法打开页面，请检查 app.json 页面配置',
      icon: 'none'
    });
  };

  wx.navigateTo({
    url,
    success: opts.success,
    fail(firstErr) {
      wx.redirectTo({
        url,
        success: opts.success,
        fail(secondErr) {
          wx.reLaunch({
            url,
            success: opts.success,
            fail(thirdErr) {
              wx.switchTab({
                url,
                success: opts.success,
                fail() {
                  onFail(thirdErr || secondErr || firstErr);
                }
              });
            }
          });
        }
      });
    }
  });
}

module.exports = {
  request,
  patientRequest,
  getBaseUrl,
  getPatientToken,
  getDemoOpenId,
  clearPatientSession,
  resetPatientIdentity,
  persistPatientSession,
  // openMiniProgramPage 此前已定义但漏在导出列表里，导致 home 页 require 后为
  // undefined：点击「切换」(goBind) 抛 TypeError、按钮看似无反应。这里补上导出。
  openMiniProgramPage,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_WRITE_REQUEST_TIMEOUT_MS
};


